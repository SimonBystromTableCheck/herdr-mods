# Todos

A keyboard-first todo panel for the right side of the window. Todos live as
plain Markdown pages (`# Title` plus `- [ ] item` lines) in
`~/.config/herdr-app/todos/`. The panel lists the pages, newest first, each with
its next open todo and a progress bar; open one to check, add, nest, fold,
reorder and delete todos with vim-style keys. Every change is written to disk at
once, notes that aren't todos are kept, and edits made elsewhere (nvim, a synced
folder) show up live.


**Install:** tell your Herdr agent "Install the Herdr mod at
https://github.com/SimonBystromTableCheck/herdr-mods/tree/main/todos". You get a **Todos**
button in the tab bar that opens it in the right-hand panel, next to Herdr's Files and Changes.
You don't need the `pond` layout. What the agent does:

1. Copy `mods/todos/` into `~/.config/herdr-app/mods/` and run
   `herdr-app check ~/.config/herdr-app/mods/todos`.
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
4. Within a few seconds the tab bar adds `{ "id": "todos", "type": "block", "content": { "mod": "todos" } }`
   to the layout's `panel-body` stack (the right-hand `panel` column Herdr's `main` and its copies
   have) and shows the button. Check with `herdr-app status` and tell the person where it is.

Without changing the tab bar, it also opens beside a terminal:
`herdr-app do pane.split --direction right --mod todos` (`q` closes that pane).

**Version:** 1.2.0 (see Changes at the end; also `"version"` in `mod.json`).

**Update:** from 1.1.0, an "Update available" pill appears in its header when this repo publishes a newer version; click it, confirm, and a new Claude tab updates just this mod (following `UPDATE.md`). Or tell your Herdr agent "update my herdr mods" (or "update pond mods"). It follows `UPDATE.md`, installed in the mod folder, which checks this repo's `versions.json` and offers every newer version of the mods and layouts you have from here, with a backup of each. By hand: replace `mods/todos/` with this folder's copy (asking an agent to *install* it again adds a second copy instead). Your settings and data live outside the mod folder and are kept (your pages in `~/.config/herdr-app/todos/`); edits you made inside the mod folder are not.

## What you see

One rounded card (radius 10, `background`, 1px `border`; the border turns
`accent` while the panel has the keyboard), 12.5px UI text, top to bottom:

- **Header, 42px**, bottom border. On the pages list: "Todos" (13px semibold)
  and a "+ New page" button. Inside a page: a back chevron, the page title,
  and a progress bar 60px wide, 4px tall (`raised` track, `accent` fill, `ansi2`
  green when all done) with `done/total` in 11px `dim`.
- **Body.**
  - Pages list: rows 46px tall, radius 8: title (semibold) over the first open
    todo's text in 11px `dim` ("All done" / "Empty"), and a 48px progress bar.
    With no pages: "No pages yet" and a New page button.
  - A page: todo rows (min 30px, text wraps), 20px indent per nesting level. Each
    row: a fold chevron (only when the page has any nesting; active on rows with
    sub-todos), a 15px checkbox (radius 4, `input` border; checked = filled
    `ansi2` with a check in `background`), the text (struck through and `dim`
    when done), `done/all` of its sub-todos (green when all done), and on the
    selected row an `x` that deletes (hover `ansi1`). Selected row: `selected`
    when the panel has the keyboard, else `hover`. Below: an "Add a todo" row
    (plus icon). Long pages show "N above · M below" in 10.5px `dim`. If the file
    has non-todo lines: "N note lines kept in the file · E to open in nvim".
