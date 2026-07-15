# TTB Alcohol Label Verification (Prototype)

A browser-based tool that checks an alcohol-beverage **label image** against the
data submitted on its **TTB application form**, and reports — field by field —
whether they match. Built as a take-home prototype for the U.S. Department of the
Treasury *IT Specialist (AI)* position.

**Everything runs client-side in the browser.** No backend, no database, and no
image or data ever leaves the machine — a deliberate choice for a government
context (firewall-safe, no PII exposure).

> **Status:** work in progress, developed in small iterations. See
> [Project status](#project-status) for what is implemented vs. planned.

---

## What it does

TTB agents verify that the text on a beverage label matches the application the
producer submitted. This tool automates the first pass:

1. **Read the label** — OCR extracts the text from a label image (in the browser).
2. **Compare to the application** — each required field is checked against the
   values entered on the form.
3. **Report a verdict** — every field gets **PASS**, **NEEDS REVIEW**, or
   **FAIL**, each with a plain-language reason an agent can trust and audit.

The tool assists the agent; it does not replace them. Ambiguous cases are surfaced
as **NEEDS REVIEW** rather than silently passed or failed — the human keeps the
final call.

---

## Features

### Core (required)
- **Single-label verification** — upload a label image, enter the application
  data, get a verdict. *(implemented)*
- **In-browser OCR** — automatic text extraction from the image via tesseract.js;
  no image is uploaded anywhere. *(implemented)*
- **Five TTB field checks** — Brand Name, Class/Type, Alcohol Content, Net
  Contents, and the Government Warning. *(implemented, in `compare.js`)*
- **Government warning — exact matching** — `GOVERNMENT WARNING:` must appear in
  all capitals and the wording must match word-for-word (27 CFR Part 16). A
  title-case "Government Warning" correctly **FAILs**. *(implemented)*
- **Three-state verdicts with reasons** — PASS / NEEDS REVIEW / FAIL, each field
  carries a human-readable explanation. Case/punctuation differences (e.g.
  `STONE'S THROW` vs `Stone's Throw`) become **REVIEW**, not a hard fail.
  *(implemented)*
- **≤ 5-second target** — per-label elapsed time is shown in the UI so an agent
  can see the tool is meeting the responsiveness the workflow needs.
  *(implemented)*
- **Editable OCR output (human-in-the-loop)** — the extracted text is shown in an
  editable box so an agent can correct OCR mistakes before verifying. This makes
  the result trustworthy and auditable. *(implemented — see open question below)*

### High-volume (required)
- **Batch upload** — a CSV of application data plus a folder of label images,
  verified together with a results table and progress indicator, for seasonal
  volume spikes. *(planned)*

### Robustness (stretch)
- **Image preprocessing** — grayscale / contrast / thresholding on the canvas
  before OCR, to better handle photos taken at an angle or in poor light.
  *(basic grayscale implemented; stronger preprocessing planned)*

---

## Requirement → feature mapping

These requirements were drawn from the assignment's stakeholder interviews and
the job announcement.

| Requirement | Source | How it's met |
|---|---|---|
| Compare label vs application on the core TTB fields | Assignment | 5 field checks in `compare.js` |
| Government warning matched **word-for-word**, all-caps prefix | Agent (Jenny) | `checkGovernmentWarning()` — all-caps check + word diff |
| Case differences shouldn't hard-fail | Agent (Dave) | 3-state verdicts; case/punct diff → **REVIEW** |
| Results in **≤ 5 seconds** | Compliance Dir. (Sarah) | client-side OCR; per-label time shown |
| **Batch upload** for volume spikes | Sarah | batch mode *(planned)* |
| Usable by non-technical agents | Sarah | one screen, large type, big color-coded verdicts |
| Handle imperfect photos (angle/glare) | Jenny | canvas preprocessing *(basic; more planned)* |
| Government network blocks outbound ML endpoints | IT (Marcus) | **all processing in-browser, no external API calls** |
| No PII storage, standalone, no COLA integration | Marcus | static site; nothing leaves the browser; no backend |
| Implement an AI solution in a test/production environment | Job (selective factor) | deployed and accessible on GitHub Pages |

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
  (Claude / Claude Code). All code was reviewed, understood, and is maintainable
  by the author. (Disclosed per the assignment's request to document tools used;
  fitting for an AI-focused role.)

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

**Deployed prototype:** _(GitHub Pages URL — added once deployment is enabled)_

### Try it
Upload `samples/sample_pass.png` and enter: Brand `STONE'S THROW`, Class
`Cabernet Sauvignon`, ABV `13.5`, Net `750 mL` → expect an all-green **PASS**.
Real-world label photos are in `samples/real/` to see OCR on harder images.

---

## Limitations

- OCR quality depends on image quality; stylized or angled labels may need manual
  correction (that's why the OCR text is editable).
- Bold-formatting of the government warning is a manual visual check.
- Batch mode and stronger image preprocessing are still in progress.

---

## Project status

Developed iteratively; each step is a reviewed, self-contained commit.

- [x] **Iteration 0** — comparison engine (`compare.js`)
- [x] **Iteration 1** — single-label UI skeleton
- [x] **Iteration 2** — wire UI to the engine (verdict cards)
- [x] **Iteration 3** — in-browser OCR (tesseract.js) + elapsed time
- [ ] **Iteration 4** — stronger image preprocessing
- [ ] **Iteration 5** — batch mode
- [ ] **Iteration 6** — automated tests for the engine
- [ ] **Iteration 7** — sample label set
- [ ] **Iteration 8** — polish & finalize docs
- [ ] **Iteration 9** — deploy to GitHub Pages
