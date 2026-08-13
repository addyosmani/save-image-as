// Cloudinary source upgrading.
//
// A Cloudinary delivery URL looks like:
//
//   https://res.cloudinary.com/<cloud>/image/upload/w_400,q_auto,f_auto/v1699/folder/pic.jpg
//   \___________ host ________/ \____/ \___/ \____/ \___ transforms ___/ \ver/ \_ public id _/
//
// The bytes at that URL are a *derived* asset: downscaled to 400px, re-encoded
// at whatever quality q_auto chose, possibly transcoded by f_auto. Converting
// that to PNG locally gives you a lossless copy of a lossy thumbnail.
//
// Dropping the transformation segments — and the file extension, which is
// itself a format request — makes Cloudinary serve the original uploaded
// master in its native format. That is what we actually want to convert from.
//
// This is strictly best-effort. The caller always keeps the original URL as a
// fallback, because accounts with strict transformations, or assets behind a
// signature, can reject a rewritten URL.

const RESOURCE_TYPES = new Set(['image', 'video']);
const DELIVERY_TYPES = new Set([
  'upload',
  'fetch',
  'private',
  'authenticated',
  'sprite',
  'facebook',
  'twitter',
  'twitter_name',
  'gravatar',
  'youtube',
  'hulu',
  'vimeo',
  'animoto',
  'worldstarhiphop',
  'dailymotion',
]);

// Transformation parameter keys, per Cloudinary's transformation reference.
const TRANSFORM_KEYS = new Set([
  'a', 'ac', 'af', 'ar', 'b', 'bo', 'br', 'c', 'cs', 'co', 'd', 'dl', 'dn', 'dpr',
  'du', 'e', 'eo', 'f', 'fl', 'fn', 'g', 'h', 'ho', 'if', 'ki', 'l', 'o', 'p',
  'pg', 'q', 'r', 'so', 'sp', 't', 'u', 'vc', 'vs', 'w', 'x', 'y', 'z',
]);

/** A path segment that is a comma-joined list of `key_value` transformations. */
function isTransformSegment(seg) {
  if (!seg) return false;
  if (/^v\d+$/.test(seg)) return false; // version marker — transforms end here
  if (/^https?:/i.test(seg) || /^https?%3a/i.test(seg)) return false; // /fetch/ remote URL
  return seg.split(',').every((part) => {
    const m = /^(\$?[a-z]{1,3})_(.+)$/i.exec(part);
    return !!m && TRANSFORM_KEYS.has(m[1].toLowerCase());
  });
}

/** `s--Abc123XY--` precedes signed transformations; rewriting invalidates them. */
function isSignature(seg) {
  return /^s--[A-Za-z0-9_-]+--$/.test(seg);
}

function stripExtension(seg) {
  const dot = seg.lastIndexOf('.');
  if (dot <= 0) return seg;
  const ext = seg.slice(dot + 1);
  // Only strip things that look like a real format extension.
  return /^[a-z0-9]{2,5}$/i.test(ext) ? seg.slice(0, dot) : seg;
}

/**
 * @param {string} rawUrl
 * @returns {{url: string, reason: string} | null} an upgraded URL, or null if
 *   this is not a Cloudinary delivery URL / there is nothing to upgrade.
 */
export function upgradeCloudinaryUrl(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;

  // Empty segments are deliberately kept: a /fetch/ tail contains a whole
  // remote URL, and dropping the empty between "https:" and the host would
  // rejoin it as "https:/example.com".
  const parts = u.pathname.split('/');

  // Locate `<resource_type>/<delivery_type>`. Works for res.cloudinary.com and
  // for customers serving from their own CNAME, where the cloud name is absent.
  let deliveryIdx = -1;
  for (let i = 1; i < parts.length; i++) {
    if (RESOURCE_TYPES.has(parts[i - 1]) && DELIVERY_TYPES.has(parts[i])) {
      deliveryIdx = i;
      break;
    }
  }
  if (deliveryIdx === -1) return null;

  // Require some corroborating evidence before rewriting a stranger's URL:
  // either the canonical host, or a Cloudinary-shaped transformation segment.
  const onCloudinaryHost = /(^|\.)cloudinary\.com$/i.test(u.hostname);
  const isFetch = parts[deliveryIdx] === 'fetch';

  let cursor = deliveryIdx + 1;
  if (parts[cursor] && isSignature(parts[cursor])) return null; // signed — leave alone

  const transforms = [];
  while (cursor < parts.length - 1 && isTransformSegment(parts[cursor])) {
    transforms.push(parts[cursor]);
    cursor++;
  }

  if (!onCloudinaryHost && transforms.length === 0) return null;

  const tail = parts.slice(cursor);
  if (tail.length === 0) return null;

  // The extension on the public id is a format request, not a fact about the
  // master. Drop it so Cloudinary returns the original bytes. Never touch a
  // /fetch/ tail — that is a foreign URL, not a public id.
  if (!isFetch) {
    tail[tail.length - 1] = stripExtension(tail[tail.length - 1]);
  }

  const rebuilt = [...parts.slice(0, deliveryIdx + 1), ...tail];
  const next = new URL(u.toString());
  next.pathname = rebuilt.join('/'); // parts[0] is '' so the leading slash is already there
  // Transformations can also arrive as query params on some setups.
  next.searchParams.delete('tx');

  const candidate = next.toString();
  if (candidate === rawUrl) return null;

  const reason = transforms.length
    ? `Cloudinary: dropped ${transforms.join('/')}`
    : 'Cloudinary: requested original format';
  return { url: candidate, reason };
}

/**
 * Ordered list of URLs to try for one image, best first. The original is always
 * last so a rejected rewrite degrades to exactly the old behaviour.
 */
export function candidateSources(srcUrl, { upgradeSource = true } = {}) {
  const out = [];
  if (upgradeSource) {
    const up = upgradeCloudinaryUrl(srcUrl);
    if (up) out.push({ url: up.url, reason: up.reason, upgraded: true });
  }
  out.push({ url: srcUrl, reason: 'original source', upgraded: false });
  return out;
}
