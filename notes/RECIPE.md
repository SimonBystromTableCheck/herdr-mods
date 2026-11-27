# Notes

An Obsidian vault as a panel on the right side of the window. Each repo and branch you work on
gets a feature note (`Herdr/<repo>/<branch>.md`) with its todos, linked from a note for the repo;
the panel follows the space you're in and shows that branch's note. Any note opens rendered, with
its `[[links]]` followed in place and the notes linking to it listed underneath. Find notes by name
or search inside them, create, rename (links are updated), delete, and edit in your own editor
(nvim by default) in a split. A setup screen installs what's missing and picks or creates the vault.
The vault is plain files: Obsidian doesn't need to be running and no Obsidian plugin is needed.

**Install:** tell your Herdr agent "Install the Herdr mod at
https://github.com/SimonBystromTableCheck/herdr-mods/tree/main/notes". You get a **Notes** button
in the tab bar that opens it in the right-hand panel, next to Herdr's Files and Changes. You don't
need the `pond` layout. What the agent does:

1. Tell the person: the mod runs programs (`rg`, `git`, `mkdir`, `mv`, `test`, `open`/`xdg-open`,
   their editor, and, from the setup screen only when they click, `brew install`), reads and writes
   files in the vault they choose, writes `~/.config/herdr-app/notes.json`, and can copy
   `feature-todo` to `~/.local/bin`. No network, except Homebrew installs they start.
2. Copy `mods/notes/` into `~/.config/herdr-app/mods/` and run
   `herdr-app check ~/.config/herdr-app/mods/notes`. Copy the folder; don't symlink it (a symlinked
   mod folder draws no icons).
3. The button comes from this repo's tab bar, `pond-tabs`, which draws a button for every panel in
   the right-hand column. If `~/.config/herdr-app/mods/pond-tabs/` is missing, copy `mods/pond-tabs/`
   from https://github.com/SimonBystromTableCheck/herdr-mods/tree/main/pond-tabs and check it too.
4. The shown layout (`herdr-app status` names it) must be a personal one whose `tabs` block shows
   `pond-tabs`. Herdr's own layouts are read-only:
   - On Herdr's `main`: `herdr-app do layout.clone '{"name":"main","as":"my-main"}'` (it switches
     to the copy, which looks and works the same), then in `layouts/my-main.json` set the block
     with `"id": "tabs"` to `"content": { "mod": "pond-tabs" }`. Tell the person a clone doesn't get
     Herdr's later changes to `main`.
   - On a personal layout: set its `tabs` block's `content` to `{ "mod": "pond-tabs" }` if it isn't.
   - On `pond` (this repo): nothing to do.
5. Within a few seconds the tab bar adds `{ "id": "notes", "type": "block", "content": { "mod": "notes" } }`
   to the layout's `panel-body` stack and shows the button. Check with `herdr-app status`.
6. Tell the person to open Notes: the setup screen comes first. They finish it themselves (it picks
   their vault). Don't write `notes.json` for them.

Without changing the tab bar, it also opens beside a terminal:
`herdr-app do pane.split --direction right --mod notes` (`q` closes that pane).

**Version:** 1.1.0 (see Changes at the end; also `"version"` in `mod.json`).

**Update:** an "Update available" pill appears in its header when this repo publishes a newer
version; click it, confirm, and a new Claude tab updates just this mod (following `UPDATE.md`). Or
tell your Herdr agent "update my herdr mods". By hand: replace `mods/notes/` with this folder's
copy. Your settings (`~/.config/herdr-app/notes.json`) and your notes (in your vault) are outside
the mod folder and are kept; if you installed `feature-todo`, reinstall it from the setup screen
(⚙) to get a newer copy.

## What you see

- **Setup screen** (first open, and later from ⚙ in the header), on `background`, scrolling:
  - "Set up Notes" in 15px semibold and a one-line 11.5px `dim` explanation.
  - Five step cards (10px padding, 8px corners, `border`): a numbered circle that turns into a
    green (`ansi2`) ✓ when done, a semibold title, 11.5px `dim` text, warnings in `ansi3`:
    1. **Obsidian (recommended)**: "Install with Homebrew" (when `brew` is there) or "Download Obsidian".
    2. **Your vault** (the only required step, accent-bordered circle): the vaults Obsidian knows as
       radio rows (the open one marked "open in Obsidian"), then **Use an existing folder…** and
       **Create a new vault** (a name field, "In ~/Documents · Change…", **Create**).
    3. **ripgrep**: "Install with Homebrew", else a "How to install" link.
    4. **Editor and folder**: two fields, "Editor command" (default `nvim`) and "Feature notes
       folder" (default `Herdr`, hint `<vault>/<folder>/<repo>/<branch>.md`).
    5. **TODOs from agents (optional)**: **Install** copies `feature-todo` to `~/.local/bin`; once
       installed, **Copy instructions for your agents** and **Reinstall**.
  - A footer line ("Choose a vault to finish." / "Settings are saved to ~/.config/herdr-app/notes.json."),
    **Check again** and **Finish** (`solid` primary, disabled without a vault).
