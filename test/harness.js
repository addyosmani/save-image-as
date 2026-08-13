// End-to-end exercise of the conversion pipeline against real image bytes.
//
// The point of this harness is to distrust blob.type. Every assertion about
// what came out is made by reading the file's magic number, because the whole
// class of bug we care about — canvas silently substituting PNG for a codec it
// lacks — produces a Blob whose .type is a lie only until you look at byte 0.

import { convertImage, probeEncoders, ConvertError } from '../src/lib/convert.js';
import { DEFAULTS, normalize } from '../src/lib/settings.js';

const results = [];
const out = document.getElementById('out');

function check(name, condition, detail = '') {
  results.push({ name, pass: !!condition, detail: String(detail) });
}

// ─── Magic-number sniffing ──────────────────────────────────────────────────

async function sniff(blob) {
  const b = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
  const at = (i, ...sig) => sig.every((v, k) => b[i + k] === v);
  const ascii = (i, s) => [...s].every((c, k) => b[i + k] === c.charCodeAt(0));

  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'jpeg';
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'webp';
  if (ascii(4, 'ftyp') && (ascii(8, 'avif') || ascii(8, 'avis'))) return 'avif';
  if (ascii(0, 'GIF8')) return 'gif';
  const head = new TextDecoder().decode(b).trimStart();
  if (head.startsWith('<svg') || head.startsWith('<?xml')) return 'svg';
  return 'unknown';
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

function paint(w, h, { alpha = false } = {}) {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d');
  if (!alpha) {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#e11d48');
    g.addColorStop(1, '#1d4ed8');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  } else {
    // Left half opaque red, right half fully transparent.
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, Math.floor(w / 2), h);
  }
  ctx.fillStyle = '#ffffff';
  ctx.font = `${Math.round(h / 6)}px sans-serif`;
  ctx.fillText('SaveImage', 8, Math.round(h / 2));
  return c;
}

const urls = [];
function toUrl(blob) {
  const u = URL.createObjectURL(blob);
  urls.push(u);
  return u;
}

async function fixture(w, h, type, quality, opts) {
  const blob = await paint(w, h, opts).convertToBlob({ type, quality });
  return { blob, url: toUrl(blob) };
}

const src = (url) => [{ url, reason: 'test', upgraded: false }];
const settings = (over = {}) => normalize({ ...DEFAULTS, ...over });

/** Decode a result blob and read one pixel back. */
async function pixelAt(blob, x, y) {
  const bmp = await createImageBitmap(blob);
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  const d = ctx.getImageData(x, y, 1, 1).data;
  bmp.close();
  return [d[0], d[1], d[2], d[3]];
}

// ─── Suite ──────────────────────────────────────────────────────────────────

