// The conversion pipeline.
//
// Deliberately free of any chrome.* API so it can be exercised directly in a
// plain page — see test/harness.html, which runs it against real image bytes
// and checks the magic numbers of what comes out.
//
// Takes source URLs in, gives Blobs back. The caller owns object-URL lifetime.

import { FORMATS, ANIMATED_MIMES, EXT_BY_MIME } from './formats.js';

export class ConvertError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ConvertError';
    this.code = code;
  }
}

// ─── Encoder probing ────────────────────────────────────────────────────────

// canvas.convertToBlob() does not reject for a MIME type it cannot encode — it
// quietly hands back image/png. Asking it once, up front, is the only way to
// know what this browser can really produce.
export async function probeEncoders() {
  const canvas = new OffscreenCanvas(2, 2);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, 2, 2);

  const support = {};
  for (const [id, fmt] of Object.entries(FORMATS)) {
    try {
      const blob = await canvas.convertToBlob({ type: fmt.mime, quality: 0.8 });
      support[id] = blob.type === fmt.mime;
    } catch {
      support[id] = false;
    }
  }
  return support;
}

// ─── Fetching ───────────────────────────────────────────────────────────────

async function fetchImage(url) {
  let resp;
  try {
    resp = await fetch(url, { credentials: 'omit', redirect: 'follow' });
  } catch (err) {
    throw new ConvertError('FETCH_FAILED', `Could not fetch: ${err.message}`);
  }
  if (!resp.ok) throw new ConvertError('FETCH_FAILED', `Server returned ${resp.status}`);

  const blob = await resp.blob();
  if (!blob.size) throw new ConvertError('EMPTY', 'The server returned an empty file.');

  // A rewritten URL that 404s into an HTML error page still arrives with a 200
  // on some CDNs, so check what we actually got.
  if (/^(text|application\/json)/i.test(blob.type)) {
    throw new ConvertError('NOT_AN_IMAGE', `Got ${blob.type || 'non-image data'}.`);
  }
  return blob;
}

// ─── Decoding ───────────────────────────────────────────────────────────────

/** @returns {{source: CanvasImageSource, width: number, height: number, cleanup: Function}} */
async function decode(blob) {
  if (blob.type === 'image/svg+xml') return decodeSvg(blob);

  try {
    // 'from-image' honours the EXIF orientation tag, so a phone photo does not
    // come out rotated. Chrome's default already does this, but relying on a
    // default that changed once is how you get sideways holiday snaps.
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      cleanup: () => bitmap.close(),
    };
  } catch {
    return decodeViaElement(blob);
  }
}

function decodeViaElement(blob, forcedWidth, forcedHeight) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.decoding = 'sync';
    img.onload = () => {
      const width = forcedWidth || img.naturalWidth || img.width;
      const height = forcedHeight || img.naturalHeight || img.height;
      if (!width || !height) {
        URL.revokeObjectURL(url);
        reject(new ConvertError('DECODE_FAILED', 'The image has no intrinsic size.'));
        return;
      }
      resolve({ source: img, width, height, cleanup: () => URL.revokeObjectURL(url) });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ConvertError('DECODE_FAILED', 'This file is not a decodable image.'));
    };
    img.src = url;
  });
}

/**
 * SVG is resolution-independent, so there is no "natural" size to convert at.
 * Use the declared width/height, fall back to the viewBox, and finally to a
 * sensible raster size rather than failing.
 */
async function decodeSvg(blob) {
  const text = await blob.text();
  let width = 0;
  let height = 0;
  try {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const svg = doc.documentElement;
    const num = (v) => {
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : 0;
    };
    width = num(svg.getAttribute('width'));
    height = num(svg.getAttribute('height'));
    if (!width || !height) {
      const vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
      if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
        width = vb[2];
        height = vb[3];
      }
    }
  } catch {
    /* fall through to the default below */
  }

  if (!width || !height) {
    width = 1024;
    height = 1024;
  }
  // Render vectors at a useful size instead of a 16px favicon-sized square.
  const scale = Math.min(4, Math.max(1, 1024 / Math.max(width, height)));
  return decodeViaElement(blob, Math.round(width * scale), Math.round(height * scale));
}

// ─── Rasterising ────────────────────────────────────────────────────────────

function newCanvas(w, h) {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', { alpha: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { c, ctx };
}

/**
 * Downscale in halving steps.
 *
 * A single drawImage from 4000px to 400px runs a cheap filter that drops most
 * of the source pixels and aliases badly on fine detail. Repeated halving costs
 * a few extra draws and looks dramatically better.
 */
function downscale(source, sw, sh, dw, dh) {
  let cur = source;
  let cw = sw;
  let ch = sh;
  while (cw / 2 >= dw && ch / 2 >= dh && cw > 2 && ch > 2) {
    const nw = Math.max(dw, Math.round(cw / 2));
    const nh = Math.max(dh, Math.round(ch / 2));
    const { c, ctx } = newCanvas(nw, nh);
    ctx.drawImage(cur, 0, 0, nw, nh);
    cur = c;
    cw = nw;
    ch = nh;
  }
  return cur;
}

function targetSize(width, height, maxDimension) {
  if (!maxDimension || (width <= maxDimension && height <= maxDimension)) {
    return { width, height, resized: false };
  }
  const scale = maxDimension / Math.max(width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    resized: true,
  };
}

// ─── Encoding ───────────────────────────────────────────────────────────────

