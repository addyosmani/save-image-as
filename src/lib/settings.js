// Settings storage.
//
// Stored in chrome.storage.sync so preferences follow the profile. Everything
// read back out goes through normalize(), because synced data can be stale
// (written by an older version) or corrupt, and a bad quality value would
// otherwise reach the encoder.

export const DEFAULTS = Object.freeze({
  schema: 1,

  // Encoding
  jpegQuality: 85,
  webpQuality: 82,
  avifQuality: 60,
  jpegBackground: '#ffffff',
  passthrough: true, // don't re-encode when the source is already the target format

  // Geometry
  maxDimension: 0, // 0 = keep original size

  // Sources
  upgradeSource: true, // prefer a higher-resolution original when one is discoverable

  // Output
  saveMode: 'downloads', // 'downloads' | 'ask' | 'subfolder'
  subfolder: 'SaveImageAs',
  filenameTemplate: '{name}.{ext}',

  // Feedback
  notifyOnError: true,
  notifyOnSuccess: false,
});

export const SAVE_MODES = ['downloads', 'ask', 'subfolder'];

const clampInt = (v, lo, hi, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

export function normalize(raw = {}) {
  const s = { ...DEFAULTS, ...raw };
  return {
    schema: 1,
    jpegQuality: clampInt(s.jpegQuality, 1, 100, DEFAULTS.jpegQuality),
    webpQuality: clampInt(s.webpQuality, 1, 100, DEFAULTS.webpQuality),
    avifQuality: clampInt(s.avifQuality, 1, 100, DEFAULTS.avifQuality),
    jpegBackground: /^#[0-9a-f]{6}$/i.test(String(s.jpegBackground))
      ? String(s.jpegBackground).toLowerCase()
      : DEFAULTS.jpegBackground,
    passthrough: s.passthrough !== false,
    maxDimension: clampInt(s.maxDimension, 0, 20000, DEFAULTS.maxDimension),
    upgradeSource: s.upgradeSource !== false,
    saveMode: SAVE_MODES.includes(s.saveMode) ? s.saveMode : DEFAULTS.saveMode,
    subfolder: typeof s.subfolder === 'string' ? s.subfolder : DEFAULTS.subfolder,
    filenameTemplate:
      typeof s.filenameTemplate === 'string' && s.filenameTemplate.trim()
        ? s.filenameTemplate.trim()
        : DEFAULTS.filenameTemplate,
    notifyOnError: s.notifyOnError !== false,
    notifyOnSuccess: s.notifyOnSuccess === true,
  };
}

export async function getSettings() {
  const raw = await chrome.storage.sync.get(null);
  return normalize(raw);
}

export async function patchSettings(patch) {
  const next = normalize({ ...(await chrome.storage.sync.get(null)), ...patch });
  await chrome.storage.sync.set(next);
  return next;
}

/**
 * Fill in only the keys that are missing.
 *
 * Deliberately a merge and not a blind set: running set(DEFAULTS) on every
 * onInstalled — including the "update" reason — would silently reset the
 * user's preferences on each extension update.
 */
export async function seedDefaults() {
  const raw = await chrome.storage.sync.get(null);
  const missing = {};
  for (const [k, v] of Object.entries(DEFAULTS)) {
    if (!(k in raw)) missing[k] = v;
  }
  if (Object.keys(missing).length) await chrome.storage.sync.set(missing);
  return normalize({ ...raw, ...missing });
}

export async function resetSettings() {
  await chrome.storage.sync.clear();
  await chrome.storage.sync.set(DEFAULTS);
  return normalize(DEFAULTS);
}
