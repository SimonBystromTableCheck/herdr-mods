# Contributing

Pull requests are welcome: fixes, new behaviour in a mod, or a new mod. Fork the repo, make
your change on a branch and open a pull request against `main`.

## How the repo is laid out

Each item is a folder laid out like `~/.config/herdr-app`, as on herdr.dev:

- `<item>/RECIPE.md`: the brief an agent builds or installs it from, ending in `## Changes`.
- `<item>/mods/<mod>/`: the mod's files. `pond/layouts/pond.json`: the layout.
- `items.conf`: which mods and layouts each item holds. **A mod can sit in more than one item**:
  `git` is in `git/mods/git/` and in `pond/mods/git/`, `todos` in `todos/` and `pond/`, and so on.
  Change every copy the same way.
- `versions.json`, `UPDATE.md` in every mod folder and `"source"` in each `mod.json` / layout are
  written by `tools/stamp.py`. Don't edit them by hand; run it (below).
- `update.js` and `panel.js` are the same file in every mod that has them: `tools/stamp.py`
  refuses copies that differ, so edit one and copy it to the others.

## Making a change

1. **Try it in your own Herdr.** Copy the mod folder into `~/.config/herdr-app/mods/`
   (keep a backup of yours), make the change there, and run
   `herdr-app check ~/.config/herdr-app/mods/<mod>`: it must pass. Use it in the app too.
   Then copy the changed files back into every item folder that has that mod.
2. **Bump the version** in the mod's `mod.json` (`"version"`): patch for a fix, minor for new
   behaviour, major when people must redo something (merge keys, change their layout, move
   settings). If the mod is in `pond` (see `items.conf`), bump `"version"` at the top of
   `pond/layouts/pond.json` too (patch at least).
3. **Write it down.** Add a `### x.y.z (YYYY-MM-DD)` entry at the top of the recipe's
   `## Changes`, one bullet per change, and update its `**Version:**` line. Update the recipe's
   other sections where behaviour, keys, files or dependencies changed. For a `pond` bump, add an
   entry to `pond/RECIPE.md` listing the mod versions. Update the item's row in `README.md`.
4. **Stamp:** `python3 tools/stamp.py .` refreshes `versions.json` (what the update pills read),
   the `UPDATE.md` copies and the `"source"` stamps. Commit what it changes.
5. **A new mod:** add a line to `items.conf`, a folder with its `mods/<mod>/`, a `RECIPE.md` in
   Herdr's recipe format (see "RECIPE.md" in `~/.config/herdr-app/AGENTS.md`: what you see, how
   it behaves, built from, watch out, done when; plus Install, Version, Update and Changes) and a
   README row. A panel for the right-hand column declares `"panel"` in its `mod.json`; copy
   `todos/` as the example.

## Keep out

- Personal paths (`/Users/...`), tokens, account names, work repo or branch names, in code, docs
  or screenshots (a `preview.png` must not show terminal content or work repos).
- Third-party mods (gitview and the like): link to them instead.
- `machine/`: the maintainer's own keys and settings.

## In the pull request

Say what changes for someone using the mod, how you tried it (`herdr-app check` and what you did
in the app), and add a screenshot for anything visual. The template asks for the rest.

## After it's merged

The maintainer's live config is the source the repo is synced from, so a merged pull request is
installed into it before the next publish. `sync.sh` checks this: it stops rather than overwrite a
file that changed in the repo since its last sync (`tools/guard.py`). People then get your change
through the update pill in the mod's header.
