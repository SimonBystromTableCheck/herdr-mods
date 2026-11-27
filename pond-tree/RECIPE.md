# Pond Tree

The Pond layout with a different left sidebar. Instead of a spaces list and an agents list, the
sidebar is one tree: each machine, its spaces, and each space's agents (drawn as Pond's ducks and
other figures) with their sub-agents. Above the tree, a row of cards for the panels you pinned; below
it, Claude usage cards; at the top a brand bar, at the bottom a footer with Settings, Add machine and
Pond settings. The main area shows the focused agent as a Chat (its conversation, with a message box)
or as its Terminal. The tab bar keeps the tab pills and puts the right-hand panels (Files, Git,
Skills, Todos, Servers, GH, Claude, Find, Notes) in one hamburger dropdown. The right-hand panels and
the status bar are the same as Pond's.

The sidebar is Anthony Chapé's herdr-pond (github.com/anthonychape-tc/herdr-pond, published here with
his permission), itself built on azaeldrm's Harness layout (github.com/azaeldrm/harns-layout, MIT;
`LICENSE` in each mod folder that started from it).

**Install:** tell your Herdr agent "Install the Herdr layout at
https://github.com/SimonBystromTableCheck/herdr-mods/tree/main/pond-tree", or use Install in Pond
settings' Available layouts. The agent copies `layouts/pond-tree.json` and its preview `layouts/pond-tree.svg` to `~/.config/herdr-app/layouts/`
and every folder in `mods/` (`pond-chrome`, `pond-history`, `pond-sidebar`, `space-editor`, `pond-usage`, `agent-chat`, `pond-pins`,
`pond-settings`, `pond-tabs`, `pond-profiles`, `pond-agents`, `pond-files`, `git`, `git-conflicts`,
`skills`, `todos`, `servers`, `remote-checker`, `workbench`, `notes`) to `~/.config/herdr-app/mods/`,
skipping mods you already have from this repo (offering their updates) and never overwriting your own,
then runs `herdr-app check` on each. It's an alternative to `pond`, never a replacement: both can be
installed. Installing doesn't switch layouts; pick it in Settings → Look or cycle with ctrl-shift-L
(`layout.switch --name pond-tree`).

**Version:** 1.1.3 (see Changes at the end; also `"version"` in `layouts/pond-tree.json`, and each
mod's own in its `mod.json`).

**Update:** Pond settings (the duck in the footer, or "Pond settings" in the palette) shows the layout
and each mod with Update when a newer one is out; pond-tabs also shows a "Pond ↑ x.y.z"-style pill for
the shown layout. Or tell your Herdr agent "update my herdr mods". Both follow `UPDATE.md`, which
backs up what it replaces. Sizes and panels you clicked are kept (`layouts/.state/`), and so are the
mods' data files; edits inside `pond-tree.json` or the mod folders are not.

## What you see

Left to right; no system title bar (macOS traffic lights at 12,16); `canvas` behind everything; 1px
`border` divider between sidebar and work column; terminals padded 14x12.

- **Sidebar**, 268px on `surface` (44–480px, edges not draggable, no inner dividers), top to bottom:
  - brand bar, 46px (`pond-chrome`), drags the window: a 20px tile with a still duck and the brand
    name, then search (the shipped `picker`) and fold-sidebar buttons;
  - pinned panels, 68px (`pond-pins`), hidden while nothing is pinned: 52px square cards;
  - the tree (`pond-sidebar`), the rest (at least 90px): machine groups (system icon, status, CPU
    rings), their spaces (draggable within the machine), each space's agents with an 18px figure
    acting out the status, a context bar and model, sub-agents indented under their parent with
    tree lines, and non-agent panes (shells, servers) per machine;
  - usage, 134px (`pond-usage`): a card per Claude account pinned in the Claude panel (claude.ai:
    session and weekly limits; gateway: token budgets, forecast and spend); empty until you pin one;
  - footer, 44px (`pond-chrome` with `footer: true`): Settings (accent dot when an app update is
    ready), Add machine (shipped `machine-add`), the duck that opens Pond settings, and optionally a
    token-usage spark.
- **Work column**, the rest:
  - tab bar, 42px (`pond-tabs` with props `{"menu": true}`), drags the window: tab pills, `+`, and one
    hamburger button whose dropdown lists the panels (with a pin icon per row);
  - body row, 8px padding and gap:
    - `chat-view` stack: **Chat** (`agent-chat`, radius 10): the focused agent's conversation with a
      composer, or **Terminal**: the active tab's panes as cards (`background`, 1px `border`, `accent`
      when focused, radius 10, gap 8, framed when alone) with a 42px `agent-chat` header carrying the
      Chat | Terminal switch;
    - the panel, 368px (280–900), hidden until opened: a stack of `files` (`pond-files`), `git`,
      `skills`, `todos`, `servers`, `remote` (`remote-checker`), `profiles` (`pond-profiles`),
      `workbench`, `notes`;
  - status bar, 28px (shipped `workspace-status`).

## How it behaves

- Agent statuses in the tree: working = figure at work + `working` spinner; blocked = angry figure and
  `blocked` color; done = happy figure + `done` dot; idle = resting figure. A space and a machine show
  their most urgent agent. Tabs show a spinner while working and a 6px `blocked`/`done` dot.
- Click an agent: focus it (the Chat or Terminal view follows). Drag spaces, agents and machines to
  reorder. Hover a machine for its details card.
- Chat | Terminal switches the `chat-view` stack; Chat mirrors Claude Code, Codex, pi and opencode.
- Panels: open from the hamburger dropdown or a pinned card; click again to close. Each remembers
  per space as in Pond. Pin icon in the dropdown adds or removes a card.
