// Unit tests for the pure-logic modules. Run: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upgradeCloudinaryUrl, candidateSources } from '../src/lib/cloudinary.js';
import {
  buildFilename,
  sanitizeSubfolder,
  safeComponent,
  baseNameFromUrl,
  withSubfolder,
} from '../src/lib/filename.js';
import { normalize, DEFAULTS } from '../src/lib/settings.js';

test('cloudinary: strips transforms and the format extension', () => {
  const got = upgradeCloudinaryUrl(
    'https://res.cloudinary.com/demo/image/upload/w_400,h_300,c_fill,q_auto,f_auto/v1699/folder/pic.jpg'
  );
  assert.equal(got.url, 'https://res.cloudinary.com/demo/image/upload/v1699/folder/pic');
});

test('cloudinary: chained transform segments all removed', () => {
  const got = upgradeCloudinaryUrl(
    'https://res.cloudinary.com/demo/image/upload/w_400,c_scale/e_sharpen:80/q_70/sample.png'
  );
  assert.equal(got.url, 'https://res.cloudinary.com/demo/image/upload/sample');
});

test('cloudinary: no transforms still drops the extension for the master format', () => {
  const got = upgradeCloudinaryUrl('https://res.cloudinary.com/demo/image/upload/v1/sample.jpg');
  assert.equal(got.url, 'https://res.cloudinary.com/demo/image/upload/v1/sample');
});

test('cloudinary: already-bare URL yields no upgrade', () => {
  assert.equal(upgradeCloudinaryUrl('https://res.cloudinary.com/demo/image/upload/v1/sample'), null);
});

test('cloudinary: signed transformations are left alone', () => {
  assert.equal(
    upgradeCloudinaryUrl(
      'https://res.cloudinary.com/demo/image/authenticated/s--Ab3xY9Zq--/w_400/v1/secret.jpg'
    ),
    null
  );
});

test('cloudinary: /fetch/ remote URL tail is never rewritten', () => {
  const got = upgradeCloudinaryUrl(
    'https://res.cloudinary.com/demo/image/fetch/w_300,q_80/https://example.com/photo.jpg'
  );
  assert.equal(got.url, 'https://res.cloudinary.com/demo/image/fetch/https://example.com/photo.jpg');
});

test('cloudinary: custom CNAME needs a real transform segment as evidence', () => {
  assert.equal(upgradeCloudinaryUrl('https://media.acme.com/image/upload/v1/a.jpg'), null);
  const got = upgradeCloudinaryUrl('https://media.acme.com/image/upload/w_200,q_60/v1/a.jpg');
  assert.equal(got.url, 'https://media.acme.com/image/upload/v1/a');
});

test('cloudinary: unrelated URLs are ignored', () => {
  for (const u of [
    'https://example.com/img/photo.jpg',
    'https://cdn.shopify.com/s/files/1/products/thing_400x.jpg',
    'not a url',
    'blob:https://example.com/abc-123',
  ]) {
    assert.equal(upgradeCloudinaryUrl(u), null, u);
  }
});

test('cloudinary: public id containing an underscore key-like folder survives', () => {
  const got = upgradeCloudinaryUrl(
    'https://res.cloudinary.com/demo/image/upload/w_100/v1/my_folder/my_photo.jpg'
  );
  assert.equal(got.url, 'https://res.cloudinary.com/demo/image/upload/v1/my_folder/my_photo');
});

test('candidateSources: original is always the last fallback', () => {
  const src = 'https://res.cloudinary.com/demo/image/upload/w_50/v1/a.jpg';
  const list = candidateSources(src, { upgradeSource: true });
  assert.equal(list.length, 2);
  assert.equal(list[0].upgraded, true);
  assert.equal(list.at(-1).url, src);

  const off = candidateSources(src, { upgradeSource: false });
  assert.equal(off.length, 1);
  assert.equal(off[0].url, src);
});

