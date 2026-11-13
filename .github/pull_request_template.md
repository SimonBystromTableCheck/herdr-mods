## What changes

<!-- What someone using the mod or layout will notice, and why. -->

## How I tried it

<!-- herdr-app check output, and what you did in the app. Screenshots for anything visual
     (no terminal content, personal paths or work repos in them). -->

## Checklist

- [ ] `herdr-app check ~/.config/herdr-app/mods/<mod>` passes for every changed mod
- [ ] Every copy of a changed mod is updated (a mod can be in several item folders: see `items.conf`)
- [ ] `"version"` bumped in each changed `mod.json` (and in `pond/layouts/pond.json` if the mod is in `pond`)
- [ ] A `### x.y.z (YYYY-MM-DD)` entry in the recipe's `## Changes`, its `**Version:**` line and the README row updated
- [ ] The recipe updated where behaviour, keys, files or dependencies changed
- [ ] `python3 tools/stamp.py .` run, and its changes committed (`versions.json`, `UPDATE.md`, `"source"`)
- [ ] `update.js` / `panel.js` still identical in every mod that has them
- [ ] No personal paths, tokens, account names or work repos (code, docs, screenshots)
