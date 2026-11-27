# Pond Pins

Shortcut cards for the right-hand panels you use most. In the `pond-tree` layout, a row of square
cards sits at the top of the left sidebar, above the agents tree: one card per pinned panel (Files,
Git, Todos, Servers, ...), with its icon and name. Click a card to open that panel on the right,
click it again to close it. You pin and unpin panels from the tab bar's hamburger dropdown; when
nothing is pinned, the row is gone.

**Install:** tell your Herdr agent "Install the Herdr mod at
https://github.com/SimonBystromTableCheck/herdr-mods/tree/main/pond-pins". What the agent does:

1. Copy `mods/pond-pins/` into `~/.config/herdr-app/mods/` and run
   `herdr-app check ~/.config/herdr-app/mods/pond-pins`.
2. Nothing else. Its `mod.json` `"dock"` asks pond-tabs (1.6.0 or later) to insert its block at the
   top of the `sidebar-lists` column, and only in the `pond-tree` layout. With an older pond-tabs, or
   in any other layout, nothing happens: the mod sits unused and harms nothing. The `pond-tree`
   layout already has the block.

**Version:** 1.0.1 (see Changes at the end; also `"version"` in `mod.json`).

**Update:** this mod has no update pill of its own. Open Pond settings (command palette, or the duck
in pond-tree's sidebar footer) and click Update, or tell your Herdr agent "update my herdr mods". It
follows `UPDATE.md`, installed in the mod folder, which checks this repo's `versions.json` and backs
up what it replaces. By hand: replace `mods/pond-pins/` with this folder's copy. Your pins live
outside the mod folder (`~/.config/herdr-app/pond-pins.json`) and are kept.

## What you see

- One row, 68px tall (8px above and below 52px cards), across the sidebar's width.
- **Cards**: 52px square, radius 8, 1px `border` outline, 6px apart, 12px in from the sides. Each
  has an 18px icon and the panel's title below it (10px, truncated). The open panel's card is
  `selected` with `foreground` text; the others are transparent with `muted` text, `hover` and
  `foreground` under the pointer.
- **Leader tag**: the panel's leader key (its `mod.json` `panel.leader`) in 9px `dim` at the top left.
- **Servers badge**: on the `servers` card, a small `ansi2` (green) tile with `background` text at the
  top right: the number of live terminals labeled `herdr.server`, hidden at 0.
- **Edge arrows**: when more cards are pinned than fit, the row scrolls sideways; a 22px round arrow
  (`raised` with a `border` ring, chevron icon) shows at the left and/or right edge while cards are
  hidden that way, and disappears at each end.
- **Insertion line**: while dragging a card, a 2px dashed `accent` line in the gap where it will land.

## How it behaves

- Click a card: `layout.select {stack: "panel-body", child}` + `layout.show {id: "panel"}`. Click the
  open one: `layout.hide {id: "panel"}`.
- Right-click a card: unpins it.
- Drag a card (press, move over another card, release): it moves to the dashed line; the order is
  saved. Releasing outside the row, or with no line shown, cancels.
- Arrows page: forward brings the card a page past the last whole one to the right edge, back the
  reverse. A trackpad scrolls the row; a plain mouse wheel steps one card per notch.
- **Pinning** is in pond-tabs' hamburger dropdown (props `{"menu": true}`): each panel row has a pin
  icon (`pin` in `accent` when pinned, `pin-off` in `dim` otherwise). The icon shows only when the shown
  layout has a pond-pins block.
- pond-tabs shows the block while at least one pin matches a panel this layout has and the sidebar is
  not a narrow rail (hidden, or under 160px), and hides it otherwise. pond-pins keeps it 68px tall.
- Pins for panels the shown layout lacks are kept (at the end) and come back in a layout that has them.

## Built from

- `main.js`: the row. It finds the `panel` column and `panel-body` stack in `layout()`, and its own
  block by `content.mod === "pond-pins"` (whatever id the dock gave it), and runs
  `layout.resize {id, px: 68}` once if the size differs.
- Titles and icons: `files` and `changes` by child id (`mods/files/file.svg`,
  `mods/changes/changes.svg`); any other child from its mod's `mod.json` `panel` (`title`, `icon` in
  the mod folder, else `mods/workspace-chrome/square.svg`; `leader`), re-read every 15 s. A child with
  no `panel.title` gets no card.
- `pins.js`: the pins file. `~/.config/herdr-app/pond-pins.json` is `{"pins": [panel-body child ids]}`,
  mirrored live in shared state `pond-pins`; read every 3 s (hand edits show), written with
  `writeTextFile` keeping other keys. An identical copy is in pond-tabs (mods can't import each other).
- `mod.json`: `"place": "none"` and
  `"dock": {"into": "sidebar-lists", "at": 0, "id": "pins", "size": 68, "hidden": true, "layouts": ["pond-tree"]}`.
- Scrolling: `ScrollHandle` on an `overflow_x_scroll` rail with spacer divs as end padding (so
  `scroll_to_item` on a spacer shows the padding); arrows recheck the handle 250 ms after layout.
- `herdr`: `run`, `theme`, `layout`, `terminals`, `readTextFile`, `writeTextFile`, `appHome`,
  `settings`, `shared`, `setShared`. Commands: `layout.select`, `layout.show`, `layout.hide`,
  `layout.resize`. Icons from shipped `workspace-chrome` (chevrons, pins).

## Watch out

- An arrow's own hover doesn't stop the card under it from hovering, so the row tracks the pointer
  (`on_mouse_move`, `local_position` divided by `settings().zoom`) and the cards skip hover and click
  while it's on an arrow.
- Drag uses `on_mouse_down` + `on_mouse_move` on each card and `on_window_mouse_up` on the row; a
  window move with no left button pressed cancels a drag that ended outside the window.
- Needs the layout's `panel` column and `panel-body` stack (pond-tree, Pond and copies of Herdr's
  `main` have them). Without pond-tabs 1.6.0 there is nothing to pin with: the row never shows.
- The dock only targets `pond-tree`. In another layout, add a block
  `{ "id": "pins", "type": "block", "content": { "mod": "pond-pins" }, "size": { "px": 68 }, "hidden": true }`
  to a column yourself; pond-tabs then shows pin icons there.
- No programs or network; it reads mod folders' `mod.json` and writes only `pond-pins.json`.

## Done when

- `herdr-app check ~/.config/herdr-app/mods/pond-pins` passes.
- In `pond-tree`, pinning Git and Todos from the hamburger dropdown shows two 52px cards above the
  agents; unpinning both hides the row.
- Clicking Git opens the Git panel and highlights its card; clicking it again closes the panel.
- With eight pins in a 268px sidebar, a right arrow shows; paging to the end hides it and shows a left one.
- Dragging Todos before Git shows the dashed line and swaps them; the order survives a restart and is
  in `pond-pins.json`.
- Starting a server shows a green `1` on the Servers card.

## Changes

### 1.0.1 (2026-11-27)

- Clicking a pinned card now gives that panel the keyboard, as leader + its key does. New file `enter.js` (same copy in pond-tabs).

### 1.0.0 (2026-11-26)

- First release: pinned panel cards in one scrolling row with edge arrows, drag to reorder,
  right-click to unpin, server badge and leader tags; pins kept in `pond-pins.json`; docks itself into
  `pond-tree` through pond-tabs 1.6.0.
