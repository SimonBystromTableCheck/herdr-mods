# Leader

A tmux-style prefix key for Herdr. Press `ctrl-a` and a small popup drops in
near the top of the window listing every binding in four columns (Tabs, Panes,
Panels, Spaces); the next key runs one (new tab, split, move between panes,
show a side panel, find a space) and the popup closes. `ctrl-a` twice sends a
real `ctrl-a` to the terminal. Panels aren't a fixed list: every installed panel mod that names a
leader key in its `mod.json` shows up under Panels, so it works with any subset of this repo's
panels, on any layout.


**Install:** point your Herdr agent at this folder: copy `mods/leader/` into
`~/.config/herdr-app/mods/`, then `herdr-app check ~/.config/herdr-app/mods/leader`.
Then merge `keys.json` from this folder into `~/.config/herdr-app/keys.json`
(add `"ctrl-a": "mod.open:leader"` to the `global` section; ask before
replacing an existing `ctrl-a`). This takes `ctrl-a` from terminal programs:
readline/shell beginning-of-line and a tmux prefix; leader `ctrl-a` gives it
back once. The mod is `"place": "none"`: it only ever opens as this popup.

**Version:** 2.0.0 (see Changes at the end; also `"version"` in `mod.json`).

**Update:** tell your Herdr agent "update my herdr mods" (or "update pond mods"). It follows `UPDATE.md`, installed in the mod folder, which checks this repo's `versions.json` and offers every newer version of the mods and layouts you have from here, with a backup of each. By hand: replace `mods/leader/` with this folder's copy (asking an agent to *install* it again adds a second copy instead). Your settings and data live outside the mod folder and are kept; edits you made inside the mod folder are not. If its `keys.json` changed, merge it again.

## What you see

A popup 620×330px, at the top of the window 40px down, `popover` background,
`foreground` text at 12.5px, 14px padding, 10px gaps:

- **Top row:** a `ctrl-a` pill (`accent` background, `accent_foreground` text,
  radius 5, terminal font at 11.5px), then "Press a key" in `dim`, or
  `Nothing on "<key>"` in `ansi1` red after an unbound key, and on the right
  "esc cancel · ctrl-a send ctrl-a" in 11px `dim`.
- **Four columns** of equal width, 18px apart, in order Tabs, Panes, Panels,
  Spaces. Each has an 11px semibold `muted` heading, then rows: the key in a
  30px column (terminal font, `accent`) and its label (truncated). Tabs shows
  `1-9` once for "Go to tab"; hidden aliases aren't listed.

Bindings (aliases in brackets, not shown):

- Tabs: `t` [`c`] new tab, `n` next, `p` previous, `,` rename, `&` close,
  `1`-`9` go to tab N.
- Panes: `%` [`|`] split right, `"` [`-`] split down, `h` `j` `k` `l` go
  left/down/up/right, `z` zoom, `x` close.
- Panels: `e` expand / collapse, `b` toggle sidebar; `f` Files and `d` Changes (diff) when the layout's
  panel stack has a `files` / `changes` child; then each installed panel mod by its own key, in
  folder-name order: with this repo's, `g` Git, `P` PR (remote-checker), `C` Claude (pond-profiles),
  `r` Servers, `a` Skills, `T` Todos.
- Spaces: `s` [`o`] find space / tab, `$` rename space, `)` next, `(` previous,
  `?` all shortcuts.

## How it behaves

- Any bound key runs and closes the popup; `escape` or `q` closes it; an
  unbound key stays open with the red "Nothing on" hint. Modifier presses alone
  are ignored.
- `ctrl-a` again: closes and sends `ctrl+a` to the focused terminal.
- Panel keys find the mod's block in the shown layout (by mod, not id) and show it (`panel.js`
  `revealPanel`: select it in every stack on the way, show hidden nodes), then enter it the way the
  app's own navigation does (`enterPanel`): wait 60ms for the panel to lay out, `pane.focus` the
  focused pane, `pane.go right` (tab's pane count + 1) times, which always ends in the rightmost
  panel, then close the popup. If the panel is already showing but the keyboard is elsewhere (a
  terminal), the key just focuses it; only when that panel already had the keyboard does the key
  hide it (`hidePanel`: the column holding its stack), giving the focused pane the keyboard back.
- A panel mod no layout block shows opens as a pane on the right of the tab (`pane.split`), or is
  focused if the tab already has it as a pane.
- Panels are found by reading every `mods/*/mod.json` for `"panel": { "title", "leader" }`
  (`fs/promises` `readdir`), cached in shared `leader.panels` and refreshed when the popup opens
  more than 20s after the last read. A key already bound keeps its first owner.
- `h`/`j`/`k`/`l` from a panel that had the keyboard (git, skills, todos,
  gitview, pond-files, servers, remote-checker) ask that panel to move (`<panel>.go:<dir>`), so
  the move starts from the panel, not the last terminal. From gitview the leader moves itself,
  before closing the popup: `h` is `pane.focus` on the focused pane, `j`/`k`/`l` are `pane.go`.
- `e` (expand), in order: inside gitview's own tab, or from gitview's list while
  Changes shows → closes the popup and opens gitview's tab through `changes-expand` (this repo); from the git mod's tab → `git.collapse`;
  from the git panel → `git.expand`; from another panel → an info toast
  "<Panel> has no expanded view" (2.5s); from a terminal → zen mode: hides
  `sidebar` and `panel`, remembering which were open; `e` again restores them.
- Commands that need a name (`tab.rename`, `space.rename`) let Herdr ask.

## Built from

- `mod.json`: `{ "place": "none", "title": "Leader", "overlay": { "kind": "popup", "at": "top", "offset": 40, "width": 620, "height": 330 } }`.
- `bindings.js`: the table, `{ group, key, label, run, args?, hidden? }` or `{ action: "expand" }`,
  and `BUILTIN_PANELS`: Herdr's own panels by their child id in the panel stack (`f` → `files`,
  `d` → `changes`, whatever mod shows there). Edit it to rebind; panel mods' keys are in their
  `mod.json` `panel.leader`.
