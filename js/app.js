/**
 * app.js — UI wiring for the single-label verification flow.
 *
 * Iteration 2 scope: connect the DOM to the compare.js engine.
 * OCR is not wired yet — the user pastes the label text into a textarea, which
 * stands in for the OCR output. Iteration 3 replaces that textarea with
 * tesseract.js so images are read automatically.
 */

(function () {
  'use strict';

  /* ------------------------------- tabs -------------------------------- */

  const tabs = document.querySelectorAll('.tab');
  const panels = {
    single: document.getElementById('panel-single'),
    batch: document.getElementById('panel-batch'),
  };

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      tabs.forEach((t) => {
        const active = t === tab;
        t.classList.toggle('is-active', active);
        t.setAttribute('aria-selected', String(active));
      });
      Object.entries(panels).forEach(([name, panel]) => {
        const active = name === target;
        panel.classList.toggle('is-active', active);
        panel.hidden = !active;
      });
    });
  });

  /* --------------------------- image preview --------------------------- */

  const imageInput = document.getElementById('label-image');
  const previewWrap = document.getElementById('image-preview');
  const previewImg = document.getElementById('preview-img');
  const dropText = document.querySelector('.dropzone-text');
  const ocrStatus = document.getElementById('ocr-status');
  const labelText = document.getElementById('label-text');

  imageInput.addEventListener('change', () => {
    const file = imageInput.files && imageInput.files[0];
    if (!file) return;
    previewImg.src = URL.createObjectURL(file);
    previewWrap.hidden = false;
    if (dropText) dropText.textContent = file.name;
    runOcr(file);
  });

  /**
   * Read the label image with OCR, fill the text box, and report elapsed time.
   * The 5-second target from the interviews is shown explicitly so an agent can
   * see the tool is meeting it.
   */
  async function runOcr(file) {
    const btn = document.getElementById('verify-btn');
    ocrStatus.hidden = false;
    ocrStatus.className = 'ocr-status working';
    ocrStatus.textContent = 'Reading label… 0%';
    btn.disabled = true;
    const t0 = performance.now();
    try {
      const text = await window.extractText(file, {
        onProgress: (p) => {
          ocrStatus.textContent = 'Reading label… ' + Math.round(p * 100) + '%';
        },
      });
      const ms = Math.round(performance.now() - t0);
      labelText.value = text.trim();
      const slow = ms > 5000;
      ocrStatus.className = 'ocr-status done' + (slow ? ' slow' : '');
      ocrStatus.textContent = 'Read in ' + ms + ' ms'
        + (slow ? ' (over the 5s target)' : '')
        + '. Review the text below, then click Verify.';
    } catch (err) {
      ocrStatus.className = 'ocr-status error';
      ocrStatus.textContent = 'OCR failed: ' + err.message
        + ' You can type or paste the label text below instead.';
    } finally {
      btn.disabled = false;
    }
  }

  /* ------------------------------ verify ------------------------------- */

  const verifyBtn = document.getElementById('verify-btn');
  const resultsEl = document.getElementById('results');

  verifyBtn.addEventListener('click', () => {
    const application = {
      brandName: value('app-brand'),
      classType: value('app-class'),
      abv: value('app-abv'),
      netContents: value('app-net'),
      producer: value('app-producer'),
      countryOfOrigin: value('app-country'),
    };
    const ocrText = value('label-text');

    if (!ocrText) {
      renderNotice('Please paste the label text first (temporary step until OCR is wired up).');
      return;
    }

    const result = window.verifyLabel(application, ocrText);
    renderResult(result);
  });

  function value(id) {
    return document.getElementById(id).value.trim();
  }

  /* ------------------------------ render ------------------------------- */

  /** Map a verdict to a CSS modifier class. */
  function verdictClass(verdict) {
    return verdict === window.Verdict.PASS ? 'pass'
      : verdict === window.Verdict.REVIEW ? 'review'
      : 'fail';
  }

  /** Human-friendly label for the overall banner. */
  function overallLabel(verdict) {
    return verdict === window.Verdict.PASS ? 'PASS — all fields match'
      : verdict === window.Verdict.REVIEW ? 'NEEDS REVIEW — some fields need a human check'
      : 'FAIL — one or more fields do not match';
  }

  function renderNotice(message) {
    resultsEl.innerHTML = `<div class="notice">${escapeHtml(message)}</div>`;
  }

  function renderResult(result) {
    const rows = result.checks.map((c) => `
      <div class="check-row ${verdictClass(c.verdict)}">
        <div class="check-head">
          <span class="check-field">${escapeHtml(c.field)}</span>
          <span class="badge ${verdictClass(c.verdict)}">${escapeHtml(c.verdict)}</span>
        </div>
        <div class="check-reason">${escapeHtml(c.reason)}</div>
      </div>
    `).join('');

    resultsEl.innerHTML = `
      <div class="overall ${verdictClass(result.overall)}">
        ${escapeHtml(overallLabel(result.overall))}
      </div>
      <div class="checks">${rows}</div>
    `;
  }

  /** Minimal HTML escaping for text interpolated into result markup. */
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* =============================== batch =============================== */
  /*
   * Batch mode: a CSV of application rows + a set of label images. Each row is
   * matched to its image by filename, OCR'd, and verified — with a progress bar
   * and a results table. This addresses the seasonal-volume requirement (200-300
   * labels) the compliance director raised. One persistent OCR worker is reused
   * across the whole run so the engine loads once, not per image.
   */

  const csvInput = document.getElementById('batch-csv');
  const imagesInput = document.getElementById('batch-images');
  const batchRunBtn = document.getElementById('batch-run');
  const batchProgress = document.getElementById('batch-progress');
  const progressBar = document.getElementById('progress-bar');
  const progressLabel = document.getElementById('progress-label');
  const batchResults = document.getElementById('batch-results');

  let batchRows = [];      // parsed CSV rows (application data)
  let batchImages = new Map(); // filename -> File

  csvInput.addEventListener('change', async () => {
    const file = csvInput.files && csvInput.files[0];
    if (!file) return;
    document.getElementById('batch-csv-text').textContent = file.name;
    try {
      batchRows = parseCsv(await file.text());
    } catch (err) {
      batchRows = [];
      renderBatchNotice('Could not read the CSV: ' + err.message);
    }
    updateBatchReady();
  });

  imagesInput.addEventListener('change', () => {
    batchImages = new Map();
    const files = imagesInput.files ? Array.from(imagesInput.files) : [];
    files.forEach((f) => batchImages.set(f.name, f));
    document.getElementById('batch-images-text').textContent =
      files.length ? files.length + ' image' + (files.length === 1 ? '' : 's') + ' selected' : 'Click to choose label images';
    updateBatchReady();
  });

  function updateBatchReady() {
    batchRunBtn.disabled = !(batchRows.length && batchImages.size);
  }

  /**
   * Tiny CSV parser — handles quoted fields, escaped quotes, and commas inside
   * quotes. The government warning is never in this file (it's fixed text), so
   * we don't need a full RFC-4180 parser, just enough for typical exports.
   */
  function parseCsv(text) {
    const rows = [];
    let field = '', row = [], inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += ch;
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field); field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some((c) => c.trim() !== '')) rows.push(row);
        row = [];
      } else field += ch;
    }
    if (field !== '' || row.length) { row.push(field); if (row.some((c) => c.trim() !== '')) rows.push(row); }
    if (!rows.length) throw new Error('file is empty');

    const header = rows[0].map((h) => h.trim().toLowerCase());
    const idx = (name) => header.indexOf(name);
    const need = ['filename', 'brand_name', 'class_type', 'abv', 'net_contents'];
    const missing = need.filter((n) => idx(n) === -1);
    if (missing.length) throw new Error('missing columns: ' + missing.join(', '));

    return rows.slice(1).map((cells) => ({
      filename: (cells[idx('filename')] || '').trim(),
      brandName: (cells[idx('brand_name')] || '').trim(),
      classType: (cells[idx('class_type')] || '').trim(),
      abv: (cells[idx('abv')] || '').trim(),
      netContents: (cells[idx('net_contents')] || '').trim(),
      producer: idx('producer') > -1 ? (cells[idx('producer')] || '').trim() : '',
      countryOfOrigin: idx('country_of_origin') > -1 ? (cells[idx('country_of_origin')] || '').trim() : '',
    }));
  }

  batchRunBtn.addEventListener('click', runBatch);

  async function runBatch() {
    batchRunBtn.disabled = true;
    batchResults.innerHTML = '';
    batchProgress.hidden = false;
    setProgress(0, batchRows.length);

    let recognizer;
    try {
      recognizer = await window.createBatchRecognizer();
    } catch (err) {
      renderBatchNotice('OCR engine unavailable: ' + err.message);
      batchProgress.hidden = true;
      batchRunBtn.disabled = false;
      return;
    }

    const results = [];
    const runStart = performance.now();
    for (let i = 0; i < batchRows.length; i++) {
      const app = batchRows[i];
      progressLabel.textContent = `Reading ${app.filename} (${i + 1} of ${batchRows.length})…`;
      const file = batchImages.get(app.filename);
      if (!file) {
        results.push({ app, missing: true });
      } else {
        const t0 = performance.now();
        try {
          const text = await recognizer.recognize(file);
          const verdict = window.verifyLabel(app, text);
          results.push({ app, result: verdict, ms: Math.round(performance.now() - t0), text });
        } catch (err) {
          results.push({ app, error: err.message });
        }
      }
      setProgress(i + 1, batchRows.length);
    }
    await recognizer.terminate();

    const totalMs = Math.round(performance.now() - runStart);
    progressLabel.textContent =
      `Done — ${batchRows.length} labels in ${(totalMs / 1000).toFixed(1)} s ` +
      `(${Math.round(totalMs / batchRows.length)} ms avg per label).`;
    renderBatchResults(results);
    batchRunBtn.disabled = false;
  }

  function setProgress(done, total) {
    const pct = total ? Math.round((done / total) * 100) : 0;
    progressBar.style.width = pct + '%';
  }

  function renderBatchNotice(message) {
    batchResults.innerHTML = `<div class="notice">${escapeHtml(message)}</div>`;
  }

  function renderBatchResults(results) {
    const V = window.Verdict;
    const counts = { [V.PASS]: 0, [V.REVIEW]: 0, [V.FAIL]: 0, other: 0 };
    results.forEach((r) => {
      if (r.result) counts[r.result.overall] = (counts[r.result.overall] || 0) + 1;
      else counts.other++;
    });

    const summary = `
      <div class="batch-summary">
        <span class="badge pass">${counts[V.PASS]} pass</span>
        <span class="badge review">${counts[V.REVIEW]} review</span>
        <span class="badge fail">${counts[V.FAIL]} fail</span>
        ${counts.other ? `<span class="badge other">${counts.other} not processed</span>` : ''}
      </div>`;

    const rows = results.map((r, i) => {
      const name = escapeHtml(r.app.filename || '(no filename)');
      if (r.missing || r.error) {
        const msg = r.missing ? 'No matching image uploaded' : 'Error: ' + r.error;
        return `<tr class="row-other">
          <td>${name}</td>
          <td><span class="badge other">NOT PROCESSED</span></td>
          <td class="row-msg">${escapeHtml(msg)}</td>
        </tr>`;
      }
      const cls = verdictClass(r.result.overall);
      const detailId = 'detail-' + i;
      const detail = r.result.checks.map((c) => `
        <div class="check-row ${verdictClass(c.verdict)}">
          <div class="check-head">
            <span class="check-field">${escapeHtml(c.field)}</span>
            <span class="badge ${verdictClass(c.verdict)}">${escapeHtml(c.verdict)}</span>
          </div>
          <div class="check-reason">${escapeHtml(c.reason)}</div>
        </div>`).join('');
      return `<tr class="row-${cls}">
          <td>${name}</td>
          <td><span class="badge ${cls}">${escapeHtml(r.result.overall)}</span></td>
          <td class="row-msg">
            <button type="button" class="link-btn" data-detail="${detailId}" aria-expanded="false">details</button>
            <span class="row-time">${r.ms} ms</span>
          </td>
        </tr>
        <tr class="detail-row" id="${detailId}" hidden><td colspan="3"><div class="checks">${detail}</div></td></tr>`;
    }).join('');

    batchResults.innerHTML = summary + `
      <div class="table-wrap">
        <table class="results-table">
          <thead><tr><th>Label</th><th>Verdict</th><th>Detail</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;

    batchResults.querySelectorAll('.link-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const row = document.getElementById(btn.dataset.detail);
        const open = row.hidden;
        row.hidden = !open;
        btn.setAttribute('aria-expanded', String(open));
        btn.textContent = open ? 'hide' : 'details';
      });
    });
  }
})();
