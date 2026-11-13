# herdr-mods

My mods and layout for the [Herdr](https://herdr.dev) desktop app. Take any one of them on its own, or the whole layout.

Each folder is laid out like `~/.config/herdr-app` and has a `RECIPE.md` (what it is, how it behaves, what it assumes):

```
todos/
├── RECIPE.md
├── mods/todos/
└── keys.json      (only some: keys to merge into yours)
```

## Install one

Give your Herdr agent the folder's link, e.g.

> Install the Herdr mod at https://github.com/SimonBystromTableCheck/herdr-mods/tree/main/todos

You don't need the `pond` layout for a single mod. The panels (Git, Skills, Todos, Servers, PR, Claude) open from a button in the tab bar, in the right-hand panel next to Herdr's Files and Changes: that button comes from [`pond-tabs`](pond-tabs/), which the panel's install adds if it's missing and sets as your layout's tab bar (on Herdr's own `main` it first makes your own copy, `my-main`, since Herdr's layouts are read-only). Install more panels later and each brings its own button. With [`leader`](leader/), `ctrl-a` and a panel's key opens it too.

It follows the "Layouts and mods other people made" steps in your `~/.config/herdr-app/AGENTS.md`: read the recipe, copy `mods/<name>/`, merge `keys.json` if there is one, `herdr-app check`.

## Update one (or all)

Nothing updates by itself: an installed mod is a copy, not a link to this repo. Tell your Herdr agent:

> Update my herdr mods

(or "update pond mods", "check my Herdr mods for updates"). Or click a panel's update pill: each mod from here shows "Update available" when a newer version is published (and nothing while it's up to date), and confirming starts Claude to update just that one. The pond layout's own pill ("Pond ↑ x.y.z") is in its tab bar. Every mod from here carries `UPDATE.md` and a `"source"` in its `mod.json`, so the agent finds what you installed from this repo, compares each `"version"` with [`versions.json`](versions.json), shows what's newer with its Changes, and updates the ones you pick: it shows your own edits before replacing them, backs each one up to `~/.config/herdr-app/backups/`, merges changed keys, and runs `herdr-app check`. Herdr reloads each mod at once.

- **Kept:** your settings and data. They live outside the mod folder (e.g. `pond-agents.json`, `pond-figures/`, `servers.json`, `todos/`), and Herdr keeps your clicks on a layout (sizes, open panels) in `layouts/.state/`.
- **Replaced:** anything you edited inside `mods/<name>/` or the layout file (the agent asks first and keeps a backup). To keep a changed version for good, duplicate it (`herdr-app do mod.clone '{"name":"pond-agents","as":"my-pond-agents"}'`); clones are never updated.
- By hand: copy the item's `mods/<name>/` over yours. Don't ask an agent to *install* it again: installs never overwrite, so you'd get a second copy (`pond-agents-2`).

Which version you have: `"version"` in `~/.config/herdr-app/mods/<name>/mod.json` (or the root of the layout file). What changed: the **Changes** section at the end of each item's `RECIPE.md`.

## Layout

| Layout | Version | |
| --- | --- | --- |
| [pond](pond/) | 1.9.0 | Herdr's main layout with my own tabs, agents and files panels, and git, skills, todos, servers, remote-checker and Claude profiles panels on the right |

## Mods

| Mod | Version | |
| --- | --- | --- |
| [git](git/) | 1.3.0 | a lazygit-style git panel: a Files tree with a hunk / line staging diff, review notes and Ask AI, sections, vim-ish keys, writes run in core terminals, conflicts handed to an agent, plus a Conflicts pane with a lazygit-style chunk picker |
| [leader](leader/) | 2.0.1 | a tmux-style prefix: `ctrl-a`, then a key, with a popup of the bindings |
| [changes-expand](changes-expand/) | 1.0.0 | `cmd-g` opens [herdr-gitview](https://github.com/ChmaraX/herdr-gitview)'s own tab on the repo you're in, even with its diff pane focused |
| [todos](todos/) | 1.2.0 | todo pages as Markdown files in `~/.config/herdr-app/todos` |
| [servers](servers/) | 1.2.0 | local dev servers as labelled herdr-core terminals that survive restarts |
| [remote-checker](remote-checker/) | 1.4.1 | the focused branch's GitHub pull request (CI checks, reviewers, comments, diff size and commits, refetched every 10s), Mine / Review / Search lists, a GitHub account per space, and gh setup |
| [skills](skills/) | 1.2.0 | Claude skills (personal and the repo's): run, edit, scaffold |
| [pond-agents](pond-agents/) | 1.2.2 | Herdr's agents list with a pixel duck per agent that acts out its status, plus the Claude context bar and model; swap figures per space (emoji, your pictures) |
| [pond-files](pond-files/) | 1.1.2 | Herdr's Files panel with focus, vim keys and a key bar |
| [pond-tabs](pond-tabs/) | 1.4.0 | Herdr's tab bar with Git, Skills, Todos, Servers, PR and Claude account panel buttons (needs those mods) |
| [pond-profiles](pond-profiles/) | 1.4.0 | Claude Code accounts (claude.ai or a gateway) and versions via cvm/cvp: switch, pin per folder, usage limits, updates, agent-router models; with a setup wizard and a one-click update of the panel itself |

Some panels integrate with [herdr-gitview](https://github.com/ChmaraX/herdr-gitview) when it's installed. It isn't part of this repo.

## Contributing

Pull requests are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md) for how the repo is laid out,
versions, recipes and what to keep out. Bugs and ideas: open an issue.

## For me: keeping this in sync

The live copies are in `~/.config/herdr-app` (Herdr hot-reloads from there, and not through symlinks).
This repo is a snapshot of them:

- `./sync.sh`: copies the mods and layouts listed in `items.conf` from the config into their item folders, and `keys.json` / `settings.json` into `machine/`. Then `tools/stamp.py` adds `"source"` to each published `mod.json` and layout, copies `tools/UPDATE.md` into every mod folder and writes `versions.json`; none of that touches the live config.
- `sync.sh` never undoes a merged pull request: `tools/guard.py` remembers what each sync wrote (`.git/herdr-sync-manifest.json`, local) and stops when a file changed in the repo since then and differs from the live config. Install the change into `~/.config/herdr-app` and sync again, or `./sync.sh --overwrite` to replace it on purpose.
- `./install.sh [--machine]`: copies everything back into `~/.config/herdr-app` on a new machine; `--machine` also installs `machine/*.json` (old ones kept as `*.bak-<time>`).
- New mod to publish: add a line to `items.conf`, run `./sync.sh`, write its `RECIPE.md`.
- Changed an item: bump `"version"` in its live `mod.json` (or layout root) — patch for fixes, minor for new behaviour, major when it needs the person to redo something (keys, layout, settings) — add a `### x.y.z (date)` entry to its recipe's Changes, and update the version here.
