# Todos

A keyboard-first todo panel for the right side of the window. Todos live as
plain Markdown pages (`# Title` plus `- [ ] item` lines) in
`~/.config/herdr-app/todos/`. The panel lists the pages, newest first, each with
its next open todo and a progress bar; open one to check, add, nest, fold,
reorder and delete todos with vim-style keys. Every change is written to disk at
once, notes that aren't todos are kept, and edits made elsewhere (nvim, a synced
folder) show up live.


**Install:** point your Herdr agent at this folder: copy `mods/todos/` into
`~/.config/herdr-app/mods/`, then `herdr-app check ~/.config/herdr-app/mods/todos`.
It is `"place": "none"`, so it shows only where you put it: add a block
`{ "id": "todos", "type": "block", "content": { "mod": "todos" } }` to your
layout (in a cloned layout, as a child of the right `panel-body` stack, or as a
column of its own), or open it beside a terminal with
`herdr-app do pane.split --direction right --mod todos`.

**Version:** 1.0.0 (see Changes at the end; also `"version"` in `mod.json`).

**Update:** ask your Herdr agent to update it from this folder, replacing `mods/todos/` (say *update*: installing again adds a second copy next to the old one). Your settings and data live outside the mod folder and are kept (your pages in `~/.config/herdr-app/todos/`); edits you made inside the mod folder are not.

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
  `<`/`>` first/last, `?` all keys, `q` hides the `panel` layout node and gives
  the keyboard back to the focused pane.
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

- `mod.json`: `{ "place": "none", "title": "Todos", "focusable": true }`.
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
- Commands: `layout.hide {id: "panel"}`, `pane.focus`, `pane.go`,
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
- `q` hides a layout node with id `panel` (the shipped `main` layout's right
  column); in a layout without one it only returns focus.
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
- `q` hides the panel and the terminal gets the keyboard back.

## Changes

### 1.0.0 (2026-11-11)

- First versioned release.
- Leaving to the left gives the keyboard back to the terminal; `cmd-alt-arrows` caught (2026-11-09).
