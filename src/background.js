// Service worker: menus, orchestration, downloads.
//
// Deliberately holds no image data. Bytes live in the offscreen document; this
// worker moves URLs and settings around and talks to chrome.downloads.

import { getSettings, seedDefaults } from './lib/settings.js';
import { FORMATS, FORMAT_ORDER, supportedFormats } from './lib/formats.js';
import { candidateSources } from './lib/cloudinary.js';
import { buildFilename, withSubfolder, formatBytes } from './lib/filename.js';

const OFFSCREEN_PATH = 'src/offscreen.html';
const MENU_PREFIX = 'si:';
const IDLE_CLOSE_MS = 30_000;

// ─── Offscreen document lifecycle ───────────────────────────────────────────

let creatingOffscreen = null;
let idleTimer = null;
const pendingRevokes = new Map(); // downloadId -> blobUrl

async function hasOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
  });
  return contexts.length > 0;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }
  creatingOffscreen = chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['BLOBS'],
      justification: 'Decode images and package converted bytes as blob URLs for downloading.',
    })
    .catch((err) => {
      // Two calls can race; a document already existing is a success for us.
      if (!/single offscreen|already exists/i.test(String(err))) throw err;
    })
    .finally(() => {
      creatingOffscreen = null;
    });
  await creatingOffscreen;
}

function scheduleIdleClose() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    // Tearing the document down revokes its blob URLs, which would cancel any
    // download still reading from one.
    if (pendingRevokes.size > 0) {
      scheduleIdleClose();
      return;
    }
    try {
      if (await hasOffscreen()) await chrome.offscreen.closeDocument();
    } catch {
      /* already gone */
    }
  }, IDLE_CLOSE_MS);
}

async function askOffscreen(type, payload) {
  await ensureOffscreen();
  let res;
  try {
    res = await chrome.runtime.sendMessage({ target: 'offscreen', type, payload });
  } catch {
    // The document can be evicted between the check and the send. One retry.
    await ensureOffscreen();
    res = await chrome.runtime.sendMessage({ target: 'offscreen', type, payload });
  }
  scheduleIdleClose();
  if (!res) throw Object.assign(new Error('The converter did not respond.'), { code: 'NO_RESPONSE' });
  if (!res.ok) throw Object.assign(new Error(res.message), { code: res.code });
  return res;
}

// ─── Encoder support (probed once, cached) ──────────────────────────────────

async function refreshEncoderSupport() {
  try {
    const { support } = await askOffscreen('probe', {});
    await chrome.storage.local.set({ encoderSupport: support });
    return support;
  } catch (err) {
    console.warn('[SaveImageAs] encoder probe failed:', err);
    // Assume only the three formats every Chrome has shipped for a decade.
    const fallback = { jpeg: true, png: true, webp: true, avif: false };
    await chrome.storage.local.set({ encoderSupport: fallback });
    return fallback;
  }
}

async function getEncoderSupport() {
  const { encoderSupport } = await chrome.storage.local.get('encoderSupport');
  return encoderSupport || (await refreshEncoderSupport());
}

// ─── Context menus ──────────────────────────────────────────────────────────

// Serialised: onInstalled calls this directly, and the probe it just ran also
// fires storage.onChanged, which calls it again. Two overlapping runs would
// interleave removeAll() with create() and throw duplicate-id errors.
let menuQueue = Promise.resolve();
function buildMenus() {
  menuQueue = menuQueue
    .catch(() => {})
    .then(rebuildMenus)
    .catch((err) => console.warn('[SaveImageAs] menu rebuild failed:', err));
  return menuQueue;
}

async function rebuildMenus() {
  const support = await getEncoderSupport();
  const available = supportedFormats(support);

  await chrome.contextMenus.removeAll();

  chrome.contextMenus.create({
    id: `${MENU_PREFIX}root`,
    title: 'Save Image As...',
    contexts: ['image'],
  });

  for (const id of FORMAT_ORDER) {
    if (!available.includes(id)) continue;
    chrome.contextMenus.create({
      id: MENU_PREFIX + id,
      parentId: `${MENU_PREFIX}root`,
      title: FORMATS[id].label,
      contexts: ['image'],
    });
  }

  chrome.contextMenus.create({
    id: `${MENU_PREFIX}sep`,
    parentId: `${MENU_PREFIX}root`,
    type: 'separator',
    contexts: ['image'],
  });

  chrome.contextMenus.create({
    id: `${MENU_PREFIX}original`,
    parentId: `${MENU_PREFIX}root`,
    title: 'Original file (no conversion)',
    contexts: ['image'],
  });
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await seedDefaults();
  await refreshEncoderSupport();
  await buildMenus();
  if (reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('ui/welcome.html') });
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await refreshEncoderSupport();
  await buildMenus();
});

