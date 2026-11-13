# Remote Checker

A panel showing the GitHub pull request for the branch checked out in the focused terminal: its CI checks, reviewers, review threads and comments, diff size, commit count and when it was published. A GitHub-style summary card gives the headline ("All checks have passed", "Some checks haven't completed yet", "Some checks were not successful") with three bars for Checks, Comments and Approvals. It follows you between spaces and repos, refetches every 10s while it's showing, and has a refresh button.

Four tabs, remembered per space: **Active** (that context-aware view), and gh-dash style lists in the space's base repo: **Mine** (your open PRs), **Review** (open PRs waiting for your review) and **Search** (any PR, GitHub search syntax). The base repo is the focused terminal's GitHub repo unless you pick another for the space. Enter on a list row opens the same detailed view; escape goes back to the list.

An avatar in the header switches the GitHub account per space (only for this panel: `gh` and `git` in your terminals keep `gh`'s active account) and signs in more accounts. Without `gh`, or signed out, the panel shows a setup screen that installs the GitHub CLI (Homebrew, or the official release into `~/.local/bin` when there's no Homebrew) and signs you in.

**Install:** tell your Herdr agent "Install the Herdr mod at
https://github.com/SimonBystromTableCheck/herdr-mods/tree/main/remote-checker". You get a **PR** button in the tab bar that opens it in the right-hand panel,
next to Herdr's Files and Changes. You don't need the `pond` layout. Uses the GitHub CLI (`gh`); if it's missing or signed out, the panel's own setup screen installs it and signs you in. What the agent does:

1. Copy `mods/remote-checker/` into `~/.config/herdr-app/mods/` and run `herdr-app check ~/.config/herdr-app/mods/remote-checker`.
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
4. Within a few seconds the tab bar adds `{ "id": "remote-checker", "type": "block", "content": { "mod": "remote-checker" } }`
   to the layout's `panel-body` stack (the right-hand `panel` column Herdr's `main` and its copies
   have) and shows the button. Check with `herdr-app status` and tell the person where it is.
5. Optional: with this repo's `leader` installed, `ctrl-a` then its key opens it too.

Without changing the tab bar, it also opens beside a terminal:
`herdr-app do pane.split --direction right --mod remote-checker` (`q` closes that pane).

**Version:** 1.3.0 (see Changes at the end; also `"version"` in `mod.json`).

**Update:** from 1.1.0, its header has a "Check for updates" pill that turns into "Update to x.y.z" when this repo publishes a newer version; click it, confirm, and a new Claude tab updates just this mod (following `UPDATE.md`). Or tell your Herdr agent "update my herdr mods" (or "update pond mods"). It follows `UPDATE.md`, installed in the mod folder, which checks this repo's `versions.json` and offers every newer version of the mods and layouts you have from here, with a backup of each. By hand: replace `mods/remote-checker/` with this folder's copy (asking an agent to *install* it again adds a second copy instead). Your settings and data live outside the mod folder and are kept; edits you made inside the mod folder are not.

## What you see

Panel: theme `background`, text 13px, rounded 10 with a 1px border (`accent` while it has the keyboard, else `border`).

