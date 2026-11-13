# Skills

A panel of your Claude Code skills: the personal ones in `~/.claude/skills` and the ones in the focused repo's `.claude/skills`, as cards with their slash name, a one-sentence description and argument hint. Run one and it goes as `/name args` to an agent already open in this space, or to a new agent tab in the repo; edit opens it in nvim; New scaffolds a `SKILL.md`. A bar on top says which repo and branch the skills will run against.


**Install:** tell your Herdr agent "Install the Herdr mod at
https://github.com/SimonBystromTableCheck/herdr-mods/tree/main/skills". You get a **Skills** button in the tab bar that opens it in the right-hand panel,
next to Herdr's Files and Changes. You don't need the `pond` layout. Needs `nvim` and `git`. What the agent does:

1. Copy `mods/skills/` into `~/.config/herdr-app/mods/` and run `herdr-app check ~/.config/herdr-app/mods/skills`.
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
4. Within a few seconds the tab bar adds `{ "id": "skills", "type": "block", "content": { "mod": "skills" } }`
   to the layout's `panel-body` stack (the right-hand `panel` column Herdr's `main` and its copies
   have) and shows the button. Check with `herdr-app status` and tell the person where it is.
5. Optional: with this repo's `leader` installed, `ctrl-a` then its key opens it too.

Without changing the tab bar, it also opens beside a terminal:
`herdr-app do pane.split --direction right --mod skills` (`q` closes that pane).

**Version:** 1.2.0 (see Changes at the end; also `"version"` in `mod.json`).

**Update:** from 1.1.0, its header has a "Check for updates" pill that turns into "Update to x.y.z" when this repo publishes a newer version; click it, confirm, and a new Claude tab updates just this mod (following `UPDATE.md`). Or tell your Herdr agent "update my herdr mods" (or "update pond mods"). It follows `UPDATE.md`, installed in the mod folder, which checks this repo's `versions.json` and offers every newer version of the mods and layouts you have from here, with a backup of each. By hand: replace `mods/skills/` with this folder's copy (asking an agent to *install* it again adds a second copy instead). Your settings and data live outside the mod folder and are kept; edits you made inside the mod folder are not.

## What you see

Panel: theme `background`, text 12.5px, rounded 10 with a 1px border (`accent` while it has the keyboard, else `border`).

- **Header, 42px**, 1px bottom border: "Skills" (semibold 13), "5 local · 2 in herdr" (11.5px, `dim`), the active filter `/text` in `accent`, and a "New" button (24px, plus icon, `raised` with an `input` border).
- **Runs on bar, 30px**, `surface`, 12px: "Runs on" (`dim`), the repo name (semibold), a `git-branch` icon in `accent`, the focused pane's branch in mono `accent` (or "detached HEAD" in `ansi3`), and at the right the subfolder you're in (`dim`, max 140px). Outside a repo: "~/folder (not a git repo)" or "no folder".
- **List**, 8px padding, 6px gap:
  - Group headings, 26px: "Repo · herdr" + `~/code/herdr/.claude/skills`, then "Local" + `~/.claude/skills` (11px; title `muted` semibold, path `dim`). Empty groups say "No skills in this repo" / "No local skills yet: press n to create one" / "No matches".
  - Cards, 90px tall, 10px padding, 9px radius, 1px border (selected: `accent` with the keyboard, else `input`; background `surface` when selected or hovered). Top row: a scope badge (`repo · herdr` in `ansi6`, `local` in `ansi5`, outlined, 10.5px), `/name` in mono semibold, a primary Run button (`solid`) and an Edit button. Then the description's first sentence (max 120 chars, 12px `muted`, or "No description") and, if the skill has an `argument-hint`, `args <hint>` (mono 11px `dim`).
  - When more rows are below, a "3 more ↓" chip in the bottom-right corner (`raised`, 10.5px).
- **Footer, 28px**: keycaps run, edit, new, copy, filter, close and `?`; short messages ("Sent /review to Claude") replace them in `accent` for about 4s.
- Overlays on a `#00000055` scrim: a menu (440px, `popover`, key column in `accent`, hints at the right), a prompt (340px, 70px from the top, `accent`-bordered input), and the all-keys card.

## How it behaves

