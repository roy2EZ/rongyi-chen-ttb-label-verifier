/**
 * extract.js — OCR text extraction from a label image, using tesseract.js.
 *
 * Runs entirely in the browser (tesseract.js ships a WASM engine + worker),
 * so no image ever leaves the machine — this is the "firewall-safe, no PII"
 * property that matters for a government deployment.
 *
 * Iteration 3 scope: basic recognition with a light grayscale pass.
 * Iteration 4 adds stronger canvas preprocessing (contrast, thresholding) for
 * photos taken at an angle or in poor light.
 */

(function () {
  'use strict';

  /**
   * Draw the image onto a canvas, downscaling very large images (OCR does not
   * need more than ~1600px on the long edge and it keeps things under 5s), and
   * apply a light grayscale pass which generally helps Tesseract.
   */
  function toGrayscaleCanvas(img, maxEdge) {
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
    for (let i = 0; i < d.length; i += 4) {
      // Luminance-weighted grayscale.
      const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
      d[i] = d[i + 1] = d[i + 2] = g;
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
    const canvas = toGrayscaleCanvas(img);

    const { data } = await window.Tesseract.recognize(canvas, 'eng', {
      logger: (m) => {
        if (m.status === 'recognizing text' && typeof opts.onProgress === 'function') {
          opts.onProgress(m.progress);
        }
      },
    });
    return (data && data.text) ? data.text : '';
  }

  window.extractText = extractText;
})();
