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

  imageInput.addEventListener('change', () => {
    const file = imageInput.files && imageInput.files[0];
    if (!file) return;
    previewImg.src = URL.createObjectURL(file);
    previewWrap.hidden = false;
    if (dropText) dropText.textContent = file.name;
  });

  /* ------------------------------ verify ------------------------------- */

  const verifyBtn = document.getElementById('verify-btn');
  const resultsEl = document.getElementById('results');

  verifyBtn.addEventListener('click', () => {
    const application = {
      brandName: value('app-brand'),
      classType: value('app-class'),
      abv: value('app-abv'),
      netContents: value('app-net'),
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
})();
