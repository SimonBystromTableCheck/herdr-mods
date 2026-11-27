# Session history (pond-history)

A "Session history" dialog for Claude Code: every past session on this computer, newest first and
grouped by day, with a search box, project chips to narrow it to one folder, and a preview of the
selected session (project, branch, dates, messages, model, cost, PR, first and last message). Enter
resumes it in a new tab, `f` resumes a fork of it, `y` copies its ID; a session still running in a
terminal is jumped to instead. **This mod is by Anthony Chapé, from his Pond
(github.com/anthonychape-tc/herdr-pond), and is published here with his permission**, with a few
local changes (see Changes at the end).

**Install:** tell your Herdr agent "Install the Herdr mod at
https://github.com/SimonBystromTableCheck/herdr-mods/tree/main/pond-history". What the agent does:

1. Copy `mods/pond-history/` into `~/.config/herdr-app/mods/` and run
   `herdr-app check ~/.config/herdr-app/mods/pond-history`.
2. Nothing to add to a layout: it opens as a dialog with `mod.open {name: "pond-history"}`, or the
   palette entry "Session history". With `pond-chrome` from this repo, the brand bar's history
   button opens it too.

**Version:** 1.0.0 (see Changes at the end; also `"version"` in `mod.json`).

**Update:** no update pill of its own. Tell your Herdr agent "update my herdr mods" (or "update pond mods"). It follows `UPDATE.md`, installed in the mod folder, which checks this repo's `versions.json` and offers every newer version of the mods and layouts you have from here, with a backup of each. By hand: replace `mods/pond-history/` with this folder's copy (asking an agent to *install* it again adds a second copy instead). Your settings and data live outside the mod folder and are kept; edits you made inside the mod folder are not.

## What you see

A dialog 880px wide and 80% of the window tall (`mod.json` `overlay`), on the theme's `popover`.
Top to bottom:

- **Header**: a 17px history icon in `muted`, "Session history" (15px semibold), a `dim` 12px count
  ("42 of 500": shown of loaded), and at the right a small "Esc" button (11px `dim`, `hover`
  background) that closes the dialog.
- **Search**: a 36px box, radius 9, `input` border on the terminals' `background`, a 14px magnifier
  in `dim` and the placeholder "Search sessions…".
- **Project chips**: "All projects", then the eight folders with the most sessions, busiest first,
  each with its count in `dim`. Chips are 24px tall, radius 6, 12px text; the picked one has an
  `input` border, `selected` background and `foreground` text, the others `border`, `popover` and
  `muted`. They wrap onto more rows when they don't fit. A folder is named by its last part (`~` for
  home, "unknown" without one).
- **List | preview**, under a `border` line:
  - **List** (fills the rest): day groups as 11px semibold `dim` capitals ("TODAY", "YESTERDAY",
    "EARLIER THIS WEEK", "EARLIER THIS MONTH", then "NOVEMBER 2026"...). Each row, radius 7, has a
    15px message icon (`dim`; a message-with-dot icon in `working` when the session is open in a
    terminal), the title (13px `foreground`, semibold when selected; else the first message, else
    "Untitled session"), a meta line (11.5px `dim`: project · branch · "N msgs"), an "open" pill
    (`raised`, `working` text) for running sessions, and a 64px right-aligned age ("just now", "5m
    ago", "3h ago", "2d ago", then a date). The selected row has a `hover` background.
  - **Preview** (300px, `border` on its left): the title (14.5px semibold), then labelled fields
    (72px `dim` labels): Project, Folder (home shown as `~`), Branch, Started and Last active
    ("Thu, Nov 27 · 14:05"), Messages, Model (last part of the id), Cost ("$1.23"), PR (an `accent`
    link "#123 owner/repo") and Status "Open in a terminal" in `working` when it runs. Then FIRST
    MESSAGE and LAST MESSAGE quotes on `raised` (cut at 360 characters; the last only when it differs).
    At the bottom: a primary button (`solid`) "Resume session" with a history icon, or "Go to
    session" with an arrow when it's open, and two outlined buttons, "Fork" and "Copy ID".
    With nothing selected it says "No session" (or "Reading sessions…").
- **Keybar**: a 28px footer with keycaps (JetBrains Mono letters, symbols for ⏎ ↑ ↓ esc) and `dim`
  labels, as many as fit, and a `?` keycap at the right for all keys.
- Empty list: "Reading sessions…", "No sessions match", or "Couldn't read sessions: <error>".

## How it behaves

The list has the keyboard when the dialog opens.

- **List keys:** `j`/`k` (or ↓/↑, ctrl-j/ctrl-k, ctrl-n/ctrl-p) move; `g`/`G` first/last; ctrl-d /
  ctrl-u ten down/up; enter resumes (or goes to its open terminal); `f` resumes a fork; ⌘enter (or
  ctrl-enter) also forks; `y` copies the session ID (toast "Session ID copied"); `[`/`]` cycle the
  project filter through All projects and the eight chips; `/` puts the keyboard in the search box;
  `?` opens the keys card; `q` or esc closes the dialog. The selection scrolls into view.
- **Search keys:** typing filters (title, first and last message, folder, branch and session id,
  case-insensitive) and selects the first row; ↑/↓, ctrl-j/k and ctrl-n/p move; enter resumes;
  ⌘enter forks; esc goes back to the list, keeping the filter (esc again closes). The keybar swaps
  to these keys while the box has the keyboard.
- **Keys card:** "Session history: keys", two groups (In the list, In the search box) over a dark
  scrim. Esc, `?`, `q` or a click outside closes it.
- **Mouse:** a click selects a row and puts the keyboard in the list; clicking the selected row
  resumes it. A chip picks its project (clicking the picked one again goes back to all). The
  buttons resume, fork and copy; the PR link opens in the browser; Esc and the `?` keycap work as
  their keys.
- **Resume:** a session open in a terminal on this computer is focused (`agent.focus`) and the
  dialog closes. Otherwise it checks the session's folder exists (else an error toast "Can't resume
  this session: Its folder is gone") and runs `claude --resume <id>` (plus `--fork-session` for a
  fork; a fork always starts a new terminal) in that folder: as a new tab in a local space already
  running a Claude session of the same project, else one whose folder or a terminal's folder is the
  session's (the shown space first), else a new space there. A session whose tab or pane was renamed
  shows that name as its title and the new tab gets it too.
