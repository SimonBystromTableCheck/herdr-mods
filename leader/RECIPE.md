# Leader

A tmux-style prefix key for Herdr. Press `ctrl-a` and a small popup drops in
near the top of the window listing every binding in four columns (Tabs, Panes,
Panels, Spaces); the next key runs one (new tab, split, move between panes,
show a side panel, find a space) and the popup closes. `ctrl-a` twice sends a
real `ctrl-a` to the terminal.


**Install:** point your Herdr agent at this folder: copy `mods/leader/` into
`~/.config/herdr-app/mods/`, then `herdr-app check ~/.config/herdr-app/mods/leader`.
Then merge `keys.json` from this folder into `~/.config/herdr-app/keys.json`
(add `"ctrl-a": "mod.open:leader"` to the `global` section; ask before
replacing an existing `ctrl-a`). This takes `ctrl-a` from terminal programs:
readline/shell beginning-of-line and a tmux prefix; leader `ctrl-a` gives it
back once. The mod is `"place": "none"`: it only ever opens as this popup.

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
- Panels: `g` Git, `a` AI skills, `T` Todos, `e` expand / collapse, `f` Files,
  `d` Changes (diff), `r` Servers, `P` Remote Checker (PR), `b` toggle sidebar.
- Spaces: `s` [`o`] find space / tab, `$` rename space, `)` next, `(` previous,
  `?` all shortcuts.

## How it behaves

- Any bound key runs and closes the popup; `escape` or `q` closes it; an
  unbound key stays open with the red "Nothing on" hint. Modifier presses alone
  are ignored.
- `ctrl-a` again: closes and sends `ctrl+a` to the focused terminal.
- Panel keys select that child of the `panel-body` stack and show the `panel`
  column, then enter it the way the app's own navigation does (`enterPanel`): wait 60ms for the
  panel to lay out, `pane.focus` the focused pane, `pane.go right` (tab's pane count + 1) times,
  which always ends in the rightmost panel, then close the popup (`files` is the `pond-files`
  mod, `changes` is `gitview`). If the panel is already showing but
  the keyboard is elsewhere (a terminal), the key just focuses it; only when that
  panel already had the keyboard does the key hide it, giving the focused pane
  the keyboard back.
- `h`/`j`/`k`/`l` from a panel that had the keyboard (git, skills, todos,
  gitview, pond-files, servers, remote-checker) ask that panel to move (`<panel>.go:<dir>`), so
  the move starts from the panel, not the last terminal. From gitview the leader moves itself,
  before closing the popup: `h` is `pane.focus` on the focused pane, `j`/`k`/`l` are `pane.go`.
- `e` (expand), in order: inside gitview's own tab, or from gitview's list while
  Changes shows → opens `gitview-tab`; from the git mod's tab → `git.collapse`;
  from the git panel → `git.expand`; from another panel → an info toast
  "<Panel> has no expanded view" (2.5s); from a terminal → zen mode: hides
  `sidebar` and `panel`, remembering which were open; `e` again restores them.
- Commands that need a name (`tab.rename`, `space.rename`) let Herdr ask.

## Built from

- `mod.json`: `{ "place": "none", "title": "Leader", "overlay": { "kind": "popup", "at": "top", "offset": 40, "width": 620, "height": 330 } }`.
- `bindings.js`: the table, `{ group, key, label, run, args?, hidden? }` or
  `{ panel, mod?, focus?, toggle? }` (`mod` when the mod in that `panel-body`
  child is named differently) or `{ action: "expand" }`. Edit it to rebind.
- `main.js`: the popup; grabs keyboard with a focus handle (again after 30ms
  and 250ms, since the popup takes focus a moment after opening), reads keys
  from `on_key_down` and from `nextCommand()` `key:<k>` (so `leader.key:x` works
  from keys.json).
- `herdr`: `props`, `closeOverlay`, `theme`, `settings` (`font_family`), `run`,
  `focused`, `hc(["keys", <terminal>, "ctrl+a"])`, `layout`, `shared`,
  `setShared("leader.zen")`, `spaces`, `notify`, `nextCommand`.
- Commands: `tab.new/next/prev/rename/close/select`, `pane.split/go/zoom/close/focus`,
  `layout.select/show/hide/toggle`, `mod.open {name: "picker"}`,
  `mod.open {name: "gitview-tab"}`, `space.rename/next/prev`, `app.help`,
  `git.expand`, `git.collapse`, `<panel>.go:<dir>`, `pane.go`, `pane.focus`.
- Reads shared flags written by other mods: `<mod>.hasKeys` for git, skills,
  todos, gitview, pond-files, servers, remote-checker; `git.tabHasKeys`; `gitview.own`.

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
- Panel keys assume a layout with a `panel` column holding a `panel-body` stack
  whose children are `git`, `skills`, `todos`, `files`, `changes`, `servers`, `remote`
  (as in this repo's `pond` layout). Shipped `main` has only `files` and
  `changes`; other panel keys then do nothing useful. `b` needs a `sidebar` node.
- References mods not shipped with Herdr: `git`, `skills`, `todos`, `servers`, `remote-checker`,
  `pond-files` (this repo), `picker` (shipped with Terminals), and `gitview` /
  `gitview-tab` (third-party, github.com/ChmaraX/herdr-gitview, not in this
  repo). Without them the popup still works: missing flags read as "not
  focused", tabs/panes/spaces keys are unaffected, and `e` falls through to zen
  mode or the toast. `gitview.hasKeys` comes only from a local patch to gitview;
  stock gitview never sets it, so the Changes panel counts as a terminal for `e`.
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