// ─── Page-side helpers (injected, so they must be self-contained) ───────────

/**
 * Find the clicked image and report a higher-resolution candidate if the page
 * declares one. Runs in the page's isolated world.
 */
function pageProbe(srcUrl) {
  // Spec-shaped srcset parser: a URL runs to the next whitespace, so the commas
  // inside a Cloudinary transform list are never mistaken for separators.
  function parseSrcset(input) {
    const out = [];
    let i = 0;
    const n = input.length;
    const ws = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
    while (i < n) {
      while (i < n && (ws(input[i]) || input[i] === ',')) i++;
      if (i >= n) break;
      const start = i;
      while (i < n && !ws(input[i])) i++;
      const url = input.slice(start, i).replace(/,+$/, '');
      while (i < n && ws(input[i])) i++;
      const dstart = i;
      while (i < n && input[i] !== ',') i++;
      const desc = input.slice(dstart, i).trim();
      if (i < n) i++;
      if (url) out.push({ url, desc });
    }
    return out;
  }

  try {
    const imgs = Array.from(document.images || []);
    const img =
      imgs.find((el) => el.currentSrc === srcUrl) ||
      imgs.find((el) => el.src === srcUrl) ||
      null;

    const result = {
      best: null,
      naturalWidth: img ? img.naturalWidth : 0,
      naturalHeight: img ? img.naturalHeight : 0,
    };
    if (!img) return result;

    const sets = [img.getAttribute('srcset') || ''];
    const picture = img.closest && img.closest('picture');
    if (picture) {
      for (const s of picture.querySelectorAll('source[srcset]')) {
        sets.push(s.getAttribute('srcset') || '');
      }
    }

    const baseWidth = img.naturalWidth || 0;
    let bestUrl = null;
    let bestWidth = baseWidth;

    for (const set of sets) {
      if (!set) continue;
      for (const { url, desc } of parseSrcset(set)) {
        let width = 0;
        const m = /^([\d.]+)([wx])$/.exec(desc);
        if (m) width = m[2] === 'w' ? parseFloat(m[1]) : parseFloat(m[1]) * (baseWidth || 1);
        else width = baseWidth;
        if (width > bestWidth) {
          bestWidth = width;
          try {
            bestUrl = new URL(url, document.baseURI).href;
          } catch {
            /* skip malformed candidate */
          }
        }
      }
    }

    if (bestUrl && bestUrl !== srcUrl) result.best = bestUrl;
    return result;
  } catch {
    return { best: null, naturalWidth: 0, naturalHeight: 0 };
  }
}

/**
 * Last-resort byte grab. Needed for blob: URLs, which only exist inside the
 * page's own origin and are invisible to the extension, and for hosts that
 * serve images only to their own referer.
 */
function pageGrab(srcUrl) {
  return new Promise((resolve) => {
    fetch(srcUrl)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then(
        (blob) =>
          new Promise((res, rej) => {
            if (blob.size > 48 * 1024 * 1024) {
              rej(new Error('too large to transfer'));
              return;
            }
            const fr = new FileReader();
            fr.onload = () => res(fr.result);
            fr.onerror = () => rej(fr.error || new Error('read failed'));
            fr.readAsDataURL(blob);
          })
      )
      .then((dataUrl) => resolve({ dataUrl }))
      .catch((err) => resolve({ error: String((err && err.message) || err) }));
  });
}

async function runInPage(tabId, frameId, func, args) {
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId ?? 0] },
      func,
      args,
      injectImmediately: true,
    });
    return res?.result ?? null;
  } catch {
    return null; // restricted page, closed tab, no host permission — all fine
  }
}

const injectable = (tab) => !!tab?.id && /^https?:/.test(tab.url || '');

// ─── Main flow ──────────────────────────────────────────────────────────────

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const id = String(info.menuItemId || '');
  if (!id.startsWith(MENU_PREFIX)) return;
  const format = id.slice(MENU_PREFIX.length);
  if (format !== 'original' && !FORMATS[format]) return;
  if (!info.srcUrl) return;
  saveImage({ srcUrl: info.srcUrl, pageUrl: info.pageUrl, format, info, tab });
});

