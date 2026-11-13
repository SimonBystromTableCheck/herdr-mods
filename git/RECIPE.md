# Git

A lazygit-style git panel for the repo of the focused terminal. Numbered sections (Branches, Commits, Stash) sit beside a preview of the selected item (a branch's log with a drawn commit graph, a commit's or stash's full diff, or a command's output). Vim-ish keys drive it: check out, merge, rebase, squash, fixup, reword, drop, reorder, cherry-pick, push, pull. Writes run in background herdr-core terminals whose output stays in a copyable log, and a merge or rebase conflict or a failed command (a pre-commit hook, say) can be handed to a coding agent with one key. When a merge or rebase stops on conflicts, `v` opens a Conflicts pane beside the tab: the conflicted files, a lazygit-style chunk picker (ours / theirs / both, undo), Ask AI, and continue / abort with a failure box you can hand to an agent.


**Install:** tell your Herdr agent "Install the Herdr mod at
https://github.com/SimonBystromTableCheck/herdr-mods/tree/main/git". You get a **Git** button in the tab bar that opens it in the right-hand panel,
next to Herdr's Files and Changes. You don't need the `pond` layout. Needs `git`, `perl` and `nvim` (see Watch out). What the agent does:

1. Copy `mods/git/` and `mods/git-conflicts/` into `~/.config/herdr-app/mods/` and run `herdr-app check ~/.config/herdr-app/mods/git` and `herdr-app check ~/.config/herdr-app/mods/git-conflicts`.
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
4. Within a few seconds the tab bar adds `{ "id": "git", "type": "block", "content": { "mod": "git" } }`
   to the layout's `panel-body` stack (the right-hand `panel` column Herdr's `main` and its copies
   have) and shows the button. Check with `herdr-app status` and tell the person where it is.
5. Optional: with this repo's `leader` installed, `ctrl-a` then its key opens it too.

Without changing the tab bar, it also opens beside a terminal:
`herdr-app do pane.split --direction right --mod git` (`q` closes that pane).

**Version:** 1.2.0 (see Changes at the end; also `"version"` in `mod.json`).

**Update:** from 1.1.0, an "Update to x.y.z" pill appears in the Git (and Conflicts) header when this repo publishes a newer version; click it, confirm, and a new Claude tab updates just this mod (following `UPDATE.md`). Or tell your Herdr agent "update my herdr mods" (or "update pond mods"). It follows `UPDATE.md`, installed in the mod folder, which checks this repo's `versions.json` and offers every newer version of the mods and layouts you have from here, with a backup of each. By hand: replace `mods/git/` and `mods/git-conflicts/` with this folder's copy (asking an agent to *install* it again adds a second copy instead). Your settings and data live outside the mod folder and are kept (commit-message drafts and panel state); edits you made inside the mod folder are not.

## What you see

Panel: theme `background`, text 12.5px, rounded 10 with a 1px border (`accent` while it has the keyboard, else `border`). Opened as its own tab (expanded), it has no border or radius.

