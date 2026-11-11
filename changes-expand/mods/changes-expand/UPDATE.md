# Updating mods from herdr-mods

For the person's agent. This mod came from
https://github.com/SimonBystromTableCheck/herdr-mods (its `mod.json` says so under
`"source"`). When the person asks to update it, or "update pond mods", "update my
herdr mods", "check for mod updates": follow this. It updates every mod and layout
installed from that repo that has a newer published version, not only this one.

Paths are from the Herdr home, `~/.config/herdr-app` (`herdr-app status` names
another if `HERDR_APP_HOME` is set).

## 1. What's installed

- Mods: every `mods/*/mod.json` whose `source.repo` is the URL above. The folder
  name is what it's installed as; `source.mod` is its published name (different
  when it was renamed at install because the name was taken). Its `"version"` is
  the installed one. No `version`: treat it as `0.0.0`.
- Layouts: every `layouts/*.json` whose root `source.repo` is the URL above;
  `source.layout` is the published name.
- A mod or layout without that `source` isn't from this repo: leave it alone, even
  one with the same name. Leave the person's own copies alone too: a mod whose
  `cloned_from.name` is one of this repo's mods (or a layout whose
  `cloned_from.name` is one of its layouts) was duplicated with `mod.clone` /
  `layout.clone` to be edited; it keeps `source` but must never be updated.
  (`cloned_from` naming one of Herdr's own, like `pond-agents`' `agents`, is fine.)

## 2. What's published

Fetch https://raw.githubusercontent.com/SimonBystromTableCheck/herdr-mods/main/versions.json.
`mods.<name>` and `layouts.<name>` give each one's `version`, `item` and `path` in
the repo; `items.<item>` its `recipe` and `keys`. Compare versions as semver.

## 3. Ask first

Show the person a short list, one line each: name, installed → published, and
the new entries of that item's `## Changes` (the `RECIPE.md` at
`https://raw.githubusercontent.com/SimonBystromTableCheck/herdr-mods/main/<recipe>`,
entries above the installed version). Call out major bumps (first number): their
entries say what the person has to redo. Nothing newer: say so and stop.

Ask which to update (default: all). Never update without that answer.

## 4. Update

Clone once: `git clone --depth 50 https://github.com/SimonBystromTableCheck/herdr-mods <tmp>`.

For each chosen mod (folder `mods/<installed>`, published `<path>`):

1. **Own edits.** Find the published copy of the installed version: in `<tmp>`,
   the newest commit where `<path>/mod.json` has the installed `"version"`
   (`git log --format=%H -- <path>/mod.json`, then `git show <sha>:<path>/mod.json`).
   Diff that commit's `<path>` against `mods/<installed>/`. Files that differ
   are the person's own edits: show them and ask before replacing. Not found
   (shallow clone, very old version): say you can't tell and ask.
2. **Back up** the installed folder to `backups/mods/<installed>-<version>-<time>/`
   in the Herdr home. Never inside `mods/`: a folder there loads as a mod.
3. **Replace:** `rsync -a --delete <tmp>/<path>/ mods/<installed>/`. Herdr reloads
   it at once. Installed under another name: redo that install's renames in the
   new files (its own `mods/<published>/` paths and self-opening overlay names).
4. **Keys:** if the item has `keys` and that file changed since the installed
   version, merge it into `keys.json` as at install: add new keys, ask before
   replacing a key the person uses.
5. `herdr-app check mods/<installed>`. On failure: put the backup back, tell the
   person, continue with the rest.

Layouts: the same, with `layouts/<installed>.json` (back up to
`backups/layouts/`). Update the mods the layout lists in the same run (ask for
those too). Never touch `layouts/.state/`: the person's clicks (sizes, shown
panels) live there and survive. Then `layout.switch` to it only if it was showing.

Never touch the person's data outside these folders: `pond-agents.json`,
`pond-figures/`, `servers.json`, `todos/`, `shared.json`, `data/`.

## 5. Finish

Run `herdr-app status` and fix or report any errors. Tell the person what was
updated (old → new), where the backups are, any keys merged, and anything the
Changes entries say to do by hand (for the `pond` layout: reapply the gitview
patch after a gitview update). Delete `<tmp>`.