- `panel.js`: the same file the panel mods carry (finding, showing and hiding a mod's layout block).
- `main.js`: the popup; grabs keyboard with a focus handle (again after 30ms
  and 250ms, since the popup takes focus a moment after opening), reads keys
  from `on_key_down` and from `nextCommand()` `key:<k>` (so `leader.key:x` works
  from keys.json).
- `herdr`: `props`, `closeOverlay`, `theme`, `settings` (`font_family`), `run`,
  `focused`, `hc(["keys", <terminal>, "ctrl+a"])`, `layout`, `shared`,
  `setShared("leader.zen")`, `spaces`, `panes`, `notify`, `nextCommand`,
  `exec("herdr-app", ["do", "mod.open", '{"name":"changes-expand"}'])`.
- Commands: `tab.new/next/prev/rename/close/select`, `pane.split/go/zoom/close/focus`,
  `layout.select/show/hide/toggle`, `mod.open {name: "picker"}`,
  `space.rename/next/prev`, `app.help`,
  `<panel>.<expand>` (a panel's `mod.json` `panel.expand`, e.g. `git.expand`), `git.collapse`,
  `<panel>.go:<dir>`, `pane.go`, `pane.focus`.
- Reads shared flags written by other mods: `<mod>.hasKeys` for every mod the layout shows, every
  panel mod and every mod pane (whichever has the keyboard); `git.tabHasKeys`; `gitview.own`.

## Watch out

- Enter panels through `pane.go`, never by sending the mod `focus` yourself: only then does
  the app know the panel holds the keyboard. Sent directly, `pane.go` out of it starts from the
  terminal, and the popup closing hands the keyboard back to the terminal (a flicker).
- Closing this popup re-sends `focus` to the mod the app thinks holds the keyboard. Moving out
  of gitview after closing left gitview's handle with the keys while the app's focus was on the
  terminal (nothing looked focused); move first, then close.
- Panels answer `focus` once more after 150ms if they lost the keyboard to the
  closing popup; a fresh build of a panel should do the same, but only when the
  first focus never landed (checked at 40ms) and the panel wasn't left meanwhile,
  or leaving quickly snaps the keyboard back.
- Entering a panel goes right until it can't, so it assumes the panel is in the rightmost column
  (Herdr's `main`, its copies and `pond` put it there). Zen mode (`e` from a terminal) and `b` use
  Herdr's `sidebar` and `panel` ids and do nothing for a layout without them.
- References mods not shipped with Herdr by name only for `git.collapse` and `changes-expand` (this repo), `picker` (shipped with Terminals), and `gitview` /
  `gitview-tab` (third-party, github.com/ChmaraX/herdr-gitview, not in this
  repo). Without them the popup still works: missing flags read as "not
  focused", tabs/panes/spaces keys are unaffected, and `e` falls through to zen
  mode or the toast. `gitview.hasKeys` comes only from a local patch to gitview
  (see "Patch gitview" in `pond/RECIPE.md`). Stock gitview never sets it, so for `e` the Changes panel counts as a
  terminal, and `h` from Changes loses the keyboard after the popup closes.
- Expanding gitview goes through `herdr-app do mod.open`, not `run("mod.open")`. A launcher window
  (`changes-expand`, `gitview-tab`) opened from this popup's own key handler, before or after the
  popup closes, stays open and never starts. Don't paper over it with a timed close: the CLI
  reaches the app the way a key does.
- `fromPanel` is read in `init`, before the popup steals focus; computing it
  later always gives null.
- `ctrl-a` forwarding uses `hc keys` on the focused terminal; with a mod
  focused nothing is sent.
- Runs no programs except `hc`; no network; no files.

## Done when

- `herdr-app check ~/.config/herdr-app/mods/leader` passes.
- With keys merged, `ctrl-a` in a terminal opens the 620×330 popup near the top
  with four columns; `escape` closes it.
- `ctrl-a` then `%` splits the focused pane right; `ctrl-a` `t` opens a tab.
- `ctrl-a` `y` shows `Nothing on "y"` in red and stays open.
- `ctrl-a` `ctrl-a` in a shell moves the cursor to the line start.
- In `pond`, `ctrl-a` `T` opens Todos with the keyboard; again hides it.
- `ctrl-a` `e` in a terminal hides sidebar and panel; again brings back exactly
  what was open.

## Changes

### 2.0.0 (2026-11-13)

- Panels are found, not listed: every installed mod whose `mod.json` `panel` names a `leader` key shows under Panels, wherever the layout puts it (found by mod, not by `panel`/`panel-body` ids). A panel no layout block shows opens as a pane on the right.
- **Major:** `bindings.js` no longer takes `{ panel, mod, focus, toggle }` entries. If you added panels there, put `"leader": "<key>"` in that mod's `mod.json` `panel` instead. Herdr's Files and Changes are `BUILTIN_PANELS` there.
- `e` from a panel runs that panel's `mod.json` `panel.expand` (Git's `expand`).

### 1.1.0 (2026-11-12)

- `C` opens the Claude profiles panel (pond-profiles), with the keyboard in it.

### 1.0.0 (2026-11-11)

- First versioned release.
- `e` opens gitview's tab through changes-expand, with no timed close (2026-11-10).
- Opens panels with the keyboard in them via `pane.go`, all six; hides only a focused panel (2026-11-09).