- **Header, 42px**, 1px bottom border: "Git" (semibold 13), repo folder name (`dim`, max 160px), a 12px `git-branch` icon in `accent` and the branch (or `detached @ <7-char sha>`), then `↑n ↓n` in `ansi3` (or `✓` in `ansi2` when in sync), "no upstream" (`dim`) and "N staged · M changed" (`ansi3`). Right side: Fetch, Pull, Push icon buttons (24px high, labels only when the panel is ≥560px wide) and a pop-out button. While a command runs, the buttons are replaced by a spinning 11px spinner and the command's title in `working`.
- **Banners** (8px radius, `surface`, colored border and 7px dot): an operation banner under the header for a rebase/merge/cherry-pick/revert in progress (`ansi1` with conflicts, else `ansi3`; text like "Rebasing feat onto main · 2/5 · 3 conflicts"; buttons Resolve (v) / Ask AI (i) while conflicts remain, Continue once none are left, More (m)); an AI banner while an agent works on a hand-off; a failure banner above the footer ("git push failed (exit 1)": Output, Copy, Ask AI (i), ×).
- **Body**, 6px padding and gap. At ≥720px wide: sections on the left (42% of the width, clamped 300-520px), preview on the right. Narrower: sections on top, preview below (38% of the height, at least 160px); with the preview focused, only the preview.
- **Sections**, each a box with an 8px radius and 1px border (`accent` when focused with the keyboard). A 24px head: the number key badge (3, 4, 5), the title, tab pills (Branches: Local / Remote; Commits: Branch / All), the active filter `/text` in `accent`, a count at the right. The focused section grows and scrolls (virtual list, 22px rows); the others show only a few rows around their selection (Branches 5, Commits 6, Stash 2).
  - Branch rows: `*` for HEAD, the name (`accent` semibold for HEAD, `dim` when its PR is merged/closed or its upstream is gone), a PR badge `#12 open` (`ansi2`) / `merged` (`ansi5`) / `closed` (`ansi1`) / `draft` (`dim`), then `gone` (`ansi1`) / `local` (`dim`) / `↑n↓n` (`ansi3`) / `✓` (`ansi2`), a `merged` badge (`ansi5`), a `worktree` badge, on remote rows `local: ✓` (`ansi2`); the relative date at ≥520px.
  - Commit rows: a graph cell drawn from lines (14px per lane, 1.6px lines, rounded fork/merge elbows, 8px dots; 10px hollow ring for merges, a `foreground` ring on HEAD; lane colors cycle `ansi4 ansi5 ansi6 ansi2 ansi3 ansi1 ansi12 ansi13`), the short hash (`ansi1` unpushed, `ansi3` pushed but not in the default branch, `ansi2` merged), `⎘` (`ansi6`) if marked for cherry-pick, up to two ref chips (`→ branch` on `accent`, tags `ansi3`, others `ansi6`) and `+N`, the subject (`muted` once merged), author first name · date at ≥520px.
  - Stash rows: index, message, date.