async function run() {
  const support = await probeEncoders();
  check('probe: PNG encoder present', support.png === true, JSON.stringify(support));
  check('probe: JPEG encoder present', support.jpeg === true);
  check('probe: WebP encoder present', support.webp === true);
  check(
    'probe: AVIF correctly reported unavailable on this build',
    support.avif === false,
    `avif=${support.avif}`
  );

  const pngAlpha = await fixture(300, 200, 'image/png', undefined, { alpha: true });
  const jpegSrc = await fixture(300, 200, 'image/jpeg', 0.9);
  const big = await fixture(2000, 1200, 'image/png');

  // 1. PNG -> JPEG really produces JPEG bytes.
  {
    const r = await convertImage({
      sources: src(pngAlpha.url),
      format: 'jpeg',
      settings: settings(),
    });
    check('PNG→JPEG: magic number is JPEG', (await sniff(r.blob)) === 'jpeg', await sniff(r.blob));
    check('PNG→JPEG: dimensions preserved', r.width === 300 && r.height === 200, `${r.width}x${r.height}`);
    check('PNG→JPEG: reports ext jpg', r.ext === 'jpg', r.ext);
    check('PNG→JPEG: not a passthrough', r.passthrough === false);

    // The transparent right half must have become the configured background.
    const px = await pixelAt(r.blob, 280, 20);
    check(
      'PNG→JPEG: transparency flattened to white, no black halo',
      px[0] > 245 && px[1] > 245 && px[2] > 245,
      `rgba(${px})`
    );
  }

  // 2. Custom flatten colour is honoured.
  {
    const r = await convertImage({
      sources: src(pngAlpha.url),
      format: 'jpeg',
      settings: settings({ jpegBackground: '#00ff00' }),
    });
    const px = await pixelAt(r.blob, 280, 20);
    check(
      'PNG→JPEG: custom background colour applied',
      px[1] > 200 && px[0] < 80 && px[2] < 80,
      `rgba(${px})`
    );
  }

  // 3. PNG -> WebP really produces WebP bytes, and keeps alpha.
  {
    const r = await convertImage({
      sources: src(pngAlpha.url),
      format: 'webp',
      settings: settings(),
    });
    check('PNG→WebP: magic number is WebP', (await sniff(r.blob)) === 'webp', await sniff(r.blob));
    const px = await pixelAt(r.blob, 280, 20);
    check('PNG→WebP: transparency preserved', px[3] < 16, `alpha=${px[3]}`);
  }

  // 4. Passthrough hands back the original bytes untouched.
  {
    const r = await convertImage({
      sources: src(pngAlpha.url),
      format: 'png',
      settings: settings({ passthrough: true }),
    });
    check('PNG→PNG passthrough: flagged', r.passthrough === true);
    check('PNG→PNG passthrough: byte-identical size', r.blob.size === pngAlpha.blob.size,
      `${r.blob.size} vs ${pngAlpha.blob.size}`);
    const a = new Uint8Array(await r.blob.arrayBuffer());
    const b = new Uint8Array(await pngAlpha.blob.arrayBuffer());
    check('PNG→PNG passthrough: bytes identical', a.every((v, i) => v === b[i]));
  }

  // 5. Passthrough off forces a genuine re-encode.
  {
    const r = await convertImage({
      sources: src(pngAlpha.url),
      format: 'png',
      settings: settings({ passthrough: false }),
    });
    check('PNG→PNG re-encode: still PNG bytes', (await sniff(r.blob)) === 'png');
    check('PNG→PNG re-encode: not flagged as passthrough', r.passthrough === false);
  }

  // 6. JPEG -> PNG.
  {
    const r = await convertImage({ sources: src(jpegSrc.url), format: 'png', settings: settings() });
    check('JPEG→PNG: magic number is PNG', (await sniff(r.blob)) === 'png', await sniff(r.blob));
  }

  // 7. Quality actually reaches the encoder.
  {
    const lo = await convertImage({
      sources: src(big.url),
      format: 'jpeg',
      settings: settings({ jpegQuality: 20 }),
    });
    const hi = await convertImage({
      sources: src(big.url),
      format: 'jpeg',
      settings: settings({ jpegQuality: 95 }),
    });
    check('quality: q20 is smaller than q95', lo.bytesOut < hi.bytesOut,
      `${lo.bytesOut} vs ${hi.bytesOut}`);
  }

  // 8. Resizing preserves aspect ratio and caps the longest side.
  {
    const r = await convertImage({
      sources: src(big.url),
      format: 'jpeg',
      settings: settings({ maxDimension: 400 }),
    });
    check('resize: longest side capped at 400', r.width === 400, `${r.width}x${r.height}`);
    check('resize: aspect ratio kept', r.height === 240, `${r.width}x${r.height}`);
    const bmp = await createImageBitmap(r.blob);
    check('resize: decoded output matches reported size', bmp.width === 400 && bmp.height === 240,
      `${bmp.width}x${bmp.height}`);
    bmp.close();
  }

  // 9. Resizing never upscales.
  {
    const r = await convertImage({
      sources: src(pngAlpha.url),
      format: 'png',
      settings: settings({ maxDimension: 5000, passthrough: false }),
    });
    check('resize: small image left alone', r.width === 300 && r.height === 200,
      `${r.width}x${r.height}`);
  }

  // 10. THE important one: an unavailable codec must fail loudly, never
  //     silently write PNG bytes into an .avif file.
  {
    let err = null;
    try {
      await convertImage({ sources: src(pngAlpha.url), format: 'avif', settings: settings() });
    } catch (e) {
      err = e;
    }
    check('AVIF: refused rather than mislabelled', err instanceof ConvertError, String(err));
    check('AVIF: reports ENCODER_MISSING', err?.code === 'ENCODER_MISSING', err?.code);
  }

  // 11. SVG decodes through the HTMLImageElement path.
  {
    const svg = new Blob(
      [
        `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60" viewBox="0 0 120 60">
           <rect width="120" height="60" fill="#4f46e5"/>
           <circle cx="30" cy="30" r="18" fill="#fff"/>
         </svg>`,
      ],
      { type: 'image/svg+xml' }
    );
    const r = await convertImage({ sources: src(toUrl(svg)), format: 'png', settings: settings() });
    check('SVG→PNG: magic number is PNG', (await sniff(r.blob)) === 'png', await sniff(r.blob));
    check('SVG→PNG: rasterised larger than the 120px declared size',
      r.width >= 120 && r.height >= 60, `${r.width}x${r.height}`);
    check('SVG→PNG: aspect ratio kept', Math.abs(r.width / r.height - 2) < 0.05,
      `${r.width}x${r.height}`);
  }

  // 12. Non-image payloads are rejected before they reach disk.
  {
    let err = null;
    try {
      await convertImage({
        sources: src(toUrl(new Blob(['<html>404 not found</html>'], { type: 'text/html' }))),
        format: 'png',
        settings: settings(),
      });
    } catch (e) {
      err = e;
    }
    check('HTML error page rejected', err?.code === 'NOT_AN_IMAGE', err?.code);
  }

  // 13. Source fallback: a dead first candidate must not sink the save.
  {
    const r = await convertImage({
      sources: [
        { url: 'https://127.0.0.1:9/definitely-not-there.png', reason: 'upgraded', upgraded: true },
        { url: jpegSrc.url, reason: 'original source', upgraded: false },
      ],
      format: 'png',
      settings: settings(),
    });
    check('fallback: recovered from a failed upgrade', (await sniff(r.blob)) === 'png');
    check('fallback: reports it used the original', r.upgraded === false, String(r.upgraded));
  }

  // 14. All candidates failing surfaces a fetch error.
  {
    let err = null;
    try {
      await convertImage({
        sources: src('https://127.0.0.1:9/nope.png'),
        format: 'png',
        settings: settings(),
      });
    } catch (e) {
      err = e;
    }
    check('all sources dead: FETCH_FAILED', err?.code === 'FETCH_FAILED', err?.code);
  }

  // 15. "Original" hands back untouched bytes with the right extension.
  {
    const r = await convertImage({
      sources: src(jpegSrc.url),
      format: 'original',
      settings: settings({ maxDimension: 100 }),
    });
    check('original: bytes untouched', r.blob.size === jpegSrc.blob.size,
      `${r.blob.size} vs ${jpegSrc.blob.size}`);
    check('original: ext from content type', r.ext === 'jpg', r.ext);
    check('original: ignores the resize cap', r.width === 300, `${r.width}`);
    check('original: still JPEG bytes', (await sniff(r.blob)) === 'jpeg');
  }

  // 16. Reported byte counts are real.
  {
    const r = await convertImage({ sources: src(big.url), format: 'webp', settings: settings() });
    check('bytesOut matches the blob', r.bytesOut === r.blob.size, `${r.bytesOut} vs ${r.blob.size}`);
    check('bytesIn matches the source', r.bytesIn === big.blob.size);
  }

  urls.forEach(URL.revokeObjectURL);
  report();
}

function report() {
  const passed = results.filter((r) => r.pass).length;
  const lines = results.map(
    (r) =>
      `<span class="${r.pass ? 'pass' : 'fail'}">${r.pass ? 'PASS' : 'FAIL'}</span>  ${r.name}` +
      (r.pass || !r.detail ? '' : `\n        ↳ ${r.detail}`)
  );
  out.innerHTML = `${passed}/${results.length} passed\n\n${lines.join('\n')}`;
  window.__RESULTS__ = { passed, total: results.length, results };
  window.__DONE__ = true;
}

run().catch((err) => {
  check('harness crashed', false, err?.stack || String(err));
  report();
});
