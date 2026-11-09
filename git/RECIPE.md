# Git

A lazygit-style git panel for the repo of the focused terminal. Numbered sections (Branches, Commits, Stash) sit beside a preview of the selected item (a branch's log with a drawn commit graph, a commit's or stash's full diff, or a command's output). Vim-ish keys drive it: check out, merge, rebase, squash, fixup, reword, drop, reorder, cherry-pick, push, pull. Writes run in background herdr-core terminals whose output stays in a copyable log, and a merge or rebase conflict or a failed command (a pre-commit hook, say) can be handed to a coding agent with one key.


**Install:** Point your Herdr agent at this folder: copy `mods/git/` into `~/.config/herdr-app/mods/`, then `herdr-app check ~/.config/herdr-app/mods/git`.

## What you see

Panel: theme `background`, text 12.5px, rounded 10 with a 1px border (`accent` while it has the keyboard, else `border`). Opened as its own tab (expanded), it has no border or radius.

- **Header, 42px**, 1px bottom border: "Git" (semibold 13), repo folder name (`dim`, max 160px), a 12px `git-branch` icon in `accent` and the branch (or `detached @ <7-char sha>`), then `↑n ↓n` in `ansi3` (or `✓` in `ansi2` when in sync), "no upstream" (`dim`) and "N staged · M changed" (`ansi3`). Right side: Fetch, Pull, Push icon buttons (24px high, labels only when the panel is ≥560px wide) and a pop-out button. While a command runs, the buttons are replaced by a spinning 11px spinner and the command's title in `working`.
- **Banners** (8px radius, `surface`, colored border and 7px dot): an operation banner under the header for a rebase/merge/cherry-pick/revert in progress (`ansi1` with conflicts, else `ansi3`; text like "Rebasing feat onto main · 2/5 · 3 conflicts"; buttons Ask AI (i) / Continue / More (m)); an AI banner while an agent works on a hand-off; a failure banner above the footer ("git push failed (exit 1)": Output, Copy, Ask AI (i), ×).
- **Body**, 6px padding and gap. At ≥720px wide: sections on the left (42% of the width, clamped 300-520px), preview on the right. Narrower: sections on top, preview below (38% of the height, at least 160px); with the preview focused, only the preview.
- **Sections**, each a box with an 8px radius and 1px border (`accent` when focused with the keyboard). A 24px head: the number key badge (3, 4, 5), the title, tab pills (Branches: Local / Remote; Commits: Branch / All), the active filter `/text` in `accent`, a count at the right. The focused section grows and scrolls (virtual list, 22px rows); the others show only a few rows around their selection (Branches 5, Commits 6, Stash 2).
  - Branch rows: `*` for HEAD, the name (`accent` semibold for HEAD, `dim` when its PR is merged/closed or its upstream is gone), a PR badge `#12 open` (`ansi2`) / `merged` (`ansi5`) / `closed` (`ansi1`) / `draft` (`dim`), then `gone` (`ansi1`) / `local` (`dim`) / `↑n↓n` (`ansi3`) / `✓` (`ansi2`), a `merged` badge (`ansi5`), a `worktree` badge, on remote rows `local: ✓` (`ansi2`); the relative date at ≥520px.
  - Commit rows: a graph cell drawn from lines (14px per lane, 1.6px lines, rounded fork/merge elbows, 8px dots; 10px hollow ring for merges, a `foreground` ring on HEAD; lane colors cycle `ansi4 ansi5 ansi6 ansi2 ansi3 ansi1 ansi12 ansi13`), the short hash (`ansi1` unpushed, `ansi3` pushed but not in the default branch, `ansi2` merged), `⎘` (`ansi6`) if marked for cherry-pick, up to two ref chips (`→ branch` on `accent`, tags `ansi3`, others `ansi6`) and `+N`, the subject (`muted` once merged), author first name · date at ≥520px.
  - Stash rows: index, message, date.
