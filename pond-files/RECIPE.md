# Pond Files

Herdr's Files panel made keyboard-first. It still browses the focused pane's folder as a
lazy tree with git marks and opens a read-only preview, but you can move into it with
`pane.go` and drive it with vim motions: j/k through the tree, l to open, h to go up, J/K to
flip between files in the preview, q to hide the panel. A footer of keycaps shows the keys
that fit, and `?` opens a card with all of them. The border turns accent while it has the keyboard.


**Install:** Point your Herdr agent at this folder: copy `mods/pond-files/` into
`~/.config/herdr-app/mods/`, then `herdr-app check ~/.config/herdr-app/mods/pond-files`.
It is `"place": "none"`: it replaces the shipped `files` mod in a layout block. Clone the
layout (`herdr-app do layout.clone '{"name":"main","as":"my-main"}'`) and set the `files`
block's `content` to `{ "mod": "pond-files" }`.

**Version:** 1.1.2 (see Changes at the end; also `"version"` in `mod.json`).

**Update:** from 1.1.0, its header has a "Check for updates" pill that turns into "Update to x.y.z" when this repo publishes a newer version; click it, confirm, and a new Claude tab updates just this mod (following `UPDATE.md`). Or tell your Herdr agent "update my herdr mods" (or "update pond mods"). It follows `UPDATE.md`, installed in the mod folder, which checks this repo's `versions.json` and offers every newer version of the mods and layouts you have from here, with a backup of each. By hand: replace `mods/pond-files/` with this folder's copy (asking an agent to *install* it again adds a second copy instead). Your settings and data live outside the mod folder and are kept; edits you made inside the mod folder are not.

## What you see

One rounded (10px) card on `background`, 1px border (`border`; `accent` while it holds the
keyboard), text 13px, top to bottom:

- **Header** (42px, 14px side padding, bottom border): "←" back button (only in a preview),
  "Files" semibold, and right-aligned in 12px `dim` the previewed file's path, or the folder name.
- **Tree** (6px padding, virtual list, vertical scrollbar): 28px rows, rounded 7, indented
  18px per level from 8px; a 12px chevron (`dim`) for folders, a 14px folder/file icon
  (`muted`), the name, and a git mark at the right (11px): `A` new or untracked in `ansi2`,
  `D` deleted / `U` conflicted in `ansi1`, `M` modified in the `blocked` color. Folders first,
  then by name; `.git` hidden. The selected row is `selected` with the keyboard, `raised` without.
  Empty states: "Loading files…", "No files", "No folder", or the error. Past the limits:
  "File list limited to 500 entries per folder and 5,000 total".
- **Preview** (replaces the tree): the file as plain monospace lines (the terminal font,
  12px, 18px rows), line numbers right-aligned in `dim`, the current line highlighted
  (`selected` with the keyboard, else `raised`), with a scrollbar. No syntax colors.
  Word wrap is on by default: a long line continues on extra 18px rows (line number only
  on its first row, the whole line highlighted), breaking at the last space in the row's
  second half, else mid-word.
- **Keybar** (28px footer, top border, 11px): keycaps (16px, rounded 4, `raised` on `border`,
  JetBrains Mono) with labels in `dim`, as many as fit: tree "j k move · l open · h up ·
  g G ends · q hide"; preview "j k line · w wrap on|off · J K file · h back · q hide" (the
  wrap chip is also a button: hover `hover`, click toggles); a `?` keycap at the right.
- **Keys card** (on `?`): a 55%-black scrim over the panel with a centered card (max 360px,
  `popover`, rounded 10) titled "Files: all keys", groups Tree / Preview / Everywhere.

## How it behaves

- Follows the focused pane's live folder (or the focused terminal block's, or the space's),
  on this or a remote machine. Each folder remembers its open folders and previewed file.
- Refreshes every 10s, and at once on file changes for local folders (`watchFolder`).
- Mouse: click a folder to fold/unfold, a file to preview; "←" goes back. Clicking the panel
  gives it the keyboard.
- Keyboard: `pane.go` into it (`"focusable": true`), or click it. Tree: `j`/`k`/↓/↑ move,
  `g`/`G`/Home/End first/last, `ctrl-d`/`ctrl-u`/PgDn/PgUp half a page, `l`/→/Enter open a
  folder (again: step into it) or preview a file, `h`/← close the folder or jump to its parent,
  `space`/`o` fold, `esc` keyboard back to the focused pane. Preview: `j`/`k`, `g`/`G`,
  `ctrl-d`/`ctrl-u` move the line, `w` word wrap on/off (remembered in the copy's
  `localStorage` "wrap"), `J`/`K` next/previous file in the tree, `h`/←/`esc`/⌫ back
  to the tree with that file selected. Anywhere: `r` refresh, `q` hide the panel
  (`layout.hide {id: "panel"}`) and refocus the pane, `?` the keys card (`esc`, `?`, `q` or a
  click closes it). Keys with cmd/alt pass through.
