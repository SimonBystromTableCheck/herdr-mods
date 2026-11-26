# Pond Settings

One dialog for everything you installed from this repo. It lists your layouts and mods (not Herdr's
own), with the version you have and the latest published one, and an Update button wherever a newer
version is out, or Update all. Below your layouts, "Available layouts" offers the published layouts
you don't have yet, each with Install. Open it from the command palette ("Pond settings") or the duck
button in pond-tree's sidebar footer.

**Install:** tell your Herdr agent "Install the Herdr mod at
https://github.com/SimonBystromTableCheck/herdr-mods/tree/main/pond-settings". What the agent does:

1. Copy `mods/pond-settings/` into `~/.config/herdr-app/mods/` and run
   `herdr-app check ~/.config/herdr-app/mods/pond-settings`.
2. Nothing else: its `mod.json` adds "Pond settings" to the command palette. The `pond-tree`
   layout's footer (`pond-chrome`) already has the duck button.

It reaches the network: it fetches `versions.json` from raw.githubusercontent.com. Updates and
installs start Claude (`claude`) in a new tab, only after you confirm.

**Version:** 1.0.0 (see Changes at the end; also `"version"` in `mod.json`).

**Update:** it lists itself: when a newer pond-settings is out, its own row shows Update. Or tell
your Herdr agent "update my herdr mods"; it follows `UPDATE.md`, installed in the mod folder. By hand:
replace `mods/pond-settings/` with this folder's copy. It keeps no data of its own.

## What you see

A 640×600 dialog on `popover`:

- **Header** (1px `border` below): "Pond settings" (15px semibold) over a `dim` line: "N updates
  available" or "Everything from herdr-mods is up to date", then " · Checked N min ago" (or "Checking
  GitHub…", "Not checked yet", or "Couldn't check: …" in `blocked`). Right: **Update all (N)** (only
  with two or more updates), **Check now**, and a 26px close `x`.
- **Column heads**, 10.5px `dim`: NAME, INSTALLED, LATEST.
- **Sections** (each hidden when empty), rows 36px, radius 6, `hover` background:
  - **Layouts**: your layout files.
  - **Available layouts** ("try one: yours stays as it is"): published layouts you don't have, with
    "adds N mods" and the published version, and an **Install** button.
  - **Mods from herdr-mods**: mods linked to this repo, and unlinked ones with a published name.
  - **Your other mods** ("not published, so no updates"): local mods and your own copies.
- A row: name (13px), the mod's title in `dim` if different, an "as <name>" tag when installed under
  another name, installed version (JetBrains Mono, `muted`), `→`, latest version, then its status:
  - **Update to x.y.z**: a solid (`solid`/`solid_foreground`) button;
  - **Up to date**: check icon, `dim`; **Not published** (linked but not in `versions.json`);
  - **Not linked**: a published name installed without a `source` (tooltip: updates leave it alone);
  - **Your copy**: a clone of a published item (tooltip: never updated);
  - **Local**: anything else.
  Buttons: 26px, radius 6, 12px medium text; secondary ones `raised` with an `input` border.

## How it behaves

- On open it scans `mods/*/mod.json` and `layouts/*.json`, skipping names in `installed.json`
  (Herdr's own; layouts as `layout:<name>`). It fetches `versions.json` if the cache is older than
  5 minutes, from another repo, or lacks layouts. **Check now** fetches again.
- **Update** (one) or **Update all**: a `confirm` dialog listing `name old → new`; on confirm,
  `tab.new` named "Update <name>" (or "Update pond") in the Herdr home, running `claude` with a task:
  update just these, following the mod's own `UPDATE.md` (one mod) or the repo's `tools/UPDATE.md`,
  don't ask again, show the new Changes entries, still ask before replacing personal edits or keys.
- **Install** (available layout): a confirm naming the mods it adds; then a Claude tab "Install
  <name>" told to read the recipe, report what reaches outside its folder, copy the layout and missing
  mods keeping their `source` stamps, never overwrite, offer updates for older mods, run
  `herdr-app check`, and never switch layouts (Settings → Look or ctrl-shift-L).
- Close: the `x` or Escape.

## Built from

- `main.js` (one `View`), `mod.json` (`"place": "none"`, overlay 640×600, a `palette` entry running
  `mod.open {name: "pond-settings"}`), `icons/check.svg`, `icons/x.svg`, `UPDATE.md`.
- Published versions: `https://raw.githubusercontent.com/SimonBystromTableCheck/herdr-mods/main/versions.json`.
  Cached in shared `herdr-mods.versions` (`{repo, at, mods: {name: version}, layouts: {name: version}}`),
  the same cache the mods' update pills (`update.js`) read. Each layout's `item` and `mods` go in a
  separate shared key, `pond-settings.layouts`, so the pills' cache keeps its shape.
- Status: a mod or layout whose `source.repo` is this repo compares `version` with the published one
  under `source.mod` / `source.layout`; one with `cloned_from` a published name is "Your copy".
- `herdr`: `appHome`, `readTextFile`, `openOverlay`, `closeOverlay`, `props`, `shared`, `setShared`,
  `theme`, `checking`; `fs/promises` `readdir`; `fetch`. Shipped mod `confirm`. Command `tab.new`.
- Opened by `pond-chrome`'s footer duck:
  `openOverlay({ mod: "pond-settings", kind: "dialog", width: 640, height: 600 })`.

## Watch out

- It never changes files itself: every update and install is a Claude tab, so `claude` must be on
  PATH. Without it the tab opens a shell that fails.
- "Not linked" items are skipped by updates on purpose; reinstall from this repo to link them.
- Available layouts hides a layout you have under its name or linked by `source.layout`; a renamed
  unlinked copy still shows it as available.
- `checking()` skips the fetch during `herdr-app check`.

## Done when

- `herdr-app check ~/.config/herdr-app/mods/pond-settings` passes.
- The palette's "Pond settings" opens the dialog; Herdr's own mods (`files`, `menu`, ...) aren't listed.
- With an older pond-tabs installed from this repo, its row shows "Update to x.y.z", and the header
  counts it; confirming opens a Claude tab named "Update pond-tabs".
- Without `pond-tree` installed, Available layouts lists it with Install; confirming opens "Install
  pond-tree" and the shown layout doesn't change.
- Offline, Check now shows "Couldn't check: …" in the `blocked` color.

## Changes

### 1.0.0 (2026-11-26)

- First release: installed vs latest versions for your layouts and mods, Update and Update all through
  a Claude tab, Check now, and Available layouts with Install.
