# Remote Checker

A panel showing the GitHub pull request for the branch checked out in the focused terminal: its CI checks, reviewers, review threads and comments, diff size, commit count and when it was published. A GitHub-style summary card gives the headline ("All checks have passed", "Some checks haven't completed yet", "Some checks were not successful") with three bars for Checks, Comments and Approvals. It follows you between spaces and repos, refetches every 10s while it's showing, and has a refresh button.

**Install:** Point your Herdr agent at this folder: copy `mods/remote-checker/` into `~/.config/herdr-app/mods/`, then `herdr-app check ~/.config/herdr-app/mods/remote-checker`. Needs `gh` installed and logged in (`gh auth login`).

**Version:** 1.0.0 (see Changes at the end; also `"version"` in `mod.json`).

**Update:** tell your Herdr agent "update my herdr mods" (or "update pond mods"). It follows `UPDATE.md`, installed in the mod folder, which checks this repo's `versions.json` and offers every newer version of the mods and layouts you have from here, with a backup of each. By hand: replace `mods/remote-checker/` with this folder's copy (asking an agent to *install* it again adds a second copy instead). Your settings and data live outside the mod folder and are kept; edits you made inside the mod folder are not.

## What you see

Panel: theme `background`, text 13px, rounded 10 with a 1px border (`accent` while it has the keyboard, else `border`).

- **Header, 42px**, 1px bottom border: a pull-request icon in `accent`, "Remote Checker" (semibold), "checked 12s ago" / "fetching…" (11px, `dim`), then 26px icon buttons: open on GitHub (external-link, only with a PR) and refetch (a circular arrow, a spinning ring while fetching).
- **Branch line, 28px**: `git-branch` icon in `accent`, the branch, `→`, the repo (`owner/name`); a red "stale" on the right (tooltip: the error) when the last refetch failed and the shown PR is from before.
- **List** (scrolls with the wheel; a 3px `border` thumb on the right when it overflows), rows 10px in from the sides:
  - **PR card** (140px, `surface`, 9px radius, 12px padding): a state pill (Open `ansi2`, Draft `raised`/`muted`, Merged `ansi5`, Closed `ansi1`), `#1234` in mono `dim`, `main ← my-branch`; the title (13.5px semibold, one line); `@author · published 3h ago · updated 1h ago` (or `merged …`); then in mono 12px `+2,239` (`ansi2`) `−369` (`ansi1`) `51 files` `8 commits`, and on the right `↑2 unpushed` (`ansi3`) / `↓1 behind` (`ansi4`) when the local branch differs from its upstream.
  - **Summary card** (146px): a 34px round `raised` badge with a check (`ansi2`), an x (`ansi1`), a spinning ring (`ansi3`) or a minus (`dim`, no checks); the headline (13px semibold); "4 pending, 9 successful checks." (`muted`); the merge state and review decision ("Merging is blocked · review required"). Below, three equal columns split by 1px borders, each a label + note and an 8px rounded bar:
    - **Checks** `9/13` or `2 req. pending` / `1 req. failing` (red): green passed+skipped, pending `ansi3` pulsing, failed `ansi1`.
    - **Comments** `2 open` / `resolved`: green resolved review threads, `ansi3` unresolved.
    - **Approvals** `1 pending` / `2 approved` / `1 changes` (red): green approved, red changes requested, `dim` waiting.
    - An empty bar is a `raised` track with a `border` outline.
  - **Sections**: an uppercase 11px `muted` title with a count and a rule: CHECKS `9/13`, REVIEWERS `3`, COMMENTS `2 unresolved`. Rows (12.5px, 7px radius, `hover`; the selected one `selected`, with a 2px `accent` left edge when the panel has the keyboard):
    - Check (30px): check / x / spinning ring / minus icon by outcome, `workflow / name`, "required" (10.5px `dim`). Failing first, then pending, passed, skipped; required before optional.
    - Reviewer (30px): icon + login (teams as `team: name`) + state: "approved · 2h ago" (`ansi2`), "changes requested" (`ansi1`), "commented" (`muted`), "awaiting review" / "re-requested" (`ansi3`), "dismissed" (`dim`). The PR author is left out.
    - Comment (50px): author (semibold), `dir/file.ts` or "conversation", `· 2 replies`, a tag "unresolved" (`ansi3`) / "outdated" (`dim`) / "resolved" (`ansi2`), age; under it the first readable line of the comment (HTML, markdown headings, links and badges stripped). Unresolved review threads first, then the conversation, then resolved threads, each newest first.