- **Footer keybar, 28px**, top border: keycaps (16px tall, `raised`, radius 4,
  JetBrains Mono) with labels for the keys that apply now, as many as fit, and a
  `?` keycap at the right that opens the all-keys card. A message ("Deleted · u
  to undo") replaces the chips for 4 seconds, in `accent`.
- **Overlays inside the card** (scrim `#00000055`): a 320px prompt (New page,
  Rename), a 320px confirm menu (y / n), and the "Todos: all keys" card (max
  360px, grouped: In a page, Pages, Everywhere).

## How it behaves

- Click a page to select, click again or double-click to open. Click a row to
  select it, its checkbox to toggle, its chevron to fold.
- Keys (when the panel has the keyboard). Everywhere: `j`/`k` (arrows) move,
  `<`/`>` first/last, `?` all keys, `q` closes the panel where it is (the
  right-hand column, a pane or a popup) and gives the keyboard back to the focused pane.
- Pages: `enter`/`l`/right open, `n` new (asks a title, makes `<slug>.md`,
  `-2`, `-3` if taken, then starts adding), `R` rename (rewrites the `# ` line),
  `D` delete (confirm, moves the file to `~/.Trash/<name>-<ms>.md`), `E` open in
  nvim.
- In a page: `space`/`x` toggle, `a` add at end, `o` add below the selected
  todo's subtree, `A` add as its last sub-todo, `enter`/`e`/`i` edit inline,
  `tab`/`shift-tab` nest/un-nest (with its subtree), `z` fold (on a sub-todo:
  folds its parent), `J`/`K` swap with the sibling below/above (with subtrees),
  `d` delete (with subtree), `u` undo the last delete, `C` clear done (confirm),
  `R` rename page, `E` nvim, `h`/left/backspace/escape back to pages.
- Adding keeps the input open: each enter saves and the next goes right after;
  escape or an empty enter stops. Esc also closes prompts and menus.
- Checking a todo checks its whole subtree; a parent becomes done exactly when
  all its sub-todos are; adding an open sub-todo unchecks its parents.
- The list scrolls by keeping the selection in view (no scroll wheel).
- Remembers the open page and folds (per copy, `localStorage`).

## Built from

- `update.js`: the self-update pill (the same file in every mod from this repo; `tools/stamp.py` refuses copies that differ). It reads `mod.json` `version` and `source`, fetches the repo's `versions.json` (shared between mods as `herdr-mods.versions`, on start and whenever the panel comes back on screen) and on confirm runs `tab.new` with `claude` in the Herdr home. No `source`: no pill.
- `mod.json`: `{ "place": "none", "title": "Todos", "focusable": true, "panel": { "title": "Todos", "icon": "todos.svg" } }`. `panel` is what tab bars like `pond-tabs` read: the button's label and icon (in the mod folder), and that the mod belongs in the right-hand panel.
- `panel.js`: where the panel is and closing it there (the same file in every panel mod from this repo; `tools/stamp.py` refuses copies that differ).
- `main.js` (the View), `keybar.js` (keycap footer and all-keys card),
  lucide-style SVGs tinted with `svg()`: `back`, `check`, `chevron-down`,
  `chevron-right`, `plus`, `x`, `todos` (the panel icon other mods use).
- File format: `- [ ]` / `- [x]` (also `*`, `X`), two spaces per nesting
  level. Title from the first `# ` line, else the file name.
- `herdr`: `appHome`, `home`, `exec` (`mkdir -p`, a `sh -c` loop with
  `stat -f %m` to list pages by mtime, `mv` to Trash), `readTextFile`,
  `writeTextFile(path, text, expected)` (writes are queued; a mismatch reloads
  and flashes "The file changed on disk, so it was reloaded"), `watchFolder`,
  `nextCommand`, `setShared`, `focused`, `theme`, `run`.
- Commands: `layout.hide` (the column holding its stack), `pane.close`, `pane.focus`, `pane.go`,
  `terminal.open {argv: ["/bin/zsh","-lic","nvim '<file>'"], folder, place: "tab", name}`.
- `nextCommand()` accepts `focus` (from `pane.go`), `go:<dir>` (left: `pane.focus` back to the
  focused pane; others `pane.go`; `cmd-alt-arrows` caught in the key handler do the same) and
  `key:<k>`, so keys.json can send `todos.key:j` and the `leader` mod can send
  `todos.focus` / `todos.go:left`. Every 300ms it publishes
  `shared("todos.hasKeys")` for the leader.

## Watch out

- macOS assumptions: `stat -f %m` (GNU stat on Linux reads `-f` differently and
  the list comes up empty), `~/.Trash`, and `/bin/zsh` with `nvim` on the login
  PATH for `E`.
- Reads and writes only `~/.config/herdr-app/todos/`; moves deleted pages to
  `~/.Trash`. No network.
- `q` follows where the panel is (`panel.js`): a popup closes, a focused pane closes, and a layout
  block hides the node holding its stack (the `panel` column in Herdr's `main` and its copies; the
  block itself outside a stack). No layout ids are assumed.
- The tab bar button needs `pond-tabs` as the layout's tab bar and a `panel-body` stack; a block
  the person removes from the stack isn't added back.
- Focus has no blur event: it is polled every 300ms, so the accent border can
  lag a moment.
- Folds are keyed by page path, depth and text, so editing a folded todo's text
  elsewhere unfolds it.
- Row heights for wrapped text are estimated (about 7px a character), so very
  long todos can leave the window slightly off.
- Undo only remembers the last delete, on the same page.
- Mods can't import each other: `keybar.js` is a private copy.

## Done when

- `herdr-app check ~/.config/herdr-app/mods/todos` passes.
- Shown in a block, `n` → "Groceries" creates `~/.config/herdr-app/todos/groceries.md`
  with `# Groceries` and opens it with the add input focused.
- Adding `a`, then `A` under it, then checking the child with `space` checks the
  parent too; the file shows `- [x]` on both, the child indented two spaces.
- Editing the file in another editor updates the panel without a reload.
- `d` deletes with a 4-second "Deleted · u to undo" flash, and `u` restores it.
- `q` hides the panel and the terminal gets the keyboard back; opened as a pane, `q` closes the pane.
- On a fresh copy of Herdr's `main` with `pond-tabs` as its tab bar, installing the mod adds a Todos button next to Files and Changes that opens it in the right-hand column.

## Changes

### 1.2.0 (2026-11-13)

- Works without the `pond` layout: installing it adds a button to the tab bar that opens it in the right-hand panel, next to Herdr's Files and Changes (needs `pond-tabs` as the layout's tab bar; see Install).
- `q` closes it wherever it is (the right-hand column, a pane or a popup) through the shared `panel.js`, instead of assuming `pond`'s ids.
- `mod.json` declares `"panel": { "title", "icon", "leader": "T" }` for tab bars and the `leader`.

### 1.1.2 (2026-11-12)

- The update pill only shows when a newer version is published, and reads "Update available" (the version is in its tooltip); no more "Check for updates" pill while up to date. Each panel checks GitHub when it starts and every time it comes back on screen (shared `update.js`).

### 1.1.1 (2026-11-12)

- `update.js` (shared) can also offer the layout's update; no change in this mod's behaviour.

### 1.1.0 (2026-11-12)

- Self-update pill: its header has a "Check for updates" pill that turns into "Update to x.y.z" when this repo publishes a newer version; confirming starts a Claude tab that updates just this mod.

### 1.0.0 (2026-11-11)

- First versioned release.
- Leaving to the left gives the keyboard back to the terminal; `cmd-alt-arrows` caught (2026-11-09).
