/**
 * compare.js — Field comparison engine for TTB label verification.
 *
 * Design: three-state verdicts per field, mirroring how a human agent works:
 *   PASS   — matches (possibly after safe normalization)
 *   REVIEW — likely the same, but a human should confirm (e.g. case/punctuation
 *            differences: "STONE'S THROW" vs "Stone's Throw")
 *   FAIL   — clear mismatch or required element missing
 *
 * All matching is deterministic and explainable: every verdict carries a
 * human-readable reason so agents can trust (and audit) the tool.
 */

const Verdict = Object.freeze({ PASS: 'PASS', REVIEW: 'REVIEW', FAIL: 'FAIL' });

/* The mandatory Government Health Warning text, 27 CFR Part 16. */
const GOV_WARNING_PREFIX = 'GOVERNMENT WARNING:';
const GOV_WARNING_BODY =
  '(1) According to the Surgeon General, women should not drink alcoholic ' +
  'beverages during pregnancy because of the risk of birth defects. ' +
  '(2) Consumption of alcoholic beverages impairs your ability to drive a car ' +
  'or operate machinery, and may cause health problems.';

/* ---------------------------- normalization ---------------------------- */

/** Lowercase, strip punctuation, collapse whitespace. For fuzzy comparison. */
function normalizeLoose(s) {
  return (s || '')
    .toLowerCase()
    .replace(/['’‘`]/g, '')      // apostrophe variants
    .replace(/[^a-z0-9%.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Collapse whitespace only — preserves case and punctuation. */
function normalizeSpace(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

/** Levenshtein similarity ratio in [0,1]. */
function similarity(a, b) {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}

/* ------------------------------ extractors ----------------------------- */

/** Parse alcohol content from text: "45% Alc./Vol.", "ALC. 45% BY VOL", "90 proof". */
function parseAbv(text) {
  const t = text.replace(/\s+/g, ' ');
  // "45% alc" / "alc 45%" / "45 % alc./vol."
  let m =
    t.match(/(\d{1,2}(?:\.\d+)?)\s*%\s*alc/i) ||
    t.match(/alc[^0-9]{0,12}(\d{1,2}(?:\.\d+)?)\s*%/i) ||
    t.match(/(\d{1,2}(?:\.\d+)?)\s*%\s*(?:alcohol|abv|by vol)/i);
  if (m) return parseFloat(m[1]);
  // proof → ABV
  m = t.match(/(\d{2,3})\s*proof/i);
  if (m) return parseFloat(m[1]) / 2;
  return null;
}

/** Normalize net contents to milliliters. Returns {ml, raw} or null. */
function parseNetContents(text) {
  const t = text.replace(/\s+/g, ' ');
  const m = t.match(/(\d+(?:\.\d+)?)\s*(milliliters?|millilitres?|ml|liters?|litres?|l|fl\.?\s*oz|fluid\s*ounces?|oz)\b/i);
  if (!m) return null;
  const v = parseFloat(m[1]);
  const unit = m[2].toLowerCase().replace(/[\s.]/g, '');
  let ml;
  if (unit === 'ml' || unit.startsWith('milli')) ml = v;
  else if (unit === 'l' || unit.startsWith('liter') || unit.startsWith('litre')) ml = v * 1000;
  else ml = v * 29.5735; // fluid ounces
  return { ml: Math.round(ml * 10) / 10, raw: m[0] };
}

/* ------------------------------ field checks --------------------------- */

/** Generic text field check (brand name, class/type). */
function checkTextField(label, expected, ocrText, fieldName) {
  const exp = normalizeSpace(expected);
  if (!exp) return { field: fieldName, verdict: Verdict.REVIEW, reason: 'No expected value provided in application data.' };

  const hay = normalizeSpace(ocrText);
  const hayLoose = normalizeLoose(hay);
  const expLoose = normalizeLoose(exp);

  // 1. exact (case-sensitive) substring
  if (hay.includes(exp)) {
    return { field: fieldName, verdict: Verdict.PASS, reason: `Exact match found on label: "${exp}"` };
  }
  // 2. case/punctuation-insensitive substring → REVIEW ("Dave's rule": obviously
  //    the same thing, but technically different — surface it, don't auto-fail.)
  if (expLoose && hayLoose.includes(expLoose)) {
    return {
      field: fieldName, verdict: Verdict.REVIEW,
      reason: `Likely match with case/punctuation differences (application: "${exp}"). Agent judgment recommended.`
    };
  }
  // 3. fuzzy window scan — tolerate small OCR errors
  const words = hayLoose.split(' ');
  const expWords = expLoose.split(' ').length;
  let best = 0;
  for (let i = 0; i + expWords <= words.length; i++) {
    const win = words.slice(i, i + expWords).join(' ');
    best = Math.max(best, similarity(win, expLoose));
  }
  if (best >= 0.85) {
    return {
      field: fieldName, verdict: Verdict.REVIEW,
      reason: `Near match (${Math.round(best * 100)}% similar) — possible OCR noise or minor label variation. Verify visually.`
    };
  }
  return { field: fieldName, verdict: Verdict.FAIL, reason: `"${exp}" not found on label (best similarity ${Math.round(best * 100)}%).` };
}

/** Alcohol content check: numeric comparison, proof cross-check. */
function checkAbv(label, expectedAbv, ocrText) {
  const exp = parseFloat(expectedAbv);
  if (isNaN(exp)) return { field: 'Alcohol Content', verdict: Verdict.REVIEW, reason: 'No expected ABV provided.' };
  const found = parseAbv(ocrText);
  if (found === null) {
    return { field: 'Alcohol Content', verdict: Verdict.FAIL, reason: 'No alcohol content statement detected on label.' };
  }
  if (Math.abs(found - exp) < 0.05) {
    return { field: 'Alcohol Content', verdict: Verdict.PASS, reason: `Label shows ${found}% — matches application (${exp}%).` };
  }
  return {
    field: 'Alcohol Content', verdict: Verdict.FAIL,
    reason: `Label shows ${found}% but application says ${exp}%.`
  };
}

/** Net contents check with unit normalization (750 mL == 0.75 L). */
function checkNetContents(label, expected, ocrText) {
  const expParsed = parseNetContents(String(expected));
  if (!expParsed) return { field: 'Net Contents', verdict: Verdict.REVIEW, reason: `Could not parse expected net contents: "${expected}".` };
  const found = parseNetContents(ocrText);
  if (!found) return { field: 'Net Contents', verdict: Verdict.FAIL, reason: 'No net contents statement detected on label.' };
  if (Math.abs(found.ml - expParsed.ml) <= expParsed.ml * 0.005) {
    return { field: 'Net Contents', verdict: Verdict.PASS, reason: `Label shows "${found.raw}" (≈${found.ml} mL) — matches application.` };
  }
  return {
    field: 'Net Contents', verdict: Verdict.FAIL,
    reason: `Label shows "${found.raw}" (≈${found.ml} mL) but application says ${expParsed.ml} mL.`
  };
}

/**
 * Government warning check — the strict one ("Jenny's rule"):
 *  - "GOVERNMENT WARNING:" must be present in ALL CAPS, exactly.
 *  - Body text must match word-for-word (whitespace-insensitive; case-insensitive
 *    body comparison with the diff reported, since OCR can lose case on body text).
 *  - Any deviation is reported with a word-level diff.
 * Note: bold-font verification is not possible from OCR output alone — flagged
 * in the UI as a manual check item.
 */
function checkGovernmentWarning(ocrText) {
  const flat = normalizeSpace(ocrText);

  // 1. locate the prefix, case-insensitively first
  const idx = flat.toUpperCase().indexOf(GOV_WARNING_PREFIX);
  if (idx === -1) {
    return { field: 'Government Warning', verdict: Verdict.FAIL, reason: 'Government warning statement not found on label.' };
  }
  const actualPrefix = flat.substr(idx, GOV_WARNING_PREFIX.length);
  const capsOk = actualPrefix === GOV_WARNING_PREFIX; // exact ALL-CAPS check

  // 2. compare body word-for-word
  const actualBody = normalizeSpace(flat.substr(idx + GOV_WARNING_PREFIX.length));
  const expWords = GOV_WARNING_BODY.toLowerCase().replace(/[^a-z0-9()\s]/g, '').split(/\s+/);
  const actWords = actualBody.toLowerCase().replace(/[^a-z0-9()\s]/g, '').split(/\s+/).slice(0, expWords.length + 8);

  const diffs = [];
  let ai = 0;
  for (let ei = 0; ei < expWords.length; ei++) {
    if (ai < actWords.length && actWords[ai] === expWords[ei]) { ai++; continue; }
    // simple lookahead resync (tolerate one OCR-garbled word)
    if (ai + 1 < actWords.length && actWords[ai + 1] === expWords[ei]) {
      diffs.push({ expected: ei > 0 ? expWords[ei - 1] : '(start)', got: actWords[ai], type: 'extra/garbled' });
      ai += 2; continue;
    }
    diffs.push({ expected: expWords[ei], got: actWords[ai] || '(missing)', type: 'mismatch' });
    ai++;
  }

  const wordAccuracy = 1 - diffs.length / expWords.length;

  if (!capsOk) {
    return {
      field: 'Government Warning', verdict: Verdict.FAIL,
      reason: `"${actualPrefix}" must appear in all capitals as "${GOV_WARNING_PREFIX}".`,
      diffs
    };
  }
  if (diffs.length === 0) {
    return {
      field: 'Government Warning', verdict: Verdict.PASS,
      reason: 'Warning statement present, "GOVERNMENT WARNING:" in all caps, body matches word-for-word. (Bold formatting: verify visually.)'
    };
  }
  if (wordAccuracy >= 0.9) {
    return {
      field: 'Government Warning', verdict: Verdict.REVIEW,
      reason: `Warning nearly matches (${diffs.length} word difference${diffs.length > 1 ? 's' : ''}) — may be OCR noise. Verify: ` +
        diffs.slice(0, 3).map(d => `expected "${d.expected}" got "${d.got}"`).join('; '),
      diffs
    };
  }
  return {
    field: 'Government Warning', verdict: Verdict.FAIL,
    reason: `Warning text deviates from the required statement (${diffs.length} differences). Required wording is mandatory and exact.`,
    diffs
  };
}

/**
 * Country of origin — only relevant for imported products. If the application
 * provides an expected country, confirm the label states it (e.g. "Product of
 * Chile"). If none is provided (a domestic product), the check is omitted so it
 * doesn't affect the verdict.
 * Returns a check object, or null when not applicable.
 */
function checkCountryOfOrigin(expected, ocrText) {
  const exp = normalizeSpace(expected);
  if (!exp) return null; // not applicable — domestic, or simply not provided
  const hayLoose = normalizeLoose(ocrText);
  const expLoose = normalizeLoose(exp);
  if (expLoose && hayLoose.includes(expLoose)) {
    return { field: 'Country of Origin', verdict: Verdict.PASS, reason: `Label states country of origin "${exp}".` };
  }
  // fuzzy single-word tolerance (OCR noise on the country name)
  let best = 0;
  for (const w of hayLoose.split(' ')) best = Math.max(best, similarity(w, expLoose));
  if (best >= 0.85) {
    return { field: 'Country of Origin', verdict: Verdict.REVIEW, reason: `Possible origin match (${Math.round(best * 100)}% similar) — verify visually.` };
  }
  return { field: 'Country of Origin', verdict: Verdict.FAIL, reason: `Expected country of origin "${exp}" not found on label.` };
}

/* ------------------------------ main entry ----------------------------- */

/**
 * verifyLabel(application, ocrText) → { overall, checks[] }
 * application: { brandName, classType, abv, netContents, producer, countryOfOrigin }
 * Country of origin is optional (imports only) and omitted when not provided.
 */
function verifyLabel(application, ocrText) {
  const checks = [
    checkTextField(null, application.brandName, ocrText, 'Brand Name'),
    checkTextField(null, application.classType, ocrText, 'Class / Type'),
    checkAbv(null, application.abv, ocrText),
    checkNetContents(null, application.netContents, ocrText),
    checkTextField(null, application.producer, ocrText, 'Producer / Bottler'),
  ];
  const country = checkCountryOfOrigin(application.countryOfOrigin, ocrText);
  if (country) checks.push(country);
  checks.push(checkGovernmentWarning(ocrText));

  const overall = checks.some(c => c.verdict === Verdict.FAIL) ? Verdict.FAIL
    : checks.some(c => c.verdict === Verdict.REVIEW) ? Verdict.REVIEW
    : Verdict.PASS;
  return { overall, checks };
}

/* Export for browser and for Node-based tests. */
const compareExports = {
  verifyLabel, checkGovernmentWarning, checkCountryOfOrigin,
  parseAbv, parseNetContents, similarity,
  Verdict, GOV_WARNING_PREFIX, GOV_WARNING_BODY,
};
if (typeof module !== 'undefined' && module.exports) {
  module.exports = compareExports;
}
if (typeof window !== 'undefined') {
  // Attach explicitly. A top-level `const` (e.g. Verdict) does NOT become a
  // window property on its own, so the UI needs these set here.
  Object.assign(window, compareExports);
}
