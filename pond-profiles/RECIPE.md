# Pond Profiles

A right-side panel for Claude Code accounts and versions, driven by
[cvm](https://github.com/alexandernicholson/cvm) and its cvp profiles plugin. Click an account to make it
the one new Claude sessions start on (your claude.ai login, or a company gateway with its own key).
Pin an account or a Claude version to a folder, and see each account's usage limits.
Install, switch and update Claude versions, cvm and cvp. Optionally set per-role subagent models and
the prompt-cache bar of [agent-router](https://github.com/alexandernicholson/agent-router). The first
time it opens, a setup wizard installs whatever is missing. Nothing personal is in the mod folder:
accounts, names, usage settings and sign-in tokens stay in `~/.cvm` on your machine.

**Install:** point your Herdr agent at this folder: copy `mods/pond-profiles/` into
`~/.config/herdr-app/mods/`, then `herdr-app check ~/.config/herdr-app/mods/pond-profiles`.
It is `"place": "none"`: add a block `{ "id": "profiles", "type": "block", "content": { "mod": "pond-profiles" } }`
to a layout (the `pond` layout has it as a child of its right `panel-body` stack, opened from
pond-tabs' account button or `ctrl-a C` in leader). Needs macOS or Linux, `python3`, `curl`/`bash`
for the cvm install, and a Claude login (claude.ai) for the default account.

**Version:** 1.0.0 (see Changes at the end; also `"version"` in `mod.json`).

**Update:** tell your Herdr agent "update my herdr mods" (or "update pond mods"). It follows `UPDATE.md`, installed in the mod folder, which checks this repo's `versions.json` and offers every newer version of the mods and layouts you have from here, with a backup of each. By hand: replace `mods/pond-profiles/` with this folder's copy (asking an agent to *install* it again adds a second copy instead). Your settings and data live outside the mod folder (`~/.cvm/herdr/`) and are kept.

**Reaches the network and runs programs:** it runs `python3 ctl.py`, which runs `cvm`, `claude`
(plugin commands), your login shell (to check PATH) and `security` (macOS Keychain, to read your
claude.ai token for plan usage, never refreshed or written). It fetches from GitHub (cvm, cvp and
agent-router versions, cvm's installer), `api.anthropic.com/api/oauth/usage` (plan usage) and the
gateways you add (their `/v1/models`, `openapi.json`, usage API and device sign-in). It writes
`~/.cvm/` (profiles, `herdr/`, `env.d/zz-herdr.sh`), your shell rc (setup's PATH step, once) and
`~/.claude/settings.json` (setup sets `DISABLE_AUTOUPDATER`; agent-router setup sets
`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS`).

## What you see

A rounded panel (radius 10, 1px `border`, `accent` while it has the keyboard) with a 42px header:
a Claude glyph in `accent`, "Claude", the account in effect for the focused pane's folder (dim),
then a ⚙ button (reopens setup) and a refresh button. Below, cards scroll, each a titled section with
a one-line dim description. `j`/`k` moves the selected card, outlined in `accent`.

- **Account:** one tile per cvp profile: a colored dot (`ansi4` for a claude.ai account, `ansi5` for
  a gateway), the profile's display name, and the gateway host or "claude.ai login". The global
  account is filled. Below the tiles: "+ Add profile" and "Manage profiles". Manage lets you rename a
  profile, replace its key and remove it, with a second click to confirm. The note says "New Claude
  sessions start on this account; running ones keep theirs."
- **Usage:** per profile, either a "Set up usage" button (opt-in) or a usage card:
  - claude.ai plan: "Plan usage limits" (5-hour session) and "Weekly limits" bars with "Resets in …" and "% used".
  - Gateway: daily token/request limits per provider, a forecast, and an optional budget.
  - The bar turns `ansi3` at 75% and `ansi1` at 90%.
  - Each card has Change and Stop showing.
  - When a read fails, it says why ("<host> didn't answer in time.") with Retry, plus Sign in again for gateways using browser sign-in.
- **This folder:** the focused pane's folder, its pinned account (`.claude-profile`) and version
  (`.claude-version`), each with chips to pin or unpin.
- **Claude Code versions:** installed versions (the global one marked), Use / Remove, and Install
  stable or latest when there's a newer one.
- **Updates:** Claude, cvm, cvp, and agent-router and keepalive when installed: installed vs latest,
  with Update buttons. It checks every 6 hours and on `u`.
- **Agent router:** if not installed, an Install card. Otherwise each subagent role gets a model dropdown (the
  gateway's `/v1/models` catalog) and an effort dropdown. The roles are Scout, Reviewer, Security, Task,
  Sonic and Teammates. Below them, keepalive's Upkeep and Cache TTL chips.
- A key bar at the bottom (`p` switch account, `u` check updates, `j k` sections, `r` refresh, `q`
  close, `?` all keys).

Setup view (first run, or ⚙): steps with a status each: cvm, cvm on PATH, Claude (latest), cvp,
then optional "Add a gateway profile" and "Agent router" (with Skip), then Finish.

## How it behaves

- **Switching** (tile click or `p` to cycle) runs `cvm profile use <name>` with
  `CVP_NO_SETTINGS_SYNC=1`. New Claude sessions get the profile at launch through cvm's
  `env.d`; running sessions are untouched. On each status read the panel strips what cvp copied
  into `~/.claude/settings.json` earlier (from cvp's ledger `~/.cvm/profiles/.settings-managed`),
  because Claude applies that file to running sessions and never drops removed variables.
- **Adding a profile:** name, optional gateway URL (https, or http on localhost) and key, key style (Bearer
  `ANTHROPIC_AUTH_TOKEN`, the default, or `ANTHROPIC_API_KEY`, which makes Claude warn on every start
  while a claude.ai login exists), and flag chips (agent teams, gateway models in `/model`, advisor
  tool, function hooks). Gateway profiles also get `ENABLE_CLAUDEAI_MCP_SERVERS=0` (else Claude
  shows "claude.ai connectors are disabled…" on every start). The key goes through a hidden hand-off
  file in the mod folder that `ctl.py` reads and deletes; it's never on a command line or printed.
- **Usage setup:** "Set up usage" suggests a setup:
  - The claude.ai plan for a profile without a gateway.
  - For a gateway, it reads the gateway's `openapi.json` to find a usage path (and a budget path), and auth by device sign-in (RFC 8628, `/oauth/device`) or the profile key.
  - Device sign-in shows the code on the card, opens the browser, and polls until approved.
  - Usage reloads every 2 minutes and on `r`.
- Folder pins: `cvm profile local <name>` / `--unset`, `cvm local <ver>` (unpinning a version
  deletes `.claude-version`).
- Every action shows its busy text on its button and a toast when done; failures show under the card.
- `cmd-alt-arrows` move between panels; `escape` returns to the focused pane; `q` hides the panel.
- Launch hook: setup installs `herdr-label.sh` as `~/.cvm/env.d/zz-herdr.sh`, which labels each
  Claude terminal `herdr.claude-profile` and `herdr.claude-version`. pond-agents shows the label as
  an account badge.
- Shared state: `pond-profiles.hasKeys` (focus) and `pond-profiles.account`. It also writes an
  `accounts` map (name, label, gateway) into `~/.cvm/herdr/pond-profiles.json` for pond-tabs and
  pond-agents.

## Built from

- `main.js`: the panel (cards, keys, the agent-router dropdowns, usage rendering).
- `setup.js`: the wizard, the add-profile, rename and usage forms, and the hand-off writer.
- `keybar.js`: the key bar. `claude.svg`: the glyph.
- `ctl.py`: the JSON backend; every command prints one `{"ok": …}` object. Commands: status,
  doctor, setup, remote, use, profile-add/remove/label, pin-profile, pin-version, install,
  use-version, uninstall, update, set-key, models, router, router-set, install-hook, usage,
  usage-detect, usage-setup, usage-remove, gateway-login/poll/logout.
- `herdr-label.sh`: the launch hook.
- Herdr: `exec`, `writeTextFile`, `notify`, `run("layout.hide")`, `run("pane.focus")`,
  `run("pane.go")`, `nextCommand()` (`setup`, `add-profile`, `finish`, `switch`, `updates`, `key:<k>`,
  `go:<dir>`), `setShared`.
- Local state: `~/.cvm/herdr/pond-profiles.json` (display names, usage setups, setup flags,
  accounts) and `~/.cvm/herdr/tokens/` (gateway sign-in tokens, folder 700, files 600).

## Watch out

- cvm's `claude` must come first on PATH (setup adds `~/.cvm/bin` to your shell rc). A `claude`
  earlier on PATH bypasses profiles.
- `cvm profile use` run in a terminal still syncs into `settings.json` until the panel's next
  refresh cleans it; running sessions pick that up in between. Switch from the panel.
- Split-pane agent teammates don't get the profile (they read `settings.json`, not the launch env).
- Plan usage reads the claude.ai token from the Keychain item "Claude Code-credentials" and never
  refreshes it; when it expires, run `/login` in Claude.
- The ctl `usage` read allows 30s per request; slow gateways show "didn't answer in time" and Retry.
- `herdr-app check` doesn't run `ctl.py`. Test the backend from a shell with a scratch
  `CVM_DIR=<dir>`, and don't run `setup path|claude|router` there.

## Done when

- First open with no cvm shows the setup view; each step installs and turns done; Finish shows the cards.
- Adding a gateway profile creates `~/.cvm/profiles/<name>.env` (mode 600) with no key in any log.
- Clicking an account tile changes `~/.cvm/active-profile`, and a new Claude tab runs on it while
  `~/.claude/settings.json` stays byte-identical.
- "Set up usage" on a claude.ai account shows the 5-hour and weekly bars.
- An agent-router role's model and effort dropdowns save and show the new value after reload.

## Changes

### 1.0.0 (2026-11-12)

- First release: accounts (cvp profiles) with no settings.json sync, folder pins, versions, updates,
  usage (claude.ai plan and gateway usage with device sign-in, Retry and Sign in again), agent-router
  and keepalive options with dropdowns, setup wizard, launch labels.