- **Header, 42px**, 1px bottom border: a pull-request icon in `accent`, "Remote Checker" (semibold), "checked 12s ago" / "fetching…" (11px, `dim`), then 26px icon buttons: open on GitHub (external-link, only with a PR) and refetch (a circular arrow, a spinning ring while fetching), then the account avatar: a 22px circle with the account's initials (from its GitHub name, else the capitals of its login) on a color picked from the login (`ansi1`–`ansi6`), `selected` behind it while its menu is open; tooltip `GitHub: <login> (this space)` or `(gh's active account)`.
- **Account menu** (`a` or the avatar): a 280px `popover` card under the header's right end, "GitHub account for <space>", a `dim` line saying only this panel uses it, then a 36px row per account `gh` has for github.com: a 24px avatar, the login, and its name / "gh's active account · follows it" / "signed out: sign in again" (`ansi1`), a ✓ in `accent` on this space's account (row `selected`). A rule, then "Sign in to another account…" with a round `+`. Clicking outside or escape closes it.
- **Setup** (instead of everything below the tab bar while `gh` is missing or has no account; laid out like `pond-profiles`' setup): "Set up GitHub for Remote Checker" (15px semibold) and a `dim` line, then a card per step (8px radius, `border`, numbered 18px circle with an `accent` border; a green ✓ when done): **GitHub CLI (gh)** with "Install GitHub CLI" (primary; "Installing…" with a spinner while it runs; the last lines of a failure in `ansi1`) and, without Homebrew, "Other ways"; a yellow note when `gh` landed in `~/.local/bin` but that isn't on PATH. **Sign in to GitHub** with "Sign in" (disabled until `gh` is there; "Waiting for sign-in…" while its tab is open). A bottom line with "Check again".
- **Tab bar, 34px**, 1px bottom border: `Active` `Mine` `Review` `Search` (26px, 12px text; the current one `selected`/`foreground`, others `muted`; Mine and Review show their loaded count in 10.5px `dim`), then on the right the base repo chip (11.5px `muted`, `owner/repo` when the panel is 560px+ wide, else just `repo`, then a chevron; a 5px `accent` dot when the space has its own pick; `ansi3` "Pick a repo" when there's none).
- **Search line, 36px** (Search tab): a search icon and the query in mono 11.5px (click or `/` to edit: a mono input with an `accent` border; enter saves it), and on the right "2 results" / "50 of 1,204" in `dim`.
- **Back line, 30px** (a PR opened from a list): a chevron, the list's name (`Search`), `owner/repo #123` in `dim`; click or escape goes back.
- **List rows** (Mine, Review, Search): at 560px+ wide one 34px line of columns: a PR icon colored by state (open `ansi2`, draft `dim`, merged `ansi5`, closed `ansi1`), `#123` mono `dim`, the title, author, a CI icon (check `ansi2`, x `ansi1`, spinning ring `ansi3`, minus `dim`), the review decision ("approved" `ansi2`, "changes" `ansi1`, "review" `ansi3`, "draft" `dim`), `+12 −3` mono, and the age. Narrower, two lines in 54px: `#123` title age, then `@author`, CI icon, review, `+12 −3`, "4 comments". Selection and hover look like the detail rows.
- **Repo picker** (`b` or the chip): a card over the panel, "Repo for <space>", a line saying Active still follows the terminal, a mono input ("Filter, or type owner/repo"), and up to 12 rows: the focused terminal's repo ("follows it": picking it clears the space's own pick), the space's current pick, repos picked before, each space's repo (`space: <name>`, from its first terminal's live folder), repos seen in terminals, and your 40 most recently pushed GitHub repos ("on GitHub"). A typed `owner/repo` that isn't listed comes first ("use this repo").
- **Branch line, 28px** (Active tab): `git-branch` icon in `accent`, the branch, `→`, the repo (`owner/name`); a red "stale" on the right (tooltip: the error) when the last refetch failed and the shown PR is from before.
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
- **Messages** instead of the list (centred, PR icon): "Checking the GitHub CLI…" (first start), "No terminal focused", "Looking for the pull request…", "Not a git repository", "Detached HEAD", "<branch> isn't pushed", "No pull request for this branch", "Couldn't reach GitHub" (with gh's error).
- **Footer, 28px**: keycap chips (open, refetch, move, PR, copy, section) and a `?` keycap for the all-keys card.

## How it behaves

- Which PR: the active space's focused terminal folder (`focused()` pane's `cwd`, else the space's folder) and its branch's upstream (`@{u}`). `gh pr view` finds the PR for that branch (re-looked-up at most once a minute, or on `r`); a branch without an upstream says it isn't pushed.
- A 400ms timer watches the focused folder/branch and whether the panel shows (`panel.js` `panelOnScreen`: nothing hidden on the way to its layout block and each stack on it; as a pane it counts as always showing): a change, or the panel coming into view, fetches at once. While showing it refetches every 10s; while hidden it doesn't fetch. A result for another folder is never shown for this one ("Looking…" until it loads).
- A failed refetch keeps the last good PR on screen, marked stale.
- The list tabs: one GitHub search each (`gh api graphql`, `search(type: ISSUE, first: 50)`), `repo:<base> is:pr` plus `is:open author:@me` (Mine), `is:open review-requested:@me` (Review) or the space's query (Search, default `is:open`), sorted `updated-desc` unless the query has a `sort:`. Fetched when the tab, base or query changes or the panel comes into view, then every 30s while it shows. Runs `gh` on this computer (GitHub is the same from every machine).
- The base repo: the space's own pick, else the focused terminal's repo (its branch's remote, else `origin`, re-read every 60s). Picking a repo from the Active tab switches to Mine.
- Per space, saved in `~/.config/herdr-app/remote-checker.json`: `{ "spaces": { "<space id>": { "tab", "base", "query", "account" } }, "recent": [...], "names": { "<login>": "<name>" } }`. Switching spaces shows that space's tab, repo and query.
- A PR opened from a list stays on screen (refetched every 10s) while you move between terminals, until escape or backspace.
- GitHub account: on start and every 60s while showing, `gh --version` (else `~/.local/bin/gh`) and `gh auth status --hostname github.com --json hosts` (older `gh`: its text) list the accounts. A space's pick (`account` in `remote-checker.json`) applies while `gh` still has it signed in; picking `gh`'s active account clears the pick, so the space follows `gh`. With a pick, every `gh` call runs as `sh -c 'GH_TOKEN=$(gh auth token --user <login>) … exec gh …'`: the token goes through the environment, never argv, and `gh`'s active account isn't touched. Switching drops what was fetched as the old account and refetches; list results are cached per account. Remote spaces' `gh pr view` runs on their machine with its own login (the pick is for this computer).
- Names for initials: `gh api user` once per account, kept in `remote-checker.json` (`names`).
- Setup shows while `gh` is missing or has no github.com account; nothing is fetched meanwhile. Install runs in the background (up to 10 minutes): `brew install gh` when `brew` is there, else `install-gh.sh`: the latest release (tag from the `releases/latest` redirect, no API rate limit) for `uname -s`/`-m` (macOS or Linux, arm64 or amd64), checked against the release's `gh_<v>_checksums.txt` (SHA-256), installed to `~/.local/bin/gh`. Sign in opens a tab (`tab.new`) running `gh auth login --hostname github.com --web` (it needs enter and the browser). While an install or sign-in is pending the panel rechecks every 3s for up to 10 minutes. `gh auth login` makes the new account `gh`'s active one: the panel switches it back (`gh auth switch`) to the one that was active, and an account added from the menu becomes that space's pick.
- Keys: `j`/`k` (or arrows) move between selectable rows (the PR card, the summary card, checks, reviewers, comments), `gg`/`G` top/bottom (also `<`/`>`, home/end), `ctrl-d`/`ctrl-u` six rows, `]`/`[` next / previous section, `enter`/`o`/`l` open the selected row in the browser (a check's details, a review, a comment, the PR, the PR's checks tab), `O` open the PR, `y` copy the selected row's link (a flash in the footer), `r` refetch, `a` the account menu, `h`/`←` or `escape` give the keyboard back to the terminal, `q` hide the panel and give the keyboard back, `?` the keys card (`escape`, `?` or `q` closes it). Double-click opens a row; click selects.
- Leaving: `cmd-alt-left` (a `pane.go:left` key) and the leader's `h` (`remote-checker.go:left`) go straight back to the focused pane with `pane.focus` rather than `pane.go`; other directions use `pane.go`.
- Selection keeps its row in view; the section header above a section's first item stays visible too.

## Built from

- Tabs, lists and the picker: `TABS`, `SEARCH` (the list query), `shapeItem`, `listItem`, `tabsBar`, `searchBar`, `backBar`, `pickerView` in `main.js`; `view()` is what the detail rows draw (Active's PR, or the one opened from a list), `fetchPr` loads one PR's details for both. Text fields are `InputState` + `Input` from `gpui-base`; `readTextFile` / `writeTextFile` for `remote-checker.json`.
- Accounts and setup: `accounts.js` (`gh` runs every call as the space's account, `checkAuth`, `installGh`, `startSignIn`, `avatar`, `setupView`, `accountMenu`) and `install-gh.sh` (the no-Homebrew installer); in `main.js` `account()`, `needsSetup()`, `loadAuth`, `watchAuth`, `pickAccount`. Command `remote-checker.accounts` opens the menu.
- `update.js`: the self-update pill (the same file in every mod from this repo; `tools/stamp.py` refuses copies that differ). It reads `mod.json` `version` and `source`, fetches the repo's `versions.json` (shared between mods as `herdr-mods.versions`, on start and whenever the panel comes back on screen) and on confirm runs `tab.new` with `claude` in the Herdr home. No `source`: no pill.
- `main.js` (all logic and rendering), `keybar.js` (footer keycaps and keys card, the same file as the servers, todos and skills mods), icons `pr.svg comment.svg dot.svg ring.svg minus.svg check.svg x.svg external.svg`.
- `mod.json`: `{ "place": "none", "title": "Remote Checker", "focusable": true, "panel": { "title": "PR", "icon": "pr.svg", "leader": "P" } }`. No `props`. `panel` is what `pond-tabs` (button label and icon) and the `leader` (key) read.
- `panel.js`: where the panel is and showing or closing it there (the same file in every panel mod from this repo; `tools/stamp.py` refuses copies that differ). `q` closes it wherever it is: a popup closes, a focused pane closes, and a layout block hides the node holding its stack (the `panel` column in Herdr's `main` and its copies). No layout ids are assumed.
- herdr: `exec theme settings run nextCommand focused panes spaces setShared home` (`layout`, `closeOverlay`, `props` through `panel.js`). Commands: `tab.new` (sign-in), `layout.hide`, `pane.close`, `pane.focus`, `pane.go`.
- `nextCommand()`: `focus`, `go:<direction>`, `key:<k>` (e.g. `"remote-checker.key:r"` in keys.json), `refresh`. Shared: `remote-checker.hasKeys` (keyboard ownership, polled every 300ms, read by the `leader` mod).
- Programs (with `on: space.machine`, so a remote space asks its own machine): one `sh -c` running `git branch --show-current`, `git rev-parse HEAD`, `git rev-parse --abbrev-ref --symbolic-full-name @{u}`, `git rev-list --left-right --count HEAD...@{u}`, `git remote get-url <branch remote>`; `gh pr view --json number,url`; `gh api graphql` with one query: the PR's title, state, draft, dates (`publishedAt`), author, base/head, additions/deletions/changedFiles, `reviewDecision`, `mergeable`, `mergeStateStatus`, `commits(last:1)` with `statusCheckRollup.contexts(first:100)` (CheckRun name/status/conclusion/detailsUrl/workflow, StatusContext context/state/targetUrl, both `isRequired(pullRequestNumber:)`), `reviewRequests`, `latestReviews`, `comments(last:20)`, `reviewThreads(first:100)` with their first comment. `open` for links, `pbcopy` for copy.
- Rows are drawn by hand, each with a fixed height, in an `overflow_hidden` box shifted up by the scroll offset; the wheel and the selection move that offset.
- Art: Lucide-style 24px stroke icons; Herdr's shipped `mods/workspace-chrome/spinner.svg` and `git-branch.svg`; the refresh icon is its own `restart.svg`.

## Watch out

- `place: "none"`: `pond-tabs` adds it to the right-hand panel (see Install; in `pond` its child id is `remote`, elsewhere `remote-checker`). Its "only fetch while showing" check finds its block by mod, not by id; as a pane it counts as always showing.
- Never start a fetch from `render()`: it calls `cx.notify()`, which throws during render and left the fetch flag stuck ("fetching…" forever) in the first build. Fetches start from timers and handlers only.
- `panes()` entries are keyed `pane`, not `id`.
- A `v_virtual_list` here drew nothing at all (it sizes itself from its first row), so the list scrolls by hand. `Background.pattern_slash` can't go to `.bg()` (canvas paint only), so empty bars aren't hatched like GitHub's.
- The focus retry (`focus` → refocus after 150ms if not focused) is cancelled once focus lands or the panel is left; without that, leaving quickly snapped the keyboard back.
- The refresh icon comes from `mods/servers/`; without the `servers` mod, copy any refresh SVG to `mods/remote-checker/` and point to it.
- `gh` is looked up on the PATH Herdr's `exec` sees, then in `~/.local/bin`; GitHub only (the PR link must be `github.com/<owner>/<repo>/pull/<n>`). GraphQL costs ~1 point a query: 360/hour while showing, well under the limit.
- At most 100 checks, 100 review threads and the last 20 conversation comments are read; reviewers and requested reviewers 30 each.
- `open` and `pbcopy` are macOS-only. `install-gh.sh` needs `curl` and `unzip` (macOS) or `tar` (Linux).
- `exec` has no `env` option, so per-account calls go through `sh -c`; `gh auth login` can't run through `exec` (it prompts), so it gets a tab.

## Done when

- `herdr-app check ~/.config/herdr-app/mods/remote-checker` passes.
- The avatar shows your initials; `a` lists every account `gh auth status` shows, and picking another one for a space makes Mine list that account's PRs there while `gh auth status` in a terminal still shows the old active account.
- With `gh` missing (or `GH_CONFIG_DIR` pointing at an empty folder), the panel shows the setup steps instead of an error, and finishing them shows the PR without a restart.
- `2` in a space whose terminal is in a GitHub repo lists your open PRs there; `4` with `is:merged` lists merged ones; enter opens one in the detailed view and escape goes back to the list with the same row selected.
- `b` lists the spaces' repos and your GitHub repos; picking one changes the chip (with an accent dot) for that space only, and survives a restart (`remote-checker.json`).
- In a space whose terminal is on a pushed branch with an open PR, the panel shows its number, title, `+/−`, files and commits, the right headline and bars, and every check, reviewer and review thread GitHub shows.
- Switching to a space in another repo shows "Looking for the pull request…", then that repo's PR (or the right message) within a couple of seconds; a non-repo folder says "Not a git repository".
- "checked …" stays under ~10s while the panel shows; the refresh button and `r` spin the ring and refetch.
- `j`/`k`, `gg`/`G`, `]`/`[` move the selection and keep it in view; `enter` opens the selected check's CI page; `y` copies a link.
- `h`, `escape`, `cmd-alt-left` and leader `h` give the keyboard back to the terminal and it stays there; `q` hides the panel.
- A local commit not yet pushed shows `↑1 unpushed` on the PR card.

## Changes

### 1.3.0 (2026-11-13)

- Tabs: **Active**, and gh-dash style **Mine**, **Review** and **Search** lists in the space's base repo, which `b` picks per space (`remote-checker.json`). Enter opens a list row in the detailed view.
- A GitHub account per space: the header's avatar (initials) opens a menu of `gh`'s accounts and "Sign in to another account…". Only this panel switches; `gh` in your terminals keeps its active account. `a` opens the menu too.
- Setup screen when `gh` is missing or signed out, instead of an error: installs the GitHub CLI with Homebrew, or without Homebrew from the official release (checksum-verified) into `~/.local/bin`, then signs you in.

### 1.2.0 (2026-11-13)

- Works without the `pond` layout: installing it adds a button to the tab bar that opens it in the right-hand panel, next to Herdr's Files and Changes (needs `pond-tabs` as the layout's tab bar; see Install).
- `q` closes it wherever it is (the right-hand column, a pane or a popup) through the shared `panel.js`, instead of assuming `pond`'s ids. "Only fetch while showing" finds its block by mod, so it works under any child id.
- `mod.json` declares `"panel"` (leader `P`); the refresh icon is its own (it no longer needs `servers` installed).

### 1.1.2 (2026-11-12)

- The update pill only shows when a newer version is published, and reads "Update available" (the version is in its tooltip); no more "Check for updates" pill while up to date. Each panel checks GitHub when it starts and every time it comes back on screen (shared `update.js`).

### 1.1.1 (2026-11-12)

- `update.js` (shared) can also offer the layout's update; no change in this mod's behaviour.

### 1.1.0 (2026-11-12)

- Self-update pill: its header has a "Check for updates" pill that turns into "Update to x.y.z" when this repo publishes a newer version; confirming starts a Claude tab that updates just this mod.

### 1.0.0 (2026-11-11)

- First versioned release: the focused branch's GitHub PR, checks, reviews and comments (2026-11-09).
