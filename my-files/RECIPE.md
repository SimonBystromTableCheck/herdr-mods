# My Files

Herdr's Files panel made keyboard-first. It still browses the focused pane's folder as a
lazy tree with git marks and opens a read-only preview, but you can move into it with
`pane.go` and drive it with vim motions: j/k through the tree, l to open, h to go up, J/K to
flip between files in the preview, q to hide the panel. A footer of keycaps shows the keys
that fit, and `?` opens a card with all of them. The border turns accent while it has the keyboard.


**Install:** Point your Herdr agent at this folder: copy `mods/my-files/` into
`~/.config/herdr-app/mods/`, then `herdr-app check ~/.config/herdr-app/mods/my-files`.
It is `"place": "none"`: it replaces the shipped `files` mod in a layout block. Clone the
layout (`herdr-app do layout.clone '{"name":"main","as":"my-main"}'`) and set the `files`
block's `content` to `{ "mod": "my-files" }`.

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
- **Keybar** (28px footer, top border, 11px): keycaps (16px, rounded 4, `raised` on `border`,
  JetBrains Mono) with labels in `dim`, as many as fit: tree "j k move · l open · h up ·
  g G ends · q hide"; preview "j k line · J K file · h back · q hide"; a `?` keycap at the right.
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
  `ctrl-d`/`ctrl-u` move the line, `J`/`K` next/previous file in the tree, `h`/←/`esc`/⌫ back
  to the tree with that file selected. Anywhere: `r` refresh, `q` hide the panel
  (`layout.hide {id: "panel"}`) and refocus the pane, `?` the keys card (`esc`, `?`, `q` or a
  click closes it). Keys with cmd/alt pass through.
- Commands from `keys.json`: `my-files.key:<k>` presses a key, `my-files.go:<dir>` takes the
  keyboard then runs `pane.go`.
- Publishes `shared("my-files.hasKeys")` (true while it holds the keyboard), polled every 300ms.

## Built from

Clone of shipped `files` (`cloned_from: {name: "files", version: "0.1.14"}`). Files: `main.js`,
`keybar.js` (new), `mod.json`, `chevron-down.svg`, `chevron-right.svg`, `folder.svg`,
`file.svg` (Lucide, `currentColor`). Differences from shipped:

- `mod.json`: adds `"focusable": true` and `"title": "Files"`.
- Tree: the recursive element list becomes `flat()` (rows as data) drawn by `v_virtual_list`
  with a `VirtualListScrollHandle` and `Scrollbar.vertical`, plus a selected row.
- Preview: shipped uses a readonly `EditorState`/`Editor` with syntax colors; this one splits
  the text into lines (tabs as 4 spaces, max 20,000 lines / 400,000 chars, "… (file truncated)")
  in a second virtual list so a line cursor can move. The `LANG` table is now unused.
- Keyboard: `cx.focus_handle()`, `.track_focus().on_key_down()`, `nextCommand()` loop for
  `focus` / `key:` / `go:`, a retry 150ms after `focus`, and a 300ms timer for focus changes
  (GPUI has no blur event). Back now reselects the file in the tree.
- Asset paths changed from `mods/files/…` to `mods/my-files/…`.
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
- The `leader` mod in this repo reads `my-files.hasKeys`; keep the key name if you rename.

## Done when

- `herdr-app check ~/.config/herdr-app/mods/my-files` passes.
- In a block in place of `files`, it lists the focused pane's folder with git marks.
- `pane.go` into the panel turns its border accent; `j`/`k` move the highlight, `l` opens a
  folder and previews a file, `h` goes back, `J`/`K` step through files in the preview.
- The footer shows keycaps that fit its width; `?` opens the all-keys card, `esc` closes it.
- `q` hides the panel and puts the keyboard back in the terminal; `esc` in the tree does the latter.
