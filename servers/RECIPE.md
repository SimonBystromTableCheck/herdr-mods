# Servers

A panel of your local dev servers. Each card shows whether the server is running, the branch its folder is on, the localhost URL it printed, and the command it runs; start, stop, restart and its logs are one click or key away. Servers run as labeled herdr-core terminals, so they keep running when Herdr closes and are found again when it reopens. Adding one is a two-step picker: choose a folder under your projects root (`~/code` by default, changeable), then pick a detected start command (package.json scripts, Procfile, Rails, Docker Compose, Django, Cargo, Go) or type one.


**Install:** tell your Herdr agent "Install the Herdr mod at
https://github.com/SimonBystromTableCheck/herdr-mods/tree/main/servers". You get a **Servers** button in the tab bar that opens it in the right-hand panel,
next to Herdr's Files and Changes. You don't need the `pond` layout. What the agent does:

1. Copy `mods/servers/` into `~/.config/herdr-app/mods/` and run `herdr-app check ~/.config/herdr-app/mods/servers`.
2. The button comes from this repo's tab bar, `pond-tabs`, which draws a button for every panel in
   the right-hand column. If `~/.config/herdr-app/mods/pond-tabs/` is missing, copy `mods/pond-tabs/`
   from https://github.com/SimonBystromTableCheck/herdr-mods/tree/main/pond-tabs and check it too.
3. The shown layout (`herdr-app status` names it) must be a personal one whose `tabs` block shows
   `pond-tabs`. Herdr's own layouts are read-only:
   - On Herdr's `main`: `herdr-app do layout.clone '{"name":"main","as":"my-main"}'` (it switches
     to the copy, which looks and works the same), then in `layouts/my-main.json` set the block
     with `"id": "tabs"` to `"content": { "mod": "pond-tabs" }`. Tell the person a clone doesn't get
     Herdr's later changes to `main`.
   - On a personal layout: set its `tabs` block's `content` to `{ "mod": "pond-tabs" }` if it isn't.
   - On `pond` (this repo): nothing to do.
4. Within a few seconds the tab bar adds `{ "id": "servers", "type": "block", "content": { "mod": "servers" } }`
   to the layout's `panel-body` stack (the right-hand `panel` column Herdr's `main` and its copies
   have) and shows the button. Check with `herdr-app status` and tell the person where it is.
5. Optional: with this repo's `leader` installed, `ctrl-a` then its key opens it too.

Without changing the tab bar, it also opens beside a terminal:
`herdr-app do pane.split --direction right --mod servers` (`q` closes that pane).

**Version:** 1.2.0 (see Changes at the end; also `"version"` in `mod.json`).

**Update:** from 1.1.0, its header has a "Check for updates" pill that turns into "Update to x.y.z" when this repo publishes a newer version; click it, confirm, and a new Claude tab updates just this mod (following `UPDATE.md`). Or tell your Herdr agent "update my herdr mods" (or "update pond mods"). It follows `UPDATE.md`, installed in the mod folder, which checks this repo's `versions.json` and offers every newer version of the mods and layouts you have from here, with a backup of each. By hand: replace `mods/servers/` with this folder's copy (asking an agent to *install* it again adds a second copy instead). Your settings and data live outside the mod folder and are kept (your servers in `servers.json`); edits you made inside the mod folder are not.

## What you see

Panel: theme `background`, text 13px, rounded 10 with a 1px border (`accent` while it has the keyboard, else `border`).

- **Header, 42px**, 1px bottom border: "Servers" (semibold), "2/3 running" (12px, `dim`), and a "+ Add" button (26px, `muted`, `hover` background).
- **List** (scrolls, 8px padding and gap): one card per server, 10px padding, 9px radius, `surface`, 1px border (the selected card: `accent` with the keyboard, else `input`).
  - Line 1: an 8px status dot, the name (semibold), the status word (11px), then 26px icon buttons: Restart and Stop (`ansi1`) while running; Start (play, `ansi2`) and Remove (trash) while not; Logs (terminal icon) whenever it has a terminal. Statuses: `running` (`ansi2`), `exited (1)` (`ansi1`, the terminal ended on its own), `stopped` (`dim`), `starting` / `stopping` (`working`, a spinning 10px ring instead of the dot).
  - Line 2 (12px, indented 16px): a `git-branch` icon in `accent` and the branch (`detached @ abc1234`, or "not a git repo" in `dim`); while running, the detected URL at the right in `accent` (`localhost:5173`, with an external-link icon).
  - Line 3: `~/code/app $ pnpm run dev` in the mono font, 11.5px, `dim`, truncated.
  - An error line in `ansi1` if starting failed.
