#!/usr/bin/env bash
# Installed by Herdr's pond-profiles panel (mods/pond-profiles/herdr-statusline.sh) as Claude Code's
# status line. In Herdr it labels this terminal with its context use and model
# (claude.context, claude.model) for the agents list, only when they change and in the background.
# Then it hands the same input to the status line you had before (kept in statusline-next), or
# prints a short one of its own.
input=$(cat)
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if command -v jq >/dev/null 2>&1; then
  pct=$(printf '%s' "$input" | jq -r '.context_window.used_percentage // empty' 2>/dev/null | cut -d. -f1)
  model=$(printf '%s' "$input" | jq -r '.model.display_name // empty' 2>/dev/null)
else
  pct=$(printf '%s' "$input" | python3 -c 'import json,sys
try: p=(json.load(sys.stdin).get("context_window") or {}).get("used_percentage")
except Exception: p=None
print(int(p) if isinstance(p,(int,float)) else "")' 2>/dev/null)
  model=$(printf '%s' "$input" | python3 -c 'import json,sys
try: print((json.load(sys.stdin).get("model") or {}).get("display_name") or "")
except Exception: print("")' 2>/dev/null)
fi

if [ -n "${HC_TERMINAL_ID:-}" ] && command -v hc >/dev/null 2>&1; then
  cache="${TMPDIR:-/tmp}/herdr-claude-context-${HC_SCOPE:-}-${HC_TERMINAL_ID}"
  if [ "$(cat "$cache" 2>/dev/null)" != "${pct:-0}|$model" ]; then
    printf '%s' "${pct:-0}|$model" >"$cache"
    (hc label "$HC_TERMINAL_ID" "claude.context=${pct:-0}" "claude.model=$model" >/dev/null 2>&1 &)
  fi
fi

next=$(cat "$here/statusline-next" 2>/dev/null)
if [ -n "$next" ]; then
  printf '%s' "$input" | eval "$next"
else
  printf '%s' "${model:-Claude}${pct:+ · ${pct}% context}"
fi