- **Preview**, a bordered box with a 28px title row. A branch shows its last 200 commits as commit rows. A commit or stash shows `git show --stat --patch` in the mono font at 12px, 18px lines, scrolling both ways: added lines `ansi2` on `ansi2`+`18` alpha, removed `ansi1` likewise, hunks `ansi6` on `raised`, file headers semibold, commit metadata `ansi3`. A command's output shows in a read-only, selectable editor (`$ title`, exit code, output) with Watch (while running), Copy and Ask AI (on failure) buttons.
- **Footer, 28px**: keycap chips for the focused section's own actions (as many as fit), `x actions`, and a `?` keycap at the right. Messages flash there in `accent` for 3.5s.
- **Conflicts pane** (`git-conflicts`, a mod pane opened full height at the tab's right edge, beside the side panel; only on demand):
  - Header, 42px: a 7px dot (`ansi1` while files are left, `ansi2` when none), "Conflicts", then Ask AI (i), Continue (c) (solid once every file is decided, else 45% opacity), Skip (rebase only), Abort (A) in `ansi1`. Below it, 11.5px `muted`: "Merging main into feat · 2 of 3 files left" (or "Rebasing feat onto main · 2/5"), "all resolved: continue (c)" at the end.
  - Failure box under the header after a continue/skip/abort fails: `ansi1` border on `ansi1`+`12`, "git merge --continue failed (exit 1)", buttons Ask AI (f), Copy, All N lines / Less, ×; git's error lines (error/fatal/hook/✖/ERR!/failed, red) or the last 6 lines, mono 11.5px, max 120px (320 expanded).
  - File list: 240px on the left when the pane is ≥620px wide, else on top (max 150px). 24px rows: a 3px `accent` bar on the selected row while the list has the keyboard, the status code (UU, UD, DU, AA, AU, UA, DD in `ansi1`; `✓` in `ansi2` once decided), the file name, its folder (`dim`), the number of conflicts left. Decided files stay in place: name in `ansi2`, a `resolved` / `kept` / `deleted` label, strikethrough when deleted.
  - Chunk view for a file with markers: a 28px row with the path, Ask AI (a), Editor (e); a 34px toolbar on `surface` with ← "Conflict 1 of 2" → and Keep ours (o) in `ansi2`, Keep theirs (t) in `ansi4`, Both (b), Undo (z). Then a virtual list of 22px rows: 3 context lines around each conflict with line numbers (longer runs fold into "⋯ N unchanged lines"), a green "▲ OURS · current · feat" band, ours lines tinted `ansi2` with a 3px left border, an optional grey "BASE" band and lines (diff3), a blue "▼ THEIRS · incoming · main" band and lines in `ansi4`, a 2px rule. The current conflict's bands and lines are brighter; the chosen side says "space: keep this".
  - A file one side deleted (UD, DU) or only one added (AU, UA): what the surviving side changed against the base (`git diff :1:path :2|3:path`, colored like a diff), with Keep the file (r), Delete it (d), Ask AI (a).
  - Footer, 28px: key chips for where the keyboard is; flash messages replace them.
- Overlays on a `#00000055` scrim: action menus (380px wide, max 520px, `popover`, key column in `accent`, dangerous items `ansi1`), a prompt (420px, 70px from the top), and the all-keys card (max 360px).

## How it behaves

- Follows the focused pane's folder (else the space's folder), on that pane's machine. A mod pane in focus (the Conflicts pane, a diff pane) has no folder: the panel keeps the repo it had in that space. Not in a repo: "Not a git repository: <folder>".
- Refreshes: a local folder watch on the work tree and git dir marks it dirty (checked every 800ms); a full reload at least every 30s; PRs from `gh` every 2 minutes. Ctrl-r forces both.
- Keys: `3 4 5` sections, `h/l` (tab, arrows) previous/next section, `j/k` move, `< >` first/last, `, .` page, `[ ]` switch section tab, `enter` focus the preview (`j/k` then scroll it), `J/K` and `ctrl-d/ctrl-u` scroll the preview, `/` live filter, `x` all actions as a menu, `escape` back out (preview, filter, output, failure), `q` hide the panel, `?` the keys card. Click a row to select, click it again within 400ms for its `space` action.
- Branches: `space` check out (remote: switch to its local or create a tracking one; a branch checked out in another worktree: "Go to its worktree", which selects the space with a terminal in that folder or opens a new space there), `n` new branch, `M` merge menu (ff / --no-ff / --ff-only / --squash), `r` rebase menu (--autostash, --update-refs, --rebase-merges, --autosquash, interactive in a new tab), `f` fast-forward from upstream, `R` rename, `d` delete (local: force only after confirming when not merged and no merged PR; or local + remote), `D` clean up merged/closed/gone branches (keeps HEAD, base, main, master, develop, worktrees, open PRs), `o` open PR, `y` copy name. The `merged` badge needs the branch to be in `git branch --merged <base>` and not sitting exactly on the base commit and not checked out in another worktree (a fresh branch with uncommitted work isn't merged).
- Commits: `s` squash and `f` fixup into the commit below, `r` reword (prompt), `R` reword in your editor (new tab), `d` drop, `A` amend staged changes into it, `e` edit (stop there in a rebase), `a` reset author / set author / add co-author, `F` fixup! commit, `S` autosquash, `ctrl-j/ctrl-k` move down/up, `space` detached checkout, `g` reset soft/mixed/hard, `t` revert, `T` tag, `C` mark for cherry-pick, `V` cherry-pick the marked, `n` new branch, `o` open in browser, `y` copy menu (hash, subject, message, URL, author). `v` or shift-up/down selects a range: then squash, fixup, drop, move, mark or copy hashes for all of them. Rewriting a pushed commit asks first; rewrites only work in the Branch tab and never on merge commits.
- Stash: `space` apply, `g` pop, `d` drop, `n` branch from stash.
- Everywhere: `c` commit menu (commit staged, stage all and commit, amend, or `git commit` in a new tab; the message prompt opens with the repo's saved draft, cursor at the end: esc or a failed commit keeps what was typed, per repo root in shared `git.commitDrafts`, and only a commit that moves HEAD clears it), `P` push (`-u origin HEAD` with no upstream; offers `--force-with-lease` when diverged; refuses when only behind), `p` pull, `f` fetch all, `S` stash all (with optional message), `@` command log (last 20; a running one opens in `terminal.peek`), `m` continue/skip/abort the operation in progress, `v` open the Conflicts pane (also in the `m` menu and the banner; in Commits `v` stays range select), `i` Ask AI.
- One write at a time; a second shows "Wait for the running git command to finish". Click the header's running title to peek at it.
- Ask AI: with conflicts it writes a resolution prompt (files, ours/theirs meaning during a rebase, "don't continue, commit or push"); after a failure it sends the command and its last 300 output lines. A menu offers up to 8 agents in the active space (sent with `hc send`), a new tab of the first installed agent, or Copy prompt. The AI banner then tracks that agent: `working` (`working` color), `blocked` ("needs you", `blocked` color), finished (`ansi2`, "review, then continue (m)"), with Show (`agent.focus`) and Dismiss.
- Conflicts pane: opens only when asked (`v`, Resolve), focused and holding the keyboard; if one is already in the tab it is focused instead. It refreshes every 1.5s and closes itself once no operation is in progress (two looks in a row). It starts on the first file with chunks. Two places, as in lazygit: the file list (`↑↓`/`j k` files, `enter`/`→`/`tab` into the chunks, `r` keep, `d` delete for one-sided files) and the chunks (`←→`/`h l` conflict, `↑↓`/`j k` ours/theirs, `space`/`enter` keep the chosen side, `esc`/`tab` back to the files). Anywhere: `o`/`t`/`b` keep ours/theirs/both, `z` undo, `[ ]` file, `a` Ask AI for this file, `i` for all, `e` editor (new tab, `$VISUAL`/`$EDITOR`/nvim), `c` continue, `A` abort (confirm), `f` Ask AI about the failure, `x` dismiss it, `esc` in the list leaves (`pane.go right`). Clicks select files, conflicts and sides.
  - A pick rewrites the file (`writeTextFile` against the text it read, so an edit elsewhere is caught and reloaded) and keeps an undo stack per file. Picking the last conflict runs `git add` (as lazygit does), marks the file resolved and moves to the next undecided file (wrapping round). `z` on a decided file runs `git checkout -m` to make it conflicted again and writes the earlier picks back. Keep runs `git add`, Delete `git rm`.
  - "Ours" and "theirs" are labelled: during a rebase ours is the upstream being rebased onto and theirs your commit.
  - Ask AI (a / i) writes the conflict prompt for that file or all of them; Ask AI on a failure (f) sends the command, exit code and last 300 lines, noting that a failed `--continue` with everything staged is most likely a commit hook. Both offer the same menu: agents in the space, a new agent tab, Copy prompt.
  - Continue / Skip / Abort run like the panel's writes (a login-shell core terminal, `GIT_EDITOR=true`).
- Pop-out: opens the repo in a tab of its own ("Git · repo", one per space, reused) and hides the side panel; the same button in that tab closes it and brings the panel back.

## Built from

- `update.js`: the self-update pill (the same file in every mod from this repo; `tools/stamp.py` refuses copies that differ). It reads `mod.json` `version` and `source`, fetches the repo's `versions.json` (shared between mods as `herdr-mods.versions`, on start and whenever the panel comes back on screen) and on confirm runs `tab.new` with `claude` in the Herdr home. No `source`: no pill.
- `main.js` (view, keys, actions, rendering), `git.js` (reads and writes), `graph.js` (lane layout and graph cell), `keybar.js` (footer and keys card, shared design with the servers/skills mods), `seq-edit.pl` (a `GIT_SEQUENCE_EDITOR`: `replace` / `swap` / `move` modes driven by `HERDR_MODE`, `HERDR_A`, `HERDR_B`, `HERDR_OP`), `config.json`, icons `fetch.svg pull.svg push.svg popout.svg copy.svg ai.svg`.
- `mod.json`: `{ "place": "none", "title": "Git", "focusable": true, "panel": { "title": "Git", "icon": "git-branch.svg", "leader": "g", "expand": "expand" } }`. `panel` is what tab bars like `pond-tabs` and the `leader` read: button label and icon (in the mod folder), leader key, and the command (`git.expand`) leader `e` sends.
- `panel.js`: where the panel is and showing or closing it there (the same file in every panel mod from this repo; `tools/stamp.py` refuses copies that differ). `q` closes it wherever it is: a popup closes, a focused pane closes, and a layout block hides the node holding its stack (the `panel` column in Herdr's `main` and its copies). No layout ids are assumed.
- `props`: none in a layout block; `{ cwd, on }` pins it to one repo (the expanded tab).
- herdr: `spaces panes focused agents knownAgents exec hc run theme settings props appHome watchFolder nextCommand readTextFile setShared shared`. Commands: `tab.new`, `tab.select`, `tab.close`, `terminal.open`, `terminal.peek`, `agent.focus`, `pane.go`, `pane.focus`, `layout.hide`, `layout.show`, `layout.select`, `git.focus`.
- `nextCommand()`: `focus`, `expand`, `collapse`, `go:<direction>` (left, in the panel: `pane.focus` back to the focused pane, since `pane.go` doesn't reliably move the keyboard out of a panel; in its own tab and other directions `pane.go`; `cmd-alt-arrows` are caught in the key handler and do the same; leaving cancels a pending 150ms focus retry, which also skips once focus has landed), `key:<k>` (bind e.g. `"git.key:P"` in keys.json).
- Shared state: `git.hasKeys`, `git.tabHasKeys` (keyboard ownership, polled every 300ms), `git.tab` (the expanded tab and where it came from).
- Reads: `exec git` with `--no-optional-locks -c core.fsmonitor=false` (so reads don't trigger the watch): `status --porcelain=v2`, `for-each-ref`, `log --topo-order` (400 commits), `stash list`, `show`, plus `sh` reading the git dir for rebase/merge state, and `gh pr list --state all --limit 200`.
- Writes: `hc run --bg --json --no-parent --no-notify --outlive-parent --label herdr.git=run -- $SHELL -lic '<script>'` (login shell so hooks find node/pnpm, `GIT_EDITOR=true`), then `hc wait` in a loop, `hc read --lines 20000`, `hc rm`. Quick local ones (branch rename/delete, reset, tag, stash, add) use `exec sh -c`.
- `config.json`: `editor` (for conflicted files; default `$VISUAL`/`$EDITOR`/`vi`) and lazygit-style `customCommands` (`key` like `<c-p>`, `context` global/localBranches/remoteBranches/commits/stash, `command` with `{{.SelectedLocalBranch.Name}}`-style fields, `output: "terminal"` for a new tab, else the log). It ships one: `ctrl-p` prunes branches whose remote is gone.
- `git-conflicts/`: `main.js` (the pane), `logic.mjs` (pure: `parse` conflict markers incl. diff3 and CRLF, `resolve`, `rows`, `unmerged` from `status --porcelain=v2 -z`, `KINDS`; tested by `test_logic.mjs`), `mod.json` `{ "place": "none", "title": "Conflicts", "focusable": true }`. Props `{ tab, root, gitDir, on }`. herdr: `agents exec hc knownAgents nextCommand panes props readTextFile run settings spaces theme writeTextFile`; commands `pane.close`, `pane.go`, `tab.new`, `terminal.open`.
- The panel opens the pane with gitview's `herdr-gitview json sidebar --tab <tab> --mod git-conflicts --props <json>` (full height at the tab's right edge, as gitview's diff pane), read from `mods/gitview/config.json`; without gitview, `pane.split {direction: "right", mod: "git-conflicts"}`.
- Art: Lucide-style 24px stroke icons; `git-branch.svg` (its tab-bar icon, a copy of Herdr's) in the mod folder; Herdr's shipped `mods/workspace-chrome/git-branch.svg`, `spinner.svg`, `terminal.svg`.

## Watch out

- `place: "none"`: `pond-tabs` adds it to the right-hand panel (see Install); or open it as a pane: `herdr-app do pane.split '{"direction":"right","mod":"git"}'`. `mod.open` does not apply (no overlay in `mod.json`).
- Pop-out hides the panel's column and collapse shows it again wherever the layout has the `git` block (`panel.js`); as a pane, pop-out still opens the tab and collapse just closes it.
- The folder name `git` is hardcoded: icons `mods/git/*.svg`, `${appHome()}/mods/git/config.json`, `${appHome()}/mods/git/seq-edit.pl`, and `tab.new {mod: "git"}`. Rename the folder and these break.
- `gitview` (github.com/ChmaraX/herdr-gitview, not in this repo) is optional: with it, the Conflicts pane opens full height at the tab's right edge like gitview's diff pane; without it, it splits right of the focused pane. The footer copies its look. The `leader` mod in this repo reads `git.hasKeys` and runs `git.expand`/`git.collapse`, but Git works without it.
- Needs `git`, `perl` (commit rewrites), `sh`; `gh` is optional (PR badges, cleanup by PR state). `o` and PR links use macOS `open`. The editor tab runs `nvim` per the shipped config.
- Remote spaces: reads and writes run there, but there is no folder watch (refresh every 30s or ctrl-r) and `seq-edit.pl` is a local path, so commit rewrites fail on remote repos.
- The commit graph must be laid out from parents (no `git log --graph` ASCII) and reuse freed lanes so lines stay vertical. Virtual-list rows can't hold handlers: double-click is two clicks on the same row within 400ms.
- GPUI has no blur event for a focus handle: poll `is_focused()` and redraw only on change.
- Conflicts pane: chunk picks write files on this computer only (`writeTextFile`); for a remote space it points to the editor or AI. A mod's `mod.json` must exist before its folder is first seen, or Herdr docks a copy into the shown layout. Its list rows use the list's `on_item_click`, never per-row handlers (they drew nothing), and one row height (per-row sizes drew nothing). Never use a key event's `cx` after an `await` (wrap the work in `cx.spawn`), or a refresh flag sticks and the pane freezes.
- Diffs are capped at 4000 lines; reads are bounded by exec's 30s limit, writes are not.

## Done when

- `herdr-app check ~/.config/herdr-app/mods/git` passes.
- Split it beside a terminal in a repo: the header shows the branch and ahead/behind; Branches lists local branches with ✓ / ↑↓ / gone badges, and `]` shows remote ones.
- `4` focuses Commits with a line graph and colored hashes; selecting one shows its colored diff; `enter` then `j` scrolls it.
- `c` → `a` → a message commits; the header spinner shows while the hook runs, and `@` lists the command with ✓.
- `c` → `a`, type a message, esc; `c` → `a` again shows the same message. A commit blocked by a failing hook keeps it too; a successful commit clears it.
- `s` on an unpushed commit squashes it into the one below with no editor appearing.
- A rebase with a conflict shows the red banner; `i` offers the space's agents and Copy prompt; `m` → `a` aborts it.
- A failing command shows the failure banner and its output in the preview, selectable and copyable.
- `cd` the terminal into another repo: the panel follows within a second.
- `space` on a branch checked out in another worktree switches to (or opens) that worktree's space; a new branch on the base with only uncommitted work shows no `merged` badge.
- `herdr-app check ~/.config/herdr-app/mods/git-conflicts` passes and `node mods/git-conflicts/test_logic.mjs` prints `ok`.
- Merge a branch that conflicts: the banner offers Resolve (v); `v` opens the Conflicts pane with the keyboard in it, on the first file with chunks; `enter`, `↓`, `space` keeps theirs for the first conflict, the file's count drops, and after the last one the file turns green as `resolved` and is staged. `z` brings it back.
- A file deleted on the other side shows its own changes against the base; `r` keeps it (green, `kept`), `d` deletes it.
- With every file decided, `c` continues; a continue blocked by a failing hook shows the red failure box with the hook's error, and `f` offers to send it to an agent.

## Changes

### 1.2.0 (2026-11-13)

- Works without the `pond` layout: installing it adds a button to the tab bar that opens it in the right-hand panel, next to Herdr's Files and Changes (needs `pond-tabs` as the layout's tab bar; see Install).
- `q` closes it wherever it is (the right-hand column, a pane or a popup) through the shared `panel.js`, instead of assuming `pond`'s ids. Pop-out and collapse find the Git block by mod too.
- `mod.json` declares `"panel"` (leader `g`, and `expand` for leader `e`); its tab-bar icon is now in the mod folder.

### 1.1.2 (2026-11-12)

- The update pill only shows when a newer version is published, and reads "Update available" (the version is in its tooltip); no more "Check for updates" pill while up to date. Each panel checks GitHub when it starts and every time it comes back on screen (shared `update.js`).

### 1.1.1 (2026-11-12)

- `update.js` (shared) can also offer the layout's update; no change in the Git and Conflicts panels' behaviour.

### 1.1.0 (2026-11-12)

- Self-update pill: an "Update to x.y.z" pill appears in the Git (and Conflicts) header when this repo publishes a newer version; confirming starts a Claude tab that updates just this mod.

### 1.0.0 (2026-11-11)

- First versioned release.
- Conflicts pane: chunk picker, hand conflicts to an agent, continue/abort (2026-11-10).
- Go to a branch's worktree from Branches; the merged badge no longer marks fresh branches (2026-11-10).
- Commit message drafts kept per repo until a commit lands (2026-11-09).
