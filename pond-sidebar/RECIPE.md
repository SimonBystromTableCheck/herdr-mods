# Pond Sidebar

The Pond sidebar's agents list: every space as a folder row, with its agents hung under it on tree lines,
each agent drawn as a Pond figure (a duck by default, its mood following the agent's status), named like
its tab, with its Claude profile as a small coloured badge, and a second line with its context bar, folder,
branch and model. Plain terminals sit under their space, sub-agents under their agent. With more than
one machine, each machine gets a band with its own spaces. Resting on an agent or machine opens a details
card beside the sidebar. Spaces and machines drag to reorder, agents pin to the top, and narrowing the
sidebar below 160px turns it into a rail of figures.

Cloned from `machine-sidebar` in azaeldrm's Harness layout (github.com/azaeldrm/harns-layout, MIT; its
`LICENSE` is in the mod folder), adapted for Pond by Anthony Chapé (github.com/anthonychape-tc/herdr-pond),
and published here with his permission. Added here: the Claude profile badge and the model line.

**Install:** tell your Herdr agent "Install the Herdr mod at
https://github.com/SimonBystromTableCheck/herdr-mods/tree/main/pond-sidebar". What the agent does:

1. Copy `mods/pond-sidebar/` into `~/.config/herdr-app/mods/` and run
   `herdr-app check ~/.config/herdr-app/mods/pond-sidebar`. Also install `pond-agents` from this repo
   if it's missing (the figures' art and the figure picker live there; see Watch out).
2. Place it as a block in a personal layout's sidebar column (Herdr's own layouts are read-only: clone
   `main` first with `herdr-app do layout.clone '{"name":"main","as":"my-main"}'`). In `pond-tree` it is
   `{ "id": "agents", "type": "block", "content": { "mod": "pond-sidebar" }, "size": { "weight": 1 }, "min": 90 }`
   inside the `sidebar-lists` column. It lists spaces itself, so on a `main` clone it can replace both the
   `spaces` and `agents` blocks. The column holding it should have `"id": "sidebar"` with a px size: that
   is what switches the rail on.

There are no props for layout copies. The mod opens three copies of itself with props (`newMenu`,
`newSpace`, `loginBar`) as popups and dialogs; never place those in a layout.

**Version:** 1.2.1 (see Changes at the end; also `"version"` in `mod.json`).

**Update:** no update pill. Tell your Herdr agent "update my herdr mods" (or "update pond mods"); it
follows `UPDATE.md` in the mod folder, which checks this repo's `versions.json` and backs up what it
replaces. Your order, pins and folds live in the mod's `localStorage`, outside the folder, and are kept.

## What you see

One column on `surface`, 13px text, 10px top gap, 8px side padding, scrolling without a bar; a 32px fade
appears at the top or bottom when more is out of sight that way.

- **Pinned** group first (only while something is pinned): 11px `dim` header, click folds it.
- **Machine bands** (only with two or more machines): 28px, a 14px `laptop` (this computer) or `server`
  icon in `dim`, the name in `muted` 12.5px, a fold chevron, and `+` (add an agent) when the machine is
  ready or a `rotate-cw` reconnect button when it isn't (a spinner while reconnecting). A 1px tree line
  (`dim` mixed 70% into `surface`) runs down from the icon to the machine's spaces. With one machine the
  band is left out and the spaces are the top level. Machines with nothing show "No agents",
  "Connecting…", "Needs login" or "Offline".
- **Space rows**, 28px, radius 6: the icon and colour chosen in **Edit space** ([`space-editor`](../space-editor/), from the space's menu; a 13px glyph on a 20px tile of that hue at 20%), else a 14px folder icon, the space name (`foreground` if shown, else `muted`),
  a fold chevron and a 16px `+` (new tab). Folded: the most urgent status mark and a count. Hover: a `×`
  that removes the space (turns `blocked` red on hover).
- **Agent cards** under their space, 24px in on rounded tree elbows; py 5, radius 6, a 2px left border
  (`accent` and `selected` background when focused). Line 1: the figure (18px tall), the name (`muted`
  when idle and unfocused), the Claude profile badge (14px tall, radius 3, 9.5px text in `background` on
  `ansi4` for a plan login, `ansi5` for a gateway), a sub-agent fold chevron (with the count when folded,
  coloured by the most urgent), and the status: a 15px `working` spinner, a `done` green check
  (`ansi2`), or a "Needs you" pill (`blocked` text on `blocked` at 15%). Hover swaps the status for a pin.
  Line 2, 10.5px `dim`: a 14×3px context bar under the figure, the folder (if it differs from the name),
  the branch (icon in `accent`), the space name when pinned, and the model (`muted`, max 120px, truncated).
- **Sub-agent rows**, 24px, their own small figure (14px) on tree lines, name and status.
- **Plain terminals** (shells, servers, lazygit), 28px: the program's icon (a Claude terminal that stopped
  reporting status gets the duck), its name and folder.