- The repo is the git top level of the focused pane's folder (else the focused block's, else the space's). Moving to another folder updates the list within 1s; both skill folders are watched for changes, plus a full rescan every 30s.
- A skill is a folder with `SKILL.md` or a loose `*.md` file; its `name`, `description` and `argument-hint` come from the YAML frontmatter (quoted and `>`/`|` block values work), the name falling back to the folder or file name. Repo skills list first, each group alphabetical.
- Run (button, `enter` or `space`): if the skill has an argument hint, a prompt asks for arguments (optional). Then a menu: `1`-`8` Send to each agent in the active space (the focused one first, marked "(current)", hint "branch · status"), `n` New <first installed agent> tab in <repo> (`tab.new` with the agent's `run`, `task: "/name args"`, named `/name`), `y` Copy command. Sending types the text into that agent with `hc send`.
- Edit (button or `e`): a new tab running `nvim <path>` in the skill's folder, named `edit <name>`.
- New (button or `n`): asks a name (kebab-cased), then a one-line description, then, inside a repo, where it lives (`l` local or `r` this repo only). It writes `<dir>/<name>/SKILL.md` with frontmatter and TODO body, and opens it in nvim. An existing one is opened instead.
- Keys: `j/k` move, `< >` first/last, `y` copy `/name`, `/` filter by name and description (applied on enter), `escape` clears it, `r` or `ctrl-r` rescan, `q` hide the panel and give the keyboard back to the focused pane, `?` keys card. Menus: `j/k`, `enter`, an item's key, `escape`/`q`. The mouse wheel moves the list one row per notch; the keyboard keeps the selection in view.

## Built from

- `update.js`: the self-update pill (the same file in every mod from this repo; `tools/stamp.py` refuses copies that differ). It reads `mod.json` `version` and `source`, fetches the repo's `versions.json` (shared between mods as `herdr-mods.versions`, on start and whenever the panel comes back on screen) and on confirm runs `tab.new` with `claude` in the Herdr home. No `source`: no pill.
- `main.js` (scan, actions, rendering), `keybar.js` (footer keycaps and keys card, same file as the git and servers mods), icons `run.svg edit.svg plus.svg` (and `skills.svg`, which the code doesn't use).
- `mod.json`: `{ "place": "none", "title": "Skills", "focusable": true, "panel": { "title": "Skills", "icon": "skills.svg", "leader": "a" } }`. No `props`. `panel` is what `pond-tabs` (button label and icon) and the `leader` (key) read.
- `panel.js`: where the panel is and showing or closing it there (the same file in every panel mod from this repo; `tools/stamp.py` refuses copies that differ). `q` closes it wherever it is: a popup closes, a focused pane closes, and a layout block hides the node holding its stack (the `panel` column in Herdr's `main` and its copies). No layout ids are assumed.
- herdr: `spaces panes focused agents knownAgents exec hc run theme settings home readTextFile writeTextFile watchFolder nextCommand setShared`. Commands: `tab.new`, `terminal.open` (`place: "tab"`), `layout.hide`, `pane.focus`, `pane.go`.
- `nextCommand()`: `focus`, `go:<direction>` (left: `pane.focus` back to the focused pane, since `pane.go` doesn't reliably move the keyboard out of a panel; other directions `pane.go`; `cmd-alt-arrows` are caught in the key handler and do the same; leaving cancels a pending 150ms focus retry, which also skips once focus has landed), `key:<k>` (e.g. `"skills.key:n"` in keys.json). Shared: `skills.hasKeys` (keyboard ownership, polled every 300ms).
- Programs: `sh` (list `SKILL.md` and `*.md`; `printf $SHELL`), `git rev-parse --show-toplevel`, `mkdir -p`, `hc send <agent> "/name args"`, `nvim` through `$SHELL -lic`.
- The list is a window of fixed-height rows (cards 90, headings 26, gap 6) computed from the panel's height, since a plain scroll area can't be scrolled from code.
- Art: Lucide-style 24px stroke icons; Herdr's shipped `mods/workspace-chrome/git-branch.svg`.

## Watch out

- `place: "none"`: `pond-tabs` adds it to the right-hand panel (see Install); or open it as a pane: `herdr-app do pane.split '{"direction":"right","mod":"skills"}'`. `mod.open` does not apply (no overlay in `mod.json`).
- Reads `~/.claude/skills` and `<repo>/.claude/skills`, and New writes `SKILL.md` files there: outside its own folder.
- Needs `nvim` for Edit and New (hardcoded, not `$EDITOR`), `git`, and an installed agent (`knownAgents()`) for the New tab option. Send works with any agent; it is written for Claude Code's `/skill` syntax.
- Local machine only: on a remote space the folder is checked with local `git`, so its repo skills don't show.
- The filter prompt applies on enter, not as you type. The footer message clears only on the next redraw after 4s.
- No dependency on `gitview` or other mods in this repo; the `leader` mod reads `skills.hasKeys` but isn't needed.

## Done when

- `herdr-app check ~/.config/herdr-app/mods/skills` passes.
- With a terminal in a repo that has `.claude/skills`, the Runs on bar names the repo and branch, and a "Repo" group lists its skills above "Local".
- Each card shows `/name`, the first sentence of its description and `args …` when it has an `argument-hint`.
- Adding a folder with a `SKILL.md` under `~/.claude/skills` makes a card appear without a manual refresh.
- `enter` on a skill with an agent open in the space lists it; picking it types `/name` into that agent.
- `n` → name → description → `l` creates `~/.claude/skills/<name>/SKILL.md` and opens it in nvim in a new tab.
- `/` filters cards; `escape` clears it; `cd` into another repo switches the Repo group within a second.

## Changes

### 1.2.0 (2026-11-13)

- Works without the `pond` layout: installing it adds a button to the tab bar that opens it in the right-hand panel, next to Herdr's Files and Changes (needs `pond-tabs` as the layout's tab bar; see Install).
- `q` closes it wherever it is (the right-hand column, a pane or a popup) through the shared `panel.js`, instead of assuming `pond`'s ids.
- `mod.json` declares `"panel"` (leader `a`).

### 1.1.2 (2026-11-12)

- The update pill only shows when a newer version is published, and reads "Update available" (the version is in its tooltip); no more "Check for updates" pill while up to date. Each panel checks GitHub when it starts and every time it comes back on screen (shared `update.js`).

### 1.1.1 (2026-11-12)

- `update.js` (shared) can also offer the layout's update; no change in this mod's behaviour.

### 1.1.0 (2026-11-12)

- Self-update pill: its header has a "Check for updates" pill that turns into "Update to x.y.z" when this repo publishes a newer version; confirming starts a Claude tab that updates just this mod.

### 1.0.0 (2026-11-11)

- First versioned release.
- Leaving to the left gives the keyboard back to the terminal (2026-11-09).