async function encode(canvas, fmt, quality) {
  const options = { type: fmt.mime };
  if (fmt.qualityKey) options.quality = Math.min(1, Math.max(0.01, quality / 100));

  const blob = await canvas.convertToBlob(options);

  // The load-bearing check. convertToBlob substitutes PNG for any codec this
  // build lacks, so without this a "Save as AVIF" would write PNG bytes into a
  // .avif file and the user would not find out until something failed to open
  // it. Refusing is the only honest option.
  if (blob.type !== fmt.mime) {
    throw new ConvertError(
      'ENCODER_MISSING',
      `This browser cannot encode ${fmt.label} (it produced ${blob.type || 'unknown data'} instead).`
    );
  }
  return blob;
}

// ─── Pipeline ───────────────────────────────────────────────────────────────

/** Best guess at a file extension for bytes we are passing through untouched. */
function extForSource(mime, url) {
  const known = EXT_BY_MIME[String(mime).split(';')[0].trim().toLowerCase()];
  if (known) return known;
  try {
    const last = new URL(url).pathname.split('/').pop() || '';
    const dot = last.lastIndexOf('.');
    if (dot > 0) {
      const ext = last.slice(dot + 1).toLowerCase();
      if (/^[a-z0-9]{2,5}$/.test(ext)) return ext;
    }
  } catch {
    /* not a parseable URL */
  }
  return 'img';
}

export async function convertImage({ sources = [], dataUrl = null, format, settings }) {
  // 'original' means "give me the bytes as the server sent them" — no decode
  // round-trip, no generation loss, metadata and animation intact.
  const isOriginal = format === 'original';
  const fmt = isOriginal ? null : FORMATS[format];
  if (!isOriginal && !fmt) throw new ConvertError('BAD_FORMAT', `Unknown format ${format}`);

  const warnings = [];
  let blob = null;
  let usedSource = null;
  let upgraded = false;
  let sourceNote = '';
  let lastError = null;

  if (dataUrl) {
    // Bytes the page handed us because we could not reach the URL ourselves.
    blob = await (await fetch(dataUrl)).blob();
    usedSource = 'page';
    sourceNote = 'fetched by the page';
  } else {
    for (const cand of sources) {
      try {
        blob = await fetchImage(cand.url);
        usedSource = cand.url;
        upgraded = cand.upgraded;
        sourceNote = cand.reason;
        break;
      } catch (err) {
        lastError = err;
        if (cand.upgraded) {
          // Expected whenever an account restricts derived/original access.
          console.info('[SaveImage] source upgrade rejected, falling back:', err.message);
        }
      }
    }
  }

  if (!blob) throw lastError || new ConvertError('FETCH_FAILED', 'Could not read the image.');

  const bytesIn = blob.size;
  const sourceType = blob.type;

  // Decoding is only for the dimensions here, but it doubles as validation:
  // a "download" of an HTML error page should fail loudly, not land on disk.
  const decoded = await decode(blob);
  try {
    if (isOriginal) {
      return {
        blob: blob,
        mime: sourceType,
        ext: extForSource(sourceType, usedSource),
        width: decoded.width,
        height: decoded.height,
        bytesIn,
        bytesOut: bytesIn,
        passthrough: true,
        upgraded,
        usedSource,
        sourceNote,
        warnings,
      };
    }

    const { width: outW, height: outH, resized } = targetSize(
      decoded.width,
      decoded.height,
      settings.maxDimension
    );

    // Passthrough: the source is already the requested format and nothing about
    // it needs to change. Re-encoding here would be pure loss — a second
    // generation of JPEG artefacts, or a PNG stripped of its metadata — for no
    // benefit. Hand back the original bytes untouched.
    if (settings.passthrough && !resized && sourceType === fmt.mime) {
      return {
        blob: blob,
        mime: fmt.mime,
        ext: fmt.ext,
        width: decoded.width,
        height: decoded.height,
        bytesIn,
        bytesOut: bytesIn,
        passthrough: true,
        upgraded,
        usedSource,
        sourceNote,
        warnings,
      };
    }

    if (ANIMATED_MIMES.has(sourceType) && sourceType !== fmt.mime) {
      warnings.push('Animation dropped — only the first frame was converted.');
    }

    let source = decoded.source;
    let sw = decoded.width;
    let sh = decoded.height;

    // Flatten onto the background before scaling. Downscaling an image with
    // transparent pixels and compositing afterwards pulls the colour of those
    // transparent pixels into the visible edge, leaving a dark halo.
    if (!fmt.alpha) {
      const { c, ctx } = newCanvas(sw, sh);
      ctx.fillStyle = settings.jpegBackground || '#ffffff';
      ctx.fillRect(0, 0, sw, sh);
      ctx.drawImage(source, 0, 0);
      source = c;
    }

    if (resized) {
      source = downscale(source, sw, sh, outW, outH);
      sw = source.width;
      sh = source.height;
    }

    const { c: out, ctx: outCtx } = newCanvas(outW, outH);
    if (!fmt.alpha) {
      outCtx.fillStyle = settings.jpegBackground || '#ffffff';
      outCtx.fillRect(0, 0, outW, outH);
    }
    outCtx.drawImage(source, 0, 0, sw, sh, 0, 0, outW, outH);

    const quality = fmt.qualityKey ? settings[fmt.qualityKey] : undefined;
    const encoded = await encode(out, fmt, quality);

    return {
      blob: encoded,
      mime: fmt.mime,
      ext: fmt.ext,
      width: outW,
      height: outH,
      bytesIn,
      bytesOut: encoded.size,
      passthrough: false,
      upgraded,
      usedSource,
      sourceNote,
      warnings,
    };
  } finally {
    decoded.cleanup?.();
  }
}
