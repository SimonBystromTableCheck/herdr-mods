// Notes: an Obsidian vault as a side panel. Each repo/branch gets a feature note (Herdr/<repo>/<branch>.md)
// with its todos; any note opens here rendered, with its links and backlinks, and edits in nvim.
// The vault is plain files: Obsidian doesn't need to run, and nothing here needs a plugin.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, ScrollHandle, TextView } from "gpui-base";
import { keybar, keysCard } from "./keybar.js";
import { closePanel, focusTab } from "./panel.js";
import { exec, run, theme, spaces, agents, focused, layout, window, readTextFile, writeTextFile, watchFolder, nextCommand, setShared, shared, checking } from "herdr";
import * as V from "./vault.js";
import { openSetup, setupView } from "./setup.js";
import { SelfUpdate } from "./update.js";

const ICON = "mods/notes";
const TODO = /^(\s*[-*] \[)([ xX])(\] ?)(.*)$/;
const LINK = "https://herdr-note.invalid/";
const q = s => `'${String(s).replace(/'/g, `'\\''`)}'`;
// agent-chat's hand-off for text meant for an agent's prompt (its composer takes it; see takeInbox there).
const INBOX = "herdr-chat.inbox";
/** Whether the shown layout has agent-chat's Chat/Terminal stack and chats are on. */
function chatShown() {
  if (shared("herdr-chat.chat") === false) return false;
  const find = node => node?.id === "chat-view" ? node : (node?.children ?? []).map(find).find(Boolean);
  const has = node => node?.content?.mod === "agent-chat" || (node?.children ?? []).some(has);
  return has(find(layout()));
}
/** The text into the focused terminal's prompt as one paste (nothing submits), then the clipboard back. */
function paste(text, cx) {
  const old = cx.read_from_clipboard();
  cx.write_to_clipboard(text);
  run("terminal.paste");
  cx.spawn(async cx => {
    await cx.sleep?.(400);
    if (old !== undefined && cx.read_from_clipboard() === text) cx.write_to_clipboard(old);
  });
}
const SCOPES = ["feature", "repo", "vault"];

const KEYS = {
  note: [
    { caps: ["space"], label: "toggle todo" }, { caps: ["a"], label: "add todo" }, { caps: ["enter"], label: "open link" },
    { caps: ["e"], label: "edit in your editor" }, { caps: ["h"], label: "back" }, { caps: ["s"], label: "send to agent" },
    { caps: ["y"], label: "copy [[link]]" }, { caps: ["o"], label: "open in Obsidian" },
    { caps: ["R"], label: "rename (updates links)" }, { caps: ["D"], label: "delete" },
  ],
  list: [{ caps: ["enter"], label: "open" }, { caps: ["e"], label: "edit" }, { caps: ["R"], label: "rename" }, { caps: ["D"], label: "delete" }],
  everywhere: [
    { caps: ["f"], label: "find note" }, { caps: ["/"], label: "search text" }, { caps: ["n"], label: "new note" },
    { caps: ["1", "2", "3"], label: "feature / repo / vault" }, { caps: ["]", "["], label: "next / prev tab" }, { caps: ["j", "k"], label: "move" },
    { caps: ["<", ">"], label: "first / last" }, { caps: ["q"], label: "close the panel" },
  ],
};

function keyOf(e) {
  const m = e.modifiers ?? {};
  if (m.control || m.platform || m.alt) return e.keystroke;
  if (["enter", "escape", "tab", "space", "up", "down", "left", "right", "backspace"].includes(e.key)) return e.key;
  return e.key_char ?? e.key;
}

// Front matter, todos and the rest of a note.
function parse(rel, raw) {
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  const body = fm ? raw.slice(fm[0].length) : raw;
  const offset = fm ? fm[0].split("\n").length - 1 : 0;
  const lines = raw.split("\n");
  const todos = [];
  lines.forEach((l, line) => { if (line < offset) return; const m = l.match(TODO); if (m) todos.push({ line, done: m[2] !== " ", text: m[4] }); });
  const title = body.match(/^# (.+)$/m)?.[1].trim() || V.nameOf(rel);
  const tags = (fm?.[1].match(/^tags:\s*\[([^\]]*)\]/m)?.[1] ?? "").split(",").map(s => s.trim()).filter(Boolean);
  return { rel, raw, lines, title, todos, tags, links: V.linksIn(raw), body };
}

// Markdown TextView can show: no front matter, no todo lines (they're rows above), [[links]] as links.
function renderable(note) {
  const lines = note.body.split("\n").filter(l => !TODO.test(l));
  const h1 = lines.findIndex(l => /^# /.test(l));
  if (h1 >= 0) lines.splice(h1, 1); // the header shows the title
  // Headings left with nothing under them (Todos, whose items are rows above; an empty Log).
  const kept = lines.filter((l, i) => {
    const m = l.match(/^(#{1,6}) /);
    if (!m) return true;
    for (let j = i + 1; j < lines.length; j++) {
      const n = lines[j].match(/^(#{1,6}) /);
      if (n && n[1].length <= m[1].length) return false;
      if (lines[j].trim() && !n) return true;
    }
    return false;
  });
  return kept.join("\n")
    .replace(/%%[\s\S]*?%%/g, "")
    .replace(/==([^=]+)==/g, "**$1**")
    .replace(/!?\[\[([^\]]+)\]\]/g, (_m, target) => {
      const [name, alias] = target.split("|");
      return `[${alias || name.replace(/#\^?/, " › ")}](${LINK}${encodeURIComponent(name.split(/[#^]/)[0])})`;
    })
    .replace(/\n{3,}/g, "\n\n").trim() || "_Empty note_";
}

