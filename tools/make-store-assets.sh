#!/usr/bin/env bash
# Render the Chrome Web Store screenshots and promo tiles with headless Chrome.
#
# The scenes are composed from the real extension UI (see tools/shots/shot.html),
# so re-running this after a UI change keeps the store listing honest.
#
# Usage: tools/make-store-assets.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_SHOTS="$ROOT/store/screenshots"
OUT_PROMO="$ROOT/store/promo"
PORT=8791
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

[ -x "$CHROME" ] || { echo "Chrome not found at: $CHROME (set \$CHROME)"; exit 1; }

mkdir -p "$OUT_SHOTS" "$OUT_PROMO"

python3 -m http.server "$PORT" --directory "$ROOT" >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
sleep 1

shoot() { # scene, width, height, outfile
  local scene=$1 w=$2 h=$3 out=$4
  "$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --virtual-time-budget=4000 --screenshot="$out" --window-size="$w,$h" \
    "http://localhost:$PORT/tools/shots/shot.html?scene=$scene&w=$w&h=$h" >/dev/null 2>&1
  printf '  %-46s %s\n' "$(basename "$out")" "$(python3 -c "
import struct,sys
d=open('$out','rb').read(33)
print('%dx%d' % struct.unpack('>II', d[16:24]))" 2>/dev/null || echo '??')"
}

echo "Screenshots (1280x800):"
shoot hero    1280 800 "$OUT_SHOTS/1-context-menu.png"
shoot popup   1280 800 "$OUT_SHOTS/2-popup.png"
shoot source  1280 800 "$OUT_SHOTS/3-original-source.png"
shoot honest  1280 800 "$OUT_SHOTS/4-format-verification.png"
shoot options 1280 800 "$OUT_SHOTS/5-settings.png"

echo "Promo tiles:"
shoot promo    440  280 "$OUT_PROMO/small-tile-440x280.png"
shoot marquee 1400  560 "$OUT_PROMO/marquee-1400x560.png"

echo "Done."
