# Pond Chrome

The top and bottom of Pond's sidebar, from one mod used twice. At the top, the brand bar: a small
pixel duck and "Pond", a search button and a button that folds the sidebar to a narrow rail. At
the bottom, the footer: Settings, Add machine and a duck button that opens Pond settings, with an
optional seven-day token sparkline at its right end. Folded to the rail, the top becomes one expand
button and the footer one gear that opens a small menu. Cloned from `harns-chrome` in azaeldrm's
Harness layout (github.com/azaeldrm/harns-layout, MIT; `LICENSE` in the folder), adapted for Pond by
Anthony Chapé (github.com/anthonychape-tc/herdr-pond) and published here with his permission.


**Install:** tell your Herdr agent "Install the Herdr mod at
https://github.com/SimonBystromTableCheck/herdr-mods/tree/main/pond-chrome". What the agent does:

1. Copy `mods/pond-chrome/` into `~/.config/herdr-app/mods/` and run
   `herdr-app check ~/.config/herdr-app/mods/pond-chrome`.
2. Put its two blocks in a personal layout's `sidebar` column (Herdr's own layouts are read-only:
   clone `main` first with `herdr-app do layout.clone '{"name":"main","as":"my-main"}'`):
   - first child: `{ "id": "brand", "type": "block", "content": { "mod": "pond-chrome" },
     "size": { "px": 46 }, "window_drag": true }`;
   - last child: `{ "id": "sidebar-footer", "type": "block", "content": { "mod": "pond-chrome",
     "props": { "footer": true } }, "size": { "px": 44 } }`.
   On macOS also set the root's `"titlebar": "none"` so the brand bar sits where the title bar was.
   On `pond-tree` (this repo) both blocks are already there.
3. Install `pond-settings` from this repo too: the footer's duck opens it.

**Version:** 1.0.0 (see Changes at the end; also `"version"` in `mod.json`).

**Update:** no update pill of its own. Tell your Herdr agent "update my herdr mods" (or "update pond mods"). It follows `UPDATE.md`, installed in the mod folder, which checks this repo's `versions.json` and offers every newer version of the mods and layouts you have from here, with a backup of each. By hand: replace `mods/pond-chrome/` with this folder's copy (asking an agent to *install* it again adds a second copy instead). Your settings and data live outside the mod folder and are kept; edits you made inside the mod folder are not.

## What you see

Both blocks fill their slot with the theme's `surface`.

- **Brand bar** (no props), 13.5px text, 12px left / 10px right padding, 4px gaps; on macOS the left
  padding is 76px to clear the traffic lights. Left: a 20px square holding a still pixel duck (14px
  tall, cropped to 15×14, drawn as native rectangles), then "Pond" (14px bold, `foreground`).
  Right: two 26px buttons, radius 6, `muted` icons turning `foreground` on a `hover` background:
  search (magnifier) and sidebar toggle.
- **Footer** (`"footer": true`), 12px side padding, 2px gaps: three 28px buttons, radius 7, 15px
  icons in `muted`: Settings (gear; a 6px `accent` dot at its corner when an app update is ready,
  tooltip "Settings · update ready"), Add machine (server), and Pond settings (the duck, tooltip
  "Pond settings"). When token usage is set to the footer, a spacer pushes a usage sparkline to the
  right end: the last seven days as 4px columns (16px tall, today in `accent`, the rest `muted`
  faded), then a coins icon and today's tokens in `muted` 11.5px ("46K", "2.8M").
- **Folded** (the `sidebar` node narrower than 160px): the brand bar shows only a centred 28px
  expand button (tooltip "Expand sidebar"); the footer shows only a centred 28px gear (24px buttons
  in the rail) with the same update dot.

## How it behaves

- Search opens Herdr's `picker` (`mod.open {name: "picker"}`).
- Sidebar toggle / Expand: folding remembers the sidebar's current width in shared `sidebar.width`,
  sets shared `sidebar.collapsed`, and resizes `sidebar` to 76px on macOS (room for the traffic
  lights) or 52px elsewhere; expanding resizes it back to the remembered width (268 if none).
- The brand bar's `window_drag` block moves the window; its buttons stop the press so they still click.
- Settings runs `app.settings`; Add machine opens Herdr's `machine-add` dialog; the duck opens
  `pond-settings` as a 640×600 dialog.
