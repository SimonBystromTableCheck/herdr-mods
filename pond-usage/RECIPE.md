# Pond Usage

Claude usage cards at the bottom of the sidebar, one per Claude account you pin from the Claude
panel. A gateway account shows each provider's token budget as a bar, the end-of-day forecast and
the spend; a claude.ai plan shows its session and weekly limits and when the session resets. The
block grows to fit its cards and shrinks to nothing when none are pinned; clicking a card opens
the Claude panel. Originally written by Anthony Chapé for Pond (github.com/anthonychape-tc/herdr-pond)
for one hard-coded account; rewritten here for any number of pinned accounts.


**Install:** tell your Herdr agent "Install the Herdr mod at
https://github.com/SimonBystromTableCheck/herdr-mods/tree/main/pond-usage". What the agent does:

1. Install `pond-profiles` from this repo first (with its cvm setup): this mod asks it for every
   number it shows.
2. Copy `mods/pond-usage/` into `~/.config/herdr-app/mods/` and run
   `herdr-app check ~/.config/herdr-app/mods/pond-usage`.
3. Put its block in a personal layout's `sidebar` column, above the footer (Herdr's own layouts are
   read-only: clone `main` first with `herdr-app do layout.clone '{"name":"main","as":"my-main"}'`):
   `{ "id": "usage", "type": "block", "content": { "mod": "pond-usage" }, "size": { "px": 0 } }`.
   The mod sets the height itself. On `pond-tree` (this repo) the block is already there.
4. Tell the person to pin an account: the pin icon in the Claude panel's Usage section.

**Version:** 1.0.0 (see Changes at the end; also `"version"` in `mod.json`).

**Update:** no update pill of its own. Tell your Herdr agent "update my herdr mods" (or "update pond mods"). It follows `UPDATE.md`, installed in the mod folder, which checks this repo's `versions.json` and offers every newer version of the mods and layouts you have from here, with a backup of each. By hand: replace `mods/pond-usage/` with this folder's copy (asking an agent to *install* it again adds a second copy instead). Your pins (`pond-usage.json`) live outside the mod folder and are kept; edits you made inside the mod folder are not.

## What you see

A column on `surface`, cards bottom-aligned, 8px side padding, 2px between cards. Each card is
rounded (7), 8px/6px padding, and lights up `hover` under the pointer.

- **Gateway card:** header row (12px): the account's label in `muted`, then a coins icon and the
  first provider's "used / limit" tokens today ("1.2M / 5M"). Up to three provider rows (16px,
  11.5px): name (62px, truncated), a 4px bar, the percentage (30px, `dim`). Foot (11px, `dim`):
  "EOD 42%" (end-of-day forecast, colored by level), "·", "$12.34 spent".
- **Plan card:** header: label, then "Max plan" (the subscription) in `dim`. Up to three limit rows
  ("Session", weekly limits) with bars and percentages. Foot: "Session resets in 2h 10m".
- **Bars and colors:** under 60% the bar is `muted` at 60% opacity; from 60% `working` (amber), from
  80% `blocked` (red); `done` (green) colors low forecasts. Numbers read 950, 46k, 2.8M, 1.6B.
- **Narrow sidebar** (under 160px): label, one big centred percentage (16px semibold, colored by
  level) for the first provider or limit, a 44px bar, and the forecast and spend stacked.
  **Rail** (under 60px): the label's first letter, the percentage (14px) and a 30px bar.
- **No numbers yet:** the label, then "Checking usage…", "Sign in needed", "Sign-in expired",
  "Usage not set up" (both amber), "No usage data" or "Usage unavailable" (red), with a tooltip
  saying what to do or the error.
- A 5px red dot in the header when the last refresh failed but older numbers are still shown.
- Nothing pinned: an empty block resized to 0px.

## How it behaves

- Each pinned account refreshes on start, every 2 minutes and on every click.
- Tooltips: a gateway row gives tokens and requests used of their limits and the projected
  end-of-day percentage; a plan row gives the percentage and time to reset.
