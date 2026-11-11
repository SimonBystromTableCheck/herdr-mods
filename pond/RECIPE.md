# Pond

Herdr's own `main` window, with a fuller right-hand panel and a few personal swaps. The left
sidebar keeps the spaces list, but its agents list shows animated ducks and Claude's context
use. The tab bar gains Git, Skills, Todos, Servers and PR buttons next to Files and Changes, each
opening its own panel on the right: a lazygit-style git panel, Claude skills, Markdown todo
pages, a dev-server runner and the focused branch's GitHub pull request. Files is keyboard-driven (vim keys), and Changes is the
third-party gitview instead of Herdr's stock panel.


**Install:** Point your Herdr agent at this folder: copy `layouts/pond.json` to
`~/.config/herdr-app/layouts/` and every folder in `mods/` (`pond-agents`, `pond-files`, `pond-tabs`,
`git`, `git-conflicts`, `skills`, `todos`, `servers`, `remote-checker`) to `~/.config/herdr-app/mods/`, renaming any that clash
(and the `mod` names in the layout), run `herdr-app check ~/.config/herdr-app/mods/<name>` on
each, install and patch gitview (below), then `herdr-app do layout.switch --name pond`.

## What you see

Left to right; no system title bar (macOS traffic lights at 12,16); `canvas` behind
everything; 1px `border` dividers; terminals padded 14x12.

