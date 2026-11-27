# Edit space (space-editor)

A small "Edit space" popup that opens at the pointer from a space row in `pond-sidebar`. It shows
the space's current mark and name at the top, then a Name field, a row of colour swatches taken from
the theme, and an icon picker with a search field and two sets: Symbols (about 2,400 Lucide icons)
and Apps (Herdr's own program logos). Save renames the space in Herdr and stores the colour and icon,
which `pond-sidebar` then draws in the space's row.

**Install:** tell your Herdr agent "Install the Herdr mod at
https://github.com/SimonBystromTableCheck/herdr-mods/tree/main/space-editor". What the agent does:

1. Copy `mods/space-editor/` (with its `lucide/` folder) into `~/.config/herdr-app/mods/` and run
   `herdr-app check ~/.config/herdr-app/mods/space-editor`.
2. Install `pond-sidebar` from this repo too: it is what opens the popup (the pencil on a hovered
   space row) and what shows the chosen icon and colour. The popup also draws its "Default folder"
   cell from `mods/pond-sidebar/icons/folder.svg`.

**Version:** 1.0.0 (see Changes at the end; also `"version"` in `mod.json`).

**Update:** no update pill of its own. Tell your Herdr agent "update my herdr mods" (or "update pond mods"). It follows `UPDATE.md`, installed in the mod folder, which checks this repo's `versions.json` and offers every newer version of the mods and layouts you have from here, with a backup of each. By hand: replace `mods/space-editor/` with this folder's copy (asking an agent to *install* it again adds a second copy instead). Your icons and colours live in `~/.config/herdr-app/pond-space-icons.json`, outside the mod folder, and are kept; edits you made inside the mod folder are not.

## What you see

A 304×500 popup on the theme's `popover` background, 14px padding, top to bottom:

- **Header:** a 26px preview tile (radius 6) holding the current icon at 15px, then the name being
  typed (13px semibold, truncated; "Edit space" when empty). Without a colour the tile is `raised`
  and the glyph `foreground`; with one, the glyph takes the colour on a tile mixed 20% of it into
  `popover`.
- **Name:** an 11px `dim` label, then a 30px input (radius 8, `background` fill, 12.5px text, border
  `input`, `accent` while focused). It opens focused with the whole name selected.
- **Color:** eight 24px round swatches (16px dot inside, 2px `foreground` ring on the selected one):
  Default (an empty ring in `input`), then Accent, Red, Yellow, Green, Cyan, Blue, Magenta (theme
  `accent`, `ansi1`, `ansi3`, `ansi2`, `ansi6`, `ansi4`, `ansi5`). Each has its name as a tooltip.
- **Icon:** the "Icon" label with two small tabs on the right, Symbols and Apps, each with its count
  of matches (the shown tab on `selected`). Below, a "Search icons" input styled like Name.
- **Grid:** 180px tall, scrolls with a scrollbar; 32px cells (radius 7, 4px gaps, 16px glyphs, name
  as tooltip). The first cell is "Default folder" (hidden while searching). The selected cell has a
  border in the chosen colour (else `accent`) and a tinted (else `selected`) background; glyphs take
  the chosen colour. SVGs are tinted; PNG logos show as pictures.
  At most 245 cells are drawn; past that, "Showing 245 of N. Type to narrow." When nothing matches:
  "No apps. Try Symbols." / "No symbols. Try Apps." if the other set has matches, else
  "No icons match."
- **Buttons** at the bottom right: Cancel (`raised`, `input` border) and Save (`solid` /
  `solid_foreground`), 28px tall.

## How it behaves

- Typing in Name updates the header live. Enter in Name, or Save, saves; Cancel or Escape closes
  without saving.
- Saving: if the trimmed name differs from the space's current name it runs
  `space.rename {id, name}` (an empty name gives the space Herdr's own name back). If the icon or
  colour changed, it writes them (see Watch out for the format). Then it closes the popup.
- Clicking a swatch picks that colour; Default clears it. Clicking a cell picks that icon; "Default
  folder" clears it.
- It opens on the Apps tab when the current icon is an app logo, otherwise on Symbols. Switching tabs
  or typing in the search scrolls the grid back to the top.
- Search: every space-separated word must appear in the icon's name or (for Symbols) its Lucide
  tags. Results are ordered: name starts with the query, then name contains it, then every word is
  in the name, then tag-only matches; ties A to Z.
- With the search empty, Symbols lists 67 common workspace symbols first (folder-git-2, code,
  terminal, rocket, star, ...), then the rest A to Z. Apps are A to Z.
- Agent status doesn't affect it.

## Built from

- One view, `main.js`; `mod.json` has `"place": "none"`, `"title": "Edit space"` and a 304×500
  `overlay` size.
- Opened by `pond-sidebar` as a popup at the pointer:
  `openOverlay({ mod: "space-editor", kind: "popup", width: 304, height: 500, props: { space, name, icon, color } })`,
  with the space's id and current name, and its icon and colour from `pond-sidebar`'s
  `space-icons.js` (`styleFor`). Herdr adds `props().overlay`.
- `herdr`: `props`, `run`, `closeOverlay`, `theme`, `appHome`, `spaces`, `shared`, `setShared`,
  `readTextFile`, `writeTextFile`; `fs/promises` `readdir` for the Apps list.
- `gpui-base`: `InputState` + `Input` for the two fields, `ScrollHandle` to reset the grid's scroll;
  `gpui-kit` `svg` and `image` for glyphs.
- Command: `space.rename {id, name}`.
- Symbols: `lucide/` holds 2,436 Lucide SVGs, `index.json` (`[[name, tags], ...]`, the search tags)
  and `LICENSE.txt`. Apps: every `.svg`/`.png` in `~/.config/herdr-app/icons` (Herdr's shipped
  program icons), skipping `LICENSE*`; stored as `icons/<file>`.
- Files: `main.js`, `mod.json`, `UPDATE.md`, `lucide/`.

## Watch out

- The Symbols are from `lucide-static` 1.81.0 (ISC license; `LICENSE.txt` is in `lucide/`). Keep the
  licence with them.
- Saved look, in `~/.config/herdr-app/pond-space-icons.json`:
  `{"spaces": {"<space id>": {"icon": "mods/space-editor/lucide/rocket.svg", "color": "ansi4"}}}`.
  `icon` is a path in the Herdr home, `color` a theme colour name (so it follows the theme); either
  key is left out when default, and a space with neither is removed. Other top-level keys in the file
  are kept. The same map is mirrored live in shared state `pond-space-icons`.
- The write is guarded with the text read just before it; if the file changed in between the write
  is dropped silently (shared state still has the new look until `pond-sidebar` next reads the file).
- `pond-sidebar`'s `space-icons.js` reads that file and shared key with identical logic (same `KEY`,
  same path); mods can't import each other, so change both together. `pond-sidebar` also accepts an
  entry that is just a string (an icon); this mod always writes objects.
- Names aren't stored here: they live in Herdr (`space.rename`).
- Nothing in the mod opens it by itself: without `pond-sidebar` (or your own `openOverlay` call with
  the props above) it never appears, and its "Default folder" cell has no glyph.
- Icon paths point into `mods/space-editor/lucide/`; renaming the mod folder breaks saved Symbol icons.
- The grid draws at most 245 cells for speed; search to reach the rest.
- No programs or network; it reads the Herdr home's `icons/` folder and its own `lucide/`, and writes
  only `pond-space-icons.json`.

## Done when

- `herdr-app check ~/.config/herdr-app/mods/space-editor` passes.
- Hovering a space row in `pond-sidebar` and clicking its pencil opens the popup at the pointer with
  the name selected in the Name field.
- Typing a new name and pressing Enter renames the space; saving an empty name restores Herdr's name.
- Picking Blue and the `rocket` symbol, then Save, writes
  `{"icon": "mods/space-editor/lucide/rocket.svg", "color": "ansi4"}` under the space's id in
  `pond-space-icons.json`, and the space row shows a blue rocket on a blue-tinted tile.
- Searching "git" narrows the Symbols count and the grid; the Apps tab shows Herdr's program logos.
- Cancel and Escape close without changes.

## Changes

### 1.0.0 (2026-11-27)

- First published release.
