# Pond Tabs

Herdr's tab bar with a button for every panel in the right-hand column. The active space's tabs are
pills along the top of the work area (program icon, name, agent status, a close `x` on the active
one), then `+`, then one toggle button per panel: Herdr's Files and Changes, and any panel mod you
install (Git, Skills, Todos, Servers, PR, Claude from this repo, or another that declares itself).
Installing a panel mod is enough: the tab bar adds it to the right-hand column and shows its
button. Servers carries a green count of running dev servers. The chosen panel is remembered per space.


**Install:** tell your Herdr agent "Install the Herdr mod at
https://github.com/SimonBystromTableCheck/herdr-mods/tree/main/pond-tabs". What the agent does:

1. Copy `mods/pond-tabs/` into `~/.config/herdr-app/mods/` and run
   `herdr-app check ~/.config/herdr-app/mods/pond-tabs`.
2. Make it the shown layout's tab bar. Herdr's own layouts are read-only:
   - On Herdr's `main`: `herdr-app do layout.clone '{"name":"main","as":"my-main"}'` (it switches
     to the copy, which looks and works the same), then in `layouts/my-main.json` set the block
     with `"id": "tabs"` to `"content": { "mod": "pond-tabs" }`. Tell the person a clone doesn't get
     Herdr's later changes to `main`.
   - On a personal layout: set its `tabs` block's `content` to `{ "mod": "pond-tabs" }`.
   - On `pond` (this repo): it already is (42px tall).

Panel mods from this repo point here for their button; their install does steps 1–2 if needed.

**Version:** 1.4.0 (see Changes at the end; also `"version"` in `mod.json`).

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
- **Panel buttons**, 26px tall, radius 6, 12px text, 14px icon + label: one per child of the
  layout's `panel-body` stack, in its order. Files and Changes show only if enabled in shared
  `workspace.panels` (default both). The open one is `selected`/`foreground`;
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
- **New panels add themselves.** Every 15 s (and on start) it reads `mods/*/mod.json`. A mod with
  `"panel": { "title", "icon" }` that the shown layout doesn't show anywhere gets a block
  `{ "id": <mod>, "type": "block", "content": { "mod": <mod> } }` appended to the `panel-body` stack
  (`layout.set` with the layout file's tree; the id gets `-panel` if taken), so installing the mod
  is enough. Each layout remembers what it added (shared `pond-tabs.added`): a block the person
  removes isn't added back. Herdr's own layouts refuse structure changes, so this needs a personal
  layout.
- Per space: the open panel (or none) is saved when it changes and restored on
  switching spaces; a space never seen keeps whatever is showing.
- Agent status per tab: working = spinning ring, blocked / done = colored dot,
  idle = nothing.

## Built from

- `update.js`: the self-update pill (the same file in every mod from this repo; `tools/stamp.py` refuses copies that differ). It reads `mod.json` `version` and `source`, fetches the repo's `versions.json` (shared between mods as `herdr-mods.versions`, on start and whenever a panel comes back on screen) and on confirm runs `tab.new` with `claude` in the Herdr home. No `source`: no pill.
- A clone of Herdr's shipped `tabs` mod (`mod.json` has
  `cloned_from: { name: "tabs", version: "0.1.13" }`). Differences from the
  shipped one, all in `main.js`:
  - Panel buttons come from the `panel-body` stack's children. Label and icon: `BY_ID` for Herdr's
    `files` and `changes` (by child id), else the child's mod's `mod.json` `panel` (`icon` is a file
    in the mod folder; none: `mods/workspace-chrome/square.svg`), else `BY_MOD`, a fallback for this
    repo's panels that don't declare one yet (`git`, `skills`, `servers`, `remote-checker` as PR,
    `pond-profiles`). A child with none of these gets no button. Per-space restore accepts every
    child with a button.
  - Two specials by mod: `servers` gets a `badge` count
    (`terminals().filter(x => x.state === "live" && x.labels?.["herdr.server"]).length`), and
    `pond-profiles` is labelled with the active cvp profile and a dot (`ansi4` claude.ai, `ansi5` gateway).
  - `scan()` / `register()`: the self-adding panels above (`fs/promises` `readdir` of `mods/`,
    `readTextFile`, `layout.set`).
  - Window-button icons point at `mods/pond-tabs/win-*.svg` instead of `mods/tabs/`.
- Files: `main.js`, `mod.json`, `win-min.svg`, `win-max.svg`, `win-restore.svg`,
  `win-close.svg` (16px, 1px stroke; same as shipped).
- `herdr`: `spaces`, `panes` (program per tab), `terminals`, `run`,
  `openOverlay`, `theme`, `window`, `shared`, `setShared`, `layout`, `settings` (zoom),
  `readTextFile`, `appHome`; `fs/promises` `readdir`.
- Commands: `tab.select`, `tab.move`, `tab.rename`, `tab.close`, `tab.prev`,
  `tab.next`, `layout.select {stack: "panel-body", child}`,
  `layout.show/hide {id: "panel"}`, `layout.set {layout}`, `window.minimize/maximize/close`.
- Shipped mods used: `menu`, `new-menu`, and icons from `pane`, `files`,
  `changes`, `workspace-chrome`.

## Watch out

- It needs the layout's right-hand `panel` column with a `panel-body` stack (Herdr's `main` and its
  copies have one). A layout without them shows no panel buttons and adds nothing.
- Self-adding only appends to the stack; it never removes. Uninstalling a mod leaves its block in the
  layout (its button goes, unless it's one of the `BY_MOD` fallbacks): remove the block from the layout file.
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

### 1.4.0 (2026-11-13)

- Panel buttons come from the layout's `panel-body` stack, labelled and iconned by each mod's `mod.json` `panel`, instead of a fixed list: any subset of panels works.
- Installing a panel mod adds it to the right-hand panel stack of a personal layout (`layout.set`, once per layout; one you remove stays removed). Use it as the tab bar of a copy of Herdr's `main` to get buttons for single mods from this repo.

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
