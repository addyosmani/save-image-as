import { getSettings, patchSettings, resetSettings, DEFAULTS } from '../src/lib/settings.js';
import { FORMATS, FORMAT_ORDER } from '../src/lib/formats.js';
import { buildFilename, withSubfolder } from '../src/lib/filename.js';

const $ = (id) => document.getElementById(id);

let settings = null;

// ─── Boot ───────────────────────────────────────────────────────────────────

(async function init() {
  $('version').textContent = `v${chrome.runtime.getManifest().version}`;
  settings = await getSettings();

  const support = await currentSupport();
  renderQualityRows(support);
  renderEncoders(support);

  $('passthrough').checked = settings.passthrough;
  $('upgradeSource').checked = settings.upgradeSource;
  $('maxDimension').value = settings.maxDimension;
  $('jpegBackground').value = settings.jpegBackground;
  $('filenameTemplate').value = settings.filenameTemplate;
  $('subfolder').value = settings.subfolder;
  $('notifyOnError').checked = settings.notifyOnError;
  $('notifyOnSuccess').checked = settings.notifyOnSuccess;

  setSaveMode(settings.saveMode);
  renderTokenList();
  renderPreview();
  wire();
})();

async function currentSupport() {
  const { encoderSupport } = await chrome.storage.local.get('encoderSupport');
  return encoderSupport || {};
}

// ─── Quality rows ───────────────────────────────────────────────────────────

function renderQualityRows(support) {
  const host = $('qualityRows');
  host.replaceChildren();

  for (const id of FORMAT_ORDER) {
    const fmt = FORMATS[id];
    if (!fmt.qualityKey) continue;
    // No point offering a dial for a codec this browser cannot encode. The
    // encoder-support card below explains the absence.
    if (fmt.probe && support[id] !== true) continue;

    const row = document.createElement('div');
    row.className = 'quality-row';
    row.innerHTML = `
      <div class="name">${fmt.label}<small>${fmt.blurb}</small></div>
      <input type="range" min="1" max="100" step="1" aria-label="${fmt.label} quality">
      <input type="number" class="num" min="1" max="100" step="1" aria-label="${fmt.label} quality value">
    `;

    const range = row.querySelector('input[type=range]');
    const num = row.querySelector('input[type=number]');

    const apply = (raw, persist) => {
      const v = Math.min(100, Math.max(1, Math.round(Number(raw) || 1)));
      range.value = v;
      num.value = v;
      range.style.setProperty('--fill', `${((v - 1) / 99) * 100}%`);
      if (persist) save({ [fmt.qualityKey]: v });
    };

    apply(settings[fmt.qualityKey], false);
    range.addEventListener('input', (e) => apply(e.target.value, true));
    num.addEventListener('change', (e) => apply(e.target.value, true));

    host.append(row);
  }

  // PNG has no dial; say so rather than leaving a gap people look for.
  const note = document.createElement('p');
  note.className = 'hint';
  note.textContent = 'PNG is lossless and has no quality setting.';
  host.append(note);
}

// ─── Encoder badges ─────────────────────────────────────────────────────────

function renderEncoders(support) {
  const host = $('encoderList');
  host.replaceChildren();

  for (const id of FORMAT_ORDER) {
    const fmt = FORMATS[id];
    const ok = fmt.probe ? support[id] === true : support[id] !== false;
    const el = document.createElement('span');
    el.className = `enc ${ok ? 'yes' : 'no'}`;
    el.innerHTML = `<i class="dot"></i>${fmt.label}`;
    el.title = ok
      ? `${fmt.label} encoding verified in this browser.`
      : `${fmt.label} is not offered — this browser cannot encode it.`;
    if (!ok) el.append(' — unavailable');
    host.append(el);
  }
}

// ─── Filename preview ───────────────────────────────────────────────────────

function renderTokenList() {
  $('tokenList').innerHTML =
    'Tokens: ' +
    ['{name}', '{ext}', '{w}', '{h}', '{date}', '{time}', '{host}']
      .map((t) => `<span class="code">${t}</span>`)
      .join(' ');
}

function renderPreview() {
  const name = buildFilename({
    template: $('filenameTemplate').value || DEFAULTS.filenameTemplate,
    srcUrl: 'https://images.example.com/gallery/sunset-over-the-bay.png',
    pageUrl: 'https://www.example.com/article',
    ext: 'jpg',
    format: 'jpg',
    width: 1920,
    height: 1080,
  });
  const mode = settings.saveMode;
  const full = withSubfolder(name, mode === 'subfolder' ? $('subfolder').value : '');
  $('filenamePreview').textContent = `Downloads/${full}`;
}

// ─── Save mode ──────────────────────────────────────────────────────────────

function setSaveMode(mode) {
  for (const btn of $('saveMode').children) {
    btn.setAttribute('aria-pressed', String(btn.dataset.mode === mode));
  }
  $('subfolderField').hidden = mode !== 'subfolder';
}

// ─── Persistence ────────────────────────────────────────────────────────────

let saveTimer = null;
let flagTimer = null;
let pending = {};

function save(patch) {
  settings = { ...settings, ...patch };
  // Accumulate rather than replace. Touching two controls inside the debounce
  // window used to clear the first timer and write only the second patch,
  // silently discarding the earlier change.
  Object.assign(pending, patch);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const batch = pending;
    pending = {};
    settings = await patchSettings(batch);
    flashSaved();
    renderPreview();
  }, 220);
}

function flashSaved() {
  const flag = $('savedFlag');
  flag.classList.add('show');
  clearTimeout(flagTimer);
  flagTimer = setTimeout(() => flag.classList.remove('show'), 1200);
}

// ─── Events ─────────────────────────────────────────────────────────────────

function wire() {
  const bindSwitch = (id) =>
    $(id).addEventListener('change', (e) => save({ [id]: e.target.checked }));
  ['passthrough', 'upgradeSource', 'notifyOnError', 'notifyOnSuccess'].forEach(bindSwitch);

  $('maxDimension').addEventListener('input', (e) =>
    save({ maxDimension: Number(e.target.value) || 0 })
  );
  $('jpegBackground').addEventListener('input', (e) => save({ jpegBackground: e.target.value }));

  $('filenameTemplate').addEventListener('input', (e) => {
    renderPreview();
    save({ filenameTemplate: e.target.value });
  });

  $('subfolder').addEventListener('input', (e) => {
    renderPreview();
    save({ subfolder: e.target.value });
  });

  $('saveMode').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-mode]');
    if (!btn) return;
    setSaveMode(btn.dataset.mode);
    settings.saveMode = btn.dataset.mode;
    renderPreview();
    save({ saveMode: btn.dataset.mode });
  });

  $('reprobe').addEventListener('click', async () => {
    const btn = $('reprobe');
    btn.disabled = true;
    btn.textContent = 'Checking…';
    try {
      const res = await chrome.runtime.sendMessage({ target: 'background', type: 'reprobe' });
      renderEncoders(res?.support || (await currentSupport()));
    } finally {
      btn.disabled = false;
      btn.textContent = 'Re-check';
    }
  });

  $('reset').addEventListener('click', async () => {
    if (!confirm('Restore all SaveImage settings to their defaults?')) return;
    settings = await resetSettings();
    location.reload();
  });
}