- Folded gear: opens a 210px menu beside the rail (popover, `popover` background, `border`, shadow)
  with Settings (plus an `accent` dot and "update" when one is ready), Add machine and Pond settings.
  A pick, a click outside or Escape closes it.
- Footer usage: resting on the sparkline for 450 ms hangs a 320px "Token usage" card beside the
  sidebar: each of the last 14 days, newest first, with a bar split by harness (Claude Code
  `#d97757`, Codex `#8b9cf7`, OpenCode `#6cc4a1`, Pi `#d4b85c`), fresh and cached tokens, a legend,
  and totals (sum, average per day, cached). Machines that couldn't be read are named at the bottom.
  Leaving closes it. Before any reading the card says "Reading the harnesses' logs…".
- Agent status doesn't change anything here: the ducks are always the still "content" mood.

## Built from

- A clone of `harns-chrome` (`mod.json` has `cloned_from: { name: "harns-chrome", version: "0.1.16" }`).
  Differences from upstream:
  - The upstream "harns settings" button is removed (it opened a `harns-settings` mod that was never
    part of Pond).
  - The footer's duck button and the rail menu's "Pond settings" item open `pond-settings`
    (`openOverlay({ mod: "pond-settings", kind: "dialog", width: 640, height: 600 })`).
  - The brand shows the duck and "Pond" instead of Harness's logo.
- `main.js`: one view; `props().footer` picks footer or brand bar. `layout.js`: `find(node, id)` and
  `narrow()` (sidebar `size.px` < 160). `duck.js`: the pixel duck as divs (`duckMood("content", 14,
  { still: true })`; other moods animate with `.loop()` but aren't used here). `token-usage.js`:
  `usageDays`, `formatTokens`, `usagePlace`, plus the reader (`TOKEN_PROBE`, `collectUsage`) other
  mods use. `usage-card.js`: `usageSpark` and `usageDetails`.
- Token usage is read from shared state, never collected here: `usage.tokens` (`{hours, errors, at}`,
  quarter-hour token counts per machine and harness) is written by `pond-sidebar` from this repo.
  The footer shows it only when shared `harness.usage` is `"footer"` (default `"strip"`: shown by the
  sidebar instead).
- `herdr`: `theme`, `run`, `props`, `window`, `shared`, `setShared`, `updates` (`app.ready`),
  `layout`, `openOverlay`; `gpui-base` `Popup` and `Popover`.
- Commands: `layout.resize {id: "sidebar", px}`, `app.settings`, `mod.open {name}`.
- Shipped mods used: `picker`, `machine-add`. Icons are in `icons/` (`settings`, `server`, `search`,
  `sidebar`, `coins`, ...).
- Files: `main.js`, `layout.js`, `duck.js`, `token-usage.js`, `usage-card.js`, `mod.json`,
  `LICENSE`, `UPDATE.md`, `icons/`, `harness-logo*.svg/.webp` (upstream art, not drawn).

## Watch out

- Without `pond-settings` installed, the duck button and the rail menu's Pond settings item do
  nothing useful: the overlay can't load its mod (Herdr logs the error).
- It expects the sidebar column's id to be `sidebar`, with a `px` size: otherwise it never folds to
  the rail and the toggle can't remember a width.
- Footer usage needs a mod writing `usage.tokens` (`pond-sidebar`) and something setting shared
  `harness.usage` to `"footer"`; nothing in this repo sets it, so by default the footer shows no usage.
- "Pond" is hard-coded in `main.js`; change it there for another name.
- The 76px macOS padding assumes the traffic lights sit at their default spot.
- No programs, files or network of its own.

## Done when

- `herdr-app check ~/.config/herdr-app/mods/pond-chrome` passes.
- The brand bar shows the duck, "Pond", search and the sidebar toggle; search opens the picker.
- The footer shows gear, server and duck; the duck opens Pond settings at 640×600.
- The toggle folds the sidebar to 76px on macOS (52 elsewhere), showing the expand button and a lone
  gear whose menu lists Settings, Add machine and Pond settings; expand restores the old width.
- With `setShared("harness.usage", "footer")` and `pond-sidebar` reading usage, the footer shows the
  seven-day sparkline and hovering it opens the two-week card.

## Changes

### 1.0.0 (2026-11-26)

- First published release: Harness's chrome adapted for Pond (duck brand, Pond settings button and
  rail menu item; harns settings button removed).