- **Sidebar**, 268px on `chrome` (44–480px, edge not draggable), top to bottom:
  - brand bar, 46px (shipped `workspace-chrome`), drags the window;
  - spaces list (shipped `spaces`) and agents list (`pond-agents`), sharing the height equally,
    each at least 90px. Agents rows are 66px with a 45px pixel duck (or the space's chosen figure set) acting out the status
    and, for Claude Code, a green/yellow/red context bar and the model;
  - system stats, 44px (`sysstat`, props `{ "stacked": true }`, not included: see Watch out):
    `CPU 12% ▁▂▃  GPU 9%` over `MEM 21.4/32.0G  HERDR 3.0G`, the second of each pair pushed to the
    right edge;
  - footer, 69px (`workspace-chrome` with `footer: true`).
- **Work column**, the rest:
  - tab bar, 42px (`pond-tabs`), drags the window: tab pills, `+` menu, then panel buttons
    Files, Changes, Git, Skills, Todos, Servers, PR (26px, 12px text; `selected` when open).
    Servers shows a green (`ansi2`) count of running servers;
  - body row with 8px padding and 8px gap:
    - the active tab's panes as cards: `background`, 1px `border` (`accent` when focused),
      radius 10, 8px apart, framed even when alone, each with the shipped `pane` header (30px, top);
    - the panel, 368px (280–900), hidden until a panel button opens it: a stack showing one of
      `files` (`pond-files`), `changes` (`gitview`), `git`, `skills`, `todos`, `servers`,
      `remote` (`remote-checker`);
  - status bar, 28px (shipped `workspace-status`).

## How it behaves

- Agent statuses in the agents list: working = duck jabbing a knife + `working` spinner;
  blocked = angry duck (scowling after 1 min) + "Needs you" pill in `blocked`; done = blushing
  duck hopping + `done` dot; idle = blushing duck bobbing + `idle` ring. Tabs in the bar show a
  spinner while working and a 6px `blocked`/`done` dot.
- A panel button runs `layout.select {stack: "panel-body", child}` + `layout.show {id: "panel"}`;
  clicking the open one runs `layout.hide`. The open panel is remembered per space.
- Files, Git, Skills, Todos, Servers, Remote Checker and gitview are `focusable`: `pane.go` moves the keyboard
  into them, the border turns accent, a keycap footer lists their keys and `?` shows them all.
- Git: lazygit-style sections and vim keys; writes run in core terminals with a log; conflicts
  and failures can be handed to an agent, and `v` opens a Conflicts pane (`git-conflicts`) beside the
  tab with a lazygit-style chunk picker (see the `git` item's recipe). Skills: `~/.claude/skills` and the repo's
  `.claude/skills`; run one in an agent here or a new tab, edit in nvim, scaffold a new one.
  Todos: pages of `- [ ]` items saved at once as Markdown in `~/.config/herdr-app/todos`.
  Servers: dev servers saved in `~/.config/herdr-app/servers.json`, each run as a core terminal
  labeled `herdr.server`, so they outlive the app. PR (`remote-checker`): the focused branch's
  GitHub pull request (checks, reviewers, comments, diff, commits) through `gh`, every 10s while open.
- Sidebar folding (`layout.toggle sidebar`) and the narrow rail work as in shipped `main`.

## Built from

Clone of shipped `layouts/main.json` (`cloned_from: {name: "main", version: "0.1.13"}`);
keys are reordered but the tree, ids, sizes and look are the shipped ones except:

| Node | Shipped | pond |
|---|---|---|
| `agents` block | `agents` | `pond-agents` (ducks, context bar) |
| `tabs` block | `tabs` | `pond-tabs` (5 extra panel buttons, Servers badge) |
| `files` (stack child) | `files` | `pond-files` (vim keys, keybar, plain-text preview) |
| `changes` (stack child) | `changes` | `gitview`, props `{ "replaces": { "mod": "changes" } }` |
| `panel-body` stack | 2 children | + `git`, `skills`, `todos`, `servers`, `remote` (`remote-checker`) blocks |

Tree: `root` row → `sidebar` column [`brand`, `sidebar-lists` column [`spaces`, `agents`],
`sysstat` (44px), `sidebar-footer`] + `work` column [`tabs`, `work-body` row [`main` (`tab: active` with the
pane frame), `panel` column [`panel-body` stack, `active: files`]], `status`].

Mods: shipped `workspace-chrome`, `spaces`, `pane`, `workspace-status` (and the `new-menu`,
`files`/`changes` icons `pond-tabs` borrows); this repo's nine in `mods/` (`git-conflicts` belongs with `git`); `sysstat` and `gitview` from
outside. `pond-agents` and `pond-files` have their own recipes in this repo; `pond-tabs` differs from
shipped `tabs` only by the five buttons (`enabled` always adds `git`, `skills`, `todos`,
`servers`, `remote` to shared `workspace.panels`) and its own `mods/pond-tabs/win-*.svg` paths.
Programs the panels run: `git`, `sh`, `hc`, `nvim` (git and skills), `mv` (todos), `gh` (remote-checker).

**gitview** (github.com/ChmaraX/herdr-gitview, not in this repo): install it with that repo's
instructions. It brings several `gitview*` mod folders plus a `herdr-gitview` engine binary
the panel runs for git. The `replaces` prop is a marker for its installer; gitview doesn't
read it. Without gitview the Changes button still opens the `changes` slot, but the block names
a mod that doesn't exist and stays empty (see `herdr-app status`). To use Herdr's stock panel
instead, set that block's `content` to `{ "mod": "changes" }`.

**Patch gitview** after installing it (gitview's own files; reapply after every gitview update).
Stock gitview never says when its file list has the keyboard, and the `leader` mod needs that.
In `mods/gitview/main.js`, `init()` already has a `cx.timer.every(300, …)` (it handles `reviveAt` and
`stale()`). At the top of that callback, add:

```js
// LOCAL PATCH (not upstream): tell the leader mod when the list has the keys.
const keys = this.handle.is_focused() || Boolean(this.typing);
if (keys !== this.sharedKeys) { this.sharedKeys = keys; setShared("gitview.hasKeys", keys); }
```

Also add `setShared` to that file's `herdr` import if it isn't there. If upstream has renamed `this.handle` (the list's focus handle) or `this.typing` (set while
a prompt or commit message takes typing), use what replaced them. Without the patch, the
leader can't tell that Changes holds the keyboard:
- leader `h` from Changes falls back to the generic move. The keyboard then goes to the terminal and is lost again, because the popup's
  close sends `focus` back to gitview and gitview's focus loop grabs it.
- leader `e` treats Changes as a terminal, so it doesn't open `gitview-tab`.

Everything else (entering Changes with `pane.go`, moving before closing the popup) lives in `leader`;
gitview needs no other change.

## Watch out

- Keep the node ids `sidebar`, `panel`, `panel-body` and the child ids `files`, `changes`,
  `git`, `skills`, `todos`, `servers`: `pond-tabs` selects stack children by id, the agents rail
  measures `sidebar`, and Files' `q` hides `panel`.
- Renaming mods on a clash: `git` reads `mods/git/config.json` and `mods/git/seq-edit.pl`
  by fixed path, and `pond-tabs` draws `mods/skills/skills.svg`, `mods/todos/todos.svg`; rename
  those paths too. The `leader` mod (separate item) looks for `<mod>.hasKeys` by these names.
- `git/config.json` ships this author's settings: editor `nvim` and a `ctrl-p` custom command
  that prunes local branches whose upstream is gone. Review before using.
- Assumptions: projects live in `~/code` (the Servers add-folder picker; changeable there with Change…), Claude skills in
  `~/.claude/skills`, deleted todo pages go to `~/.Trash` (macOS), `nvim` is installed.
- The context bar needs a Claude Code status line that runs
  `hc label "$HC_TERMINAL_ID" claude.context=<pct> claude.model=<name>`; not included here.
- The panel buttons for Git/Skills/Todos/Servers always show, even if the mods are missing.
- The `sysstat` block uses a third-party mod that isn't in this repo: github.com/DarkoKuzmanovic/herdr-mods
  (`sysstat`), which reads Linux `/proc`. This layout was built with a local version that adds a macOS
  fallback (`iostat`, `vm_stat`, `sysctl`, `ioreg`), a `HERDR` figure (resident memory of the Herdr app and
  every herdr-core process tree, from one `ps -axo pid=,ppid=,rss=,comm=`) and the two-row `stacked` prop.
  Without the mod the block is an empty 44px strip: install it, or delete the `sysstat` node.

## Done when

- Every mod in `mods/` passes `herdr-app check`; `layout.switch --name pond` shows a 268px
  sidebar (brand, spaces, duck agents list, footer), a 42px tab bar and a 28px status bar.
- The tab bar shows Files, Changes, Git, Skills, Todos, Servers; each opens a 368px panel on the
  right with that mod, and clicking it again hides the panel.
- A working agent's duck jabs a knife; a blocked one shows "Needs you".
- With gitview installed, Changes shows gitview's file list for the space's repo.
- With the gitview patch: while Changes has the keyboard, `shared.json` has `"gitview.hasKeys": true`,
  and after leader `h` from Changes the terminal has the keyboard and keeps it.
- Starting a server from Servers raises the green count on its button.
- `layout.switch` (`ctrl-shift-l` by default) cycles back to the previous layout.
