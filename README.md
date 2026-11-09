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

It follows the "Layouts and mods other people made" steps in your `~/.config/herdr-app/AGENTS.md`: read the recipe, copy `mods/<name>/`, merge `keys.json` if there is one, `herdr-app check`.

## Layout

| Layout | |
| --- | --- |
| [pond](pond/) | Herdr's main layout with my own tabs, agents and files panels, and git, skills, todos, servers and remote-checker panels on the right |

## Mods

| Mod | |
| --- | --- |
| [git](git/) | a lazygit-style git panel: sections, vim-ish keys, writes run in core terminals, conflicts handed to an agent |
| [leader](leader/) | a tmux-style prefix: `ctrl-a`, then a key, with a popup of the bindings |
| [todos](todos/) | todo pages as Markdown files in `~/.config/herdr-app/todos` |
| [servers](servers/) | local dev servers as labelled herdr-core terminals that survive restarts |
| [remote-checker](remote-checker/) | the focused branch's GitHub pull request: CI checks, reviewers, comments, diff size and commits, refetched every 10s |
| [skills](skills/) | Claude skills (personal and the repo's): run, edit, scaffold |
| [pond-agents](pond-agents/) | Herdr's agents list with a pixel duck per agent that acts out its status, plus the Claude context bar and model |
| [pond-files](pond-files/) | Herdr's Files panel with focus, vim keys and a key bar |
| [pond-tabs](pond-tabs/) | Herdr's tab bar with Git, Skills, Todos, Servers and PR panel buttons (needs those mods) |

Some panels integrate with [herdr-gitview](https://github.com/ChmaraX/herdr-gitview) when it's installed. It isn't part of this repo.

## For me: keeping this in sync

The live copies are in `~/.config/herdr-app` (Herdr hot-reloads from there, and not through symlinks).
This repo is a snapshot of them:

- `./sync.sh`: copies the mods and layouts listed in `items.conf` from the config into their item folders, and `keys.json` / `settings.json` into `machine/`.
- `./install.sh [--machine]`: copies everything back into `~/.config/herdr-app` on a new machine; `--machine` also installs `machine/*.json` (old ones kept as `*.bak-<time>`).
- New mod to publish: add a line to `items.conf`, run `./sync.sh`, write its `RECIPE.md`.
