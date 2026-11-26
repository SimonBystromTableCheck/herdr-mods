# Agent Chat

A chat view for the agent in the shown tab. Instead of the terminal, the person sees the conversation
as a chat: their messages as bubbles on the right, the agent's replies as Markdown with code blocks,
diagrams and folded tool steps, and a rounded message box at the bottom that types into the live
terminal. Under the box: the model (a menu to switch it), the effort, the permission mode and how full
the context is. When the agent asks a question, its choices show as a card above the box. A button in
the header flips between Chat and the real terminal, and each conversation remembers which one it was
left in. It works with Claude Code, Codex, Pi and OpenCode, on this computer or another machine.
Originally from azaeldrm's Harness layout (github.com/azaeldrm/harns-layout, MIT), adapted for the
Pond layout by Anthony Chapé (github.com/anthonychape-tc/herdr-pond), published here with his
permission.

**Install:** tell your Herdr agent "Install the Herdr mod at
https://github.com/SimonBystromTableCheck/herdr-mods/tree/main/agent-chat". What the agent does:

1. Copy `mods/agent-chat/` into `~/.config/herdr-app/mods/` and run
   `herdr-app check ~/.config/herdr-app/mods/agent-chat`.
2. Put it in a personal layout (Herdr's own are read-only: clone `main` first with
   `herdr-app do layout.clone '{"name":"main","as":"my-main"}'`). Replace the `{"tab":"active"}`
   block with a stack `"id": "chat-view"` of two blocks: `"id": "chat-panel"` with
   `"content": {"mod": "agent-chat"}`, and `"id": "terminal-panel"` holding the old
   `{"tab": "active", "pane": {...}}` content with a pane header of the same mod:
   `"header": {"content": {"mod": "agent-chat"}, "height": 42, "position": "top", "reveal": "always"}`
   (and `"lone": true` so a single pane gets it too). The ids must be exactly these: the mod switches
   with `layout.select {stack: "chat-view", child}`. On `pond-tree` (this repo) it already is.

**Version:** 1.0.0 (see Changes at the end; also `"version"` in `mod.json`).

**Update:** tell your Herdr agent "update my herdr mods". It follows `UPDATE.md` from this repo, which
checks `versions.json` and offers every newer version of the mods and layouts you have from here, with
a backup of each. This mod has no update pill. By hand: replace `mods/agent-chat/` with this folder's
copy. Shared state (drafts, views, read positions) lives outside the mod folder and is kept.

## What you see

- **Chat** (the `chat-panel` block): a card filling its block (`background`, 1px `border`, radius 10).
  - **Header**, 42px: the program's 15px icon (a Claude agent shows Pond's 16px duck, its mood the
    agent's status), the terminal's title in 13px `muted`, on hover the pane buttons (split, zoom,
    close), a status badge, and the Chat/Terminal toggle.
  - **Conversation**, a centered column at most 740px wide, scrolling, newest at the bottom: the
    person's messages as bubbles (with image thumbnails), replies as Markdown, code blocks with a copy
    button, mermaid diagrams drawn natively with Copy image / Copy code buttons, a row of folded tool
    steps per turn (click to open, each step with its command, diff or output), and under each reply a
    copy button and a 112px **Send to Notes** button.
  - **Status line**, 24px, 11.5px text: while working, a `accent` spark cycling `·✢✶✻✽` and the
    agent's activity ("Reading files…") with the turn's running time; after a turn, `✻ Worked for 3m
    50s` in `dim`; a dot and "machine isn't answering · messages as of 14:02" with **Retry** when reads fail.
    A question from the agent replaces it with the **question card** (below).
  - **Message box**: radius 18, `surface`, 1px `input` border, 15px text, attachments above the text,
    the agent's suggested next prompt as a dim line above the box (click to use it), and a 32px round
    button: `accent` arrow to send, or a `foreground` stop square while the agent works and the box is empty.
  - **Footer**, 24px: the model chip (duck or program icon, model name, chevron), effort (zap icon),
    mode (shield icon), and at the right the context: gauge, `used / window` tokens and a 96px bar
    (`accent`, orange from 80%, red from 95%).
  - Empty states: grey placeholder bubbles pulsing while a conversation is first read; for a
    conversation not started yet, the logo (the duck for Claude) and "What would you like to build today?".
- **Terminal** (the `terminal-panel` pane header): 42px header per pane on `background` with a bottom
  `border`: icon or duck, program name (`foreground`, max 260px), the folder in `dim` (`~` for home),
  pane buttons on hover, the status badge, and a toggle back to Chat for supported agents.
- Optional, only with `props: {"backdrop": true}`: an animated scene behind the chat (sharks,
  jellyfish, sky, rain), dimmed behind a conversation, with a pill bottom-right to switch scenes.

## How it behaves

