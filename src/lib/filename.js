// Filename construction and path sanitising.
//
// Everything here is defensive: the pieces come from remote URLs and from a
// user-editable template, and the result is handed to chrome.downloads, where
// a stray "../" or a NUL byte is either a security problem or a hard API error.

const ILLEGAL = /[<>:"/\\|?*]/g;
// Built via RegExp() so the escape sequences stay readable in source.
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001F\\u007F]', 'g');
const BIDI_CHARS = new RegExp('[\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]', 'g');
const RESERVED_WIN = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/** Sanitise one path component. Never returns an empty string. */
export function safeComponent(input, fallback = 'image', maxLen = 100) {
  let s = String(input ?? '')
    .replace(BIDI_CHARS, '') // zero-width / direction-override tricks
    .replace(CONTROL_CHARS, '_')
    .replace(ILLEGAL, '_')
    .replace(/\.{2,}/g, '') // kill "..", including the "._." left by a stripped "/"
    .replace(/_{2,}/g, '_')
    .replace(/^[._\s]+/, '') // no leading dot (hidden file) or substitution noise
    .replace(/[.\s]+$/, '') // Windows silently strips these
    .trim();
  if (RESERVED_WIN.test(s)) s = `_${s}`;
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s || fallback;
}

/** Sanitise a user-supplied subfolder into a safe relative path (max 4 deep). */
export function sanitizeSubfolder(input) {
  const parts = String(input ?? '')
    .split(/[/\\]+/)
    .map((p) => p.trim())
    .filter((p) => p && p !== '.' && p !== '..')
    .map((p) => safeComponent(p, '', 60))
    .filter(Boolean)
    .slice(0, 4);
  return parts.join('/');
}

/** The basename of a URL path, without its extension. */
export function baseNameFromUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.protocol === 'data:') return 'image';
    if (u.protocol === 'blob:') return 'image';
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
    if (!last) return safeComponent(u.hostname, 'image', 60);
    const dot = last.lastIndexOf('.');
    const stem = dot > 0 ? last.slice(0, dot) : last;
    return safeComponent(stem, 'image', 80);
  } catch {
    return 'image';
  }
}

function hostFromUrl(rawUrl) {
  try {
    return safeComponent(new URL(rawUrl).hostname.replace(/^www\./, ''), 'web', 60);
  } catch {
    return 'web';
  }
}

const pad = (n) => String(n).padStart(2, '0');

/**
 * Expand a filename template.
 *
 * Tokens: {name} {ext} {format} {w} {h} {date} {time} {host}
 * Unknown tokens are left in place rather than silently deleted, so a typo is
 * visible in the saved filename instead of quietly producing the wrong name.
 */
export function buildFilename({
  template = '{name}.{ext}',
  srcUrl = '',
  pageUrl = '',
  ext = 'png',
  format = '',
  width = 0,
  height = 0,
  now = new Date(),
}) {
  const values = {
    name: baseNameFromUrl(srcUrl),
    ext: safeComponent(ext, 'png', 8),
    format: safeComponent(format || ext, 'image', 8),
    w: String(width || 0),
    h: String(height || 0),
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`,
    host: hostFromUrl(pageUrl || srcUrl),
  };

  let out = String(template).replace(/\{(\w+)\}/g, (whole, key) =>
    key in values ? values[key] : whole
  );

  // The template may legitimately contain slashes ("{host}/{name}.{ext}"),
  // so sanitise per component rather than over the whole string.
  const parts = out
    .split(/[/\\]+/)
    .map((p) => p.trim())
    .filter((p) => p && p !== '.' && p !== '..')
    .slice(0, 5);

  if (!parts.length) return `image.${values.ext}`;

  const file = parts.pop();
  const dirs = parts.map((p) => safeComponent(p, '', 60)).filter(Boolean);

  // Keep the final extension intact while cleaning the stem.
  const dot = file.lastIndexOf('.');
  const stem = dot > 0 ? file.slice(0, dot) : file;
  const suffix = dot > 0 ? file.slice(dot + 1) : values.ext;
  const cleanFile = `${safeComponent(stem, 'image', 100)}.${safeComponent(suffix, values.ext, 8)}`;

  return [...dirs, cleanFile].join('/');
}

/** Join an optional subfolder with a relative filename. */
export function withSubfolder(filename, subfolder) {
  const dir = sanitizeSubfolder(subfolder);
  return dir ? `${dir}/${filename}` : filename;
}

export function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB`;
}
