# Pond Agents

Herdr's Agents list with a pixel-art duck in place of each agent's program icon. The duck
acts out the agent's status: it jabs a knife while the agent works, glares (then scowls)
while it waits for you, hops and flaps when it finishes, and bobs contentedly when idle.
Rows are taller and show the name over its detail, plus a thin context-use bar and the model
for Claude Code agents. Everything else (grouping, priority sort, pins, sub-agent trees,
the narrow rail) is the shipped `agents` mod unchanged. The duck is the default **figure set**:
a "Pond figures" dialog lets you swap it, per space, for emoji, your own pictures (PNG, JPEG,
GIF, WebP, SVG) or a still duck.


**Install:** Point your Herdr agent at this folder: copy `mods/pond-agents/` into
`~/.config/herdr-app/mods/`, then `herdr-app check ~/.config/herdr-app/mods/pond-agents`.
It is `"place": "none"`: to use it, point a layout block at it instead of the shipped
`agents` (clone the layout first: `herdr-app do layout.clone '{"name":"main","as":"my-main"}'`,
then set the `agents` block's `content` to `{ "mod": "pond-agents" }`).

**Version:** 1.0.0 (see Changes at the end; also `"version"` in `mod.json`).

**Update:** ask your Herdr agent to update it from this folder, replacing `mods/pond-agents/` (say *update*: installing again adds a second copy next to the old one). Your settings and data live outside the mod folder and are kept (your figure sets in `pond-agents.json` and pictures in `pond-figures/`); edits you made inside the mod folder are not.

## What you see

The sidebar's agents block, top to bottom, on `chrome` with a 1px `border` line on top, text 13px:

- **Header** (41px, 16px side padding): "Agents" 11.5px medium in `dim`; on the right, 10px
  apart, a bold `blocked` "!" when `pond-agents.json` is invalid (tooltip: the error, "Using the
  last good figures."), a 14px duck icon (`duck-icon.svg`, opens Pond figures) and the 14px
  sort icon (`clock` for Priority, `layers` for Grouped by space).
- **Group headers** (30px, 11px medium): in Priority view "Needs you" (`blocked` color),
  "Done" (`done`), "Working" (`working`), "Idle" (`dim`) with a count; in Grouped view the
  space name. A "Pinned" group comes first when anything is pinned.
- **Agent rows**, 66px tall (shipped: 30px), rounded 8, `selected` background when focused:
  - the **duck**, 45px tall and 69px wide (a 368x240 canvas scaled down, the left third
    reserved for the knife so the body never shifts);
  - a text column: the name (13px; `muted` when idle and not focused, else `foreground`),
    under it the detail (11.5px `dim`: a named tab or the agent's live title), under that,
    for Claude Code, a **context bar**: 72x3px track in `border`, fill `ansi2` (green) under
    60%, `ansi3` (yellow) from 60%, `ansi1` (red) from 80%, then "NN%" 10px `dim` and
    "· Opus 4.x" 10px `muted`. Hover the bar: "Context NN% used · model";
  - the machine name (10px `dim`) for agents on another machine;
  - fold chevron and sub-agent count when it has sub-agents;
  - time in this state ("<1m", "12m", "3h", "2d", 11px `dim`), swapped for a pin button on hover;
  - the status mark (below).
- **Sub-agent rows**, 34px (shipped: 26px), indented 44px with tree lines in `input`, a 27px
  duck, the name, and the status mark.
- Empty: "No agent status yet. Agents show up here when they report their status…".
- Narrower than 160px (the rail): numbered 26px rows with only the status mark, no ducks,
  and a "»" button at the bottom that widens the sidebar again. Same as shipped.

The duck (all native divs, colors fixed, not themed): body `#F5DA81`, beak and feet
`#EFC787`, eyes `#000000`, cheeks `#FFA798`, blade `#DBDBDB`, hilt `#A5A5A5`.

- **Pond figures** dialog (860x640): title "Pond figures", "How each agent state looks, per
  space", tabs **Sets** and **Spaces**.
  - Sets: a list of "Built-in" sets (Classic duck, Classic duck (still), Emoji pond) and
    "Yours"; for the selected set a name field and five slots (Working, Needs you, Still
    waiting = blocked over a minute, Done, Idle). Each slot picks a Figure (Duck with a mood,
    Picture, Emoji), a Motion (Still, Bob, Hop, Wiggle, Shake, Pulse, or Own animation for
    GIF/WebP), and for emoji Frames and Speed (Slow 800ms, Normal 400ms, Fast 180ms).
    Built-in sets are read-only ("Duplicate this one to pick your own figures"). Pictures
    can be dropped on the picture list or opened from the folder. "Tweak with AI" opens a tab.
  - Spaces: one row per space, choosing "Default (…)" or a set; plus the default set.

## How it behaves

| Status | Duck | Status mark |
|---|---|---|
| working | angry stepped brows that twitch, square eyes, knife on the left jabbing every 700ms while the left wing pushes out | `working` spinner, turning every 900ms |
| blocked, first minute | angry brows, square eyes, bobbing (1200ms) | "Needs you" pill (`blocked` text on `blocked` at 15% alpha); a "!" chip in Priority view |
| blocked, after 60s | scowl: brows twitch up and down (900ms) | same |
| done | blushing cheeks, arched happy eyes, hopping 18 units every 300ms, wings flapping, feet tapping in turn | 7px dot in `done` |
| idle | blushing, happy eyes, gentle bob | 7px ring in `idle` |

- Hover the duck: "Claude Code · working · right-click to change figures".
- Right-click any figure (row or sub-agent): Pond figures on that space's Spaces tab. The
  header duck icon opens it on the Sets tab for the focused space.
- The figure for a row comes from the set the agent's space uses (by space name), else the
  default set, else Classic duck. A slot missing from a set falls back (waiting → blocked,
  then Classic). Every figure takes the duck's box, centred on the duck's body, so rows line up.
- Editor changes save to `~/.config/herdr-app/pond-agents.json` at once. The list rereads the
  file every 4s, so hand edits show within seconds; an invalid file keeps the last good one.
- Picking an animated SVG with Own animation converts it once to an animated WebP (headless
  Chrome renders frames on black and white, ImageMagick joins them) and keeps the original
  as `source`. Without Chrome or ImageMagick the slot shows the error and offers Tweak with AI.
- Tweak with AI: `tab.new` in the Herdr home running the most-picked installed agent
  (`knownAgents()`), with a task describing the set, its pictures and the file format, asking
  it to look and ask before editing; new files go to `pond-figures/<set>/`.
- Click a row: `pane.focus` on its pane. Click a sub-agent: focus it if it has a pane, else
  `terminal.peek`. Click the duck of a parent: fold or unfold its sub-agents.
- Hover a row: the time is replaced by a pin button; click it to `terminal.pin` / unpin.
- Click a group header to fold it; folded it shows its count and most urgent status.
- Click the sort icon: a popup with Priority / Grouped by space (shared `agents.sort`).
- Looking at a done agent keeps it in Done until you leave it. The list order drives
  `agent.next` / `agent.prev`.
- All animation is native `.loop()`; the only timer redraws every 30s (for the
  "how long" labels and the blocked-to-scowl switch, which can therefore lag up to 30s).

## Built from

Clone of shipped `agents` (`cloned_from: {name: "agents", version: "0.1.14"}`). Files:
`mod.json` (`place: none`, title "Agents"), `main.js`, `duck.js`. Differences from shipped:

- `duck.js` (new): `duck(status, height, waitedMs)` draws the duck from absolutely positioned
  rectangles, in SVG units of a 368x240 canvas (`KNIFE_ROOM` 118 + 250 body). `mood()`
  maps working→stab, blocked→angry/scowl (`BLOCKED_SCOWL` 60s), done→happy, else content.
  Motion is `.loop("top" | "left" | "width", {from, to, period, easing})`.
- `figures.js` (new): `SLOTS`, `MOTIONS`, the read-only `SHIPPED` sets, `figureFor(spaceName,
  status, height, waited)`, `figure(spec, height)`, `load`/`save` of `pond-agents.json`
  (`{ default, spaces: { spaceName: setId }, sets: { setId: { name, slots } } }`, written with
  `writeTextFile(path, text, expected)`), `library()` (pictures in `mods/pond-agents/figures/`
  and `pond-figures/`), `addPictures`, `openFolder`. A figure is `{duck, still?}`,
  `{image, motion?, source?}` or `{text: [frames], ms?, motion?}`; text steps with `.frames()`,
  motion is `.loop("top" | "left" | "opacity")`.
- `editor.js` (new): the `Editor` class drawn when `props().figures`; the dialog opens
  `mod: "pond-agents"`, `kind: "dialog"`, props `{figures: true, space?}`.
- `animate.js` (new): `svgAnimates`, `PLAYS` (gif/webp), `svgToWebp` (Chrome + `magick`).
- `duck.js` also exports `duckMood(mood, height, {still})`, `MOODS` and `DUCK_CENTER`.
- `figures/`: shipped pictures folder (only a README for now); `sparkles.svg`, `duck-icon.svg`.
- `main.js`: drops the `icon()` program-icon helper and the `image` import; rows use
  `duck(a.status, 45, now - since)` and sub rows `duck(st, 27, …)`; row 66px with `pl(4)`,
  gap 6; name/detail stacked in a `v_flex` instead of "name · detail" on one line; the duck
  gets a tooltip and is always shown; adds `contextBar()`; the sort popup opens
  `mod: "pond-agents"` (shipped opens `agents`).
- Context data: terminal labels `claude.context` (0–100) and `claude.model`, read from
  `terminals()[i].labels`.
- herdr: `agents`, `terminals`, `panes`, `focused`, `spaces`, `run`, `theme`, `shared`,
  `setShared`, `setAgentOrder`, `openOverlay`, `closeOverlay`, `props`, `window`, `layout`,
  `localStorage` (state-change times, `changed`). Commands: `pane.focus`, `terminal.peek`,
  `terminal.pin`, `layout.resize` (rail toggle).
- Icons borrowed from the shipped `workspace-chrome` mod: `spinner`, `pin`, `pin-off`,
  `clock`, `layers`, `check`, `chevron-down`, `chevron-right` (`.svg`).

## Watch out

- It runs programs and writes outside its folder: `pond-agents.json` and `pond-figures/` in
  the Herdr home, `exec` of `mkdir`, `cp`, `rm`, `open`/`xdg-open`/`explorer`, and for SVG conversion Chrome
  (or Chromium, Edge, Brave) and ImageMagick. Tweak with AI starts an agent in a new tab.
- Sets are picked by space **name**: renaming a space loses its pick.
- Herdr glitches on animated WebP frames that only carry what changed; write whole frames.

- The context bar only appears if something sets the labels. Here that is a Claude Code
  status line script that runs, when `$HC_TERMINAL_ID` is set:
  `hc label "$HC_TERMINAL_ID" "claude.context=$pct" "claude.model=$model"` (pct from
  `.context_window.used_percentage`, model from `.model.display_name`), only on change and
  in the background. Without it rows simply have no bar.
- Herdr draws SVG still, so an animated SVG duck won't move; build it from divs and loops.
  Herdr can't rotate either: the happy wings lift instead of swinging.
- Keep the knife room in the canvas for every mood, or the body jumps when a duck starts working.
- The popup `mod` name must match the folder; a clone under another name must change it.
- Rows are 66px: about half as many agents fit as with the shipped list.
- Theme-independent duck colors: it is the same yellow on light and dark themes.

## Done when

- `herdr-app check ~/.config/herdr-app/mods/pond-agents` passes.
- A layout block with `{ "mod": "pond-agents" }` shows the "Agents" header and a 45px duck per agent.
- A working agent's duck jabs its knife and the row shows the spinner; a blocked agent shows
  "Needs you" and its duck scowls after a minute; a finished one hops; an idle one bobs.
- A Claude Code agent with the status line labels shows a colored context bar and its model.
- The sort popup switches between Priority and Grouped; clicking a row focuses that agent's pane.
- Narrowing the sidebar below 160px shows the numbered rail without ducks.
- The header duck icon opens Pond figures; choosing Emoji pond for a space switches that
  space's agents to emoji and writes `pond-agents.json`; right-clicking a figure opens it on
  that space.

## Changes

### 1.0.0 (2026-11-11)

- First versioned release.
- Figure sets per space: the duck, a still duck, emoji or your own pictures, chosen in the Pond figures dialog (2026-11-11).
- Pictures keep their own animation (GIF, WebP; animated SVGs converted once), and Tweak with AI hands a set to an agent (2026-11-11).
