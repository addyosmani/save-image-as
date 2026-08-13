#!/usr/bin/env bash
# Build the Chrome Web Store upload zip.
#
# Ships only what the extension needs at runtime. Tests, tooling, store assets
# and docs are excluded — reviewers flag unused files, and every extra byte is
# extra attack surface to justify.
#
# Usage: tools/package.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION=$(node -p "require('./manifest.json').version")
OUT="dist/save-image-as-v${VERSION}.zip"

mkdir -p dist
rm -f "$OUT"

zip -qr "$OUT" \
  manifest.json \
  icons \
  src \
  ui \
  -x '*.DS_Store'

echo "$OUT"
# `unzip -Z1` lists just the entry names, portably (BSD head has no -n -N).
unzip -Z1 "$OUT" | grep -v '/$' | sort | sed 's/^/  /'
echo
echo "  $(du -h "$OUT" | cut -f1)  total"

# Guard against shipping something that is not referenced by the manifest.
node - <<'NODE'
const fs = require('fs');
const { execSync } = require('child_process');
const version = require('./manifest.json').version;
const listed = execSync(`unzip -Z1 dist/save-image-as-v${version}.zip`)
  .toString().trim().split('\n').filter((f) => !f.endsWith('/'));
const stray = listed.filter((f) => /(^test\/|^tools\/|^store\/|\.md$)/.test(f));
if (stray.length) {
  console.error('\nERROR: non-runtime files in the package:\n  ' + stray.join('\n  '));
  process.exit(1);
}
console.log('\nPackage contains runtime files only.');
NODE
