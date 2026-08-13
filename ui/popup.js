import { getSettings, patchSettings } from '../src/lib/settings.js';
import { FORMATS, supportedFormats } from '../src/lib/formats.js';

const $ = (id) => document.getElementById(id);

const els = {
  chips: $('formatChips'),
  qualityLabel: $('qualityLabel'),
  qualityControls: $('qualityControls'),
  losslessNote: $('losslessNote'),
  quality: $('quality'),
  qualityNum: $('qualityNum'),
  savedFlag: $('savedFlag'),
  saveMode: $('saveMode'),
  subfolderPanel: $('subfolderPanel'),
  subfolder: $('subfolder'),
  maxDimension: $('maxDimension'),
  maxDimensionNote: $('maxDimensionNote'),
  version: $('version'),
};

let settings = null;
let activeFormat = 'jpeg';

// ─── Boot ───────────────────────────────────────────────────────────────────

(async function init() {
  els.version.textContent = `v${chrome.runtime.getManifest().version}`;

  settings = await getSettings();
  const { encoderSupport, popupFormat } = await chrome.storage.local.get([
    'encoderSupport',
    'popupFormat',
  ]);

  const available = supportedFormats(encoderSupport);
  renderChips(available);

  activeFormat = available.includes(popupFormat) ? popupFormat : 'jpeg';
  selectFormat(activeFormat);

  setSaveMode(settings.saveMode);
  els.subfolder.value = settings.subfolder;
  els.maxDimension.value = settings.maxDimension;
  updateMaxDimensionNote();

  wire();
})();

// ─── Format chips ───────────────────────────────────────────────────────────

function renderChips(available) {
  els.chips.replaceChildren();
  for (const id of available) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.dataset.format = id;
    btn.textContent = FORMATS[id].label;
    btn.title = FORMATS[id].hint;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', 'false');
    els.chips.append(btn);
  }
}

function selectFormat(id) {
  activeFormat = id;
  const fmt = FORMATS[id];

  for (const chip of els.chips.children) {
    chip.setAttribute('aria-selected', String(chip.dataset.format === id));
  }

  const lossless = !fmt.qualityKey;
  els.qualityControls.hidden = lossless;
  els.losslessNote.hidden = !lossless;
  els.qualityLabel.textContent = lossless ? fmt.label : `${fmt.label} quality`;

  if (!lossless) setQuality(settings[fmt.qualityKey]);
  chrome.storage.local.set({ popupFormat: id });
}

function setQuality(value) {
  const v = Math.min(100, Math.max(1, Number(value) || 1));
  els.quality.value = v;
  els.qualityNum.value = v;
  els.quality.style.setProperty('--fill', `${((v - 1) / 99) * 100}%`);
}

// ─── Save mode ──────────────────────────────────────────────────────────────

function setSaveMode(mode) {
  for (const btn of els.saveMode.children) {
    btn.setAttribute('aria-pressed', String(btn.dataset.mode === mode));
  }
  els.subfolderPanel.hidden = mode !== 'subfolder';
}

function updateMaxDimensionNote() {
  const v = Number(els.maxDimension.value) || 0;
  els.maxDimensionNote.textContent = v
    ? `Images wider or taller than ${v}px are scaled down to fit.`
    : '0 keeps the original size.';
}

// ─── Persistence ────────────────────────────────────────────────────────────

let saveTimer = null;
let flagTimer = null;
let pending = {};

function save(patch) {
  settings = { ...settings, ...patch };
  // Accumulate rather than replace: changing two controls inside the debounce
  // window must not let the second write discard the first.
  Object.assign(pending, patch);
  clearTimeout(saveTimer);
  // Debounced so dragging a slider does not write on every pixel.
  saveTimer = setTimeout(async () => {
    const batch = pending;
    pending = {};
    settings = await patchSettings(batch);
    flashSaved();
  }, 220);
}

function flashSaved() {
  els.savedFlag.classList.add('show');
  clearTimeout(flagTimer);
  flagTimer = setTimeout(() => els.savedFlag.classList.remove('show'), 1200);
}

// ─── Events ─────────────────────────────────────────────────────────────────

function wire() {
  els.chips.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (chip) selectFormat(chip.dataset.format);
  });

  const onQuality = (raw) => {
    const key = FORMATS[activeFormat].qualityKey;
    if (!key) return;
    const v = Math.min(100, Math.max(1, Math.round(Number(raw) || 1)));
    setQuality(v);
    save({ [key]: v });
  };

  els.quality.addEventListener('input', (e) => onQuality(e.target.value));
  els.qualityNum.addEventListener('change', (e) => onQuality(e.target.value));

  els.saveMode.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-mode]');
    if (!btn) return;
    setSaveMode(btn.dataset.mode);
    save({ saveMode: btn.dataset.mode });
  });

  els.subfolder.addEventListener('input', () => save({ subfolder: els.subfolder.value }));

  els.maxDimension.addEventListener('input', () => {
    updateMaxDimensionNote();
    save({ maxDimension: Number(els.maxDimension.value) || 0 });
  });

  for (const id of ['openOptions', 'openOptions2']) {
    document.getElementById(id).addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
      window.close();
    });
  }
}