async function saveImage({ srcUrl, pageUrl, format, info, tab }) {
  const label = format === 'original' ? 'the original' : FORMATS[format].label;
  try {
    const settings = await getSettings();

    // 1. Work out which URLs are worth trying, best first.
    let sources = [];
    if (settings.upgradeSource && injectable(tab)) {
      const probe = await runInPage(tab.id, info.frameId, pageProbe, [srcUrl]);
      if (probe?.best) {
        sources.push(
          ...candidateSources(probe.best, settings).map((c) => ({
            ...c,
            reason: c.upgraded ? `${c.reason} (srcset)` : 'larger srcset candidate',
          }))
        );
      }
    }
    sources.push(...candidateSources(srcUrl, settings));
    sources = dedupeBy(sources, (c) => c.url);

    // 2. Convert (or fetch, for "original").
    let result;
    try {
      result = (await askOffscreen('convert', { sources, format, settings })).result;
    } catch (err) {
      if (err.code !== 'FETCH_FAILED' && err.code !== 'NOT_AN_IMAGE') throw err;
      // The extension could not reach it. The page probably can.
      if (!injectable(tab)) throw err;
      const grab = await runInPage(tab.id, info.frameId, pageGrab, [srcUrl]);
      if (!grab?.dataUrl) throw err;
      result = (await askOffscreen('convert', { dataUrl: grab.dataUrl, format, settings })).result;
    }

    // 3. Name it and hand it to the downloader.
    const filename = withSubfolder(
      buildFilename({
        template: settings.filenameTemplate,
        srcUrl,
        pageUrl,
        ext: result.ext,
        format: result.ext,
        width: result.width,
        height: result.height,
      }),
      settings.saveMode === 'subfolder' ? settings.subfolder : ''
    );

    const downloadId = await chrome.downloads.download({
      url: result.blobUrl,
      filename,
      saveAs: settings.saveMode === 'ask',
      conflictAction: 'uniquify',
    });
    pendingRevokes.set(downloadId, result.blobUrl);

    flashBadge('ok');
    if (settings.notifyOnSuccess) notifySuccess(filename, result, label);
  } catch (err) {
    console.error('[SaveImageAs]', err);
    flashBadge('err');
    const settings = await getSettings().catch(() => ({ notifyOnError: true }));
    if (settings.notifyOnError) {
      notify(`Could not save as ${label}`, err?.message || 'Something went wrong.');
    }
  }
}

function dedupeBy(list, key) {
  const seen = new Set();
  return list.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Revoke the blob once the download has stopped reading from it.
chrome.downloads.onChanged.addListener((delta) => {
  const state = delta.state?.current;
  if (state !== 'complete' && state !== 'interrupted') return;
  const url = pendingRevokes.get(delta.id);
  if (!url) return;
  pendingRevokes.delete(delta.id);
  chrome.runtime.sendMessage({ target: 'offscreen', type: 'revoke', url }).catch(() => {});
});

// ─── Feedback ───────────────────────────────────────────────────────────────

let badgeTimer = null;
function flashBadge(kind) {
  const ok = kind === 'ok';
  chrome.action.setBadgeText({ text: ok ? '✓' : '!' });
  chrome.action.setBadgeBackgroundColor({ color: ok ? '#16a34a' : '#dc2626' });
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(() => chrome.action.setBadgeText({ text: '' }), ok ? 1600 : 4000);
}

function notify(title, message) {
  chrome.notifications
    .create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title,
      message,
    })
    .catch(() => {});
}

function notifySuccess(filename, result, label) {
  const parts = [`${result.width}×${result.height}`, formatBytes(result.bytesOut)];
  if (result.passthrough) parts.push('original bytes kept');
  else if (result.bytesIn) {
    const delta = Math.round((1 - result.bytesOut / result.bytesIn) * 100);
    if (delta > 0) parts.push(`${delta}% smaller`);
  }
  if (result.upgraded) parts.push('upgraded source');
  notify(`Saved as ${label}`, `${filename}\n${parts.join(' · ')}`);
}

// Keep the menus in step if a probe result changes.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.encoderSupport) buildMenus();
});

// Exported for the options page's "test my settings" affordance.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'background') return false;
  (async () => {
    try {
      if (msg.type === 'reprobe') {
        const support = await refreshEncoderSupport();
        await buildMenus();
        sendResponse({ ok: true, support });
      } else if (msg.type === 'rebuildMenus') {
        await buildMenus();
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, message: 'unknown' });
      }
    } catch (err) {
      sendResponse({ ok: false, message: String(err?.message || err) });
    }
  })();
  return true;
});
