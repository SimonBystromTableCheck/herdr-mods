# Pond Tabs

Herdr's tab bar with more panel buttons. The active space's tabs are pills
along the top of the work area (program icon, name, agent status, a close `x`
on the active one), then `+`, then toggle buttons for the right-side panel:
Files, Changes, Git, Skills, Todos, Servers and PR, where Servers carries a green
count of running dev servers. The chosen panel is remembered per space.


**Install:** point your Herdr agent at this folder: copy `mods/pond-tabs/` into
`~/.config/herdr-app/mods/`, then `herdr-app check ~/.config/herdr-app/mods/pond-tabs`.
It is `"place": "none"` and replaces the layout's `tabs` block: clone a layout
(`herdr-app do layout.clone '{"name":"main","as":"my-layout"}'`) and set the
`tabs` block's `content` to `{ "mod": "pond-tabs" }`. This repo's `pond`
layout already does, at 42px tall.

**Version:** 1.3.1 (see Changes at the end; also `"version"` in `mod.json`).

**Update:** from 1.2.0, a small "Tabs ↑ x.y.z" pill appears before + when this repo publishes a newer version (and "Pond ↑ x.y.z" for the shown layout, which updates the layout and offers its mods); click it, confirm, and a new Claude tab updates just this mod (following `UPDATE.md`). Or tell your Herdr agent "update my herdr mods" (or "update pond mods"). It follows `UPDATE.md`, installed in the mod folder, which checks this repo's `versions.json` and offers every newer version of the mods and layouts you have from here, with a backup of each. By hand: replace `mods/pond-tabs/` with this folder's copy (asking an agent to *install* it again adds a second copy instead). Your settings and data live outside the mod folder and are kept; edits you made inside the mod folder are not.

## What you see

One bar filling its block (`chrome` background, 1px `border` bottom, 10px side
padding, 3px gaps), left to right:

- **Tab pills**, 29px tall, radius 7, 10px padding, 12.8px text, in a
  horizontally scrolling strip. Active: `raised` with a `border` outline and
  `foreground` text; others: `chrome` and `muted`. Each: the program's icon
  (14px; tinted `muted` if a glyph), the name (max 170px, truncated; unnamed
  tabs show their agent's or program's name, else "Terminal"; ` Z` when
  zoomed), a 12px `working` spinner while an agent works, a 6px `blocked` or
  `done` dot, and on the active tab a 12px close `x` in `dim`.
- **`+`**, 26px square button, `dim`.
- **Panel buttons**, 26px tall, radius 6, 12px text, 14px icon + label: Files,
  Changes (only if enabled in shared `workspace.panels`, default both), then
  always Git, Skills, Todos, Servers, PR. The open one is `selected`/`foreground`;
  others `chrome`/`muted`. Servers adds a 16px round badge (`ansi2` green,
  `background` text, 10.5px semibold) with the number of live terminals
  labeled `herdr.server`, hidden at 0.
- **Window buttons** (Linux/Windows only, where the system draws none):
  minimize, maximize/restore, close; vector icons on Windows.
- On macOS with a hidden title bar, left padding clears the traffic lights.

## How it behaves

- Click a tab: select it. Double-click: rename. Drag one pill onto another and
  release: moves it there. Right-click: Herdr's tab menu (`menu` popup, 200px).
  Close `x`: closes the tab. Scroll wheel over the bar: previous / next tab.
- `+` opens the shipped `new-menu` popup (250×512): new terminal or agent.
- A panel button shows that child of the `panel-body` stack and the `panel`
  column; clicking the open one hides the panel.
- Per space: the open panel (or none) is saved when it changes and restored on
  switching spaces; a space never seen keeps whatever is showing.
- Agent status per tab: working = spinning ring, blocked / done = colored dot,
  idle = nothing.

## Built from