test('safeComponent: strips traversal, control chars and reserved names', () => {
  assert.equal(safeComponent('../../etc/passwd'), 'etc_passwd');
  assert.equal(safeComponent('..'), 'image');
  assert.equal(safeComponent('a\u0000b'), 'a_b');
  assert.equal(safeComponent('he\u202Ello'), 'hello');
  assert.equal(safeComponent('CON'), '_CON');
  assert.equal(safeComponent('   '), 'image');
  assert.equal(safeComponent('name.'), 'name');
});

test('sanitizeSubfolder: relative, bounded depth, no escapes', () => {
  assert.equal(sanitizeSubfolder('SaveImageAs'), 'SaveImageAs');
  assert.equal(sanitizeSubfolder('/abs/../path'), 'abs/path');
  assert.equal(sanitizeSubfolder('a/b/c/d/e/f'), 'a/b/c/d');
  assert.equal(sanitizeSubfolder('..'), '');
  assert.equal(sanitizeSubfolder(''), '');
  assert.equal(sanitizeSubfolder('C:\\Windows'), 'C_/Windows');
});

test('baseNameFromUrl: handles extensions, query strings and oddities', () => {
  assert.equal(baseNameFromUrl('https://x.com/a/photo.jpeg?v=2'), 'photo');
  assert.equal(baseNameFromUrl('https://x.com/a/photo'), 'photo');
  assert.equal(baseNameFromUrl('https://x.com/'), 'x.com');
  assert.equal(baseNameFromUrl('data:image/png;base64,AAAA'), 'image');
  assert.equal(baseNameFromUrl('https://x.com/%E7%8C%AB.png'), '\u732b');
});

test('buildFilename: default template', () => {
  assert.equal(
    buildFilename({ srcUrl: 'https://x.com/cat.png', ext: 'jpg' }),
    'cat.jpg'
  );
});

test('buildFilename: all tokens expand', () => {
  const got = buildFilename({
    template: '{host}/{name}-{w}x{h}-{date}.{ext}',
    srcUrl: 'https://cdn.x.com/cat.png',
    pageUrl: 'https://www.example.com/page',
    ext: 'webp',
    width: 800,
    height: 600,
    now: new Date(2026, 7, 13, 9, 5, 3),
  });
  assert.equal(got, 'example.com/cat-800x600-2026-08-13.webp');
});

test('buildFilename: unknown token is left visible, not dropped', () => {
  assert.equal(
    buildFilename({ template: '{name}-{bogus}.{ext}', srcUrl: 'https://x.com/a.png', ext: 'png' }),
    'a-{bogus}.png'
  );
});

test('buildFilename: a hostile template cannot escape the download dir', () => {
  const got = buildFilename({
    template: '../../{name}.{ext}',
    srcUrl: 'https://x.com/../../../etc/shadow.png',
    ext: 'png',
  });
  assert.ok(!got.includes('..'), got);
  assert.ok(!got.startsWith('/'), got);
});

test('buildFilename: template with no extension inherits the format extension', () => {
  assert.equal(
    buildFilename({ template: '{name}', srcUrl: 'https://x.com/a.png', ext: 'webp' }),
    'a.webp'
  );
});

test('withSubfolder: composes safely', () => {
  assert.equal(withSubfolder('a.png', 'Pics'), 'Pics/a.png');
  assert.equal(withSubfolder('a.png', ''), 'a.png');
  assert.equal(withSubfolder('a.png', '../../etc'), 'etc/a.png');
});

test('normalize: clamps and repairs corrupt synced values', () => {
  const s = normalize({
    jpegQuality: 999,
    webpQuality: -4,
    maxDimension: 'nope',
    saveMode: 'evil',
    jpegBackground: 'javascript:alert(1)',
    filenameTemplate: '   ',
    passthrough: false,
  });
  assert.equal(s.jpegQuality, 100);
  assert.equal(s.webpQuality, 1);
  assert.equal(s.maxDimension, DEFAULTS.maxDimension);
  assert.equal(s.saveMode, 'downloads');
  assert.equal(s.jpegBackground, '#ffffff');
  assert.equal(s.filenameTemplate, '{name}.{ext}');
  assert.equal(s.passthrough, false);
});
