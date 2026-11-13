#!/usr/bin/env bash
# Copies the live Herdr config (~/.config/herdr-app) into this repo's item folders,
# per items.conf, plus personal machine files into machine/. Never writes to the config.
set -euo pipefail
HOME_DIR="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
REPO="$(cd "$(dirname "$0")" && pwd)"

# Never undo work that reached the repo another way (a merged pull request): stop when a file
# changed here since the last sync and differs from the live config. --overwrite: replace anyway.
if [[ "${1:-}" != "--overwrite" ]]; then
  python3 "$REPO/tools/guard.py" check "$REPO" "$HOME_DIR" || exit 1
fi
EXCLUDES=(--exclude gpui-kit.d.ts --exclude jsconfig.json --exclude .DS_Store --exclude '*.error' --exclude node_modules --exclude '.handoff-*' --exclude __pycache__)

while read -r item kind rest; do
  [[ -z "$item" || "$item" == \#* ]] && continue
  mkdir -p "$REPO/$item"
  for word in $rest; do
    case "$word" in
      keys) ;;
      layout:*)
        name="${word#layout:}"
        mkdir -p "$REPO/$item/layouts"
        cp "$HOME_DIR/layouts/$name.json" "$REPO/$item/layouts/$name.json"
        [[ -f "$HOME_DIR/layouts/$name.svg" ]] && cp "$HOME_DIR/layouts/$name.svg" "$REPO/$item/layouts/"
        ;;
      *)
        [[ -d "$HOME_DIR/mods/$word" ]] || { echo "missing mod: $word" >&2; exit 1; }
        mkdir -p "$REPO/$item/mods/$word"
        rsync -a --delete "${EXCLUDES[@]}" "$HOME_DIR/mods/$word/" "$REPO/$item/mods/$word/"
        ;;
    esac
  done
done < "$REPO/items.conf"

# Personal files for setting up another machine (not published as items).
for f in keys.json settings.json programs.json; do
  [[ -f "$HOME_DIR/$f" ]] && cp "$HOME_DIR/$f" "$REPO/machine/$f"
done

# Where each mod came from, UPDATE.md in every mod, and versions.json (for updating).
python3 "$REPO/tools/stamp.py" "$REPO"
python3 "$REPO/tools/guard.py" record "$REPO" "$HOME_DIR"
echo "synced from $HOME_DIR"
