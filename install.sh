#!/usr/bin/env bash
# Installs every item into ~/.config/herdr-app (overwriting same-named mods/layouts).
# With --machine, also installs machine/keys.json and settings.json (old ones kept as *.bak-<time>).
# Herdr hot-reloads; run `herdr-app check ~/.config/herdr-app/mods/<name>` afterwards.
set -euo pipefail
HOME_DIR="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
REPO="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$HOME_DIR/mods" "$HOME_DIR/layouts"
for item in "$REPO"/*/; do
  [[ -d "$item/mods" ]] && for m in "$item"mods/*/; do rsync -a "$m" "$HOME_DIR/mods/$(basename "$m")/"; done
  [[ -d "$item/layouts" ]] && cp "$item"layouts/* "$HOME_DIR/layouts/"
done
if [[ "${1:-}" == "--machine" ]]; then
  ts=$(date +%Y%m%d%H%M%S)
  for f in "$REPO"/machine/*.json; do
    t="$HOME_DIR/$(basename "$f")"
    [[ -f "$t" ]] && cp "$t" "$t.bak-$ts"
    cp "$f" "$t"
  done
fi
echo "installed into $HOME_DIR"
