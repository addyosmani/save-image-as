// Offscreen document: the only place in the extension that holds image bytes.
//
// It exists for two reasons the service worker cannot cover:
//
//  1. URL.createObjectURL does not exist in an MV3 service worker. Without it
//     the only way to hand bytes to chrome.downloads is a data: URL, which
//     base64-inflates the payload by 33% and pins the whole thing in memory as
//     a JS string. A blob: URL costs one handle.
//  2. A document has HTMLImageElement, which decodes things createImageBitmap
//     refuses in a worker — SVG above all.
//
// The actual conversion lives in lib/convert.js, which knows nothing about
// chrome.*. This file is just the messaging seam and the object-URL ledger.

import { probeEncoders, convertImage } from './lib/convert.js';

const liveObjectUrls = new Set();

function track(url) {
  liveObjectUrls.add(url);
  // Safety net: if a download never reports back, do not leak the blob forever.
  setTimeout(() => revoke(url), 5 * 60 * 1000);
  return url;
}

function revoke(url) {
  if (liveObjectUrls.has(url)) {
    URL.revokeObjectURL(url);
    liveObjectUrls.delete(url);
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return false;

  (async () => {
    try {
      switch (msg.type) {
        case 'probe':
          sendResponse({ ok: true, support: await probeEncoders() });
          break;

        case 'convert': {
          const { blob, ...rest } = await convertImage(msg.payload);
          sendResponse({ ok: true, result: { ...rest, blobUrl: track(URL.createObjectURL(blob)) } });
          break;
        }

        case 'revoke':
          revoke(msg.url ?? msg.payload?.url);
          sendResponse({ ok: true });
          break;

        default:
          sendResponse({ ok: false, code: 'BAD_MESSAGE', message: `Unknown type ${msg.type}` });
      }
    } catch (err) {
      // Errors do not survive the message boundary, so flatten them by hand.
      sendResponse({
        ok: false,
        code: err?.code || 'ERROR',
        message: err?.message || String(err),
      });
    }
  })();

  return true; // response is async
});