- **New space** row at the bottom, `dim`, `+` icon.
- With no agents at all: "No agent status yet…" in 12px `dim`.

**Context bar**: track `border`, fill grey (`muted`), `working` amber past 75% used, `#d88179` red past 90%.
If shared `harness.context-bar` is `"health"`, it drains instead: green (`ansi2`) for what's left, amber
under 45% left, red under 25%. Its tooltip reads "38% used" (or "62% left").

**Rail** (sidebar `px` under 160): figures centred with a compact mark under each (a `!` tile for blocked,
else the context bar), machine and Pinned headers as 30px icons with tooltips, terminals as icons, empty
machines as a dash / spinner / cross, `+` for New space. Space rows are dropped on the rail.

## How it behaves

- Status: working = spinner (and the figure's working mood), blocked = "Needs you" (the figure scowls
  after a minute), done = green check until you look, idle = nothing. An agent that turns blocked, finishes
  a turn or is new moves to the top of its space; the card slides to its new place (280ms).
- Click an agent: `pane.focus`. Click its figure: fold its sub-agents. Click a sub-agent: `terminal.peek`.
  Click a terminal: `pane.focus` (and shows `terminal-panel` in a `chat-view` stack, if the layout has one).
- Drag an agent onto another of the same machine to reorder; a 2px `accent` line shows where it lands.
- Drag a space row up or down within its machine: `space.move` (moves the real space order). Click folds.
- Drag a machine band onto another to reorder machines. Click folds.
- Pin / unpin from the hover button; pins go when their terminal ends.
- Space `+`: `tab.new` in that space. `×`: the shipped `confirm` dialog, then `space.close`.
- Machine `+`: a 280×500 popup on that machine: Terminal, its installed agents (keys 1–9 start them), up to
  two not-installed ones greyed out. New space / worktree entries are disabled there.
- Reconnect: `hc machine login <name>`; if it needs a password, a 640×300 dialog with a login terminal and
  a title bar opens, closing when it connects.
- **New space**: a 440×430 dialog: the shown space's folder (else home), Choose… (system folder picker),
  then Terminal or any installed agent: `space.new {folder, argv, focus: true}`.
- **Hover card** after 450ms, 340px, hung right against the sidebar's edge, staying while the pointer is on
  it. Agent: figure, name, program · machine, status and for how long, turn, space / tab, profile, model,
  folder, branch, context, sub-agents. Machine: OS and uptime, CPU, load, temperature, memory, GPUs, disks,
  board, re-read at most every 3s for 30s after hovering.
- Mod commands `pond-sidebar.next-machine` / `pond-sidebar.prev-machine` (bind in `keys.json`) focus the top
  agent of the next / previous machine.
- Publishes its order with `setAgentOrder`, so `agent.next` / `agent.select` follow the list.

## Built from

- A clone of Harness's `machine-sidebar` (`mod.json` `cloned_from: { name: "machine-sidebar", version: "0.1.16" }`).
  `main.js` is the view; `new-menu.js` the machine `+` popup; `drag.js` the space drag (`dragger`,
  `dropPlace`); `layout.js` the rail test (`narrow()`); `context*.js`, `snapshots.js`, `sessions.js`,
  `turns.js` the context readings; `space-icons.js` reads `~/.config/herdr-app/pond-space-icons.json` (shared key `pond-space-icons`, written by `space-editor`) for each space's icon and colour; `details.js`, `platforms.js`, `os.js`, `os-icons.js` the machine card
  and OS icons; `machine-metrics.js` the CPU/RAM rings (Classic only); `figures-lib/` a copy of
  `pond-agents`' figure code (`figures.js`, `duck.js`, `slime.js`, `animate.js`). Art: `icons/`, `os/`,
  `stats/`. `LICENSE` (MIT, azaeldrm).
- Pond changes: figures instead of bot icons, spaces as folder rows (`byFolder`), the hidden single-machine
  band, the New space dialog, no token-usage strip.