- Clicking a card shows the Claude panel: the `panel-body` stack's child running `pond-profiles`
  (`layout.select` + `layout.show {id: "panel"}`), else `mod.open {name: "pond-profiles"}`.
- **Pins:** the list lives in `~/.config/herdr-app/pond-usage.json` (`{"pinned": ["work", ...]}`),
  mirrored live in shared `pond-usage.pinned`. The file is re-read every 3 s, so hand edits show
  within seconds; pinning in the Claude panel shows at once. A broken hand edit keeps the last good list.
- **First run, no file:** if the layout gives the block a `profile` prop, that account is pinned
  and the file written; otherwise nothing is pinned until the person pins one.
- Labels come from `pond-profiles`' `~/.cvm/herdr/pond-profiles.json` (`accounts.<name>.label`),
  re-read every 15 s; else the `label` prop for the `profile` prop, else the capitalised name.
- The block resizes itself (`layout.resize`) to the cards' height whenever it changes.

## Built from

- `main.js`: the view. For each pinned name it runs
  `python3 ~/.config/herdr-app/mods/pond-profiles/ctl.py usage <name>` (60 s timeout) and parses the
  last stdout line: `{kind: "plan", subscription, limits: [{group, label, percent, resetsAt}]}`, or
  a gateway's `{usage: {providers: {<key>: {tokens_used | credit_adjusted_tokens, token_limit,
  requests_used, request_limit, forecast.tokens.projected_pct_of_limit}}}, budget:
  {current_spend_usd}}`, or `{ok: false, error}` / `signedIn`, `expired`, `configured` flags.
  `ctl.py` holds the tokens and never prints a secret. Known provider keys get display names and a
  fixed order (`NAMES`, `ORDER`); others are title-cased.
- `usage-pins.js`: `pinnedUsage`, `loadUsagePins`, `saveUsagePins`, `toggleUsagePin`. An identical
  copy lives in `pond-profiles`, which draws the pin icons; keep the two the same.
- `mod.json`: `"usage_pins": true` tells `pond-profiles` (1.5.0 or later) to show its pin icons.
- `herdr`: `exec`, `appHome`, `home`, `theme`, `props`, `checking`, `layout`, `run`, `settings`
  (zoom), `readTextFile`, `writeTextFile`, `shared`, `setShared`.
- Commands: `layout.resize {id, px}` (its own block, found by `content.mod`), `layout.select`,
  `layout.show`, `mod.open`.
- Files: `main.js`, `usage-pins.js`, `mod.json`, `coins.svg`, `UPDATE.md`.
- Props (both optional): `profile` (the account pinned on first run), `label` (its label).

## Watch out

- It requires `pond-profiles` and its cvm setup, plus `python3` on PATH. Without them every card
  reads "Usage unavailable"; with no usage set up for an account in the Claude panel, "Usage not set up".
- Only one copy should be in a layout: the resize looks up the first block running `pond-usage`.
- The height is measured with `on_size_change` on an inner column, not the mod's root (a size
  handler on the root renders blank on some versions).
- Sidebar width is read from the layout node with id `sidebar`; under another id it always draws
  the wide card.
- Only the first three providers or limits show per card.
- It runs a program (`python3 ... ctl.py`), which reaches the network (claude.ai or your gateway),
  and reads `~/.cvm/herdr/pond-profiles.json`, outside its own folder.

## Done when

- `herdr-app check ~/.config/herdr-app/mods/pond-usage` passes.
- With nothing pinned, the `usage` block is 0px tall and nothing shows.
- Pinning a claude.ai account in the Claude panel adds a plan card with session and weekly bars and
  "Session resets in …"; the block grows to fit.
- Pinning a gateway account adds a card with provider bars, "EOD …%" and "$… spent".
- Editing `pond-usage.json` by hand to remove a name removes its card within a few seconds.
- Clicking a card opens the Claude panel.
- Folding the sidebar to the rail shows each card as a letter, a percentage and a short bar.

## Changes

### 1.0.0 (2026-11-26)

- First published release: one card per Claude account pinned from the Claude panel (gateway
  budgets, forecast and spend; claude.ai plan limits and reset), replacing the original single
  hard-coded account.