- Commands from `keys.json`: `pond-files.key:<k>` presses a key, `pond-files.go:<dir>` moves out:
  left is `pane.focus` back to the focused pane, other directions take the keyboard then run `pane.go`;
  `cmd-alt-arrows` are caught in the key handler and do the same.
- Publishes `shared("pond-files.hasKeys")` (true while it holds the keyboard), polled every 300ms.

## Built from

- `update.js`: the self-update pill (the same file in every mod from this repo; `tools/stamp.py` refuses copies that differ). It reads `mod.json` `version` and `source`, fetches the repo's `versions.json` (shared between mods as `herdr-mods.versions`, every 6 hours or on click) and on confirm runs `tab.new` with `claude` in the Herdr home. No `source`: no pill.
Clone of shipped `files` (`cloned_from: {name: "files", version: "0.1.14"}`). Files: `main.js`,
`keybar.js` (new), `mod.json`, `chevron-down.svg`, `chevron-right.svg`, `folder.svg`,
`file.svg` (Lucide, `currentColor`). Differences from shipped:

- `mod.json`: adds `"focusable": true` and `"title": "Files"`.
- Tree: the recursive element list becomes `flat()` (rows as data) drawn by `v_virtual_list`
  with a `VirtualListScrollHandle` and `Scrollbar.vertical`, plus a selected row.
- Preview: shipped uses a readonly `EditorState`/`Editor` with syntax colors; this one splits
  the text into lines (tabs as 4 spaces, max 20,000 lines / 400,000 chars, "… (file truncated)")
  in a second virtual list so a line cursor can move. The `LANG` table is now unused.
- Wrap: rows are precomputed (`wrapRows`, cached per file and column count) because the
  virtual list needs fixed row heights. Columns = (panel width / zoom − 2 − 16 − gutter −
  10 − 10) / 7.2px, the 12px mono advance; zoom is read from `settings.json` (`settings()`
  has none) at start and on every resize, since the size comes in zoomed pixels.
- Keyboard: `cx.focus_handle()`, `.track_focus().on_key_down()`, `nextCommand()` loop for
  `focus` / `key:` / `go:`, a retry 150ms after `focus` (skipped once focus landed at 40ms, or after leaving), and a 300ms timer for focus changes
  (GPUI has no blur event). Back now reselects the file in the tree.
- Asset paths changed from `mods/files/…` to `mods/pond-files/…`.
- `keybar.js`: `keycap`, `keybar` (fits chips to `on_size_change` width), `keysCard`; the same
  file is copied into this author's `git`, `skills`, `todos` and `servers` mods.
- herdr: `spaces`, `panes`, `focused`, `exec` (`sh` listing script, PowerShell on Windows,
  `git rev-parse` and `git --no-optional-locks status --porcelain=v1 -z`), `readTextFile`,
  `watchFolder`, `theme`, `settings`, `window`, `run`, `nextCommand`, `setShared`.
  Commands: `layout.hide`, `pane.focus`, `pane.go`.

## Watch out

- `q` hides the layout node with id `panel`; a layout without that id ignores it.
- The preview lost syntax highlighting compared with shipped Files: a line cursor needs a
  virtual list, and the shipped `Editor` has no movable highlighted line.
- Focus can arrive a moment after `"focus"` is delivered; focus once more after 150ms or the
  first keypress goes to the terminal.
- Remote folders are polled only (no watch).
- Limits: 500 entries per folder, 5,000 in total, 20,000 preview lines.
- The `leader` mod in this repo reads `pond-files.hasKeys`; keep the key name if you rename.

## Done when

- `herdr-app check ~/.config/herdr-app/mods/pond-files` passes.
- In a block in place of `files`, it lists the focused pane's folder with git marks.
- `pane.go` into the panel turns its border accent; `j`/`k` move the highlight, `l` opens a
  folder and previews a file, `h` goes back, `J`/`K` step through files in the preview.
- The footer shows keycaps that fit its width; `?` opens the all-keys card, `esc` closes it.
- A long line in the preview wraps to the panel's right edge; `w` (or clicking "wrap on")
  turns it off and the label reads "wrap off"; reopening the panel keeps the choice.
- `q` hides the panel and puts the keyboard back in the terminal; `esc` in the tree does the latter.

## Changes

### 1.1.2 (2026-11-12)

- The update pill only shows when a newer version is published, and reads "Update available" (the version is in its tooltip); no more "Check for updates" pill while up to date. Each panel checks GitHub when it starts and every time it comes back on screen (shared `update.js`).

### 1.1.1 (2026-11-12)

- `update.js` (shared) can also offer the layout's update; no change in this mod's behaviour.

### 1.1.0 (2026-11-12)

- Self-update pill: its header has a "Check for updates" pill that turns into "Update to x.y.z" when this repo publishes a newer version; confirming starts a Claude tab that updates just this mod.

### 1.0.0 (2026-11-11)

- First versioned release.
- Word wrap in the preview (`w`, footer toggle) (2026-11-09).
- Leaving to the left gives the keyboard back to the terminal (2026-11-09).