- **Preview**, a bordered box with a 28px title row. A branch shows its last 200 commits as commit rows. A commit or stash shows `git show --stat --patch` in the mono font at 12px, 18px lines, scrolling both ways: added lines `ansi2` on `ansi2`+`18` alpha, removed `ansi1` likewise, hunks `ansi6` on `raised`, file headers semibold, commit metadata `ansi3`. A command's output shows in a read-only, selectable editor (`$ title`, exit code, output) with Watch (while running), Copy and Ask AI (on failure) buttons.
- **Footer, 28px**: keycap chips for the focused section's own actions (as many as fit), `x actions`, and a `?` keycap at the right. Messages flash there in `accent` for 3.5s.
- Overlays on a `#00000055` scrim: action menus (380px wide, max 520px, `popover`, key column in `accent`, dangerous items `ansi1`), a prompt (420px, 70px from the top), and the all-keys card (max 360px).

## How it behaves

- Follows the focused pane's folder (else the space's folder), on that pane's machine. Not in a repo: "Not a git repository: <folder>".
- Refreshes: a local folder watch on the work tree and git dir marks it dirty (checked every 800ms); a full reload at least every 30s; PRs from `gh` every 2 minutes. Ctrl-r forces both.
- Keys: `3 4 5` sections, `h/l` (tab, arrows) previous/next section, `j/k` move, `< >` first/last, `, .` page, `[ ]` switch section tab, `enter` focus the preview (`j/k` then scroll it), `J/K` and `ctrl-d/ctrl-u` scroll the preview, `/` live filter, `x` all actions as a menu, `escape` back out (preview, filter, output, failure), `q` hide the panel, `?` the keys card. Click a row to select, click it again within 400ms for its `space` action.
- Branches: `space` check out (remote: switch to its local or create a tracking one), `n` new branch, `M` merge menu (ff / --no-ff / --ff-only / --squash), `r` rebase menu (--autostash, --update-refs, --rebase-merges, --autosquash, interactive in a new tab), `f` fast-forward from upstream, `R` rename, `d` delete (local: force only after confirming when not merged and no merged PR; or local + remote), `D` clean up merged/closed/gone branches (keeps HEAD, base, main, master, develop, worktrees, open PRs), `o` open PR, `y` copy name.
- Commits: `s` squash and `f` fixup into the commit below, `r` reword (prompt), `R` reword in your editor (new tab), `d` drop, `A` amend staged changes into it, `e` edit (stop there in a rebase), `a` reset author / set author / add co-author, `F` fixup! commit, `S` autosquash, `ctrl-j/ctrl-k` move down/up, `space` detached checkout, `g` reset soft/mixed/hard, `t` revert, `T` tag, `C` mark for cherry-pick, `V` cherry-pick the marked, `n` new branch, `o` open in browser, `y` copy menu (hash, subject, message, URL, author). `v` or shift-up/down selects a range: then squash, fixup, drop, move, mark or copy hashes for all of them. Rewriting a pushed commit asks first; rewrites only work in the Branch tab and never on merge commits.
- Stash: `space` apply, `g` pop, `d` drop, `n` branch from stash.
- Everywhere: `c` commit menu (commit staged, stage all and commit, amend, or `git commit` in a new tab; the message prompt opens with the repo's saved draft, cursor at the end: esc or a failed commit keeps what was typed, per repo root in shared `git.commitDrafts`, and only a commit that moves HEAD clears it), `P` push (`-u origin HEAD` with no upstream; offers `--force-with-lease` when diverged; refuses when only behind), `p` pull, `f` fetch all, `S` stash all (with optional message), `@` command log (last 20; a running one opens in `terminal.peek`), `m` continue/skip/abort the operation in progress, `i` Ask AI.
- One write at a time; a second shows "Wait for the running git command to finish". Click the header's running title to peek at it.
- Ask AI: with conflicts it writes a resolution prompt (files, ours/theirs meaning during a rebase, "don't continue, commit or push"); after a failure it sends the command and its last 300 output lines. A menu offers up to 8 agents in the active space (sent with `hc send`), a new tab of the first installed agent, or Copy prompt. The AI banner then tracks that agent: `working` (`working` color), `blocked` ("needs you", `blocked` color), finished (`ansi2`, "review, then continue (m)"), with Show (`agent.focus`) and Dismiss.
- Pop-out: opens the repo in a tab of its own ("Git · repo", one per space, reused) and hides the side panel; the same button in that tab closes it and brings the panel back.

## Built from

- `main.js` (view, keys, actions, rendering), `git.js` (reads and writes), `graph.js` (lane layout and graph cell), `keybar.js` (footer and keys card, shared design with the servers/skills mods), `seq-edit.pl` (a `GIT_SEQUENCE_EDITOR`: `replace` / `swap` / `move` modes driven by `HERDR_MODE`, `HERDR_A`, `HERDR_B`, `HERDR_OP`), `config.json`, icons `fetch.svg pull.svg push.svg popout.svg copy.svg ai.svg`.
- `mod.json`: `{ "place": "none", "title": "Git", "focusable": true }`.
- `props`: none in a layout block; `{ cwd, on }` pins it to one repo (the expanded tab).
- herdr: `spaces panes focused agents knownAgents exec hc run theme settings props appHome watchFolder nextCommand readTextFile setShared shared`. Commands: `tab.new`, `tab.select`, `tab.close`, `terminal.open`, `terminal.peek`, `agent.focus`, `pane.go`, `pane.focus`, `layout.hide`, `layout.show`, `layout.select`, `git.focus`.
- `nextCommand()`: `focus`, `expand`, `collapse`, `go:<direction>`, `key:<k>` (bind e.g. `"git.key:P"` in keys.json).
- Shared state: `git.hasKeys`, `git.tabHasKeys` (keyboard ownership, polled every 300ms), `git.tab` (the expanded tab and where it came from).
- Reads: `exec git` with `--no-optional-locks -c core.fsmonitor=false` (so reads don't trigger the watch): `status --porcelain=v2`, `for-each-ref`, `log --topo-order` (400 commits), `stash list`, `show`, plus `sh` reading the git dir for rebase/merge state, and `gh pr list --state all --limit 200`.
- Writes: `hc run --bg --json --no-parent --no-notify --outlive-parent --label herdr.git=run -- $SHELL -lic '<script>'` (login shell so hooks find node/pnpm, `GIT_EDITOR=true`), then `hc wait` in a loop, `hc read --lines 20000`, `hc rm`. Quick local ones (branch rename/delete, reset, tag, stash, add) use `exec sh -c`.
- `config.json`: `editor` (for conflicted files; default `$VISUAL`/`$EDITOR`/`vi`) and lazygit-style `customCommands` (`key` like `<c-p>`, `context` global/localBranches/remoteBranches/commits/stash, `command` with `{{.SelectedLocalBranch.Name}}`-style fields, `output: "terminal"` for a new tab, else the log). It ships one: `ctrl-p` prunes branches whose remote is gone.
- Art: Lucide-style 24px stroke icons; uses Herdr's shipped `mods/workspace-chrome/git-branch.svg`, `spinner.svg`, `terminal.svg`.

## Watch out

- `place: "none"`: nothing shows it by default. Show it with a layout block `{ "content": { "mod": "git" } }` (it was built for a hidden right-hand `panel` column with a `panel-body` stack, as in the `my-main` layout), or as a pane: `herdr-app do pane.split '{"direction":"right","mod":"git"}'`. `mod.open` does not apply (no overlay in `mod.json`).
- `q`, pop-out and collapse assume layout ids `panel` and stack `panel-body` with a child `git`. Elsewhere `q` and collapse's panel steps do nothing useful; pop-out still opens the tab.
- The folder name `git` is hardcoded: icons `mods/git/*.svg`, `${appHome()}/mods/git/config.json`, `${appHome()}/mods/git/seq-edit.pl`, and `tab.new {mod: "git"}`. Rename the folder and these break.
- No dependency on `gitview` (github.com/ChmaraX/herdr-gitview, not in this repo): it is only mentioned in comments and the footer copies its look. The `leader` mod in this repo reads `git.hasKeys` and runs `git.expand`/`git.collapse`, but Git works without it.
- Needs `git`, `perl` (commit rewrites), `sh`; `gh` is optional (PR badges, cleanup by PR state). `o` and PR links use macOS `open`. The editor tab runs `nvim` per the shipped config.
- Remote spaces: reads and writes run there, but there is no folder watch (refresh every 30s or ctrl-r) and `seq-edit.pl` is a local path, so commit rewrites fail on remote repos.
- The commit graph must be laid out from parents (no `git log --graph` ASCII) and reuse freed lanes so lines stay vertical. Virtual-list rows can't hold handlers: double-click is two clicks on the same row within 400ms.
- GPUI has no blur event for a focus handle: poll `is_focused()` and redraw only on change.
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
