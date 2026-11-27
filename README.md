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

You don't need the `pond` layout for a single mod. The panels (Git, Skills, Todos, Servers, PR, Claude, Find) open from a button in the tab bar, in the right-hand panel next to Herdr's Files and Changes: that button comes from [`pond-tabs`](pond-tabs/), which the panel's install adds if it's missing and sets as your layout's tab bar (on Herdr's own `main` it first makes your own copy, `my-main`, since Herdr's layouts are read-only). Install more panels later and each brings its own button. With [`leader`](leader/), `ctrl-a` and a panel's key opens it too.

It follows the "Layouts and mods other people made" steps in your `~/.config/herdr-app/AGENTS.md`: read the recipe, copy `mods/<name>/`, merge `keys.json` if there is one, `herdr-app check`.

## Update one (or all)

Nothing updates by itself: an installed mod is a copy, not a link to this repo. Tell your Herdr agent:

> Update my herdr mods

(or "update pond mods", "check my Herdr mods for updates"). Or click a panel's update pill: each mod from here shows "Update available" when a newer version is published (and nothing while it's up to date), and confirming starts Claude to update just that one. The pond layout's own pill ("Pond ↑ x.y.z") is in its tab bar. With [`pond-settings`](pond-settings/) installed, "Pond settings" in the command palette (or the duck in `pond-tree`'s sidebar footer) shows everything you have from here in one list, installed vs latest, with Update / Update all, and layouts you could try. Every mod from here carries `UPDATE.md` and a `"source"` in its `mod.json`, so the agent finds what you installed from this repo, compares each `"version"` with [`versions.json`](versions.json), shows what's newer with its Changes, and updates the ones you pick: it shows your own edits before replacing them, backs each one up to `~/.config/herdr-app/backups/`, merges changed keys, and runs `herdr-app check`. Herdr reloads each mod at once.

- **Kept:** your settings and data. They live outside the mod folder (e.g. `pond-agents.json`, `pond-figures/`, `servers.json`, `todos/`), and Herdr keeps your clicks on a layout (sizes, open panels) in `layouts/.state/`.
- **Replaced:** anything you edited inside `mods/<name>/` or the layout file (the agent asks first and keeps a backup). To keep a changed version for good, duplicate it (`herdr-app do mod.clone '{"name":"pond-agents","as":"my-pond-agents"}'`); clones are never updated.
- By hand: copy the item's `mods/<name>/` over yours. Don't ask an agent to *install* it again: installs never overwrite, so you'd get a second copy (`pond-agents-2`).

Which version you have: `"version"` in `~/.config/herdr-app/mods/<name>/mod.json` (or the root of the layout file). What changed: the **Changes** section at the end of each item's `RECIPE.md`.

## Layout