- **Which agent:** the focused tab's supported agent (the focused terminal if the tab has several).
  A tab without one shows the terminal. Each session opens on the view it was last left in, else Chat
  (shared `herdr-chat.default-view: "terminal"` changes that; `herdr-chat.chat: false` turns Chat off).
  Switching the stack another way (a key bound to `layout.select`) is adopted as that session's choice.
- **Reading:** a Python reader (`readers/*.py`, joined and run with `python3 -c`, on the agent's own
  machine for remote agents) finds the terminal's log and returns new lines from an offset. Claude
  Code: `~/.claude` or the process's `CLAUDE_CONFIG_DIR` (found via `/proc` or `ps eww`), matched
  by the session record whose process runs in the terminal. Codex: `$CODEX_HOME` or `~/.codex`
  `sessions/**/rollout-*.jsonl`. Pi: `~/.pi/agent/sessions`. OpenCode: its SQLite
  `~/.local/share/opencode/opencode.db`, read-only. The found log is remembered (shared
  `herdr-chat.paths`). Local logs are re-read when their folder changes (`watchFolder`), otherwise
  polled (about every 1.5 s while working, 3 s while waiting).
- **Sending:** Enter sends, Shift+Enter is a new line. The text is typed into the terminal with
  `hc send`; Codex messages go through Codex's app-server daemon when it has the conversation open.
  The message shows at once and is replaced by the logged one. Esc (or the stop button) interrupts a
  working agent (`hc interrupt`); a just-sent message it retracts goes back into the box.
- **Drafts:** the box keeps a draft per session (shared `herdr-chat.drafts`), and for Claude Code,
  Codex and Pi mirrors it with the agent's own input box when switching between Chat and Terminal
  (`input-box.py`, which attaches to the terminal; not on Windows).
- **Images:** drop or paste (Ctrl/Cmd+V with only an image on the clipboard) images or PDFs; a preview
  copy goes to `cache/agent-chat/`, the file is placed beside the terminal with `hc put`, then
  mentioned (`@path`, Claude Code), pasted (Codex) or given as a path (Pi, OpenCode).
- **Skills:** typing the harness's trigger (`/`, `$` or `@`) opens a skill menu from its skill folders
  and the log; ↑/↓ move, Tab accepts, Esc closes.
- **Question card:** permission prompts and multiple-choice questions read off the screen
  (`hc read`) show as a card with numbered options, multi-select, tabs and a text row; picking one
  presses the keys in the terminal (Codex daemon requests are answered through the daemon).
- **Model menu:** lists the models for the agent's source, read when the menu opens (below); picking
  one types `/model <id>`, and if the terminal refuses, drives its own `/model` menu by name, answers
  "Switch model?" with yes, and reports what the terminal really switched to. Effort: a menu
  (`/effort <level>`, Claude Code; Codex via `/model … --reasoning=`) or, for Pi, a click for the next
  level. Mode: a click presses the harness's cycle key (Shift+Tab, OpenCode Tab) and reads the new one off the screen.
- **Seen:** looking at a `done` agent in Chat labels it `herdr.seen=<turn>`, as showing its terminal does.
- **Agent statuses:** working = spark and timer (duck jabbing), blocked = question card or status
  badge (duck angry, then scowling), done = badge (duck hopping, blushing), idle = nothing (duck bobbing).
- **Keys in the box:** chords keys.json gives the app (every bound `ctrl-<letter>` in `global` or a
  `layout:` section, plus `alt-shift-up/down`) run their binding instead of editing text.

## Built from