- Folding the sidebar (`layout.toggle sidebar`, the brand bar button) gives a rail: the footer becomes
  one gear with a menu (Settings, Add machine, Pond settings); pins hide.

## Built from

Clone of shipped `main` (`cloned_from: {name: "main", version: "0.1.13"}`), root `version` and
`source: {repo, item: "pond-tree", layout: "pond-tree"}`.

Tree: `root` row → `sidebar` column [`brand` (pond-chrome), `sidebar-lists` column [`pins`
(pond-pins, `hidden`), `agents` (pond-sidebar, weight 1, min 90)], `usage` (pond-usage),
`sidebar-footer` (pond-chrome `{footer: true}`)] + `work` column [`tabs` (pond-tabs `{menu: true}`),
`work-body` row [`chat-view` stack (`active: chat-panel`) [`chat-panel` (agent-chat),
`terminal-panel` (`tab: active`, header agent-chat)], `panel` column [`panel-body` stack, `active:
files`]], `status` (workspace-status)].

Mods: `pond-chrome`, `pond-sidebar`, `agent-chat` (from herdr-pond / Harness), `pond-history` (Anthony Chapé's Session history, opened from the brand bar), `space-editor` (Edit space, from a space's menu), `pond-usage`,
`pond-pins`, `pond-settings` (opened by the footer duck), `pond-tabs` (1.6.0: the dropdown, pins and
the `dock`), `pond-agents` (the sidebar draws its figures from `pond-agents.json`), and Pond's panels
(see `pond` and each mod's recipe). Shipped: `workspace-status`, `picker`, `machine-add`, `menu`,
`new-menu`, `confirm`, `workspace-chrome` icons. `herdr`: `hc` (`machine ls`/`login`), `exec`,
`setAgentOrder`, `openOverlay`, shared state. Programs: `sh`/`python3` (usage, metrics, images),
`git`, `gh`, `nvim`, `claude`, `cvm`.

## Watch out

- The author's own copy has a `brew` block in `panel-body` (a private, unpublished mod) with
  `active: git`; the published file strips it and restores `files` (`pond-files`) as the first child
  and active one. Don't add `brew` back.
- `pond-usage` shows nothing until you pin an account in the Claude panel's Usage section (needs
  `pond-profiles` set up with `cvm`); it then runs `pond-profiles/ctl.py` with `python3`.
- Copy `layouts/pond-tree.svg` along with the layout: the root `"preview"` points at it, and Settings →
  Look lists only layouts with a preview.
- Keep the ids `sidebar`, `sidebar-lists`, `pins`, `panel`, `panel-body`, `chat-view` and the panel
  child ids: pond-tabs, pond-pins and the leader select by id, and pond-pins docks into `sidebar-lists`.
- The brand bar reads "Pond"; change it in `pond-chrome/main.js` (a clone) if you like.
- `pond-sidebar` and `agent-chat` reach other machines through `hc` and run local helper scripts;
  `remote-checker` uses `gh`; `pond-settings` fetches from GitHub.
- Same assumptions as Pond for the panels (`~/code`, `~/.claude/skills`, `nvim`, macOS Trash).

## Done when

- Every mod in `mods/` passes `herdr-app check`; `layout.switch --name pond-tree` shows a 268px
  sidebar (brand, tree, usage, footer), a 42px tab bar with a hamburger, and a 28px status bar.
- The tree lists this computer, its spaces and their agents with figures; a working agent animates.
- Chat | Terminal flips the main area between the conversation and the tab's panes.
- The hamburger lists Files, Git, Skills, Todos, Servers, GH, Claude, Find, Notes; picking Git opens a
  368px panel. Pinning Git shows a 52px card above the tree; clicking it toggles the panel.
- The footer duck opens Pond settings, listing `pond-tree` under Layouts.
- ctrl-shift-L cycles back to the previous layout, unchanged.

## Changes

### 1.1.3 (2026-11-27)

- Mods: agent-chat 1.2.2.

### 1.1.2 (2026-11-27)

- Mods: agent-chat 1.2.1, pond-sidebar 1.2.1.

### 1.1.1 (2026-11-27)

- Mods: agent-chat 1.2.0, pond-sidebar 1.2.0 (Anthony Chapé's newer herdr-pond changes merged in).

### 1.1.0 (2026-11-27)

- Mods: git 2.0.0, leader 2.3.0, notes 1.1.0, pond-chrome 1.1.0, pond-sidebar 1.1.0, agent-chat 1.1.0, todos 1.2.1, servers 1.3.1, remote-checker 1.4.2, skills 1.2.1, workbench 1.0.1, pond-profiles 1.5.1, pond-files 1.1.3.
- Adds [`pond-history`](../pond-history/) (Anthony Chapé's Session history, from the brand bar's history button) and [`space-editor`](../space-editor/) (Edit space: name, colour, icon) to the install.
- The private system-stats block (`pond-sysstat`) is cut from the published copy.

### 1.0.0 (2026-11-26)

- First release: Pond with herdr-pond's machine → space → agent tree sidebar, pinned panel cards,
  Claude usage cards, a Chat/Terminal main area and the panels in a hamburger dropdown. Mods at:
  pond-chrome 1.0.0, pond-sidebar 1.0.0, pond-usage 1.0.0, agent-chat 1.0.0, pond-pins 1.0.0,
  pond-settings 1.0.0, pond-tabs 1.6.0, pond-profiles 1.5.0, pond-agents 1.4.0, pond-files 1.1.2, git 1.5.0,
  git-conflicts 1.1.3, skills 1.2.0, todos 1.2.0, servers 1.3.0, remote-checker 1.4.1, workbench 1.0.0, notes 1.0.0.
