# TTB Alcohol Label Verification (Prototype)

A browser-based tool that checks an alcohol-beverage **label image** against the
data submitted on its **TTB application form**, and reports — field by field —
whether they match. Built as a take-home prototype for the U.S. Department of the
Treasury *IT Specialist (AI)* position, implementing the assignment described in
the [take-home instructions](https://github.com/treasurytakehome-rgb/instructions).

**Everything runs client-side in the browser.** No backend, no database, and no
image or data ever leaves the machine — a deliberate choice for a government
context (firewall-safe, no PII exposure).

> **Status:** the core and high-volume features are implemented and deployed;
> developed in small, reviewed iterations. See [Project status](#project-status)
> for the iteration log.

---

## What it does

TTB agents verify that the text on a beverage label matches the application the
producer submitted. This tool automates that first pass, entirely in the browser:

1. **Read the label** — tesseract.js OCRs the label image locally (no upload).
2. **Compare to the application** — each field is checked against the form values.
3. **Report a verdict** — every field gets **PASS**, **NEEDS REVIEW**, or **FAIL**
   with a plain-language, auditable reason. Ambiguous cases (e.g. a case-only
   difference like `STONE'S THROW` vs `Stone's Throw`) are surfaced as REVIEW,
   never silently passed or failed — the agent keeps the final call.

**What it checks:** brand name, class/type, alcohol content (incl. proof → ABV),
net contents (mL / L / fl oz), producer/bottler, the government warning
(`GOVERNMENT WARNING:` all-caps and word-for-word per 27 CFR Part 16 — a
title-case "Government Warning" correctly **FAILs**), and — for imports — country
of origin.

**Also:** single-label and **batch** modes (batch takes a CSV plus a folder of
images, with a progress bar and a results table); per-label elapsed time shown
against the 5-second target; editable OCR text so an agent can fix a misread
before verifying; and grayscale + contrast-stretch preprocessing for poor-light
photos.

Every requirement below was drawn from the assignment's stakeholder interviews and
the job announcement:

| Requirement | Source | How it's met |
|---|---|---|
| Compare label vs application on the core TTB fields | Assignment | Brand, class/type, ABV, net contents, producer, gov warning (+ country of origin for imports) in `compare.js` |
| Government warning matched **word-for-word**, all-caps prefix | Agent (Jenny) | `checkGovernmentWarning()` — all-caps check + word diff |
| Case differences shouldn't hard-fail | Agent (Dave) | 3-state verdicts; case/punct diff → **REVIEW** |
| Results in **≤ 5 seconds** | Compliance Dir. (Sarah) | client-side OCR; per-label time shown |
| **Batch upload** for volume spikes | Sarah | CSV + image set → progress bar + results table; one reused OCR worker |
| Usable by non-technical agents | Sarah | one screen, large type, big color-coded verdicts |
| Handle imperfect photos (angle/glare) | Jenny | canvas grayscale + contrast-stretch preprocessing |
| Government network blocks outbound ML endpoints | IT (Marcus) | **all processing in-browser, no external API calls** |
| No PII storage, standalone, no COLA integration | Marcus | static site; nothing leaves the browser; no backend |
| Implement an AI solution in a test/production environment | Job (selective factor) | deployed and accessible on GitHub Pages |

---

## Setup & run

It's a static site, but OCR needs to be served over HTTP (a Web Worker + WASM
won't load from a `file://` page), so use any static server:

```bash
git clone https://github.com/roy2EZ/rongyi-chen-ttb-label-verifier.git
cd rongyi-chen-ttb-label-verifier

# serve locally (any static server works)
python3 -m http.server 8000
# then open http://localhost:8000
```

**Deployed prototype:** https://roy2ez.github.io/rongyi-chen-ttb-label-verifier/

### Try it

**Primary example (all-green PASS).** Upload `samples/sample_old_tom_bourbon.png`
and enter: Brand `OLD TOM DISTILLERY`, Class `Kentucky Straight Bourbon Whiskey`,
ABV `45`, Net `750 mL`, Producer `Old Tom Distillery` → every field **PASS**. This
one also exercises distilled-spirits proof parsing (the label reads
`45% Alc./Vol. (90 Proof)`) and the producer/bottler check.

**Case-difference example (NEEDS REVIEW).** Upload
`samples/sample_stones_throw_cabernet.png` and enter Brand `Stone's Throw` (title
case) against the label's `STONE'S THROW` (all caps) → the brand becomes **NEEDS
REVIEW**, not a hard fail (Dave's rule).

**Batch.** In the Batch tab, choose `samples/batch.csv` and select all the images
in the `samples/` folder — the first CSV row is the Old Tom benchmark. The two
`sample_*` files are synthetic; the `real_*` files are real-world back-label
photos, included to show OCR on harder images.

---

## Architecture

Pure client-side static site — HTML + vanilla JavaScript + tesseract.js. No build
step, no server.

```
index.html          Single-screen UI (Single / Batch tabs)
css/styles.css      Large-type, high-contrast, accessible styling
js/extract.js       Image -> canvas preprocessing -> tesseract.js OCR -> text
js/compare.js       Text + application data -> per-field verdicts (the engine)
js/app.js           UI wiring: upload, OCR, verify, render results
```

Data flow: **image → `extract.js` (OCR text) → `compare.js` (verdicts) →
`app.js` (rendered result cards).**

---

## Tools used

- **JavaScript / HTML / CSS** — no framework; keeps the prototype small and the
  deployment trivial.
- **[tesseract.js](https://github.com/naptha/tesseract.js)** — in-browser OCR
  (WASM). Chosen so recognition runs locally with no external service.
- **GitHub Pages** — hosting for the deployed prototype.
- **AI-assisted development** — built with the help of AI coding tools
  (Claude / Claude Code).

---

## Security & ethics

- **No data leaves the browser.** Images are read locally; there is no upload, no
  backend, and no third-party API call at verification time. This suits a
  FedRAMP / restricted-network environment and avoids PII exposure.
- **No attack surface from a server** — it's a static site.
- **Human-in-the-loop by design.** The tool never hides uncertainty: borderline
  cases are marked NEEDS REVIEW, and OCR output is editable, so an agent's
  judgment remains the authority. This is the responsible way to deploy AI in a
  compliance decision.

---

## Assumptions

- Expected field values come from the application form: entered manually in
  single-label mode, or supplied as a CSV in batch mode.
- The mandatory government warning wording follows 27 CFR Part 16; "proof" is
  interpreted as 2 × ABV.
- **Bold-font** weight of the warning cannot be confirmed from OCR text alone, so
  it is flagged for a manual visual check rather than auto-verified.
- For this prototype the tesseract.js assets load from a CDN. The OCR computation
  is still fully local; a locked-down production deployment would self-host these
  assets so there is no outbound request at all.
- OCR accuracy is best on reasonably clear labels. Highly stylized fonts, foreign
  text, or poor photos will produce lower-confidence text — handled by the
  editable OCR box and the REVIEW state.

---

## Limitations

- OCR quality depends on image quality; stylized or angled labels may need manual
  correction (that's why the OCR text is editable in single-label mode).
- Bold-formatting of the government warning is a manual visual check.
- In batch mode the OCR text isn't hand-editable per row (it would defeat the
  point of unattended bulk processing); rows that need a closer look surface as
  NEEDS REVIEW / FAIL and can be re-run individually in single-label mode.

---

## Project status

Developed iteratively; each step is a reviewed, self-contained commit.

- [x] **Iteration 0** — comparison engine (`compare.js`)
- [x] **Iteration 1** — single-label UI skeleton
- [x] **Iteration 2** — wire UI to the engine (verdict cards)
- [x] **Iteration 3** — in-browser OCR (tesseract.js) + elapsed time
- [x] **Iteration 4** — stronger image preprocessing (grayscale + contrast stretch)
- [x] **Iteration 5** — batch mode (CSV + images → progress bar + results table)
- [x] **Iteration 6** — automated tests for the engine (16 tests)
- [x] **Iteration 7** — sample label set (2 synthetic + 7 real + batch.csv)
- [x] **Iteration 8** — polish & finalize docs
- [x] **Iteration 9** — deploy to GitHub Pages (live)