- **Panel**, rounded 10px, `accent` border while it has the keyboard:
  - A 34px tab strip: **1 Feature**, **2 `<repo>`** (the space's repo, "Repo" outside one),
    **3 Vault**, the chosen one on `raised`; then the update pill, search, + and ⚙ icon buttons.
  - **Feature**, when this branch has no note: `<repo> · <branch>`, "No note for this branch yet.
    It would be Herdr/…/….md, linked from the repo's note." and **Create feature note ⏎**. Outside a
    git repo or on a detached HEAD, a line saying so.
  - **A note**: title (14px semibold) with a back chevron when there's history, its path (11px `dim`),
    front-matter tags as `#tag` pills (`accent` on `raised`), and **nvim** (the editor's name),
    **Send**, **Obsidian** buttons. Then sections in 10.5px semibold `dim` caps:
    **TODOS done/total** with a checkbox row per todo (checked: `ansi2` box, struck-through `dim`
    text), the note rendered as markdown (13px; front matter, todo lines, the `# ` title and empty
    headings left out), **LINKS n** (to missing notes `dim`, marked "new"), **LINKED FROM n** with
    each note's folder on the right.
  - **Repo / Vault**: notes newest first, a file icon, the name and its folder on the right
    (10.5px `dim`). Repo shows `Herdr/<repo>/`.
  - **Find** (`f` by name, `/` inside notes): an input under the tab strip labelled `name` or
    `text`; text matches show `line: text` under the note's name.
  - A keycap footer (`keybar.js`) with the keys for what's on screen and `?` for all of them.

## How it behaves

- **Where you are:** the shown space; git in the focused terminal's folder (on the space's machine)
  gives the repo (the main checkout's folder name, so worktrees share it) and branch. Switching space
  or branch swaps the Feature tab to that note. Nothing is created by looking.
- **Creating a feature note** (Enter or the button, or `feature-todo`): makes `Herdr/<repo>/<repo>.md`
  if missing (front matter `tags: [repo]`, `## Features`), then `Herdr/<repo>/<branch>.md`
  (`/` and `:` in the branch become `-`) with front matter `tags: [feature]`, `repo`, `branch`,
  `status: active`, `created`, a `# <branch>` title, `Repo: [[<repo>]]` and empty `## Todos`,
  `## Notes`, `## Log`; and adds `- [[<branch>]]` under the repo note's `## Features`.
- **In a note:** `j`/`k` move over todos, links and backlinks; `space`/`x` toggles a todo (written at
  once, refused with a reload if the file changed meanwhile); `a` adds a todo after the last one
  (else under `## Todos`, else at the end); Enter follows a link or backlink, or offers to create a
  missing note; clicking a `[[link]]` in the text does the same; `h`/Escape goes back.
- `e` opens the note in the editor in a split right of the focused pane, at the selected todo's line
  (`+line`). Saves show up at once: the vault folder is watched.
- `n` new note (in `Herdr/<repo>/` inside a repo, else the vault root; opens in the editor), `R`
  rename with every `[[name…`/`[[path…` link updated, `D` delete to the vault's `.trash` (asks),
  `o` open in Obsidian, `y` copy `[[name]]`, `s` paste "My note "<name>" is at <path> (…)" into the
  focused or last focused agent's prompt without submitting it.
- `1`/`2`/`3`, `]`/`[` and `tab` switch tabs (wrapping). `f`/`/` open find; in it Up/Down or
  Ctrl-J/K move, Tab switches name ↔ text, Enter opens, Escape closes. `q` closes the panel, `?`
  shows every key. The chosen tab is remembered.
- **Setup:** opens until finished once, and again when the saved vault folder is gone. Escape or
  Back returns to the notes once it's done. Finish writes `notes.json` and loads the vault.
- **`feature-todo "item" ["item" …]`**, run inside a repo, does the feature-note creation above and
  adds `- [ ] item` lines after the last todo under `## Todos`; it prints the note's path, and exits
  2 with no vault, no repo or a detached HEAD so agents can fall back to `TODO.md`.

## Built from

- `mod.json`: `{ "place": "none", "title": "Notes", "focusable": true, "panel": { "title": "Notes", "icon": "notes.svg", "leader": "N" } }`.
- `main.js` (the View), `vault.js` (settings, the vault's files, links, rename, trash, git context,
  templates), `setup.js` (the setup screen), `keybar.js`, `panel.js` and `update.js` (the shared
  files of this repo's panel mods), `feature-todo` (Python 3, no dependencies), lucide-style SVGs.
- Settings: `~/.config/herdr-app/notes.json` `{ "vault": "~/…", "folder": "Herdr", "editor": ["nvim"], "setupDone": true }`.
  Without `vault`, the vault Obsidian has open, else the one it opened last, from Obsidian's
  `obsidian.json` (macOS `~/Library/Application Support/obsidian/`; Linux `~/.config/obsidian/`,
  Flatpak and Snap).
- A new vault is a folder with `.obsidian/app.json` (`{}`) and a `Welcome.md` when empty; Obsidian
  shows it after "Open folder as vault".
- `herdr`: `exec` (`rg --files --sortr modified`, `rg -n -i -F` for text, `rg -l` for backlinks,
  `git rev-parse --path-format=absolute --git-common-dir --abbrev-ref HEAD`, `mkdir -p`, `mv`,
  `test`, `open`/`xdg-open`, a login shell for `command -v`, `pgrep` and `brew install`),
  `readTextFile`, `writeTextFile(path, text, expected)`, `watchFolder` (changes only under
  `.obsidian`, `.trash`, `.git` ignored), `pickFolder`, `spaces`, `focused`, `agents`, `shared` /
  `setShared` (`notes.agent`, `notes.hasKeys`), `nextCommand`, `notify`, `checking`, `theme`.
- Commands: `terminal.open {argv: ["/bin/zsh","-lic","<editor> +<line> '<file>'"], folder, place: "right", name}`,
  `pane.focus {terminal}` + `terminal.paste` for Send (clipboard set, then put back after 400ms),
  `pane.focus`, `pane.go`, `pane.close`, `layout.hide`.
- Rendering: `TextView.markdown` with `[[links]]` rewritten to `https://herdr-note.invalid/<name>`
  and caught in `on_link_click`; `==highlight==` bold, `%%comments%%` dropped.

## Watch out

- macOS first: the editor starts through `/bin/zsh -lic`; Linux needs zsh too for `e`.
- `rg` is needed for text search and "Linked from"; without it notes list through `find`.
- Rename rewrites wikilinks only, not Markdown `[text](note.md)` links.
- A note's rendered view can't select text, so Send sends the note's path for the agent to read.
- The Feature tab follows the space's folder and branch; moving between panes of different repos
  inside one space keeps the first one's note until the space's folder or branch changes.
- Notes in hidden folders or ignored by the vault's `.gitignore` don't list (ripgrep skips them).
- A renamed branch gets a new note; the old one stays (rename it with `R`). Notes of merged
  branches aren't archived.
- The setup's Homebrew installs run in a login shell for up to 10 minutes; the card shows
  "Installing…" until then.
- Mods can't import each other: `keybar.js`, `panel.js`, `update.js` are copies.

## Done when

- `herdr-app check ~/.config/herdr-app/mods/notes` passes.
- Without `notes.json`, the panel opens on the setup screen with the vault Obsidian has open
  selected; Finish writes `notes.json` with `setupDone: true` and shows the Feature tab.
- **Create a new vault** with a name makes `<folder>/<name>/.obsidian/` and `Welcome.md` and selects it.
- In a git repo's space on branch `feat/x`, Enter on the Feature tab creates `Herdr/<repo>/feat-x.md`
  and `Herdr/<repo>/<repo>.md` listing `- [[feat-x]]`, and shows the note.
- `space` on a todo row writes `- [x]` to the file; `e` opens the editor beside the terminal and a
  save there updates the panel.
- `]` from Vault goes to Feature; `[` from Feature goes to Vault.
- `feature-todo "a" "b"` inside that repo adds both under `## Todos` and prints the path; outside a
  repo it exits 2.

## Changes

### 1.1.0 (2026-11-27)

- Text meant for an agent goes to agent-chat's chat box when the Chat view shows (its inbox), else is pasted into the focused terminal's prompt without submitting.
- Changes on disk show up more reliably: the folder watch restarts after a reclaimed or rejected watch, and while the window shows the open note is re-read every few seconds as a fallback.
- Back to the chat: leader+h (or Esc / h at the left edge) now gives the keyboard to agent-chat's chat box when the Chat view shows, not just to the hidden terminal (`focusTab()` in the shared `panel.js`).

### 1.0.0 (2026-11-17)

- First version: feature note per repo and branch with todos, Repo and Vault lists, find by name and
  text, rendered notes with links and backlinks, editor split, create / rename with link updates /
  delete, Send to agent, `feature-todo` for agents, and a setup screen (Obsidian, vault, ripgrep,
  editor and folder, the helper).