- `main.js` (the chat, or a pane header when `props().pane` is set, or a diagram viewer dialog),
  `header.js`, `common.js` (views and the `chat-view` stack), `terminal-fix3.js` (agents, `hc`),
  `components/` (chat list, composer, question card, session reader, skill menu, diagram viewer),
  `model/` (transcript, prompts, skills, runs-with), `ui/`, `harnesses/` (one adapter per program:
  `claude-code`, `codex`, `pi`, `opencode`, with its image style, box, skills, modes and switch keys),
  `readers/*.py` in `manifest.json` order, `duck.js` (Pond's duck in native divs), `backdrop/`,
  `icons/*.svg`, helper scripts `input-box.py`, `prepare-image.sh/.ps1`, `copy-image.sh/.ps1`, `send.ps1`.
- Vendored: `vendor/pele` (mermaid diagram layout, MIT, kepano) and `backdrop/vendor/ascii-sharks`
  (MIT, drewdi). The mod's own `LICENSE` is azaeldrm's MIT licence.
- `herdr`: `agents`, `terminals`, `panes`, `spaces`, `focused`, `layout`, `theme`, `shared`, `setShared`,
  `props`, `run`, `hc`, `exec`, `readTextFile`, `writeTextFile`, `watchFolder`, `openOverlay`,
  `appHome`, `home`, `commands`, `window`; `fs/promises`.
- Commands: `layout.select {stack: "chat-view"}`, `pane.focus`, `pane.split`, `pane.zoom`, `pane.close`,
  `tab.new` (Notes install offer), and whatever keys.json binds to passed chords.
- Shared mods: `confirm` (the Notes offer). Optional: `pond-profiles`, `notes` (both this repo).
- **Runs:** `python3` (readers; on Windows `py -3` or `python`), `hc` (`read`, `send`, `keys`,
  `interrupt`, `put`, `label`, `ls`, `attach --observe`), `git rev-parse` (Send to Notes),
  `claude -p "/model"` (model list on a non-gateway profile), `python3 mods/pond-profiles/ctl.py models
  <profile>` (gateway catalog), `sh`/`rm`/`find`/`mkdir` for its cache, and for copying a diagram one of
  `rsvg-convert`, `magick`, `convert`, `inkscape`, `qlmanage`, then `osascript`, `wl-copy` or `xclip`.
- **Reads outside its folder:** agents' session logs (above), skill folders (`~/.claude/skills`,
  `~/.codex/skills`, `~/.agents/skills`, `~/.pi/agent/skills`, `~/.config/opencode/skills` and the
  project's), `~/.pi/agent/models.json`, `keys.json`, `notes.json`, `~/.cvm/active-profile` and
  `~/.cvm/profiles/<profile>.env` (only whether it sets `ANTHROPIC_BASE_URL`). **Writes:** `cache/agent-chat/`,
  `cache/diagrams/`, and with Send to Notes the Notes vault. No network of its own; `ctl.py` asks the
  gateway, and `claude -p` talks to Anthropic.

## Watch out

- **Models per profile need pond-profiles.** The terminal's `herdr.claude-profile` label (else
  `~/.cvm/active-profile`) picks a profile; a gateway profile's models come from
  `mods/pond-profiles/ctl.py`. Without pond-profiles (or cvm) there's no profile: the menu reads
  `claude -p "/model"` (an extra Claude call each time the menu opens, kept 15 s), and if that fails
  shows the fixed aliases (Default, Opus, Sonnet, Haiku). The context bar uses the `claude.model` and
  `claude.context` labels pond-profiles' status line writes; without them it uses the log's numbers.
- **Send to Notes needs the `notes` mod.** Without `mods/notes/mod.json`, a click opens a confirm
  that starts a Claude tab in the Herdr home to install it from this repo. With Notes but no vault in
  `notes.json`, the note line says "Notes has no vault yet: set one in the Notes panel". In a git repo
  the message goes under `## Notes` of `<vault>/<folder>/<repo>/<branch>.md` (made, with its repo note,
  when missing); outside one, into a note at the vault root named after its first line.
- Without `python3` nothing is read ("Reading conversations … needs Python 3" on Windows). Remote
  agents need `python3` and `hc` on that machine.
- The layout ids `chat-view`, `chat-panel`, `terminal-panel` are hard-coded. Without that stack,
  the toggle does nothing and the chat only shows where placed.
- Reading other programs' logs and screens is heuristic: a new release of Claude Code, Codex, Pi or
  OpenCode that changes its log format or prompt drawing can break reading or the question card.
- Shared keys still carry the old name `herdr-chat.*`; `harness.context-bar: "health"` (from Harness's
  settings) switches the gauge to a heart and "% left".
- A 100 ms timer drives the view (cheap checks; reads are rate-limited). Error text renders in place
  as "herdr-chat init/render error" rather than blanking.
- The diagram viewer opens this same mod as a dialog (`props` marks it); keep the folder name `agent-chat`.

## Done when

- `herdr-app check ~/.config/herdr-app/mods/agent-chat` passes.
- In a layout with the `chat-view` stack, a tab running Claude Code shows the chat with its history;
  the header toggle shows the terminal (with the 42px header) and back.
- Typing a message and pressing Enter shows it as a bubble at once, and it appears in the terminal.
- While the agent works the status line shows the spark and a running timer; Esc stops it.
- A permission prompt shows as a card; clicking an option answers it in the terminal.
- The model chip opens a list; picking another model switches the terminal and the chip follows.
- Dropping an image attaches it and the agent receives it.
- A mermaid block in a reply draws as a diagram; Copy code puts its source on the clipboard.
- Send to Notes without the notes mod opens the install confirm.
- A Codex, Pi or OpenCode tab also shows its conversation.

## Changes

### 1.0.0 (2026-11-26)

- First published here.
- Originally from azaeldrm's Harness layout (github.com/azaeldrm/harns-layout, MIT), adapted for the
  Pond layout (duck, gateway model catalog via pond-profiles, Send to Notes) by Anthony Chapé
  (github.com/anthonychape-tc/herdr-pond), published with his permission. Includes pele (MIT, kepano)
  and ascii-sharks (MIT, drewdi).