export default class Notes extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.scroll = ScrollHandle.new();
    this.cfg = null; this.notes = []; this.ctx = null; this.ctxKey = null;
    this.scope = (() => { try { return localStorage.getItem("scope"); } catch { return null; } })() ?? "feature";
    this.note = null; this.history = []; this.sel = 0; this.listSel = 0;
    this.find = null; // { mode: "name" | "text", state, results }
    this.writes = Promise.resolve();
    this.setup = null;
    this.selfUpdate = new SelfUpdate("notes", "Notes panel"); this.selfUpdate.start(cx);
    if (checking()) return;
    cx.spawn(async cx => this.start(cx));
    cx.spawn(async cx => {
      for (;;) {
        const c = await nextCommand();
        if (c === "focus") {
          const token = this.focusToken = (this.focusToken ?? 0) + 1;
          this.handle.focus();
          cx.timer.after(40, () => { if (this.handle.is_focused()) this.focusToken++; });
          cx.timer.after(150, cx => { if (this.focusToken === token && !this.handle.is_focused()) { this.handle.focus(); cx.notify(); } });
        }
        else if (c.startsWith("go:")) this.go(c.slice(3));
        else if (c.startsWith("key:")) this.press(c.slice(4), cx);
        cx.notify();
      }
    });
    cx.timer.every(2500, cx => { cx.spawn(async cx => { if (await this.poll()) cx.notify(); }); });
    cx.timer.every(300, cx => {
      const k = this.keyboard();
      if (k !== this.sharedKeys) { this.sharedKeys = k; setShared("notes.hasKeys", k); }
      if (k !== this.hadKeys) { this.hadKeys = k; cx.notify(); }
    });
  }

  keyboard() { return this.handle.is_focused() || Boolean(this.input || this.menu || this.find || this.setup); }

  // Loads the settings and the vault; the setup screen until it was finished once (or the vault is gone).
  async start(cx) {
    this.cfg = await V.loadConfig().catch(() => null);
    this.ctxKey = null; this.note = null; this.history = [];
    if (!this.cfg?.setupDone || !this.cfg.root) {
      if (this.cfg?.setupDone && this.cfg.missing) this.flash(`The vault ${V.tilde(this.cfg.missing)} isn't there any more`);
      this.cfg = this.cfg?.root ? this.cfg : null;
      await openSetup(this, cx);
      return;
    }
    await this.reload();
    cx.notify();
    // Changes from nvim, Obsidian, agents or a sync show up here. .obsidian churns constantly: ignore it.
    // A new start (another vault) ends the old loop. The next watch starts before the reload reads, so a write
    // landing during the reload wakes it again; a rejected or reclaimed watch (Herdr keeps at most 64) is retried
    // after a pause instead of ending the loop. The poll below catches anything a watch still misses.
    const root = this.cfg.root, token = this.watchToken = (this.watchToken ?? 0) + 1;
    this.watch?.cancel?.();
    let watch = watchFolder(root);
    this.watch = watch;
    for (;;) {
      const changed = await watch.catch(() => null);
      if (token !== this.watchToken) break;
      if (changed?.length && changed.every(p => /\/\.(obsidian|trash|git)\//.test(p))) { watch = this.watch = watchFolder(root); continue; }
      await cx.sleep(changed ? 300 : 2000);
      if (token !== this.watchToken) break;
      watch = this.watch = watchFolder(root);
      await this.reload();
      cx.notify();
    }
  }

  // The fallback: while the window shows, the shown note is read every few seconds and reloaded when it changed on
  // disk; in the feature section with no note yet, the branch's note is looked for (something may have made it).
  async poll() {
    if (!this.cfg || this.pending || this.polling || window()?.visible === false) return false;
    this.polling = true;
    try {
      if (this.note) {
        const raw = await readTextFile(V.abs(this.cfg, this.note.rel)).catch(() => null);
        if (raw === this.note.raw || this.pending) return false;
        await this.reload();
        return true;
      }
      if (this.scope !== "feature" || !this.featureRel()) return false;
      const raw = await readTextFile(V.abs(this.cfg, this.featureRel())).catch(() => null);
      if (raw === null) return false;
      await this.reload();
      return true;
    } finally { this.polling = false; }
  }

  closeSetup(cx) {
    if (!this.cfg?.setupDone) return;
    this.setup = null; this.handle.focus(); cx.notify();
  }

  async reload() {
    if (!this.cfg) return;
    this.notes = await V.listNotes(this.cfg);
    if (this.note && !this.pending) await this.load(this.note.rel, true);
    // The feature section waiting for this branch's note: it may just have been made (an agent, Send to Notes).
    else if (!this.note && this.scope === "feature" && !this.pending) await this.openFeature(false);
  }

  // Loads a note into the view (keeping the selection when it's the same note).
  async load(rel, keep = false) {
    const raw = await readTextFile(V.abs(this.cfg, rel)).catch(() => null);
    if (raw === null) { if (this.note?.rel === rel) this.note = null; return false; }
    const note = parse(rel, raw);
    note.out = note.links.map(l => ({ target: l, rel: V.resolve(l, this.notes) }));
    note.back = await V.backlinks(this.cfg, rel);
    if (!keep || this.note?.rel !== rel) this.sel = 0;
    this.note = note;
    return true;
  }

  flash(text) { this.flashMsg = text; this.flashAt = Date.now(); }

  // ---- Where we are: the shown space's repo and branch -----------------------------

  space() { const id = focused()?.space; return spaces().find(s => s.id === id) ?? spaces().find(s => s.active) ?? null; }

  // Called from render: when the space, its folder or branch changed, look up the repo again.
  watchContext(cx) {
    const s = this.space(), key = s ? `${s.id}|${s.folder}|${s.branch}|${s.machine}` : "";
    if (key === this.ctxKey || !this.cfg) return;
    this.ctxKey = key;
    cx.spawn(async cx => {
      const g = s ? await V.gitContext(focused()?.cwd || s.folder, s.machine) : null;
      this.ctx = g ? { ...g, space: s.name } : null;
      if (this.scope === "feature") await this.openFeature(false);
      cx.notify();
    });
  }

  featureRel() { return this.ctx?.branch ? V.featureNote(this.cfg, this.ctx.repo, this.ctx.branch) : null; }

  // Shows this branch's note; with `create`, makes it (and the repo's note) when missing.
  async openFeature(create) {
    const rel = this.featureRel();
    if (!rel) { this.note = null; return; }
    if (create) {
      const { repo, branch } = this.ctx;
      await V.ensure(this.cfg, V.repoNote(this.cfg, repo), V.repoTemplate(repo));
      if (await V.ensure(this.cfg, rel, V.featureTemplate(repo, branch))) { await V.linkFeature(this.cfg, repo, branch); this.flash(`Created ${rel}`); }
      this.notes = await V.listNotes(this.cfg);
    }
    this.history = [];
    if (!(await this.load(rel))) this.note = null;
  }

  setScope(scope, cx) {
    this.scope = scope; this.listSel = 0; this.find = null;
    try { localStorage.setItem("scope", scope); } catch {}
    if (scope === "feature") cx.spawn(async cx => { await this.openFeature(false); cx.notify(); });
    else this.note = null;
    this.handle.focus();
    cx.notify();
  }

  // The notes a list shows: in repo scope, the repo's folder first and then notes mentioning the repo.
  listed() {
    if (this.find?.results) return this.find.results;
    let rels = this.notes;
    if (this.scope === "repo" && this.ctx) {
      const dir = `${this.cfg.folder}/${V.slug(this.ctx.repo)}/`;
      rels = rels.filter(r => r.startsWith(dir));
    }
    return rels.map(rel => ({ rel }));
  }

  // ---- Opening, editing ------------------------------------------------------------

  open(rel, cx, push = true) {
    if (!rel) return;
    cx.spawn(async cx => {
      if (push && this.note) this.history.push(this.note.rel);
      this.find = null;
      if (!(await this.load(rel))) this.flash(`Couldn't read ${rel}`);
      this.handle.focus();
      cx.notify();
    });
  }

  back(cx) {
    const prev = this.history.pop();
    if (prev) return this.open(prev, cx, false);
    if (this.scope !== "feature" || this.note?.rel !== this.featureRel()) { this.note = null; if (this.scope === "feature") this.setScope("feature", cx); }
    cx.notify();
  }

  // A [[link]] clicked in the rendered note, or a link row.
  follow(target, cx) {
    const rel = V.resolve(target, this.notes);
    if (rel) return this.open(rel, cx);
    this.confirm(`"${target}" doesn't exist yet. Create it?`, "Create note", cx => this.create(target, cx, this.note ? V.dirOf(this.note.rel) : ""), cx);
  }

  // nvim in a split beside the focused pane, at `line` (1-based) when given.
  edit(rel, line) {
    if (!rel) return;
    const argv = [...this.cfg.editor, ...(line ? [`+${line}`] : []), V.abs(this.cfg, rel)];
    run("terminal.open", { argv: ["/bin/zsh", "-lic", argv.map(q).join(" ")], folder: this.cfg.root, place: "right", name: V.nameOf(rel) });
  }

  openInObsidian(rel) { V.openUrl(`obsidian://open?path=${encodeURIComponent(V.abs(this.cfg, rel))}`); }

  create(title, cx, dir) {
    if (!title) return;
    cx.spawn(async cx => {
      const folder = dir ?? (this.ctx ? `${this.cfg.folder}/${V.slug(this.ctx.repo)}` : "");
      const rel = `${folder ? folder + "/" : ""}${title.replace(/[\\/:]/g, "-")}.md`;
      const made = await V.ensure(this.cfg, rel, V.noteTemplate(title)).catch(e => { this.flash(String(e)); return null; });
      if (made === null) return cx.notify();
      this.notes = await V.listNotes(this.cfg);
      this.open(rel, cx);
      if (made) this.edit(rel, 3);
    });
  }

  newNote(cx) { this.ask("New note", "", (title, cx) => this.create(title, cx), cx, this.ctx ? `goes in ${this.cfg.folder}/${V.slug(this.ctx.repo)}/` : "title"); }

  renameNote(rel, cx) {
    if (!rel) return;
    this.ask("Rename note (links are updated)", V.nameOf(rel), (name, cx) => {
      if (!name || name === V.nameOf(rel)) return;
      cx.spawn(async cx => {
        try {
          const to = await V.rename(this.cfg, rel, name);
          this.notes = await V.listNotes(this.cfg);
          if (this.note?.rel === rel) await this.load(to);
          this.flash(`Renamed to ${V.nameOf(to)}`);
        } catch (e) { this.flash(String(e.message ?? e)); }
        cx.notify();
      });
    }, cx);
  }

  deleteNote(rel, cx) {
    if (!rel) return;
    this.confirm(`Delete "${V.nameOf(rel)}"? It goes to the vault's .trash.`, "Move to .trash", cx => cx.spawn(async cx => {
      try { await V.trash(this.cfg, rel); } catch (e) { this.flash(String(e.message ?? e)); }
      this.notes = await V.listNotes(this.cfg);
      if (this.note?.rel === rel) { this.note = null; this.history = []; }
      this.listSel = Math.max(0, Math.min(this.listSel, this.listed().length - 1));
      cx.notify();
    }), cx);
  }

  // ---- Todos in the note -------------------------------------------------------------

  mutate(edit, cx) {
    const note = this.note;
    if (!note) return;
    const lines = note.lines.slice();
    edit(lines);
    const before = note.raw, after = lines.join("\n");
    Object.assign(note, parse(note.rel, after), { out: note.out, back: note.back });
    this.pending = (this.pending ?? 0) + 1;
    this.writes = this.writes.then(async () => {
      try { await writeTextFile(V.abs(this.cfg, note.rel), after, before); }
      catch { this.flash("The note changed on disk, so it was reloaded"); }
    });
    cx.spawn(async cx => { await this.writes; this.pending = Math.max(0, this.pending - 1); if (!this.pending) await this.reload(); cx.notify(); });
    cx.notify();
  }

  toggle(td, cx) {
    if (!td) return;
    this.mutate(lines => { lines[td.line] = lines[td.line].replace(TODO, (_m, a, _x, b, rest) => `${a}${td.done ? " " : "x"}${b}${rest}`); }, cx);
  }

  // Adds `- [ ] text` after the last todo, else under "## Todos", else at the end.
  addTodo(cx) {
    const state = InputState.new({ value: "", placeholder: "Add a todo, enter to save, esc to stop" });
    state.on("submit", (_e, cx) => {
      const text = state.value().trim();
      if (!text) { this.input = null; this.handle.focus(); cx.notify(); return; }
      this.mutate(lines => {
        const last = this.note.todos.at(-1)?.line;
        if (last != null) return lines.splice(last + 1, 0, `- [ ] ${text}`);
        const h = lines.findIndex(l => /^##\s+Todos/i.test(l));
        if (h >= 0) { const at = lines[h + 1] === "" ? h + 2 : h + 1; lines.splice(at, 0, `- [ ] ${text}`, ...(lines[at] && lines[at].trim() ? [""] : [])); return; }
        while (lines.length && !lines.at(-1).trim()) lines.pop();
        lines.push("", `- [ ] ${text}`, "");
      }, cx);
      state.set_value("");
    });
    this.input = { kind: "add", state };
    state.focus();
    cx.notify();
  }

  // ---- Agents ----------------------------------------------------------------------

  // The agent to send to: the focused one, else the one focused last (tracked while this draws).
  agent() {
    const list = agents(), f = focused()?.terminal;
    const now = list.find(a => a.address === f);
    if (now) return now;
    const last = shared("notes.agent");
    return list.find(a => a.address === last) ?? list.find(a => a.space === focused()?.space) ?? null;
  }

  // Puts a pointer to the note in the agent's prompt, unsent: one paste, so nothing submits.
  // Where agent-chat shows agents (its Chat/Terminal stack), the text goes through its inbox, so it lands in the chat
  // box when the agent shows as a chat (a paste would go to the hidden terminal); if nothing takes it, it is pasted.
  send(rel, cx) {
    const a = this.agent();
    if (!a || !rel) return this.flash("No agent to send to: click into one first");
    const text = `My note "${V.nameOf(rel)}" is at ${V.abs(this.cfg, rel)} (Obsidian vault ${this.cfg.root}; [[links]] are other notes there). `;
    run("pane.focus", { terminal: a.address });
    this.flash(`Sent to ${a.program?.name ?? a.title}`);
    if (!chatShown()) return paste(text, cx);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setShared(INBOX, { id, address: a.address, text, at: Date.now() });
    cx.spawn(async cx => {
      await cx.sleep?.(2000);
      if (shared(INBOX)?.id !== id) return;
      setShared(INBOX, null);
      run("pane.focus", { terminal: a.address });
      paste(text, cx);
    });
  }

  // ---- Find ------------------------------------------------------------------------

  startFind(mode, cx) {
    const state = InputState.new({ value: "", placeholder: mode === "text" ? "Search inside notes…" : "Find a note by name…" });
    this.find = { mode, state, results: null };
    this.listSel = 0;
    state.on("change", (_e, cx) => this.refind(cx));
    state.on("submit", (_e, cx) => {
      const r = this.find?.results?.[this.listSel];
      if (!r) return;
      this.find = null;
      if (this.scope === "feature") this.scope = "vault";
      this.open(r.rel, cx);
    });
    state.focus();
    cx.notify();
  }

  refind(cx) {
    const f = this.find;
    if (!f) return;
    const query = f.state.value().trim();
    this.listSel = 0;
    if (!query) { f.results = null; return cx.notify(); }
    if (f.mode === "name") {
      f.results = this.notes.map(rel => ({ rel, score: V.fuzzy(query, rel) })).filter(r => r.score !== null)
        .sort((a, b) => a.score - b.score).slice(0, 200);
      return cx.notify();
    }
    const token = f.token = (f.token ?? 0) + 1;
    cx.spawn(async cx => {
      await cx.sleep?.(150);
      if (this.find !== f || f.token !== token) return;
      const hits = await V.grep(this.cfg, query);
      if (this.find === f && f.token === token) { f.results = hits; cx.notify(); }
    });
  }

  // ---- Menus, prompts, keys --------------------------------------------------------

  confirm(title, label, action, cx) {
    this.menu = { title, items: [{ key: "y", label, run: action }, { key: "n", label: "Cancel", run: () => {} }], sel: 0 };
    cx.notify();
  }

  ask(title, value, onSubmit, cx, hint) {
    const state = InputState.new({ value, placeholder: hint ?? "" });
    if (value) state.set_selected_range({ start: 0, end: value.length });
    state.on("submit", (_e, cx) => { const v = state.value().trim(); this.input = null; this.handle.focus(); onSubmit(v, cx); cx.notify(); });
    this.input = { kind: "prompt", title, state };
    state.focus();
    cx.notify();
  }

  go(dir) {
    this.focusToken = (this.focusToken ?? 0) + 1;
    const pane = focused()?.pane;
    if (dir === "left" && pane) return focusTab();
    this.handle.focus();
    run("pane.go", { direction: dir });
  }

  navKey(e, cx) {
    const m = e.modifiers ?? {};
    if (!(m.platform && m.alt && !m.control && ["left", "right", "up", "down"].includes(e.key))) return false;
    cx.stop_propagation(); this.go(e.key); return true;
  }

  key(e, cx) { if (this.navKey(e, cx)) return; if (this.press(keyOf(e), cx)) cx.stop_propagation(); }

  press(k, cx) {
    if (this.setup) {
      if (k === "escape" && this.cfg?.setupDone) { this.closeSetup(cx); return true; }
      return false;
    }
    if (this.keysOpen) { if (["escape", "?", "q"].includes(k)) this.keysOpen = false; cx.notify(); return true; }
    if (this.find) {
      const n = this.find.results?.length ?? 0;
      if (k === "escape") { this.find = null; this.handle.focus(); }
      else if (k === "down" || k === "ctrl-j" || k === "ctrl-n") this.listSel = Math.min(n - 1, this.listSel + 1);
      else if (k === "up" || k === "ctrl-k" || k === "ctrl-p") this.listSel = Math.max(0, this.listSel - 1);
      else if (k === "tab") { const mode = this.find.mode === "name" ? "text" : "name", v = this.find.state.value(); this.startFind(mode, cx); this.find.state.set_value(v); this.refind(cx); }
      else return false;
      cx.notify(); return true;
    }
    if (this.input) {
      if (k !== "escape") return false;
      this.input = null; this.handle.focus(); cx.notify(); return true;
    }
    if (this.menu) {
      const m = this.menu;
      if (k === "escape" || k === "q" || k === "n") this.menu = null;
      else if (k === "j" || k === "down") m.sel = Math.min(m.items.length - 1, m.sel + 1);
      else if (k === "k" || k === "up") m.sel = Math.max(0, m.sel - 1);
      else { const it = k === "enter" || k === "space" ? m.items[m.sel] : m.items.find(i => i.key === k); if (it) { this.menu = null; it.run(cx); } }
      cx.notify(); return true;
    }
    switch (k) {
      case "?": this.keysOpen = true; cx.notify(); return true;
      case "q": closePanel("notes"); return true;
      case "1": case "2": case "3": this.setScope(SCOPES[+k - 1], cx); return true;
      case "]": case "[": case "tab": {
        const i = SCOPES.indexOf(this.scope), step = k === "[" ? -1 : 1;
        this.setScope(SCOPES[(i + step + SCOPES.length) % SCOPES.length], cx); return true;
      }
      case "f": this.startFind("name", cx); return true;
      case "/": this.startFind("text", cx); return true;
      case "n": this.newNote(cx); return true;
    }
    const handled = this.note ? this.noteKey(k, cx) : this.scope === "feature" ? this.featureKey(k, cx) : this.listKey(k, cx);
    if (handled) cx.notify();
    return handled;
  }

  featureKey(k, cx) {
    if (k === "enter" || k === "c") { cx.spawn(async cx => { await this.openFeature(true); cx.notify(); }); return true; }
    return false;
  }

  listKey(k, cx) {
    const items = this.listed(), it = items[this.listSel];
    const move = i => { this.listSel = Math.max(0, Math.min(items.length - 1, i)); this.scroll.scroll_to_item(this.listSel); };
    switch (k) {
      case "j": case "down": move(this.listSel + 1); return true;
      case "k": case "up": move(this.listSel - 1); return true;
      case "<": move(0); return true;
      case ">": move(items.length - 1); return true;
      case "enter": case "l": case "right": if (it) this.open(it.rel, cx); return true;
      case "e": if (it) this.edit(it.rel, it.line); return true;
      case "R": if (it) this.renameNote(it.rel, cx); return true;
      case "D": if (it) this.deleteNote(it.rel, cx); return true;
      case "o": if (it) this.openInObsidian(it.rel); return true;
      case "s": if (it) this.send(it.rel, cx); return true;
    }
    return false;
  }

  // Rows you can select in a note: its todos, then its links, then notes linking here.
  rows() {
    const n = this.note;
    if (!n) return [];
    return [
      ...n.todos.map(td => ({ kind: "todo", td })),
      ...n.out.map(l => ({ kind: "link", target: l.target, rel: l.rel })),
      ...n.back.map(rel => ({ kind: "back", rel })),
    ];
  }

  noteKey(k, cx) {
    const rows = this.rows(), r = rows[this.sel], rel = this.note.rel;
    const move = i => { this.sel = Math.max(0, Math.min(rows.length - 1, i)); this.scroll.scroll_to_item(this.rowChild(this.sel)); };
    switch (k) {
      case "j": case "down": move(this.sel + 1); return true;
      case "k": case "up": move(this.sel - 1); return true;
      case "<": move(0); return true;
      case ">": move(rows.length - 1); return true;
      case "space": case "x": if (r?.kind === "todo") this.toggle(r.td, cx); return true;
      case "a": this.addTodo(cx); return true;
      case "enter": case "l": case "right":
        if (r?.kind === "todo") this.toggle(r.td, cx);
        else if (r?.kind === "link") this.follow(r.target, cx);
        else if (r?.kind === "back") this.open(r.rel, cx);
        return true;
      case "e": this.edit(rel, r?.kind === "todo" ? r.td.line + 1 : null); return true;
      case "h": case "left": case "backspace": case "escape": this.back(cx); return true;
      case "s": this.send(rel, cx); return true;
      case "y": cx.write_to_clipboard(`[[${V.nameOf(rel)}]]`); this.flash(`Copied [[${V.nameOf(rel)}]]`); return true;
      case "o": this.openInObsidian(rel); return true;
      case "R": this.renameNote(rel, cx); return true;
      case "D": this.deleteNote(rel, cx); return true;
    }
    return false;
  }

  // ---- Rendering -------------------------------------------------------------------

  button(id, icon, label, action, t) {
    return h_flex().id(id).h(24).px(6).gap(4).flex_none().items_center().rounded(6).cursor_pointer().text_size(11.5).text_color(t.muted)
      .hover(s => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => { cx.stop_propagation(); action(cx); cx.notify(); })
      .when(Boolean(icon), el => el.child(svg(icon).size(13))).when(Boolean(label), el => el.child(label));
  }

  scopeTabs(t) {
    const label = { feature: "Feature", repo: this.ctx ? this.ctx.repo : "Repo", vault: "Vault" };
    return h_flex().h(34).flex_none().px(8).gap(4).items_center().border_b(1).border_color(t.border)
      .children(SCOPES.map((s, i) => {
        const on = this.scope === s;
        return h_flex().id(`scope-${s}`).h(24).px(8).gap(5).items_center().rounded(6).cursor_pointer().text_size(12)
          .text_color(on ? t.foreground : t.muted).when(on, e => e.bg(t.raised)).hover(st => st.bg(t.hover))
          .on_click((_e, cx) => this.setScope(s, cx))
          .child(div().text_size(10).text_color(t.dim).child(String(i + 1))).child(div().max_w(120).truncate().child(label[s]));
      }))
      .child(div().flex_1())
      .children([this.selfUpdate.pill(t, { compact: true })].filter(Boolean))
      .child(this.button("n-find", `${ICON}/search.svg`, null, cx => this.startFind("name", cx), t))
      .child(this.button("n-new", `${ICON}/plus.svg`, null, cx => this.newNote(cx), t))
      .child(this.button("n-setup", `${ICON}/settings.svg`, null, cx => cx.spawn(async cx => openSetup(this, cx)), t));
  }

  section(t, text) { return div().px(10).pt(10).pb(4).text_size(10.5).font_semibold().text_color(t.dim).child(text.toUpperCase()); }

  row(id, on, t, click) {
    return h_flex().id(id).min_h(28).flex_none().mx(6).px(8).py(4).gap(8).items_center().rounded(6).cursor_pointer()
      .when(on, e => e.bg(this.hadKeys ? t.selected : t.hover)).hover(s => s.bg(on && this.hadKeys ? t.selected : t.hover))
      .on_click(click);
  }

  // Index of selectable row `i` among the scroll area's direct children (section headers sit between).
  rowChild(i) {
    const n = this.note, T = n.todos.length, O = n.out.length;
    let c = 1; // the title block
    if (T) { c += 1; if (i < T) return c + i; c += T; }
    c += 1; // the rendered body
    if (O) { c += 1; if (i < T + O) return c + (i - T); c += O; }
    if (n.back.length) c += 1;
    return c + (i - T - O);
  }

  noteView(t) {
    const n = this.note, rows = this.rows();
    const children = [];
    children.push(v_flex().px(12).pt(10).gap(4)
      .child(h_flex().gap(6).items_center()
        .when(this.history.length > 0, e => e.child(this.button("n-back", `${ICON}/back.svg`, null, cx => this.back(cx), t)))
        .child(div().flex_1().min_w(0).truncate().font_semibold().text_size(14).child(n.title)))
      .child(div().truncate().text_size(11).text_color(t.dim).child(n.rel))
      .when(n.tags.length > 0, e => e.child(h_flex().gap(4).flex_wrap().children(n.tags.map(tag =>
        div().px(6).py(1).rounded(8).bg(t.raised).text_size(10.5).text_color(t.accent).child(`#${tag}`)))))
      .child(h_flex().gap(2).pt(2)
        .child(this.button("n-edit", `${ICON}/pencil.svg`, "nvim", () => this.edit(n.rel), t))
        .child(this.button("n-send", `${ICON}/send.svg`, "Send", cx => this.send(n.rel, cx), t))
        .child(this.button("n-obs", `${ICON}/external.svg`, "Obsidian", () => this.openInObsidian(n.rel), t))));
    if (n.todos.length) {
      const done = n.todos.filter(x => x.done).length;
      children.push(this.section(t, `Todos ${done}/${n.todos.length}`));
      n.todos.forEach((td, i) => children.push(this.row(`td-${td.line}`, this.sel === i, t, (_e, cx) => { this.sel = i; this.handle.focus(); cx.notify(); })
        .items_start()
        .child(div().id(`chk-${td.line}`).size(15).mt(1).flex_none().rounded(4).border_1().flex().items_center().justify_center()
          .border_color(td.done ? t.ansi2 : t.input).bg(td.done ? t.ansi2 : t.background)
          .on_click((_e, cx) => { cx.stop_propagation(); this.sel = i; this.toggle(td, cx); })
          .when(td.done, e => e.child(svg(`${ICON}/check.svg`).size(11).text_color(t.background))))
        .child(div().flex_1().min_w(0).whitespace_normal().text_size(12.5).when(td.done, e => e.line_through().text_color(t.dim)).child(td.text || " "))));
    }
    if (this.input?.kind === "add") children.splice(n.todos.length ? 2 + n.todos.length : 1, 0,
      div().mx(6).px(2).pt(4).on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(Input.new(this.input.state).h(28).px(8).rounded(6).border_1().border_color(t.accent).bg(t.background).text_size(12.5)));
    children.push(div().px(12).py(8).text_size(13).child(TextView.markdown(`md-${n.rel}`, renderable(n))
      .on_link_click((url, cx) => {
        if (url.startsWith(LINK)) return this.follow(decodeURIComponent(url.slice(LINK.length)), cx);
        V.openUrl(url);
      })));
    const T = n.todos.length;
    if (n.out.length) {
      children.push(this.section(t, `Links ${n.out.length}`));
      n.out.forEach((l, j) => children.push(this.row(`out-${j}`, this.sel === T + j, t, (_e, cx) => { this.sel = T + j; this.follow(l.target, cx); })
        .child(svg(`${ICON}/file-text.svg`).size(13).text_color(l.rel ? t.accent : t.dim))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(l.rel ? t.foreground : t.dim).child(l.target))
        .when(!l.rel, e => e.child(div().text_size(10.5).text_color(t.dim).child("new")))));
    }
    if (n.back.length) {
      children.push(this.section(t, `Linked from ${n.back.length}`));
      n.back.forEach((rel, j) => children.push(this.row(`back-${j}`, this.sel === T + n.out.length + j, t, (_e, cx) => { this.sel = T + n.out.length + j; this.open(rel, cx); })
        .child(svg(`${ICON}/file-text.svg`).size(13).text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).child(V.nameOf(rel)))
        .child(div().max_w(120).truncate().text_size(10.5).text_color(t.dim).child(V.dirOf(rel)))));
    }
    children.push(div().h(10));
    if (this.sel >= rows.length) this.sel = Math.max(0, rows.length - 1);
    return v_flex().id("note-scroll").flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.scroll).children(children);
  }

  listView(t) {
    const items = this.listed(), f = this.find;
    if (this.listSel >= items.length) this.listSel = Math.max(0, items.length - 1);
    const empty = f?.results ? "Nothing matches" : this.scope === "repo" && !this.ctx ? "This space isn't in a git repo" : "No notes yet";
    return v_flex().id("list-scroll").flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.scroll).py(4)
      .when(!items.length, e => e.child(div().p(16).text_color(t.dim).child(empty)))
      .children(items.map((it, i) => this.row(`it-${i}-${it.rel}`, i === this.listSel, t, (e, cx) => {
          this.listSel = i;
          if (e.click_count >= 2 || f) this.open(it.rel, cx);
          this.handle.focus(); cx.notify();
        })
        .child(svg(`${ICON}/file-text.svg`).size(13).text_color(t.muted))
        .child(v_flex().flex_1().min_w(0)
          .child(h_flex().gap(6).child(div().flex_1().min_w(0).truncate().text_size(12.5).child(V.nameOf(it.rel)))
            .child(div().max_w(140).truncate().text_size(10.5).text_color(t.dim).child(V.dirOf(it.rel))))
          .when(Boolean(it.text), e => e.child(div().truncate().text_size(11).text_color(t.muted).child(`${it.line}: ${it.text}`))))));
  }

  featureEmpty(t) {
    const c = this.ctx;
    const msg = !this.cfg ? "Loading the vault…" : !c ? "This space isn't in a git repo, so it has no feature note. Try 2 or 3."
      : !c.branch ? `${c.repo}: detached HEAD, no branch to keep a note for.` : null;
    return v_flex().flex_1().p(16).gap(10).text_color(t.dim).text_size(12.5)
      .when(Boolean(msg), e => e.child(msg))
      .when(!msg, e => e
        .child(div().text_color(t.foreground).font_semibold().child(`${c.repo} · ${c.branch}`))
        .child(`No note for this branch yet. It would be ${this.featureRel()}, linked from the repo's note.`)
        .child(h_flex().child(this.button("n-create", `${ICON}/plus.svg`, "Create feature note  ⏎", cx => cx.spawn(async cx => { await this.openFeature(true); cx.notify(); }), t))));
  }

  render(cx) {
    this.hadKeys = this.keyboard();
    const t = theme();
    // Remember the agent last focused, for Send while this panel has the keyboard.
    const ft = focused()?.terminal;
    if (ft && ft !== shared("notes.agent") && agents().some(a => a.address === ft)) setShared("notes.agent", ft);
    this.watchContext(cx);
    if (this.flashMsg && Date.now() - this.flashAt > 4000) this.flashMsg = null;
    if (this.setup) return v_flex().id("notes").relative().size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background)
      .border_1().border_color(this.hadKeys ? t.accent : t.border).text_color(t.foreground).text_size(12.5)
      .track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .on_size_change((size, cx) => { this.size = size; cx.notify(); })
      .child(h_flex().h(34).flex_none().px(10).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().flex_1().font_semibold().text_size(12.5).child("Notes · setup"))
        .children([this.selfUpdate.pill(t)].filter(Boolean))
        .when(Boolean(this.cfg?.setupDone), el => el.child(this.button("setup-close", `${ICON}/back.svg`, "Back", cx => this.closeSetup(cx), t))))
      .child(setupView(this, t))
      .child(keybar(t, { id: "notes", chips: this.chips(), flash: this.flashMsg, width: this.size?.width, onKeys: () => {} }));
    const body = this.error ? v_flex().flex_1().p(16).text_color(t.blocked).child(this.error)
      : this.note ? this.noteView(t)
      : this.scope === "feature" && !this.find ? this.featureEmpty(t)
      : this.listView(t);
    return v_flex().id("notes").relative().size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background)
      .border_1().border_color(this.hadKeys ? t.accent : t.border).text_color(t.foreground).text_size(12.5)
      .track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .on_mouse_down("left", () => { if (!this.input && !this.find) this.handle.focus(); })
      .on_size_change((size, cx) => { this.size = size; cx.notify(); })
      .child(this.scopeTabs(t))
      .when(Boolean(this.find), el => el.child(h_flex().px(8).py(6).gap(6).items_center().border_b(1).border_color(t.border)
        .child(div().text_size(11).text_color(t.accent).child(this.find.mode === "text" ? "text" : "name"))
        .child(div().flex_1().on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .child(Input.new(this.find.state).h(28).px(8).rounded(6).border_1().border_color(t.accent).bg(t.background).text_size(12.5)))))
      .child(this.find ? this.listView(t) : body)
      .child(keybar(t, { id: "notes", chips: this.chips(), flash: this.flashMsg, width: this.size?.width, onKeys: cx => { this.keysOpen = true; this.handle.focus(); cx.notify(); } }))
      .when(this.input?.kind === "prompt", el => el.child(this.promptView(t)))
      .when(Boolean(this.menu), el => el.child(this.menuView(t)))
      .when(Boolean(this.keysOpen), el => el.child(keysCard(t, { id: "notes", title: "Notes: all keys", onClose: cx => { this.keysOpen = false; cx.notify(); }, groups: [
        { title: "In a note", chips: KEYS.note }, { title: "In a list", chips: KEYS.list }, { title: "Everywhere", chips: KEYS.everywhere }] })));
  }

  chips() {
    if (this.setup) return this.cfg?.setupDone ? [{ caps: ["escape"], label: "back to notes" }] : [];
    if (this.find) return [{ caps: ["enter"], label: "open" }, { caps: ["up", "down"], label: "move" }, { caps: ["tab"], label: this.find.mode === "name" ? "search text" : "find name" }, { caps: ["escape"], label: "close" }];
    if (this.input) return [{ caps: ["enter"], label: "save" }, { caps: ["escape"], label: "stop" }];
    if (this.menu) return [{ caps: ["y"], label: "confirm" }, { caps: ["n"], label: "cancel" }];
    if (this.note) return KEYS.note;
    if (this.scope === "feature") return [{ caps: ["enter"], label: "create note" }, ...KEYS.everywhere];
    return [...KEYS.list, ...KEYS.everywhere];
  }

  promptView(t) {
    const p = this.input;
    return div().id("n-scrim").absolute().inset_0().bg("#00000055").flex().items_start().justify_center().pt(70)
      .child(v_flex().id("n-prompt").w(320).p(12).gap(8).rounded(10).border_1().border_color(t.border).bg(t.popover).shadow_lg()
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(div().font_semibold().child(p.title))
        .child(Input.new(p.state).h(32).px(10).rounded(7).border_1().border_color(t.accent).bg(t.background).text_size(12.5)));
  }

  menuView(t) {
    const m = this.menu;
    return div().id("n-menu-scrim").absolute().inset_0().bg("#00000055").flex().items_center().justify_center()
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.menu = null; cx.notify(); })
      .child(v_flex().id("n-menu").w(320).p(6).rounded(10).border_1().border_color(t.border).bg(t.popover).shadow_lg()
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(div().px(8).py(6).font_semibold().child(m.title))
        .children(m.items.map((it, i) => h_flex().id(`n-mi-${i}`).h(26).px(8).gap(8).items_center().rounded(6).cursor_pointer()
          .when(i === m.sel, e => e.bg(t.selected)).hover(s => s.bg(t.hover))
          .on_click((_e, cx) => { this.menu = null; it.run(cx); cx.notify(); })
          .child(div().w(16).text_size(11).text_color(t.accent).child(it.key)).child(div().child(it.label)))));
  }
}