- `update.js`: the self-update pill (the same file in every mod from this repo; `tools/stamp.py` refuses copies that differ). It reads `mod.json` `version` and `source`, fetches the repo's `versions.json` (shared between mods as `herdr-mods.versions`, every 6 hours or on click) and on confirm runs `tab.new` with `claude` in the Herdr home. No `source`: no pill.
- A clone of Herdr's shipped `tabs` mod (`mod.json` has
  `cloned_from: { name: "tabs", version: "0.1.13" }`). Differences from the
  shipped one, all in `main.js`:
  - `enabled` panels = `workspace.panels` plus `"git", "skills", "todos", "servers", "remote", "profiles"`,
    so per-space restore accepts those too.
  - Five extra `panelButton`s after Changes: Git
    (`mods/workspace-chrome/git-branch.svg`), Skills (`mods/skills/skills.svg`),
    Todos (`mods/todos/todos.svg`), Servers (`mods/workspace-chrome/server.svg`),
    PR (child `remote`, `mods/remote-checker/pr.svg`), then the Claude account
    (child `profiles`, `mods/pond-profiles/claude.svg`, labelled with the active cvp profile).
  - `panelButton` takes a `badge` count; Servers passes
    `terminals().filter(x => x.state === "live" && x.labels?.["herdr.server"]).length`
    (imports `terminals`).
  - Window-button icons point at `mods/pond-tabs/win-*.svg` instead of `mods/tabs/`.
- Files: `main.js`, `mod.json`, `win-min.svg`, `win-max.svg`, `win-restore.svg`,
  `win-close.svg` (16px, 1px stroke; same as shipped).
- `herdr`: `spaces`, `panes` (program per tab), `terminals`, `run`,
  `openOverlay`, `theme`, `window`, `shared`, `layout`, `settings` (zoom).
- Commands: `tab.select`, `tab.move`, `tab.rename`, `tab.close`, `tab.prev`,
  `tab.next`, `layout.select {stack: "panel-body", child}`,
  `layout.show/hide {id: "panel"}`, `window.minimize/maximize/close`.
- Shipped mods used: `menu`, `new-menu`, and icons from `pane`, `files`,
  `changes`, `workspace-chrome`.

## Watch out

- The Git, Skills, Todos, Servers and PR buttons always show. They need the layout's
  `panel-body` stack to have children with those ids (blocks for the `git`,
  `skills`, `todos`, `servers` mods from this repo, and `remote` for `remote-checker`, as in `pond`); on the
  shipped `main` layout they select a child that doesn't exist. The Skills, Todos and
  PR icons come from those mods' folders and are blank without them.
- In `pond` the `changes` child runs the third-party `gitview` mod
  (github.com/ChmaraX/herdr-gitview, not in this repo); pond-tabs only selects
  the child id, so it works with shipped `changes` too.
- The Servers badge counts any terminal with a `herdr.server` label, which the
  `servers` mod sets; without it the badge stays hidden.
- Per-space panel memory is in this copy's `localStorage`, not shared.
- Clones never update: fixes to the shipped `tabs` must be carried over by hand.
- No programs, files or network.

## Done when

- `herdr-app check ~/.config/herdr-app/mods/pond-tabs` passes.
- In a layout whose `tabs` block uses `pond-tabs`, the bar shows the active
  space's tabs, `+`, and Files, Changes, Git, Skills, Todos, Servers, PR.
- Clicking Todos opens the panel on Todos with the button highlighted; clicking
  it again hides the panel.
- Opening Git in one space and nothing in another, then switching back and
  forth, restores each.
- Starting a server through `servers` shows a green `1` on Servers.
- An agent working in a tab shows the spinning ring on its pill.

## Changes

### 1.3.1 (2026-11-12)

- The update pill only shows when a newer version is published, and reads "Update available" (the version is in its tooltip); no more "Check for updates" pill while up to date. Each panel checks GitHub when it starts and every time it comes back on screen (shared `update.js`).

### 1.3.0 (2026-11-12)

- "Pond ↑ x.y.z" pill before + when the shown layout came from this repo and a newer version is published: confirming starts a Claude tab that updates the layout (and offers its mods) following `UPDATE.md`. The layout file is re-read every 30 s, so the pill follows updates and layout switches.
- The tab bar's own pill now reads "Tabs ↑ x.y.z".

### 1.2.0 (2026-11-12)

- Self-update pill: a small "↑ x.y.z" pill appears before + when this repo publishes a newer version; confirming starts a Claude tab that updates just this mod.

### 1.1.0 (2026-11-12)

- Claude account button (child `profiles`, `mods/pond-profiles/claude.svg`) labelled with the active account, with a dot (`ansi4` claude.ai, `ansi5` gateway); it reads `~/.cvm/active-profile` and `~/.cvm/herdr/pond-profiles.json` every 3s. Needs pond-profiles.

### 1.0.0 (2026-11-11)

- First versioned release.
- PR button for remote-checker (2026-11-09).