- **Messages** instead of the list (centred, PR icon): "No terminal focused", "Looking for the pull request…", "Not a git repository", "Detached HEAD", "<branch> isn't pushed", "No pull request for this branch", "Couldn't reach GitHub" (with gh's error).
- **Footer, 28px**: keycap chips (open, refetch, move, PR, copy, section) and a `?` keycap for the all-keys card.

## How it behaves

- Which PR: the active space's focused terminal folder (`focused()` pane's `cwd`, else the space's folder) and its branch's upstream (`@{u}`). `gh pr view` finds the PR for that branch (re-looked-up at most once a minute, or on `r`); a branch without an upstream says it isn't pushed.
- A 400ms timer watches the focused folder/branch and whether the panel shows (`panel` not hidden and `panel-body` on `remote`, or anywhere else it's placed): a change, or the panel coming into view, fetches at once. While showing it refetches every 10s; while hidden it doesn't fetch. A result for another folder is never shown for this one ("Looking…" until it loads).
- A failed refetch keeps the last good PR on screen, marked stale.
- Keys: `j`/`k` (or arrows) move between selectable rows (the PR card, the summary card, checks, reviewers, comments), `gg`/`G` top/bottom (also `<`/`>`, home/end), `ctrl-d`/`ctrl-u` six rows, `]`/`[` next / previous section, `enter`/`o`/`l` open the selected row in the browser (a check's details, a review, a comment, the PR, the PR's checks tab), `O` open the PR, `y` copy the selected row's link (a flash in the footer), `r` refetch, `h`/`←` or `escape` give the keyboard back to the terminal, `q` hide the panel and give the keyboard back, `?` the keys card (`escape`, `?` or `q` closes it). Double-click opens a row; click selects.
- Leaving: `cmd-alt-left` (a `pane.go:left` key) and the leader's `h` (`remote-checker.go:left`) go straight back to the focused pane with `pane.focus` rather than `pane.go`; other directions use `pane.go`.
- Selection keeps its row in view; the section header above a section's first item stays visible too.

## Built from

- `main.js` (all logic and rendering), `keybar.js` (footer keycaps and keys card, the same file as the servers, todos and skills mods), icons `pr.svg comment.svg dot.svg ring.svg minus.svg check.svg x.svg external.svg`.
- `mod.json`: `{ "place": "none", "title": "Remote Checker", "focusable": true }`. No `props`.
- herdr: `exec theme settings run nextCommand focused panes spaces layout setShared home`. Commands: `layout.hide`, `pane.focus`, `pane.go`.
- `nextCommand()`: `focus`, `go:<direction>`, `key:<k>` (e.g. `"remote-checker.key:r"` in keys.json), `refresh`. Shared: `remote-checker.hasKeys` (keyboard ownership, polled every 300ms, read by the `leader` mod).
- Programs (with `on: space.machine`, so a remote space asks its own machine): one `sh -c` running `git branch --show-current`, `git rev-parse HEAD`, `git rev-parse --abbrev-ref --symbolic-full-name @{u}`, `git rev-list --left-right --count HEAD...@{u}`, `git remote get-url <branch remote>`; `gh pr view --json number,url`; `gh api graphql` with one query: the PR's title, state, draft, dates (`publishedAt`), author, base/head, additions/deletions/changedFiles, `reviewDecision`, `mergeable`, `mergeStateStatus`, `commits(last:1)` with `statusCheckRollup.contexts(first:100)` (CheckRun name/status/conclusion/detailsUrl/workflow, StatusContext context/state/targetUrl, both `isRequired(pullRequestNumber:)`), `reviewRequests`, `latestReviews`, `comments(last:20)`, `reviewThreads(first:100)` with their first comment. `open` for links, `pbcopy` for copy.
- Rows are drawn by hand, each with a fixed height, in an `overflow_hidden` box shifted up by the scroll offset; the wheel and the selection move that offset.
- Art: Lucide-style 24px stroke icons; Herdr's shipped `mods/workspace-chrome/spinner.svg` and `git-branch.svg`; the refresh icon is `mods/servers/restart.svg` (from this repo's `servers`).

## Watch out

- `place: "none"`: nothing shows it by default. It was built as the `remote` child of the `pond` layout's right-hand `panel-body` stack: `{ "id": "remote", "type": "block", "content": { "mod": "remote-checker" } }`. Its "only fetch while showing" check uses those ids (`panel`, `panel-body`, child `remote`); placed anywhere else (a pane, another layout) it counts as always showing. `q` hides the layout node `panel`.
- Never start a fetch from `render()`: it calls `cx.notify()`, which throws during render and left the fetch flag stuck ("fetching…" forever) in the first build. Fetches start from timers and handlers only.
- `panes()` entries are keyed `pane`, not `id`.
- A `v_virtual_list` here drew nothing at all (it sizes itself from its first row), so the list scrolls by hand. `Background.pattern_slash` can't go to `.bg()` (canvas paint only), so empty bars aren't hatched like GitHub's.
- The focus retry (`focus` → refocus after 150ms if not focused) is cancelled once focus lands or the panel is left; without that, leaving quickly snapped the keyboard back.
- The refresh icon comes from `mods/servers/`; without the `servers` mod, copy any refresh SVG to `mods/remote-checker/` and point to it.
- `gh` must be on the PATH Herdr's `exec` sees and logged in; GitHub only (the PR link must be `github.com/<owner>/<repo>/pull/<n>`). GraphQL costs ~1 point a query: 360/hour while showing, well under the limit.
- At most 100 checks, 100 review threads and the last 20 conversation comments are read; reviewers and requested reviewers 30 each.
- `open` and `pbcopy` are macOS-only.

## Done when

- `herdr-app check ~/.config/herdr-app/mods/remote-checker` passes.
- In a space whose terminal is on a pushed branch with an open PR, the panel shows its number, title, `+/−`, files and commits, the right headline and bars, and every check, reviewer and review thread GitHub shows.
- Switching to a space in another repo shows "Looking for the pull request…", then that repo's PR (or the right message) within a couple of seconds; a non-repo folder says "Not a git repository".
- "checked …" stays under ~10s while the panel shows; the refresh button and `r` spin the ring and refetch.
- `j`/`k`, `gg`/`G`, `]`/`[` move the selection and keep it in view; `enter` opens the selected check's CI page; `y` copies a link.
- `h`, `escape`, `cmd-alt-left` and leader `h` give the keyboard back to the terminal and it stays there; `q` hides the panel.
- A local commit not yet pushed shows `↑1 unpushed` on the PR card.

## Changes

### 1.0.0 (2026-11-11)

- First versioned release: the focused branch's GitHub PR, checks, reviews and comments (2026-11-09).