| Layout | Version | |
| --- | --- | --- |
| [pond](pond/) | 1.13.0 | Herdr's main layout with my own tabs, agents and files panels, and git, skills, todos, servers, remote-checker, Claude profiles, Find (workbench) and Notes panels on the right |
| [pond-tree](pond-tree/) | 1.1.4 | Pond with one machine → space → agent tree in the sidebar, pinned panel cards, usage cards, a Chat / Terminal view of each agent and the panels in a hamburger menu. Built on [Anthony Chapé's herdr-pond](https://github.com/anthonychape-tc/herdr-pond) and [azaeldrm's Harness](https://github.com/azaeldrm/harns-layout) |

## Mods

| Mod | Version | |
| --- | --- | --- |
| [git](git/) | 2.0.0 | a Workbench-style git panel: branches (local / remote / stashes), history, files and diff side by side, first-class mouse (drag commits to reorder or squash, drag branches to merge) and full vim keys, squash / amend / reword, pull / push / prune, hook failures and conflicts handed to an agent, plus a Conflicts pane with a lazygit-style chunk picker |
| [leader](leader/) | 2.3.0 | a tmux-style prefix: `ctrl-a`, then a key, with a popup of the bindings |
| [todos](todos/) | 1.2.1 | todo pages as Markdown files in `~/.config/herdr-app/todos` |
| [servers](servers/) | 1.3.1 | local dev servers as labelled herdr-core terminals that survive restarts, with Open and Edit buttons |
| [remote-checker](remote-checker/) | 1.4.2 | the focused branch's GitHub pull request (CI checks, reviewers, comments, diff size and commits, refetched every 10s), Mine / Review / Search lists, a GitHub account per space, and gh setup |
| [skills](skills/) | 1.2.1 | Claude skills (personal and the repo's): run, edit, scaffold |
| [pond-agents](pond-agents/) | 1.4.0 | Herdr's agents list with a pixel duck per agent that acts out its status, grouped by space with each space's color, plus the Claude context bar and model; swap figures per space (emoji, your pictures) |
| [pond-files](pond-files/) | 1.1.3 | Herdr's Files panel with focus, vim keys and a key bar |
| [pond-tabs](pond-tabs/) | 1.6.0 | Herdr's tab bar with Git, Skills, Todos, Servers, GH, Claude account and Find panel buttons, reorderable by drag (needs those mods), or all in a hamburger dropdown |
| [pond-profiles](pond-profiles/) | 1.5.1 | Claude Code accounts (claude.ai or a gateway) and versions via cvm/cvp: switch, pin per folder, usage limits, updates, agent-router models; with a setup wizard and a one-click update of the panel itself |
| [workbench](workbench/) | 1.0.1 | an IDE-style Find panel: search across files, mass find & replace with a preview, go to file, format with the repo's own tools (commit hooks, VS Code settings, installed formatters) and delete duplicate lines, with an editable file view |
| [notes](notes/) | 1.1.0 | an Obsidian vault panel: a note per repo and branch with its todos, find by name or text, links and backlinks, edit in nvim, a `feature-todo` helper for agents, and a setup screen that installs Obsidian / ripgrep and picks or creates the vault |
| [pond-settings](pond-settings/) | 1.0.0 | every layout and mod you have from here in one dialog: installed vs latest, update one or all, and install other layouts to try |
| [pond-pins](pond-pins/) | 1.0.0 | pinned panels as small cards in a carousel above the agents (`pond-tree`; pin them from pond-tabs' dropdown) |
| [pond-chrome](pond-chrome/) | 1.1.0 | the sidebar's header (logo, session history, search, fold to a rail) and footer (Settings, Add machine, Pond settings, token usage); from herdr-pond / Harness |
| [pond-sidebar](pond-sidebar/) | 1.2.2 | one machine → space → agent tree with Pond figures, context bars, Claude account and model, machine stats and token usage; from herdr-pond / Harness |
| [pond-usage](pond-usage/) | 1.0.0 | usage cards at the bottom of the sidebar for the Claude accounts you pin in the Claude panel (needs pond-profiles) |
| [agent-chat](agent-chat/) | 1.2.2 | a chat view of an agent's terminal (Claude Code, Codex, OpenCode, Pi): messages, steps, diagrams, a composer, a Chat / Terminal switch and Send to Notes; from herdr-pond / Harness |
| [pond-history](pond-history/) | 1.0.0 | Session history: every Claude Code session by project, filter and search, resume or fork it in a new tab, vim keys; by [Anthony Chapé](https://github.com/anthonychape-tc/herdr-pond), published with his permission |
| [space-editor](space-editor/) | 1.0.0 | Edit space: rename a space and give it a theme colour and an icon (Lucide symbols or program logos), shown in pond-sidebar's tree |

`changes-expand` (a `cmd-g` launcher for [herdr-gitview](https://github.com/ChmaraX/herdr-gitview)'s tab) is retired: Git's Files section replaced gitview here. Its last version is in this repo's history.

## Contributing

Pull requests are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md) for how the repo is laid out,
versions, recipes and what to keep out. Bugs and ideas: open an issue.

## For me: keeping this in sync

The live copies are in `~/.config/herdr-app` (Herdr hot-reloads from there, and not through symlinks).
This repo is a snapshot of them:

- `./sync.sh`: copies the mods and layouts listed in `items.conf` from the config into their item folders, and `keys.json` / `settings.json` into `machine/`. Then `tools/stamp.py` adds `"source"` to each published `mod.json` and layout, copies `tools/UPDATE.md` into every mod folder and writes `versions.json`; none of that touches the live config.
- `sync.sh` never undoes a merged pull request: `tools/guard.py` remembers what each sync wrote (`.git/herdr-sync-manifest.json`, local) and stops when a file changed in the repo since then and differs from the live config. Install the change into `~/.config/herdr-app` and sync again, or `./sync.sh --overwrite` to replace it on purpose.
- `tools/stamp.py` also stops the sync when a published layout shows a mod that's neither published here nor Herdr's own (cut it with `PRIVATE`, or swap the node with `REPLACE`), or when an item's files changed since the last commit but its `"version"` didn't.
- `./install.sh [--machine]`: copies everything back into `~/.config/herdr-app` on a new machine; `--machine` also installs `machine/*.json` (old ones kept as `*.bak-<time>`).
- New mod to publish: add a line to `items.conf`, run `./sync.sh`, write its `RECIPE.md`.
- Changed an item: bump `"version"` in its live `mod.json` (or layout root) — patch for fixes, minor for new behaviour, major when it needs the person to redo something (keys, layout, settings) — add a `### x.y.z (date)` entry to its recipe's Changes, and update the version here.