- **Live sessions:** a terminal runs a session when its `claude.session` label says so, else by the
  chat view's mapping in shared `herdr-chat.paths`; only live terminals on this computer count.
- It reloads the list every 20 seconds while open. Agent statuses don't change anything else.

## Built from

- `mod.json`: `"place": "none"`, overlay `kind: "dialog"`, width 880, height 0.8, and a palette
  entry "Session history" (`mod.open {name: "pond-history"}`, words "claude resume sessions back in
  time restore").
- `main.js`: one view. `init` focuses its own handle (again after 60 and 400 ms unless typing),
  then `exec("python3", [appHome()/mods/pond-history/index.py, "500"], {timeout: 60000})` and every
  20 s. `list()` filters by project and text; `reveal()` turns the row index into the scroll
  child (group headings count) for `ScrollHandle.scroll_to_item`. `spaceFor()` picks the space;
  `open()` runs `tab.new {space, folder, argv, name?}` or `space.new {folder, argv, tab?}`.
- `index.py`: reads `~/.claude/projects/*/*.jsonl` (one file per session), skips lines that aren't
  `user`, `assistant`, `ai-title`, `custom-title`, `summary`, `last-prompt`, `cost-state` or
  `pr-link`, ignores sidechains and meta lines, counts typed prompts (tool results, reminders and
  "continued from a previous conversation" don't count) and takes cwd and branch from the
  messages. Titles: custom title, else AI title, else summary. Sessions with no prompts are left
  out. Prints `{ok, sessions, total}`, newest first, capped at the argument. Results are cached in
  `.cache.json` beside the script, keyed by each file's size and mtime.
- `live.js`: `liveSessions()` (session id → terminal address).
- `keybar.js`: `keybar()` and `keysCard()`, the shared vim keybar used by the other panels
  (width given as 860).
- `herdr`: `exec`, `appHome`, `home`, `theme`, `props`, `closeOverlay`, `run`, `spaces`,
  `terminals`, `panes`, `shared`, `notify`, `checking`. `gpui-base`: `InputState`, `Input`,
  `ScrollHandle`.
- Shared state read: `pond.history.names` (session id → name, written by `pond-chrome`),
  `herdr-chat.paths`. Commands: `agent.focus`, `tab.new`, `space.new`.
- Icons in `icons/`: `history`, `search`, `message`, `message-dot`, `arrow-right`, `git-fork`, `copy`.
- Files: `main.js`, `index.py`, `live.js`, `keybar.js`, `mod.json`, `UPDATE.md`, `icons/`.

## Watch out

- It runs `python3` (must be on the PATH Herdr sees) and reads every file in `~/.claude/projects`
  on this computer; remote machines' sessions aren't listed, and resumes only go to local spaces.
- `index.py` writes `.cache.json` (and `.cache.json.tmp`) beside itself, inside the mod folder. It
  holds your sessions' messages, folders and titles: **never ship or commit it.**
- Resume and fork assume the `claude` CLI is on the PATH and accepts `--resume <id>` and
  `--fork-session`; Claude only resumes a session from the folder it started in, which is why it
  starts there.
- It reads Claude Code's private JSONL format (`ai-title`, `custom-title`, `cost-state`, `pr-link`,
  ...); a Claude Code change can drop titles, costs or PRs without an error.
- Only the 500 newest sessions load, and only the eight busiest folders get chips (and `[ ]`).
- Live detection needs the `claude.session` label (pond-profiles' status line hook) or shared
  `herdr-chat.paths`; without either, open sessions resume in a second terminal instead of being
  focused. Renamed titles need `pond-chrome`.
- The keybar's width is fixed at 860, not measured.
- `checking()` skips the python run during `herdr-app check`, so a passing check doesn't prove the
  index works: open it in the app.

## Done when

- `herdr-app check ~/.config/herdr-app/mods/pond-history` passes.
- The palette's "Session history" opens the 880px dialog, listing sessions grouped by day with the
  count in the header and chips for the busiest folders.
- `j`/`k` move and the preview follows; `/` focuses search, typing filters, esc returns to the list.
- `[`/`]` and the chips narrow the list to one folder; chips wrap onto a second row when there are many.
- Enter on a closed session opens `claude --resume <id>` in a new tab in its folder; `f` adds
  `--fork-session`; enter on a running one focuses its terminal.
- `y` copies the ID with a toast; `?` shows the keys card; `q` or esc closes the dialog.
- `.cache.json` appears beside `index.py` after the first open, and the second open is faster.

## Changes

### 1.0.0 (2026-11-27)

- First published here. Anthony Chapé's mod from github.com/anthonychape-tc/herdr-pond, with these
  local changes: project chips wrap onto more rows instead of scrolling; the footer is the shared
  vim keybar (`keybar.js`, same as the other panels) with a `?` keys card; it opens with the
  keyboard on the list, `/` focuses search, and Esc in search goes back to the list.
