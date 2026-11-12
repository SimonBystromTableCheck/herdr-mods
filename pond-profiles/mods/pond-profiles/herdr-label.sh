# Installed by Herdr's pond-profiles panel (mods/pond-profiles/herdr-label.sh); reinstalled when that changes.
# Sourced by cvm's claude wrapper. Labels this terminal in herdr-core with the Claude profile
# and version it starts with, so Herdr can show each agent's account.
if [[ -n "${HC_TERMINAL_ID:-}" ]] && command -v hc >/dev/null 2>&1; then
  _hz_walk() {
    local d="$PWD"
    while :; do
      [[ -f "$d/$1" ]] && { tr -d '[:space:]' < "$d/$1"; return 0; }
      [[ "$d" == / ]] && return 1
      d=$(dirname "$d")
    done
  }
  _hz_dir="${CVM_DIR:-$HOME/.cvm}"
  _hz_g=$(tr -d '[:space:]' < "$_hz_dir/active-profile" 2>/dev/null)
  _hz_p="${CVM_PROFILE:-$(_hz_walk .claude-profile || printf %s "$_hz_g")}"
  # A pin to a profile that doesn't exist applies nothing: the global one (in settings.json) runs.
  [[ -f "$_hz_dir/profiles/$_hz_p.env" ]] || _hz_p="$_hz_g"
  # A gateway URL in ~/.claude/settings.json (left by `cvm profile use` in a terminal) wins over
  # the launch environment: a profile without a gateway then runs on the global one.
  if [[ "$_hz_p" != "$_hz_g" ]] \
    && ! grep -q '^ANTHROPIC_BASE_URL=' "$_hz_dir/profiles/$_hz_p.env" 2>/dev/null \
    && grep -q '"ANTHROPIC_BASE_URL"' "$HOME/.claude/settings.json" 2>/dev/null; then
    _hz_p="$_hz_g"
  fi
  _hz_v="${CVM_VERSION:-$(_hz_walk .claude-version || tr -d '[:space:]' < "$_hz_dir/version" 2>/dev/null)}"
  (hc label "$HC_TERMINAL_ID" "herdr.claude-profile=$_hz_p" "herdr.claude-version=$_hz_v" >/dev/null 2>&1 &)
  unset -f _hz_walk
  unset _hz_dir _hz_g _hz_p _hz_v
fi