- Local additions: the profile badge from the terminal label `herdr.claude-profile` (set by
  `pond-profiles`' launch hook), named from `~/.cvm/herdr/pond-profiles.json` `accounts` (`label`,
  `gateway`), re-read every 5s; and `claude.model` (set by `pond-profiles`' statusline hook) on line 2.
- Figures: `pond-agents.json` in the Herdr home (per-space set, default `classic` duck), re-read every 10s.
- `herdr`: `machines`, `agents`, `terminals`, `panes`, `focused`, `spaces`, `run`, `theme`, `shared`,
  `setShared`, `setAgentOrder`, `nextCommand`, `openOverlay`, `closeOverlay`, `props`, `layout`, `hc`,
  `notify`, `home`, `watchFolder`, `exec`, `knownAgents`, `pickFolder`, `readTextFile`; `fs/promises`.
- Commands: `pane.focus`, `terminal.peek`, `terminal.kill`, `tab.new`, `space.new`, `space.move`,
  `space.close` (via `confirm`), `agent.focus`, `layout.select`.
- Shared state written: `agents.context` (context percent per address), `pond-agents.figures`.
  Read: `machine.local-label`, `machine.stats`, `harness.sidebar`, `harness.context-bar`, `herdr-chat.paths`.
  `localStorage`: `order`, `changed`, `pins`, `machines.order`, `os`.
- Shipped mods used: `confirm`, `worktree`; `icons/shell.svg`.

## Watch out

- **Reaches outside its folder and runs programs:** reads `~/.cvm/herdr/pond-profiles.json`,
  `pond-agents.json`, and `~/.config/harness/context/*.json` (watched). Runs `hc machine ls/login/run/read`;
  on every connected machine `uname` (or `cmd.exe /c ver`), an OS probe (`sh -c`), `python3`/`python` probes
  for context snapshots and Codex logs, and on hover a `python3` (PowerShell on Windows, plus `nvidia-smi`)
  machine probe; `sh -lc command -v` per agent for the `+` menu. No network of its own.
- **Needs `pond-agents`:** without it the classic and emoji figures still draw (native), but the slime's
  body (`mods/pond-agents/slime-body.svg`) and picture figures from `mods/pond-agents/figures/` are blank,
  and there's no picker to change figures.
- Context bars need something writing snapshots to `~/.config/harness/context/` (Harness's statusline
  relay); without it Claude agents show no bar and the card says "No reading yet". Codex reads come from
  `agent-chat`'s `herdr-chat.paths` or the Codex footer.
- No badge or model without `pond-profiles`' hooks; a profile missing from its file shows its capitalised id.
- The machine card's CPU load and the rings need shared `machine.stats`, which this mod never writes.
- `probes.js` (account probes with network calls), `token-usage.js` and `usage-card.js` ship from the clone
  but are never run. `shared("harness.sidebar")` = `classic`/`contained` switches to Harness's boxed look.
- The rail needs a layout node `"id": "sidebar"` with `size.px`; otherwise it never goes compact.
- A 1s timer re-renders the view (status durations), and drags only track over the list: leaving it cancels.
- Keep `LICENSE` with the folder.

## Done when

- `herdr-app check ~/.config/herdr-app/mods/pond-sidebar` passes.
- With one machine, each space shows as a folder row with its agents as ducks under it; `+` opens a new tab.
- A Claude started through a `pond-profiles` profile shows its badge and, after its first reply, its model.
- An agent that needs you shows "Needs you"; one that finished shows the green check until you look.
- Dragging a space row below another changes the order in `herdr-app ls`.
- Resting on an agent for half a second opens its card beside the sidebar.
- Resizing the sidebar under 160px gives the rail; widening brings the full rows back.
- New space opens the dialog and starts the chosen agent in the chosen folder.

## Changes

### 1.2.1 (2026-11-27)

- Branch marks: untracked files get their own dim `?n` mark ("not in git yet"); the yellow `●n` is only uncommitted changes to tracked files.

### 1.2.0 (2026-11-27)

- Takes in the newer changes from Anthony Chapé's herdr-pond (github.com/anthonychape-tc/herdr-pond): each space's branch once under its name with git marks (ahead / behind, changes), terminal rows lined up with the ducks, and a working agent's timer and step after its name.
- Agent cards show their branch only when it differs from their space's (pinned cards always), plus the space name on pinned cards. Kept from 1.1.0: Edit space icons, account badges and the model at the right end.

### 1.1.0 (2026-11-27)

- Space rows show the icon and theme colour chosen in **Edit space** ([`space-editor`](../space-editor/), now published): the glyph on a soft tile of that hue, else the plain folder. Read from `pond-space-icons.json` by the new `space-icons.js`.
- Agent cards under a space show only the branch, not the folder again (the space row already says where it is).

### 1.0.0 (2026-11-26)

- First release here: Harness's `machine-sidebar` as adapted for Pond, with the Claude profile badge and
  model line.
