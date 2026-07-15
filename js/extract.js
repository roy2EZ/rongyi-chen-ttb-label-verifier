/**
 * extract.js — OCR text extraction from a label image, using tesseract.js.
 *
 * Runs entirely in the browser (tesseract.js ships a WASM engine + worker),
 * so no image ever leaves the machine — this is the "firewall-safe, no PII"
 * property that matters for a government deployment.
 *
 * Iteration 3: basic recognition with a light grayscale pass.
 * Iteration 4: stronger canvas preprocessing — grayscale + a percentile-based
 * contrast stretch — to help photos taken at an angle or in poor light. We stop
 * short of hard binarization on purpose: Tesseract already runs Otsu
 * thresholding internally, and forcing our own threshold tends to hurt clean
 * labels more than it helps. Stretching contrast is the safe win.
 */

(function () {
  'use strict';

  /**
   * Draw the image onto a canvas, downscaling very large images (OCR does not
   * need more than ~1600px on the long edge and it keeps things under 5s), then
   * convert to grayscale and stretch contrast so faint or washed-out text
   * (glare, dim photos) separates from the background.
   */
  function preprocessCanvas(img, maxEdge) {
    maxEdge = maxEdge || 1600;
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);

    const imageData = ctx.getImageData(0, 0, w, h);
    const d = imageData.data;

    // Pass 1: luminance-weighted grayscale, building a histogram as we go.
    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) {
      const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
      d[i] = d[i + 1] = d[i + 2] = g;
      hist[g]++;
    }

    // Find the 1st/99th percentile levels and stretch that range to 0..255.
    // Clipping the extremes keeps a few stray dark/bright pixels from flattening
    // the stretch, which is what makes it robust to glare and sensor noise.
    const total = w * h;
    const cut = Math.max(1, Math.floor(total * 0.01));
    let lo = 0, hi = 255, acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > cut) { lo = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > cut) { hi = v; break; } }

    if (hi > lo) {
      const range = hi - lo;
      const lut = new Uint8Array(256);
      for (let v = 0; v < 256; v++) {
        lut[v] = v <= lo ? 0 : v >= hi ? 255 : Math.round(((v - lo) / range) * 255);
      }
      for (let i = 0; i < d.length; i += 4) {
        const s = lut[d[i]];
        d[i] = d[i + 1] = d[i + 2] = s;
      }
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  /** Load a File/Blob into an HTMLImageElement. */
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not load image.'));
      img.src = URL.createObjectURL(file);
    });
  }

  /**
   * extractText(file, { onProgress }) -> Promise<string>
   * onProgress receives a 0..1 fraction while recognition runs.
   */
  async function extractText(file, opts) {
    opts = opts || {};
    if (typeof window.Tesseract === 'undefined') {
      throw new Error('OCR engine failed to load (tesseract.js not available).');
    }
    const img = await loadImage(file);
    const canvas = preprocessCanvas(img);

    const { data } = await window.Tesseract.recognize(canvas, 'eng', {
      logger: (m) => {
        if (m.status === 'recognizing text' && typeof opts.onProgress === 'function') {
          opts.onProgress(m.progress);
        }
      },
    });
    return (data && data.text) ? data.text : '';
  }

  /**
   * createBatchRecognizer() -> { recognize(file) -> text, terminate() }
   *
   * Batch mode reads many images in a row. Spinning up a fresh Tesseract worker
   * per image (as extractText does) reloads the WASM engine every time, which is
   * wasteful at 200-300 labels. A batch run instead loads one persistent worker
   * and reuses it for every image.
   *
   * Falls back to the per-call recognize() path if the persistent-worker API
   * isn't available in this tesseract.js build.
   */
  async function createBatchRecognizer() {
    if (typeof window.Tesseract === 'undefined') {
      throw new Error('OCR engine failed to load (tesseract.js not available).');
    }
    let worker = null;
    if (typeof window.Tesseract.createWorker === 'function') {
      try {
        worker = await window.Tesseract.createWorker('eng');
      } catch (_) {
        worker = null; // fall back below
      }
    }
    return {
      async recognize(file) {
        const img = await loadImage(file);
        const canvas = preprocessCanvas(img);
        if (worker) {
          const { data } = await worker.recognize(canvas);
          return (data && data.text) ? data.text : '';
        }
        const { data } = await window.Tesseract.recognize(canvas, 'eng');
        return (data && data.text) ? data.text : '';
      },
      async terminate() {
        if (worker && typeof worker.terminate === 'function') {
          try { await worker.terminate(); } catch (_) { /* ignore */ }
        }
      },
    };
  }

  window.extractText = extractText;
  window.createBatchRecognizer = createBatchRecognizer;
})();
