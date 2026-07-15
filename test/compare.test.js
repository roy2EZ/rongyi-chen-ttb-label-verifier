/**
 * compare.test.js — automated tests for the verification engine.
 *
 * Uses Node's built-in test runner (no dependencies):  node --test
 *
 * These tests pin down the behavior that matters most to the agents we
 * interviewed: the government warning must match exactly, obvious case
 * differences should be REVIEW (not FAIL), and unit-equivalent values must pass.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  verifyLabel,
  checkGovernmentWarning,
  parseAbv,
  parseNetContents,
  similarity,
  Verdict,
  GOV_WARNING_PREFIX,
  GOV_WARNING_BODY,
} = require('../js/compare.js');

const WARNING_OK = GOV_WARNING_PREFIX + ' ' + GOV_WARNING_BODY;

/** Build OCR text for a well-formed, compliant label. */
function cleanLabelText(over = {}) {
  return [
    over.brand || "Stone's Throw",
    over.classType || 'Cabernet Sauvignon',
    over.abv || '13.5% Alc./Vol.',
    over.net || '750 mL',
    over.warning || WARNING_OK,
  ].join('\n');
}

const APP = {
  brandName: "Stone's Throw",
  classType: 'Cabernet Sauvignon',
  abv: '13.5',
  netContents: '750 mL',
};

const byField = (result) =>
  Object.fromEntries(result.checks.map((c) => [c.field, c.verdict]));

/* ------------------------------ overall flow ---------------------------- */

test('clean compliant label -> overall PASS, all fields PASS', () => {
  const r = verifyLabel(APP, cleanLabelText());
  assert.equal(r.overall, Verdict.PASS);
  for (const c of r.checks) assert.equal(c.verdict, Verdict.PASS, c.field);
});

test('ABV mismatch -> Alcohol Content FAIL, overall FAIL', () => {
  const r = verifyLabel({ ...APP, abv: '14' }, cleanLabelText());
  assert.equal(byField(r)['Alcohol Content'], Verdict.FAIL);
  assert.equal(r.overall, Verdict.FAIL);
});

/* --------------------- government warning (Jenny's rule) ---------------- */

test("title-case 'Government Warning' -> FAIL", () => {
  const bad = 'Government Warning: ' + GOV_WARNING_BODY;
  const res = checkGovernmentWarning(bad);
  assert.equal(res.verdict, Verdict.FAIL);
});

test('missing warning -> FAIL', () => {
  const res = checkGovernmentWarning('Stone\'s Throw 13.5% Alc./Vol. 750 mL');
  assert.equal(res.verdict, Verdict.FAIL);
});

test('exact all-caps warning -> PASS', () => {
  const res = checkGovernmentWarning(WARNING_OK);
  assert.equal(res.verdict, Verdict.PASS);
});

/* ----------------------- case differences (Dave's rule) ----------------- */

test("brand 'STONE'S THROW' vs 'Stone's Throw' -> REVIEW (not FAIL)", () => {
  const r = verifyLabel(APP, cleanLabelText({ brand: "STONE'S THROW" }));
  assert.equal(byField(r)['Brand Name'], Verdict.REVIEW);
});

/* ------------------------ unit equivalence / parsing -------------------- */

test('net contents 0.75 L on label matches 750 mL application -> PASS', () => {
  const r = verifyLabel(APP, cleanLabelText({ net: '0.75 L' }));
  assert.equal(byField(r)['Net Contents'], Verdict.PASS);
});

test('proof on label (90 proof) matches 45% application -> PASS', () => {
  const app = { ...APP, abv: '45' };
  const r = verifyLabel(app, cleanLabelText({ abv: '90 Proof' }));
  assert.equal(byField(r)['Alcohol Content'], Verdict.PASS);
});

test('parseAbv reads several formats', () => {
  assert.equal(parseAbv('13.5% Alc./Vol.'), 13.5);
  assert.equal(parseAbv('ALC. 40% BY VOL'), 40);
  assert.equal(parseAbv('90 proof'), 45);
  assert.equal(parseAbv('no alcohol statement here'), null);
});

test('parseNetContents normalizes to mL', () => {
  assert.equal(parseNetContents('750 mL').ml, 750);
  assert.equal(parseNetContents('1 L').ml, 1000);
  assert.equal(parseNetContents('0.75 L').ml, 750);
  assert.equal(parseNetContents('no volume'), null);
});

test('similarity is 1 for identical, lower for different', () => {
  assert.equal(similarity('cabernet', 'cabernet'), 1);
  assert.ok(similarity('cabernet', 'cabrnet') > 0.8);
  assert.ok(similarity('cabernet', 'zzzz') < 0.3);
});