- Empty: "No servers yet" and a primary "Add a server" button.
- **Add, step 1/2 "Pick a folder"** (replaces the list): header with the projects root (e.g. `~/code`) and a **Change…** button on its right that opens the system folder picker (`pickFolder`) and saves the choice; a folder tree of 28px rows indented 16px per level with chevrons and a folder icon (`accent` when the folder is a git repo or has a package.json, else `muted`), `git` / `pkg` tags on the right, selected row `selected`. Under it "Selected: ~/code/app" (the root, tilde-shortened); footer with Cancel and Next (30px buttons, primary `solid`/`solid_foreground`; Next dimmed to 0.45 until a folder is picked).
- **Add, step 2/2 "Command"**: a Name input (defaults to the folder name), "Start command" with detected options (radio dot, command in mono 12px, source hint below in 11px `dim`; picked one: `accent` border on `selected`), a free-text command input, and Back / Add server.
- **Footer, 28px**: keycap chips (start/stop, restart, logs, move, open url, add, remove) and a `?` keycap that opens the all-keys card.

## How it behaves

- Every 4s it re-reads `servers.json`, each server's branch and, for running servers without a URL yet, the last 400 lines of output for the first `http://localhost|127.0.0.1|0.0.0.0|[::1]` URL (`0.0.0.0` is shown as `localhost`).
- Start: removes old finished terminals for that server, then starts a background terminal through your login shell. Stop: kills and removes it, so nothing is left. Restart: stop then start. A server that crashes keeps its finished terminal, so it shows `exited (code)` and Logs still opens its output.
- Logs opens the terminal with `terminal.peek`. Clicking the URL (or `o`) opens it in the browser.
- Keys: `j/k` move, `< >` first/last, `s`/`enter`/`space` start or stop, `R` restart (running only), `l` logs, `o` open URL, `a` add, `d` remove (only when not running), `r` refresh, `q` hide the panel and give the keyboard back to the focused pane, `?` the keys card (`escape`, `?` or `q` closes it). In the add flow, `enter` goes next / adds, `escape` goes back / cancels. Click a card to select it.
- Detected commands: package.json scripts, ordered `dev`, `start`, `serve`, `preview` (and their `name:*` variants) first, run with the package manager from the nearest lockfile up to `$HOME` (`pnpm run`, `yarn`, `bun run`, else `npm run`); each `Procfile.dev` / `Procfile` entry; `bin/dev`; `bin/rails server`; `docker compose up`; `python manage.py runserver`; `cargo run`; `go run .`. Typing a custom command overrides the pick.

## Built from

