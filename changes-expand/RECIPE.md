# Changes Expand

A launcher for gitview's own tab (the diff on the left, the file list on the right) that always
opens on the repo you're in. It's for people who use the third-party
[herdr-gitview](https://github.com/ChmaraX/herdr-gitview) as their Changes panel. On its own,
gitview's tab takes its repo from the focused pane's folder, else the space's. After you pick a
file in Changes, gitview's diff pane (which has no folder) holds the focus, so the tab opened on
the space's folder and said "no changes" whenever the terminal had moved into a repo since the
space was made. This launcher focuses the tab's terminal first. `cmd-g` toggles it: from inside
gitview's tab it closes the tab again. The `leader` mod's `e` uses it too.

**Install:** Point your Herdr agent at this folder: copy `mods/changes-expand/` into
`~/.config/herdr-app/mods/`, merge `keys.json` (it binds `cmd-g`, replacing gitview's
`mod.open:gitview-tab` there), then `herdr-app check ~/.config/herdr-app/mods/changes-expand`.
Needs gitview installed (its `gitview-tab` mod) and `herdr-app` on the PATH that Herdr's `exec`
sees (macOS installs link it at `~/.local/bin/herdr-app`).

**Version:** 1.0.0 (see Changes at the end; also `"version"` in `mod.json`).

**Update:** ask your Herdr agent to update it from this folder, replacing `mods/changes-expand/` (say *update*: installing again adds a second copy next to the old one). Your settings and data live outside the mod folder and are kept; edits you made inside the mod folder are not. If its `keys.json` changed, merge it again.

## What you see

Nothing of its own: a 2x2px frameless window that closes at once. Then gitview's tab opens, or
closes if you're already in it.

## How it behaves

- Opened (`cmd-g`, or `herdr-app do mod.open '{"name":"changes-expand"}'`), it reads `focused()`:
  - If the focused pane has no folder (a mod pane such as gitview's diff pane), and the tab isn't
    one of gitview's own tabs, it focuses the first terminal pane in that tab that has a folder.
  - Inside gitview's own tab (`shared("gitview.own")`), it leaves the focus alone, so gitview
    closes the tab and goes back to where you were.
- It closes its own window, then asks the app to open `gitview-tab` with
  `herdr-app do mod.open '{"name":"gitview-tab"}'`. If that fails, an error toast says so.
- Under `herdr-app check` (no overlay in `props()`) it does nothing.

## Built from

- `main.js` (one `View` doing it all in `init`, rendering an empty `div`), `mod.json`:
  `{ "place": "none", "title": "Changes: expand into gitview's tab", "overlay": { "kind": "window", "width": 2, "height": 2, "frame": "none" } }`.
- herdr: `focused`, `panes`, `shared("gitview.own")`, `props().overlay`, `closeOverlay`, `run("pane.focus")`, `exec`, `notify`.
- Program: `herdr-app do mod.open`.
- `keys.json`: `{ "global": { "cmd-g": "mod.open:changes-expand" } }`.

## Watch out

- A launcher window (`gitview-tab`) opened with `run("mod.open")` from another overlay's handler
  (this one, or the leader's popup) stays open and never starts, whichever order the opener
  closes in. Opened from outside (a key, the CLI) it works. That's why this goes through
  `herdr-app do` and not `run`, and why the `leader` mod opens this launcher the same way. A
  timed close (open, then close the opener 80ms later) also works, but it's what this replaces.
- `herdr-app check` runs `init`. Without the `props().overlay` guard, the check itself toggled
  gitview's tab in the real window.
- gitview's list still does one status on the space's folder as it starts, before it reads the
  folder it was given. 12ms later it loads the right repo; that's gitview's, and harmless.
- Doesn't change gitview's files. Without gitview installed, the CLI call fails with an
  unknown mod, shown as a toast.

## Done when

- `herdr-app check ~/.config/herdr-app/mods/changes-expand` passes and doesn't open anything.
- In a space made in `~` whose terminal has since `cd`'d into a repo with changes: open Changes,
  pick a file (the diff pane opens), press `cmd-g`. gitview's tab opens and lists the changes.
- `cmd-g` inside gitview's tab closes it and goes back to the tab you came from.
- After either, `herdr-app status` shows no overlays left.

## Changes

### 1.0.0 (2026-11-11)

- First versioned release: `cmd-g` opens gitview's tab on the repo you're in, and closes it from inside (2026-11-10).
