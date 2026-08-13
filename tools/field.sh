#!/usr/bin/env bash
# Copy one Web Store submission field to the clipboard.
#
# The developer console lives on chrome.google.com/webstore, which Chrome
# refuses to let any extension script, so these fields have to be pasted in by
# hand. This makes each one a single command.
#
#   tools/field.sh              list the fields
#   tools/field.sh detailed     copy the detailed description
#   tools/field.sh 09           copy by number
set -euo pipefail

cd "$(dirname "$0")/.."
DIR=store/submission

if [ $# -eq 0 ]; then
  printf 'Fields (tools/field.sh <number or name>):\n\n'
  for f in "$DIR"/*.txt; do
    n=$(basename "$f" .txt)
    # Count what actually gets copied, i.e. without the trailing newline.
    printf '  %-26s %5s chars\n' "$n" "$(printf '%s' "$(cat "$f")" | wc -c | tr -d ' ')"
  done
  printf '\nThen: paste into the console. Order matches the tabs.\n'
  exit 0
fi

match=$(ls "$DIR" | grep -i -- "$1" || true)
count=$(printf '%s' "$match" | grep -c . || true)

if [ "$count" -eq 0 ]; then
  echo "No field matching '$1'. Run without arguments to list them." >&2
  exit 1
elif [ "$count" -gt 1 ]; then
  echo "'$1' matches more than one field:" >&2
  printf '  %s\n' $match >&2
  exit 1
fi

# printf, not cat: no trailing newline, which some console fields keep.
printf '%s' "$(cat "$DIR/$match")" | pbcopy
echo "Copied $match ($(printf '%s' "$(cat "$DIR/$match")" | wc -c | tr -d ' ') chars) to the clipboard."