- `update.js`: the self-update pill (the same file in every mod from this repo; `tools/stamp.py` refuses copies that differ). It reads `mod.json` `version` and `source`, fetches the repo's `versions.json` (shared between mods as `herdr-mods.versions`, on start and whenever the panel comes back on screen) and on confirm runs `tab.new` with `claude` in the Herdr home. No `source`: no pill.
- `main.js` (all logic and rendering), `keybar.js` (footer keycaps and keys card, same file as the git and skills mods), icons `play.svg stop.svg restart.svg trash.svg external.svg`.
- `mod.json`: `{ "place": "none", "title": "Servers", "focusable": true, "panel": { "title": "Servers", "icon": "server.svg", "leader": "r" } }`. No `props`. `panel` is what `pond-tabs` (button label and icon; it adds a green count of running servers) and the `leader` (key) read. `server.svg` is a copy of Herdr's `workspace-chrome` icon.
- `panel.js`: where the panel is and showing or closing it there (the same file in every panel mod from this repo; `tools/stamp.py` refuses copies that differ). `q` closes it wherever it is: a popup closes, a focused pane closes, and a layout block hides the node holding its stack (the `panel` column in Herdr's `main` and its copies). No layout ids are assumed.
- herdr: `exec hc home appHome readTextFile writeTextFile terminals theme settings run nextCommand focused setShared`. Commands: `terminal.peek`, `layout.hide`, `pane.focus`, `pane.go`.
- `nextCommand()`: `focus`, `go:<direction>` (left: `pane.focus` back to the focused pane, since `pane.go` doesn't reliably move the keyboard out of a panel; other directions `pane.go`; `cmd-alt-arrows` are caught in the key handler and do the same; leaving cancels a pending 150ms focus retry, which also skips once focus has landed), `key:<k>` (e.g. `"servers.key:s"` in keys.json). Shared: `servers.hasKeys` (keyboard ownership, polled every 300ms).
- Config: `~/.config/herdr-app/servers.json`, `{ "servers": [{ "id", "name", "cwd", "command", "added" }] }`; `id` is the name slug (max 20) plus 4 random characters. Saved with `writeTextFile(path, text, expected)`, retrying against the current file on conflict.
- Programs: `hc run --bg --json --no-parent --no-notify --outlive-parent --name srv-<id> --cwd <cwd> --label herdr.server=<id> -- $SHELL -lic '<command>'`, `hc kill`, `hc rm`, `hc read --lines 400`; `git branch --show-current` / `git rev-parse --short HEAD`; `sh` scripts to list folders and detect project files; `open` for URLs.
- A server's terminal is found in `terminals()` by its `herdr.server` label (or name `srv-<id>`), a live one first, else the newest.
- Art: Lucide-style 24px stroke icons; Herdr's shipped `mods/workspace-chrome/spinner.svg`, `terminal.svg`, `git-branch.svg`, `plus.svg` and `mods/files/chevron-down.svg`, `chevron-right.svg`, `folder.svg`.

## Watch out

- `place: "none"`: `pond-tabs` adds it to the right-hand panel (see Install); or open it as a pane: `herdr-app do pane.split '{"direction":"right","mod":"servers"}'`. `mod.open` does not apply (no overlay in `mod.json`).
- The projects root is `servers.json` `"root"` (a path, `~` allowed), set by Change…; without it, `~/code` if that folder exists, else home. Saving keeps `root` next to `servers`. Existing servers keep their absolute `cwd`, so changing the root never moves them. The tree only browses with the mouse.
- Writes `~/.config/herdr-app/servers.json` (outside its folder, not in this repo). Local machine only: no `on`, so remote spaces' servers aren't supported.
- Server terminals carry no `herdr.space`/`herdr.tab` labels on purpose, so they never appear as tabs; don't add those labels.
- Start through `$SHELL -lic`, or version managers (nvm, fnm, mise) aren't on PATH. `open` is macOS-only.
- Remove (trash or `d`) has no confirmation. The icon buttons have no tooltips.
- Branch reads run `git` for every server every 4s; keep the list short.
- No dependency on `gitview` or other mods in this repo; the `leader` mod reads `servers.hasKeys` but isn't needed.

## Done when

- `herdr-app check ~/.config/herdr-app/mods/servers` passes.
- Add → pick a folder with a package.json → `pnpm run dev` (or the lockfile's manager) is listed first → Add server writes it to `servers.json`.
- `s` starts it: spinner, then a green dot, `running`, the branch, and within ~4s its `localhost:<port>` URL.
- `hc ls` shows a `srv-<id>` terminal labeled `herdr.server=<id>`; quitting and reopening Herdr shows it still running.
- `l` peeks at its output; `R` restarts it; `s` stops it and `hc ls` no longer lists it.
- A command that exits on its own shows `exited (<code>)` in red, and Logs still opens.
- `d` on a stopped server removes it from the panel and from `servers.json`.

## Changes

### 1.2.0 (2026-11-13)

- Works without the `pond` layout: installing it adds a button to the tab bar that opens it in the right-hand panel, next to Herdr's Files and Changes (needs `pond-tabs` as the layout's tab bar; see Install).
- `q` closes it wherever it is (the right-hand column, a pane or a popup) through the shared `panel.js`, instead of assuming `pond`'s ids.
- `mod.json` declares `"panel"` (leader `r`); its tab-bar icon is now in the mod folder.

### 1.1.2 (2026-11-12)

- The update pill only shows when a newer version is published, and reads "Update available" (the version is in its tooltip); no more "Check for updates" pill while up to date. Each panel checks GitHub when it starts and every time it comes back on screen (shared `update.js`).

### 1.1.1 (2026-11-12)

- `update.js` (shared) can also offer the layout's update; no change in this mod's behaviour.

### 1.1.0 (2026-11-12)

- Self-update pill: its header has a "Check for updates" pill that turns into "Update to x.y.z" when this repo publishes a newer version; confirming starts a Claude tab that updates just this mod.

### 1.0.1 (2026-11-12)

- A poll stuck on a call that never answers is given up after 15s, so branches keep updating; git calls time out after 5s.

### 1.0.0 (2026-11-11)

- First versioned release.
- Configurable projects root (Change… in the add flow, saved in `servers.json`) (2026-11-09).
