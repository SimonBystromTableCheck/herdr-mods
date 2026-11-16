# Workbench

An IDE-style **Find** panel for people who want Herdr without moving to vim: search across the
repo's files, mass find & replace with a preview, go to file, format with the repo's own tools,
and delete duplicate lines. It works on files on disk (what agents edit), with an editable file
view beside the results. Every write is guarded: a file is only written if it still matches what
was read, so an agent editing at the same time is never overwritten.

**Install:** tell your Herdr agent "Install the Herdr mod at
https://github.com/SimonBystromTableCheck/herdr-mods/tree/main/workbench". You get a **Find**
button in the tab bar that opens it in the right-hand panel, next to Herdr's Files and Changes.
You don't need the `pond` layout. What the agent does:

1. Copy `mods/workbench/` into `~/.config/herdr-app/mods/` and run
   `herdr-app check ~/.config/herdr-app/mods/workbench`. Before adding it, tell the person: it runs
   programs (`rg`, `git`, `sh`, the repo's formatters and, for JS commit-hook configs, `node`) and
   reads and writes files in the repo it shows.
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
4. Within a few seconds the tab bar adds `{ "id": "workbench", "type": "block", "content": { "mod": "workbench" } }`
   to the layout's `panel-body` stack and shows the **Find** button. Check with `herdr-app status`.
5. `rg` (ripgrep) must be installed (`brew install ripgrep`, `apt install ripgrep`): search and
   Go to file use it. Tell the person if it's missing.

Without changing the tab bar, it also opens beside a terminal:
`herdr-app do pane.split --direction right --mod workbench`, or as a tab:
`herdr-app do tab.new --mod workbench --props '{"query":"TODO"}'`.

**Version:** 1.0.0 (see Changes at the end; also `"version"` in `mod.json`).

**Update:** an "Update available" pill appears in its header when this repo publishes a newer version; click it, confirm, and a new Claude tab updates just this mod (following `UPDATE.md`). Or tell your Herdr agent "update my herdr mods". By hand: replace `mods/workbench/` with this folder's copy (asking an agent to *install* it again adds a second copy instead). It keeps no settings or data of its own.

## What you see

- **Header (40px):** four tools as tabs: Search & Replace, Go to file, Format, Duplicates (Search,
  Files, Format, Dupes under 560px wide); the repo's name as a chip (click: pick up the focused
  pane's repo again), and ⤢ (expand to a tab) / ⤡ (back to the panel).
- **Tools column** (left, 360–560px when the panel is 700px or wider; otherwise on top) and the
  **file view** (right, or below once a file is open): the file with syntax colours and line
  numbers, editable, with Save and Revert while it has changes.
- **Footer (28px):** keycaps for what has the keyboard now, and `?` for every key. The panel's
  border turns accent while it holds the keyboard; the keyboard's row in a list has the selected
  background and a 2px accent bar.
- **Search & Replace:** a search box with `Aa` (match case), `ab` (whole word) and `.*` (regex)
  toggles; ▸ opens a replace box with a **Replace N** button; a file filter (`*.ts, src/**, !dist`).
  Results are grouped by file (name, folder, match count), each line with its number and the match
  highlighted. With replace open, each match shows the old text struck through on red and the new
  text on green, with a checkbox per line and per file.
- **Go to file:** a fuzzy filter over the repo's files (.gitignore respected), up to 100 matches.
- **Format:** "How this repo formats": one button per source found (Commit hook, VS Code, Repo
  tools), where its rules came from, and each rule's file pattern with its steps tagged `fix`,
  `format` or `skip`; then the always-on built-ins, options, what to format, Format / Run
  `<pm> run format` / Undo format buttons and a result card (changed files, each step's output).
- **Duplicates:** which lines are checked (whole file, or the selected lines), three options, a
  Delete button and the lines it would remove, struck through in red.

## How it behaves

- **Repo:** the git root of the focused pane's folder. As a side panel it follows the space you
  switch to (not while the open file has unsaved edits). On another machine it searches and formats;
  replace, save and the built-ins are off there (they write files).
- **Search** runs `rg --json` as you type (250 ms after the last key; Enter searches now), up to
  2,000 matches and 600 drawn lines. Hidden and ignored files are skipped (rg's defaults).
- **Opening a result** opens the file with that line centred and the match itself selected, and
  gives the file view the keyboard (a selection only shows while the editor has focus). The editor
  only scrolls just enough to show a selection, so centring jumps to the top, then half a screen
  below the line, then back: you may see a flicker. The last half-screen of a file can't centre.
- **Replace** works line by line on the lines still checked: each file is read again, every line
  must still read as it did in the search (else the file is skipped as "changed since search"),
  and the file is written only if unchanged since that read. `$1` works in regex mode, and `\n`,
  `\t` in the replacement. **Undo replace** restores every file from the last replace, again only
  where they haven't changed since.
- **Format** reads the repo's setup, strongest first: (1) commit-hook config: lint-staged or
  nano-staged in `package.json`, `.lintstagedrc*`, `lint-staged.config.*`, `.nano-staged.*` (JS
  configs are loaded with `node`, as lint-staged does); (2) `.vscode/settings.json`:
  `editor.defaultFormatter` overall and per language, `editor.codeActionsOnSave` fixes, and
  `editor.formatOnSave`; (3) config files plus installed tools: oxfmt, Biome, Prettier, dprint,
  ESLint, oxlint, stylelint, RuboCop, Ruff, Black, gofmt, rustfmt, mix format. Tools run from
  `node_modules/.bin` first, then through pnpm / yarn / npx, `bundle exec` for RuboCop with a
  Gemfile, `uv run` for Ruff/Black. Fixes run before formatting. Hook commands that aren't
  formatters or linters (scripts) are listed as `skip` and never run.
  - **What:** the open file (saved first), the files changed in git, or every file in the repo.
  - **Lint fixes** off: only formatters run (RuboCop then runs layout-only, `-x`).
  - **Always on:** built-in JSON formatting (indent from `.editorconfig`, else 2 spaces; JSON with
    comments is left alone) and `.editorconfig` whitespace rules (trailing whitespace, final
    newline, LF), for files no repo tool covers.
  - Results: "Changed N of M files" (each changed file opens on click) and each step's output;
    **Undo format** puts back what it changed (up to 300 files, this machine).
  - **Format on save** (on when `.vscode` says so) formats the open file after each save.
- **Duplicates** removes repeated lines from the open file, keeping the first. Scope: the lines you
  selected in the file view (2+ lines; selections the panel makes itself don't count), else the
  whole file. Options: ignore surrounding whitespace (on), keep blank lines (on), only consecutive
  repeats. Delete changes the file view only; Save writes it, Revert reloads it.
- **Expanded view** (leader `e`, ⤢ or `E`): the panel becomes a tab of its own ("Find · repo",
  one per space, reused) and the panel hides; the tool, query, replace text, filter, options and
  open file go along both ways. Collapsing (same keys, ⤡, or `q` in the tab) closes it, brings the
  panel back and returns to the tab you came from. Not while the open file has unsaved edits.
- **Keys** (Esc always steps out: file view → list → terminal):
  - Everywhere: `]` / `[` next / previous tab, `1`–`4` a tab, Tab, `/` the search box (the filter
    in Go to file), `e` into the file view, `E` expand / collapse, `q` close the panel (collapse in
    the tab), `?` all keys, cmd-alt-arrows leave the panel, cmd-S save, cmd-shift-F search, cmd-P
    go to file.
  - Lists (Search, Go to file, Duplicates): `j`/`k`, `g`/`G`, `ctrl-d`/`ctrl-u`, Enter opens into
    the file view, `space` peeks (opens without taking the keyboard).
  - Search: `h`/`l` fold / unfold a file, `z` all, `r` replace box, `x` include or exclude a line
    (or a file) in the replace, `R` replace all (a y / n confirm), `u` undo replace, `c` / `w` / `.`
    case / word / regex, `f` the file filter. In the search box Enter or ↓ goes to the results.
  - Go to file: in the filter, ↑↓ or `ctrl-n`/`ctrl-p` move and Enter opens.
  - Format: `f` format, `s` what, `}` / `{` rules source, `x` lint fixes, `o` on save, `b`
    built-ins, `p` run the format script, `u` undo, `R` re-read the setup.
  - Duplicates: `d` delete, `t` / `b` / `a` the options, `W` whole file.
  - Leader (`ctrl-a`, from this repo's `leader` mod): `/` opens Find with the keyboard (again: hides
    it), `e` expands / collapses.

## Built from

- `mods/workbench/main.js`: the view (tools, lists, file view, keys, expand/collapse);
  `format.js`: detection and running (hook / VS Code / config sources, glob matching, tool
  resolution, the pipeline, built-ins, `.editorconfig`); `keys.js`: the key table for footer, card
  and handler; shared `panel.js`, `keybar.js`, `update.js` (identical in every panel from this repo).
- `mod.json`: `"focusable": true`, `"panel": { "title": "Find", "icon": "workbench.svg", "leader": "/", "expand": "expand" }`.
- `herdr`: `exec` (rg, git, sh, node, formatters), `readTextFile`, `writeTextFile(path, text, expected)`
  for guarded writes, `spaces`, `panes`, `focused`, `layout`, `shared`/`setShared`
  (`workbench.hasKeys`, `workbench.owner`, `workbench.tab`, `workbench.tabOf`,
  `workbench.toTab`, `workbench.toPanel`), `nextCommand` (`focus`, `go:<dir>`, `key:<k>`,
  `expand`, `collapse`), `run` (`pane.focus`, `pane.go`, `tab.new`, `tab.select`, `tab.close`,
  `layout.show/hide/select` through `panel.js`).
- `gpui-base`: `InputState` + `Input` (the boxes), `EditorState` + `Editor` (the file view),
  `ScrollHandle` (keeping the keyboard's row in view).
- Props (pane, tab or expanded tab): `folder`, `machine`, `query`, `replace`, `include`, `opts`,
  `tool` (`search` | `goto` | `format` | `dedupe`), `file`, `line`, `token` (the expanded tab).

## Watch out

- Commands (`workbench.<cmd>`) reach every shown copy: `expand` / `collapse` act only in the copy
  that last had the keyboard (`workbench.owner`), or a panel and a tab both expand.
- After a space switch, `focused()` can still be the old space's terminal for a moment: the panel
  keeps following the focused folder for 1.5 s.
- The editor draws a selection only while focused, and scrolls only for a non-empty selection
  (a bare cursor doesn't scroll): centring uses 1-character selections and focuses 50 ms later.
- Inputs and the editor take their own clicks (`on_mouse_down` stops propagation); a click
  anywhere else gives the panel's list the keyboard.
- `readTextFile` stops at 1 MiB: bigger files can't be opened, replaced in or deduplicated.
- Replace is per line: a regex can't match across lines.
- Format detection looks in the repo root only (a monorepo package's own config isn't read), and
  can't run VS Code's built-in formatters (no command line); it says so.
- On a whole code file, Duplicates also removes repeated `}` or `end` lines: check the list first,
  or select the lines to clean.

## Done when

- `herdr-app check ~/.config/herdr-app/mods/workbench` passes and the **Find** button opens it.
- Typing a word lists matches grouped by file within a second; clicking one opens the file beside
  the list with the line centred and the word selected.
- With replace open, the preview shows old → new; Replace writes only checked lines, and Undo
  replace restores them; a file changed after the search is reported as skipped.
- Format lists the repo's own commit-hook / VS Code / tool rules with their source, and running it
  reports the changed files.
- Duplicates on a file with repeated lines lists them; Delete then Save removes them.
- `j`/`k`, Enter, Esc, `]`/`[`, `1`–`4`, `?`, `q` work as listed; leader `/` focuses it and leader
  `e` expands it to a tab and back.

## Changes

### 1.0.0 (2026-11-16)

- First version: Search & Replace, Go to file, Format (commit hook / VS Code / repo tools, built-in
  JSON and `.editorconfig`), Duplicates, an editable file view, keys, footer, leader `/`, and an
  expanded view.
