// A lazygit-style git panel: numbered sections, vim-ish keys, writes run in core
// terminals whose output stays in a copyable log, and conflicts/failures hand off to an agent.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Editor, EditorState, Scrollbar, ScrollHandle, v_virtual_list, VirtualListScrollHandle } from "gpui-base";
import { keybar, keysCard } from "./keybar.js";
import { spaces, panes, focused, agents, knownAgents, exec, hc, run, theme, settings, props, appHome, watchFolder, nextCommand, readTextFile, setShared, shared, layout } from "herdr";
import * as G from "./git.js";
import { graphCell } from "./graph.js";
import { SelfUpdate } from "./update.js";
import { closePanel, hidePanel, revealPanel, pathTo, panelOnScreen } from "./panel.js";
import { loadFileDiff, loadFolderDiff, treeRows, patchFor, snippetOf, lineOf, sidesOf, incomingPaths, loadConflict, resolveBlock } from "./files.js";

const commitDraft = root => (shared("git.commitDrafts") ?? {})[root] ?? "";
function setCommitDraft(root, msg) {
  const all = { ...(shared("git.commitDrafts") ?? {}) };
  if (msg) all[root] = msg; else delete all[root];
  setShared("git.commitDrafts", all);
}

const ROW = 22, LINE = 18;
const CHROME = "mods/workspace-chrome";
const SECTIONS = [
  { id: "files", key: "2", title: "Files", cap: 6 },
  { id: "branches", key: "3", title: "Branches", cap: 5, tabs: ["Local", "Remote"] },
  { id: "commits", key: "4", title: "Commits", cap: 6, tabs: ["Branch", "All"] },
  { id: "stash", key: "5", title: "Stash", cap: 2 },
];
const LISTS = ["files", "branches0", "branches1", "commits0", "commits1", "stash"];
const PR_COLOR = { OPEN: "ansi2", MERGED: "ansi5", CLOSED: "ansi1" };
const { q } = G;
// The panel column grows to this (or its max) while Files shows, so the diff gets the right half.
const WIDE = 1000;
const changeRow = r => r?.kind === "add" || r?.kind === "del";
const lineRow = r => changeRow(r) || ["ctx", "ours", "theirs", "base"].includes(r?.kind);
// Diffs up to this many rows are drawn as plain rows (clicks, shift-click and drag select);
// longer ones as a virtual list (keys and plain clicks).
const PLAIN_ROWS = 2000;

// `fixed`: the repo an expanded Git tab was opened on (its props, read once in init).
// `keep`: the last place; a mod pane in focus (the conflicts pane, a diff) has no folder, so it stays.
function location(fixed, keep) {
  if (fixed) return fixed;
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(x => x.pane === f.pane) : null;
  if (keep && pane && !pane.terminal && keep.space === space?.id) return keep;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on, space: space?.id ?? null };
}

// lazygit spells keys "<c-p>", "<a-x>", "<space>"; keys here are "ctrl-p", "alt-x", "space".
const lazyKey = k => k.replace(/^<c-(.+)>$/, "ctrl-$1").replace(/^<a-(.+)>$/, "alt-$1").replace(/^<(.+)>$/, "$1");
const CONTEXTS = { global: () => true, files: v => v.sec === "files", localBranches: v => v.sec === "branches" && !v.tab.branches,
  remoteBranches: v => v.sec === "branches" && v.tab.branches === 1, commits: v => v.sec === "commits", stash: v => v.sec === "stash" };

function keyOf(e) {
  const m = e.modifiers ?? {};
  if (m.control || m.platform || m.alt) return e.keystroke;
  if (["enter", "escape", "tab", "space", "up", "down", "left", "right", "backspace", "pageup", "pagedown", "home", "end"].includes(e.key))
    return m.shift && ["tab", "up", "down"].includes(e.key) ? `shift-${e.key}` : e.key;
  return e.key_char ?? (m.shift ? e.key.toUpperCase() : e.key);
}

function lineKind(text, style) {
  if (/^(diff --git|index |--- |\+\+\+ |new file|deleted file|similarity|rename |old mode|new mode)/.test(text)) return { kind: "file", text };
  if (text.startsWith("@@")) return { kind: "hunk", text };
  if (text.startsWith("+")) return { kind: "add", text };
  if (text.startsWith("-")) return { kind: "del", text };
  if (/^(commit |Author:|AuthorDate:|Commit:|CommitDate:|Merge:|── )/.test(text)) return { kind: "meta", text };
  return { kind: "", text };
}

export default class Git extends View {
  init(_props, cx) {
    this.selfUpdate = new SelfUpdate("git", "Git panel"); this.selfUpdate.start(cx);
    this.handle = cx.focus_handle();
    // Props read later can belong to another copy, so read them once.
    const p = props();
    this.fixed = p?.cwd ? { cwd: p.cwd, on: p.on ?? null } : null;
    // Which expanded tab this copy is in: expand() names it with a token (tabs from before: the only Git pane).
    this.token = p?.token ?? null;
    if (this.fixed) cx.timer.after(150, () => this.handle.focus());
    this.scrolls = Object.fromEntries([...LISTS, "main"].map(k => [k, VirtualListScrollHandle.new()]));
    this.diffScroll = ScrollHandle.new();
    this.sec = "branches"; this.tab = { branches: 0, commits: 0 };
    this.sel = {}; this.filter = {}; this.log = []; this.seq = 0; this.copied = [];
    this.mainTop = 0; this.mainToken = 0; this.cur = 0; this.anchor = null;
    // Files as a tree (t: flat); folded folders by path ("" is "/").
    this.folded = new Set(); this.flat = shared("git.flatFiles") === true;
    // A reload or restart while Files had the panel widened: this copy puts the width back.
    this.widened = this.fixed ? null : shared("git.widened") ?? null;
    this.seqEditor = `${appHome()}/mods/git/seq-edit.pl`;
    cx.spawn(async cx => {
      const r = await exec("sh", ["-c", 'printf %s "$SHELL"']).catch(() => null);
      this.shell = r?.stdout.trim() || "/bin/zsh";
      this.known = await knownAgents().catch(() => []);
      try { this.config = JSON.parse(await readTextFile(`${appHome()}/mods/git/config.json`) ?? "{}"); }
      catch (e) { this.config = {}; this.flash(`config.json: ${e}`, 8000); }
      cx.notify();
    });
    // "git.key:<k>" from keys.json (or herdr-app do) presses a panel key without focusing it.
    cx.spawn(async cx => {
      for (;;) {
        const c = await nextCommand();
        if (c === "focus") {
          // One retry in case the first focus didn't land; focus that landed and then moved
          // (leaving quickly, a click, the leader popup) is the person's choice, so no retry then.
          const token = this.focusToken = (this.focusToken ?? 0) + 1;
          this.handle.focus();
          cx.timer.after(40, () => { if (this.handle.is_focused()) this.focusToken++; });
          cx.timer.after(150, cx => { if (this.focusToken === token && !this.handle.is_focused()) { this.handle.focus(); cx.notify(); } });
        }
        else if (c === "expand" && !this.fixed) this.expand(cx);
        else if (c === "collapse" && this.fixed) this.collapse();
        else if (c.startsWith("go:")) this.go(c.slice(3));
        else if (c.startsWith("key:")) { const k = c.slice(4); this.menu ? this.menuKey(k, cx) : this.handleKey(k, cx); }
        cx.notify();
      }
    });
    cx.timer.every(800, cx => this.tick(cx));
    // GPUI has no blur event for a plain focus handle, so notice focus changes by polling (a redraw only on change).
    // Shared so the leader popup knows where its keys came from (it takes the keyboard when it opens).
    cx.timer.every(300, cx => {
      const k = this.keyboard();
      if (k !== this.sharedKeys) { this.sharedKeys = k; setShared(this.fixed ? "git.tabHasKeys" : "git.hasKeys", k); }
      if (k !== this.hadKeys) { this.hadKeys = k; cx.notify(); }
      if (!this.fixed) this.syncWidth();
      else this.refocus(cx);
    });
    this.refresh(cx, true);
  }

  // A closed copy can't report losing the keyboard any more: clear its flag (a tab closed while it
  // had the keys left the leader thinking the expanded tab still had them, so e collapsed nothing).
  close() {
    setShared(this.fixed ? "git.tabHasKeys" : "git.hasKeys", false);
  }

  // The expanded tab: coming back to it (tab.select, a click on its tab) shows the pane as focused,
  // but only pane.go hands a mod its "focus". So take the keyboard when this pane becomes the focused
  // one; only then, so a popup or dialog over it keeps the keys.
  refocus(cx) {
    const mine = this.token ? shared("git.tabOf")?.[this.token] : null;
    const gits = panes().filter(p => p.mod === "git");
    const pane = mine ? gits.find(p => p.tab === mine) : gits.length === 1 ? gits[0] : null;
    const active = Boolean(pane) && focused()?.pane === pane.pane;
    if (active && !this.wasActive && !this.keyboard() && !this.prompt) { this.handle.focus(); cx.notify(); }
    this.wasActive = active;
  }

  // ---- Data ------------------------------------------------------------------

  tick(cx) {
    if (this.flashMsg && Date.now() > this.flashMsg.until) { this.flashMsg = null; cx.notify(); }
    const k = JSON.stringify(location(this.fixed, this.loc));
    if (k !== this.locKey) return this.refresh(cx, true);
    if (this.dirty || Date.now() - (this.lastHeavy ?? 0) > 30000) { const heavy = this.dirty !== "light"; this.dirty = null; this.refresh(cx, heavy); }
  }

  watch(ctx, cx) {
    const roots = [ctx.root, ...(ctx.gitDir.startsWith(ctx.root + "/") ? [] : [ctx.gitDir])];
    if (ctx.on) return;
    for (const dir of roots) cx.spawn(async () => {
      try {
        while (this.ctx === ctx) {
          const paths = await watchFolder(dir);
          if (this.ctx !== ctx) return;
          const heavy = paths.some(p => p === dir || p.startsWith(ctx.gitDir));
          this.dirty = heavy || this.dirty === true ? true : "light";
        }
      } catch {}
    });
  }

  refresh(cx, heavy) {
    if (this.refreshing) { this.again = this.again || (heavy ? "heavy" : "light"); return; }
    this.refreshing = true;
    const loc = this.loc = location(this.fixed, this.loc), k = JSON.stringify(loc);
    cx.spawn(async cx => {
      try {
        if (k !== this.locKey) {
          this.locKey = k;
          this.ctx = loc.cwd ? await G.openRepo(loc.cwd, loc.on) : null;
          this.cwd = loc.cwd;
          Object.assign(this, { status: null, op: null, branches: null, commits: null, stash: null, prs: null, main: null, mainOverride: null, sel: {}, filter: {}, copied: [], folded: new Set() });
          if (!this.ctx) return;
          this.base = await G.defaultRef(this.ctx);
          this.watch(this.ctx, cx);
          heavy = true; this.prsAt = 0;
        }
        const ctx = this.ctx;
        if (!ctx) return;
        const [status, op] = await Promise.all([G.loadStatus(ctx), G.loadOp(ctx)]);
        if (ctx !== this.ctx) return;
        this.status = status; this.op = op;
        const opKey = op ? `${op.kind}:${op.other}:${op.current ?? ""}` : null;
        if (opKey !== this.incoming?.key) this.incoming = op ? { key: opKey, paths: await incomingPaths(ctx, op).catch(() => new Set()) } : null;
        if (heavy) {
          const [branches, commits, stash] = await Promise.all([G.loadBranches(ctx, this.base), G.loadCommits(ctx, this.tab.commits === 1 ? ["--all"] : ["HEAD"], this.base), G.loadStash(ctx)]);
          if (ctx !== this.ctx) return;
          Object.assign(this, { branches, commits, stash, lastHeavy: Date.now() });
        }
        if (Date.now() - (this.prsAt ?? 0) > 120000) {
          this.prsAt = Date.now();
          cx.spawn(async cx => { const prs = await G.loadPRs(ctx); if (prs && ctx === this.ctx) { this.prs = prs; cx.notify(); } });
        }
        this.syncMain(cx, true);
      } catch (e) { this.flash(`Refresh failed: ${e}`); }
      finally {
        this.refreshing = false; cx.notify();
        if (this.again) { const h = this.again === "heavy"; this.again = null; this.refresh(cx, h); }
      }
    });
  }

  // ---- Lists & selection -----------------------------------------------------

  lk(sec = this.sec) { return sec === "files" ? "files" : sec === "branches" ? `branches${this.tab.branches}` : sec === "commits" ? `commits${this.tab.commits}` : sec; }

  rawItems(sec) {
    if (sec === "files") {
      const files = this.status?.files ?? [];
      // A filter lists the matching files flat.
      return this.flat || this.filter.files ? files.map(f => ({ kind: "file", path: f.path, file: f, depth: 0 })) : treeRows(files, this.folded);
    }
    if (sec === "branches") return (this.tab.branches ? this.branches?.remote : this.branches?.local) ?? [];
    if (sec === "commits") return this.commits ?? [];
    return this.stash ?? [];
  }

  textOf(sec, it) {
    if (sec === "files") return it.path;
    if (sec === "branches") return `${it.name} ${it.subject}`;
    if (sec === "commits") return it.sha ? `${it.short} ${it.subject} ${it.author} ${it.refs.join(" ")}` : "";
    return it.message;
  }

  items(sec = this.sec) {
    const all = this.rawItems(sec), f = this.filter[this.lk(sec)]?.toLowerCase();
    return f ? all.filter(it => this.textOf(sec, it).toLowerCase().includes(f)) : all;
  }

  selIndex(sec = this.sec) {
    const items = this.items(sec);
    let i = Math.max(0, Math.min(this.sel[this.lk(sec)] ?? 0, items.length - 1));
    if (sec === "commits") { while (i < items.length - 1 && !items[i]?.sha) i++; }
    return i;
  }
  selected(sec = this.sec) { return this.items(sec)[this.selIndex(sec)] ?? null; }

  move(delta, cx, absolute) {
    const items = this.items();
    if (!items.length) return;
    let i = absolute != null ? absolute : this.selIndex() + delta;
    i = Math.max(0, Math.min(i, items.length - 1));
    if (this.sec === "commits") {
      const dir = (absolute != null ? (absolute === 0 ? 1 : -1) : Math.sign(delta)) || 1;
      let j = i;
      while (j >= 0 && j < items.length && !items[j].sha) j += dir;
      if (j < 0 || j >= items.length) { j = i; while (j >= 0 && j < items.length && !items[j].sha) j -= dir; }
      if (j >= 0 && j < items.length) i = j;
    }
    this.sel[this.lk()] = i;
    this.scrolls[this.lk()].scroll_to_item(i);
    this.mainOverride = null;
    this.syncMain(cx);
    cx.notify();
  }

  focusSection(id, cx) {
    if (this.sec !== id) { this.sec = id; this.mainOverride = null; this.mainFocus = false; this.syncMain(cx); }
    this.handle.focus();
    cx.notify();
  }

  switchTab(delta, cx) {
    const s = SECTIONS.find(x => x.id === this.sec);
    if (!s.tabs) return;
    this.tab[this.sec] = (this.tab[this.sec] + delta + s.tabs.length) % s.tabs.length;
    if (this.sec === "commits") this.refresh(cx, true);
    this.syncMain(cx); cx.notify();
  }

  // ---- Main view -------------------------------------------------------------

  mainSpec() {
    const it = this.selected(), ctx = this.ctx;
    if (!it || !ctx) return null;
    switch (this.sec) {
      case "files":
        if (it.kind === "dir") return { key: `d:${it.path}`, title: it.path || "/", path: it.path, diff: () => loadFolderDiff(ctx, it.path, this.status?.files ?? []) };
        return { key: `f:${it.path}`, title: it.path, path: it.path, diff: () => it.file.conflict ? loadConflict(ctx, it.file, this.sides()) : loadFileDiff(ctx, it.file) };
      case "branches": return { key: `b:${it.name}:${it.sha}`, title: `log · ${it.name}`, commits: () => G.loadCommits(ctx, [it.name], this.base, 200) };
      case "commits": return it.sha ? { key: `c:${it.sha}`, title: `${it.short} · ${it.subject}`, load: () => G.commitShow(ctx, it.sha) } : null;
      case "stash": return { key: `s:${it.ref}:${it.message}`, title: `${it.ref} · ${it.message}`, load: () => G.stashShow(ctx, it.ref) };
    }
    return null;
  }

  syncMain(cx, force) {
    const spec = this.mainOverride ?? this.mainSpec();
    if (!spec) { this.main = null; return; }
    if (spec.log) { this.showLogEditor(spec.log); this.main = { key: spec.key, log: spec.log }; return; }
    if (spec.key === this.main?.key && !force) return;
    const same = spec.key === this.main?.key;
    this.main = { key: spec.key, title: spec.title, style: spec.style, path: spec.path, rows: same ? this.main.rows : null, commits: same ? this.main.commits : null, diff: same ? this.main.diff : null, notesSig: same ? this.main.notesSig : null, width: same ? this.main.width : 0 };
    if (!same) this.mainTop = 0;
    const token = ++this.mainToken, main = this.main;
    if (spec.diff) {
      cx.spawn(async cx => {
        const d = await spec.diff().catch(e => ({ rows: [{ kind: "meta", text: String(e) }], hunks: [] }));
        if (token !== this.mainToken) return;
        main.diff = d; main.notesSig = null;
        this.diffRows(main);
        if (same) this.clampCursor(); else { this.cur = this.firstChange(); this.anchor = null; }
        cx.notify();
      });
      return;
    }
    if (spec.commits) {
      cx.spawn(async cx => {
        const commits = await spec.commits().catch(() => []);
        if (token !== this.mainToken) return;
        main.commits = commits; main.rows = commits; main.width = 0;
        cx.notify();
      });
      return;
    }
    cx.spawn(async cx => {
      const lines = await spec.load().catch(e => [String(e)]);
      if (token !== this.mainToken) return;
      main.rows = lines.map(l => lineKind(l.replace(/\t/g, "    "), spec.style));
      main.width = Math.min(30000, Math.max(300, ...lines.slice(0, 2000).map(l => l.length * 7.3 + 40)));
      cx.notify();
    });
  }

  showLogEditor(entry) {
    const value = `$ ${entry.title}\n${entry.running ? "(running…)" : `(exit ${entry.code})`}\n\n${entry.output || (entry.running ? "" : "(no output)")}`;
    if (this.editorFor === entry.id && this.editorValue === value) return;
    this.editor?.release();
    this.editor = EditorState.new({ value, readonly: true, line_numbers: false, folding: false, soft_wrap: true, font_family: settings().font_family ?? "JetBrains Mono", font_size: 12 });
    this.editor.on("focus", (_e, cx) => { this.editorFocused = true; cx.notify(); });
    this.editor.on("blur", (_e, cx) => { this.editorFocused = false; cx.notify(); });
    this.editorFor = entry.id; this.editorValue = value;
  }

  showOutput(entry, cx) {
    this.mainOverride = { key: `log:${entry.id}:${entry.running}`, log: entry };
    this.syncMain(cx); cx.notify();
  }

  scrollMain(delta, cx) {
    const n = this.main?.rows?.length ?? 0;
    this.mainTop = Math.max(0, Math.min(n - 1, this.mainTop + delta));
    this.scrolls.main.scroll_to_item(this.mainTop, "top");
    cx.notify();
  }

  // ---- Files: the diff, hunks, notes ---------------------------------------------

  // Review notes, kept per repo until sent to an agent (shared, so the expanded tab sees them).
  notesKey() { return this.ctx ? `${this.ctx.on ?? ""}:${this.ctx.root}` : null; }
  notes() { return (shared("git.notes") ?? {})[this.notesKey()] ?? []; }
  setNotes(list) {
    const all = { ...(shared("git.notes") ?? {}) }, k = this.notesKey();
    if (!k) return;
    if (list.length) all[k] = list; else delete all[k];
    setShared("git.notes", all);
  }

  // The diff's rows with this file's notes under the line each ends on (rebuilt when the notes change).
  diffRows(main = this.main) {
    if (!main?.diff) return main?.rows ?? [];
    const notes = this.notes().filter(n => main.diff.folder ? this.under(main.path, n.path) : n.path === main.path), sig = notes.map(n => n.id).join(",");
    if (main.rows && main.notesSig === sig) return main.rows;
    const rows = [], placed = new Set();
    const noteRows = n => String(n.text).split("\n").map((line, i) => ({ kind: "note", note: n, text: `${i ? "  " : "✎ "}${line}` }));
    for (const r of main.diff.rows) {
      rows.push(r);
      if (!lineRow(r)) continue;
      for (const n of notes) if (!placed.has(n.id) && n.side === r.side && n.at === this.anchorOf(r) && n.path === (r.file ?? main.path)) { placed.add(n.id); rows.push(...noteRows(n)); }
    }
    const loose = notes.filter(n => !placed.has(n.id));
    if (loose.length) rows.push({ kind: "section", text: "Notes on lines that moved" }, ...loose.flatMap(noteRows));
    main.rows = rows; main.notesSig = sig;
    main.width = Math.min(30000, Math.max(300, ...rows.slice(0, 2000).map(r => String(r.text ?? "").length * 7.3 + 110)));
    return rows;
  }

  // The status entry for a path, and the file a diff row belongs to (a folder's diff has several).
  fileAt(path) { return (this.status?.files ?? []).find(f => f.path === path) ?? null; }
  rowPath(r) { return r?.file ?? (this.main?.diff?.folder ? null : this.main?.path) ?? null; }
  under(folder, path) { return !folder || path.startsWith(`${folder}/`); }

  // Files tree: fold or unfold a folder row (enter, a click on a selected folder), keeping it selected.
  toggleFold(row, cx) {
    if (row?.kind !== "dir") return;
    if (this.folded.has(row.path)) this.folded.delete(row.path); else this.folded.add(row.path);
    this.keepSelected(row, cx);
  }
  foldAll(fold, cx) {
    const row = this.selected("files");
    this.folded = fold ? new Set(treeRows(this.status?.files ?? [], new Set()).filter(r => r.kind === "dir" && !r.root).map(r => r.path)) : new Set();
    // The selection climbs to its outermost folded folder.
    const top = row && fold ? treeRows(this.status?.files ?? [], this.folded).find(r => r.kind === "dir" && !r.root && this.under(r.path, row.path)) : row;
    this.keepSelected(top ?? row, cx);
  }
  keepSelected(row, cx) {
    const i = this.items("files").findIndex(r => row && r.kind === row.kind && r.path === row.path);
    if (i >= 0) this.sel.files = i;
    this.mainOverride = null; this.syncMain(cx); cx.notify();
  }
  toggleFlat(cx) {
    const row = this.selected("files");
    this.flat = !this.flat; setShared("git.flatFiles", this.flat);
    this.keepSelected(row?.kind === "file" ? row : null, cx);
    this.flash(this.flat ? "Files: flat list" : "Files: tree");
  }
  // J / K in the diff: the next / previous file row (folders skipped).
  nextFile(dir, cx) {
    const items = this.items("files");
    let i = this.selIndex("files") + dir;
    while (i >= 0 && i < items.length && items[i].kind !== "file") i += dir;
    if (i >= 0 && i < items.length) this.move(0, cx, i);
  }

  // The operation's two sides, named (null when no merge / rebase / pick is running).
  sides() { return sidesOf(this.op, this.status?.info?.head); }
  fromIncoming(path) { return Boolean(this.incoming?.paths?.has(path)); }

  revealCursor() {
    if ((this.main?.rows?.length ?? 0) > PLAIN_ROWS) this.scrolls.main.scroll_to_item(this.cur);
    else this.diffScroll.scroll_to_item(this.cur);
  }

  // A press on a diff line: the cursor goes there; shift extends the selection from the cursor;
  // holding the button and moving selects the lines dragged over.
  pressLine(i, e, cx) {
    const rows = this.main?.rows ?? [];
    if (!lineRow(rows[i])) return;
    this.handle.focus();
    this.mainFocus = true;
    if (e?.modifiers?.shift) { if (this.anchor == null) this.anchor = this.cur; this.cur = i; }
    else { this.cur = i; this.anchor = null; this.dragging = i; }
    cx.notify();
  }
  dragTo(i, cx) {
    if (this.dragging == null || i === this.cur || !lineRow(this.main?.rows?.[i])) return;
    this.anchor = this.dragging; this.cur = i;
    cx.notify();
  }

  // A hunk header's buttons: put the cursor on the hunk, then stage / unstage / discard it.
  onHunk(i, what, cx) {
    const rows = this.main?.rows ?? [], h = rows[i]?.hunk;
    let j = i + 1;
    while (j < rows.length && rows[j].hunk === h && !changeRow(rows[j])) j++;
    this.cur = j < rows.length && rows[j].hunk === h ? j : i + 1; this.anchor = null; this.mainFocus = true;
    if (what === "discard") this.discardHunk(cx); else if (what === "note") this.addNote(cx); else this.stageHunk(cx);
  }

  // Keeps one side of a conflict (o / t / b, or its buttons): rewrites the file without its markers.
  resolve(choice, cx, block) {
    const d = this.main?.diff, f = this.fileAt(this.main?.path);
    const b = block ?? this.main?.rows?.[this.cur]?.block;
    if (!d?.text || !b || !f) { this.flash("Move onto a conflict first"); return; }
    const text = resolveBlock(d.text, b, choice), ctx = this.ctx;
    const label = { ours: this.sides()?.oursShort ?? "ours", theirs: this.sides()?.theirsShort ?? "theirs", both: "both" }[choice];
    cx.spawn(async cx => {
      const r = await exec("sh", ["-c", 'printf "%s" "$1" > "$2"', "write", text, f.path], { cwd: ctx.root, on: ctx.on }).catch(e => ({ code: -1, stderr: String(e) }));
      if (r.code !== 0) this.flash(`Couldn't write ${f.path}: ${(r.stderr ?? "").trim()}`, 6000);
      else this.flash(`Kept ${label} in conflict ${b.index + 1}${d.blocks.length === 1 ? ": no conflicts left, space stages it" : ""}`);
      this.refresh(cx, false);
      cx.notify();
    });
  }

  anchorOf(r) { return `${r.kind === "del" ? "o" : "n"}${lineOf(r)}`; }
  firstChange() { const rows = this.main?.rows ?? []; const i = rows.findIndex(changeRow); return i >= 0 ? i : Math.max(0, rows.findIndex(lineRow)); }
  clampCursor() {
    const rows = this.main?.rows ?? [];
    let i = Math.max(0, Math.min(this.cur, rows.length - 1));
    if (!lineRow(rows[i])) { let j = i; while (j < rows.length && !lineRow(rows[j])) j++; if (j >= rows.length) { j = i; while (j > 0 && !lineRow(rows[j])) j--; } i = j; }
    this.cur = i;
    if (this.anchor != null && this.anchor >= rows.length) this.anchor = null;
  }

  // Moves the diff cursor to `i` (stepping over headers and notes in `dir`) and keeps it in view.
  cursorTo(i, dir = 1) {
    const rows = this.main?.rows ?? [];
    if (!rows.length) return;
    i = Math.max(0, Math.min(i, rows.length - 1));
    let j = i;
    while (j >= 0 && j < rows.length && !lineRow(rows[j])) j += dir;
    if (j < 0 || j >= rows.length) { j = i; while (j >= 0 && j < rows.length && !lineRow(rows[j])) j -= dir; }
    if (j >= 0 && j < rows.length) this.cur = j;
    this.revealCursor();
  }

  // ↓ / ↑ (and } / {): the next hunk's (or conflict's) first change, or the start of this one / the previous one.
  hunkJump(dir) {
    const rows = this.main?.rows ?? [], group = r => r?.hunk ?? r?.block ?? null, here = group(rows[this.cur]);
    const starts = [];
    rows.forEach((r, i) => { if (r.kind === "hunk" || (r.kind === "mark" && r.part === "ours")) starts.push(i); });
    const firstIn = s => {
      const g = group(rows[s]);
      for (let i = s + 1; i < rows.length && group(rows[i]) === g; i++) if (changeRow(rows[i]) || (rows[i].block && lineRow(rows[i]))) return i;
      return s + 1;
    };
    if (dir > 0) { const s = starts.find(s => s > this.cur && group(rows[s]) !== here); if (s != null) this.cursorTo(firstIn(s)); return; }
    const mine = starts.filter(s => s < this.cur), at = mine.length ? firstIn(mine[mine.length - 1]) : null;
    const s = at != null && at < this.cur ? mine[mine.length - 1] : mine[mine.length - 2];
    if (s != null) this.cursorTo(firstIn(s), -1);
  }

  // The chosen lines (v): changes between the anchor and the cursor on the cursor's side, else null.
  picked() {
    if (this.anchor == null) return null;
    const rows = this.main?.rows ?? [], side = rows[this.cur]?.side;
    const [a, b] = [Math.min(this.anchor, this.cur), Math.max(this.anchor, this.cur)];
    return new Set(rows.slice(a, b + 1).filter(r => changeRow(r) && r.side === side));
  }

  // space in the diff: stage (or, on the staged side, unstage) the chosen lines or the cursor's hunk.
  stageHunk(cx) {
    const r = this.main?.rows?.[this.cur], f = this.fileAt(this.rowPath(r));
    if (r?.side === "conflict") { this.flash("Keep a side first (o / t / b or the buttons), then stage the file"); return; }
    if (!f || !r?.hunk) { this.flash("Move onto a change first"); return; }
    if (f.untracked) { this.cmd(`git add ${f.path}`, `git add -- ${q(f.path)}`, cx, { term: false }); return; }
    const pick = this.picked(), reverse = r.side === "staged";
    const patch = patchFor(pick ? [...new Set([...pick].map(x => x.hunk))] : [r.hunk], pick, reverse);
    if (!patch) { this.flash("No changes chosen"); return; }
    const what = pick ? `${pick.size} line${pick.size === 1 ? "" : "s"}` : "hunk";
    this.anchor = null;
    this.cmd(`${reverse ? "unstage" : "stage"} ${what} of ${f.path}`, `printf '%s' ${q(patch)} | git apply --cached${reverse ? " --reverse" : ""} --recount --whitespace=nowarn -`, cx, { term: false });
  }

  // d in the diff: throw away the chosen lines or the cursor's hunk from the working tree (asks first).
  discardHunk(cx) {
    const r = this.main?.rows?.[this.cur], f = this.fileAt(this.rowPath(r));
    if (!f || !r?.hunk) { this.flash("Move onto a change first"); return; }
    if (r.side !== "unstaged") { this.flash(r.side === "staged" ? "Unstage it first (space), then discard" : "Resolve the conflict instead"); return; }
    if (f.untracked) return this.discardFile(f, cx);
    const pick = this.picked(), patch = patchFor(pick ? [...new Set([...pick].map(x => x.hunk))] : [r.hunk], pick, true);
    if (!patch) { this.flash("No changes chosen"); return; }
    const what = pick ? `${pick.size} line${pick.size === 1 ? "" : "s"}` : "this hunk";
    this.confirm(`Discard ${what} in ${f.path}? It can't be undone.`, "Discard", cx => {
      this.anchor = null;
      this.cmd(`discard ${what} of ${f.path}`, `printf '%s' ${q(patch)} | git apply --reverse --recount --whitespace=nowarn -`, cx, { term: false });
    }, cx);
  }

  discardFile(f, cx) {
    if (f.conflict) { this.flash("Resolve the conflict instead (v)"); cx.notify(); return; }
    if (f.untracked) return this.confirm(`Delete the untracked ${f.path}?`, "Delete file", cx => this.cmd(`git clean -f ${f.path}`, `git clean -fq -- ${q(f.path)}`, cx, { term: false }), cx);
    const all = f.x === "A" ? `git rm -qf -- ${q(f.path)}` : `git restore --source=HEAD --staged --worktree -- ${q(f.path)}`;
    this.openMenu(`Discard changes to ${f.path}`, [
      f.unstaged && f.staged && { key: "u", label: "Discard unstaged changes", hint: "keep what's staged", danger: true, run: cx => this.cmd(`git restore ${f.path}`, `git restore -- ${q(f.path)}`, cx, { term: false }) },
      { key: "a", label: f.x === "A" ? "Discard the new file" : "Discard all changes", hint: "staged and unstaged", danger: true, run: cx => this.cmd(`discard ${f.path}`, all, cx, { term: false }) },
      { key: "n", label: "Cancel", run: () => {} },
    ], cx);
  }

  // a in the diff: a note on the cursor's line, or on the chosen lines (v).
  addNote(cx) {
    const rows = this.main?.rows ?? [], r = rows[this.cur], path = this.rowPath(r), f = path ? { path } : null;
    if (!f || !lineRow(r)) { this.flash("Move onto a line first"); return; }
    const [a, b] = this.anchor == null ? [this.cur, this.cur] : [Math.min(this.anchor, this.cur), Math.max(this.anchor, this.cur)];
    const span = rows.slice(a, b + 1).filter(x => lineRow(x) && x.side === r.side && this.rowPath(x) === path), last = span[span.length - 1];
    const from = lineOf(span[0]), to = lineOf(last);
    this.ask(`Note on ${f.path}:${from}${to !== from ? `-${to}` : ""}`, "", (text, cx) => {
      if (!text.trim()) return;
      const note = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, path: f.path, side: r.side, at: this.anchorOf(last), from, to, text: text.trim(), snippet: snippetOf(span) };
      this.setNotes([...this.notes(), note]);
      this.anchor = null;
    }, cx, { hint: "What should change here? Enter saves; i or p sends your notes to an agent" });
  }

  // Ask AI (the diff's button, A): a question about this file's change, or the selected lines,
  // with the diff in the prompt; then where to send it.
  askAbout(cx) {
    const m = this.main, ctx = this.ctx, f = m?.path != null ? { path: m.diff?.folder ? `${m.path || "."}/` : m.path } : null;
    if (!f || !m?.diff || !ctx) return;
    const rows = m.rows ?? [], sides = this.sides();
    const [a, b] = this.anchor == null ? [0, rows.length - 1] : [Math.min(this.anchor, this.cur), Math.max(this.anchor, this.cur)];
    const part = rows.slice(a, b + 1), picked = this.anchor != null;
    const text = r => r.kind === "section" ? `## ${r.text}` : r.kind === "hunk" ? r.text
      : r.kind === "mark" ? (r.part === "ours" ? `<<<<<<< ${sides?.ours ?? "current"}` : r.part === "theirs" ? `======= (below: ${sides?.theirs ?? "incoming"})` : "||||||| base")
      : r.kind === "note" ? null : ({ add: "+", del: "-", ours: " ", theirs: " ", base: " " }[r.kind] ?? " ") + (r.text ?? "");
    let lines = part.map(text).filter(x => x != null);
    if (lines.length > 400) lines = [...lines.slice(0, 400), `… (${lines.length - 400} more lines)`];
    const what = picked ? `${f.path}:${lineOf(part.find(lineRow)) ?? ""}-${lineOf([...part].reverse().find(lineRow)) ?? ""}` : f.path;
    const name = m.diff.folder ? `${m.path.split("/").pop() || "/"}/` : f.path.split("/").pop();
    this.ask(`Ask AI about ${picked ? `these ${part.filter(lineRow).length} lines of ` : ""}${name}`, "", (question, cx) => {
      const head = this.status?.info?.head;
      const prompt = [
        `About ${picked ? "these lines of " : "the uncommitted change to "}${what} in ${ctx.root}${head ? ` (branch ${head})` : ""}${sides ? `, during a ${this.op.kind}: ${sides.ours} vs ${sides.theirs}` : ""}:`,
        "", "```diff", ...lines, "```", "",
        question || "Explain what this change does and point out anything risky or wrong. Don't edit anything yet.",
      ].join("\n");
      this.pickAgent(prompt, `about ${name}`, cx, null, `Ask AI about ${name}`);
    }, cx, { hint: "Your question (empty: explain it and flag anything risky). Enter picks the agent" });
  }

  // X in the diff: removes the notes on the cursor's line.
  deleteNotes(cx) {
    const r = this.main?.rows?.[this.cur], path = this.rowPath(r), f = path ? { path } : null;
    if (!r || !f) return;
    const at = this.anchorOf(r), keep = this.notes().filter(n => !(n.path === f.path && n.side === r.side && n.at === at));
    if (keep.length === this.notes().length) { this.flash("No note on this line"); return; }
    this.setNotes(keep); this.flash("Note removed");
  }

  notesPrompt(notes) {
    const head = this.status?.info?.head;
    const items = notes.map((n, i) => [
      `${i + 1}. ${n.path}:${n.from}${n.to !== n.from ? `-${n.to}` : ""} (${n.side} changes)`,
      n.snippet ? "```diff\n" + n.snippet + "\n```" : "",
      `   ${n.text.replace(/\n/g, "\n   ")}`,
    ].filter(Boolean).join("\n"));
    return [`Review notes on the uncommitted changes in ${this.ctx.root}${head ? ` (branch ${head})` : ""}.`,
      "Address each note in the code, then tell me briefly what you changed.", "", ...items].join("\n");
  }

  // o in Files: the file in the editor from config.json ("editor", default nvim), at the cursor's line.
  openEditor(path, line) {
    if (!this.ctx) return;
    const editor = this.config?.editor || "nvim";
    run("terminal.open", { argv: [this.shell ?? "/bin/zsh", "-lic", `${editor} ${line ? `+${line} ` : ""}${q(path)}`], folder: this.ctx.root, place: "right" });
  }

  // Keys while the diff has the cursor (enter from Files). False: not a diff key.
  diffKey(k, cx) {
    const rows = this.main?.rows ?? [];
    switch (k) {
      // Hunk to hunk; while selecting lines (v), line by line.
      case "j": case "down": if (this.anchor != null) this.cursorTo(this.cur + 1, 1); else this.hunkJump(1); break;
      case "k": case "up": if (this.anchor != null) this.cursorTo(this.cur - 1, -1); else this.hunkJump(-1); break;
      case "ctrl-d": case "pagedown": this.cursorTo(this.cur + 15, 1); break;
      case "ctrl-u": case "pageup": this.cursorTo(this.cur - 15, -1); break;
      case "<": case "home": case "g": this.cursorTo(0, 1); break;
      case ">": case "end": case "G": this.cursorTo(rows.length - 1, -1); break;
      case "}": this.hunkJump(1); break;
      case "A": this.askAbout(cx); break;
      case "{": this.hunkJump(-1); break;
      case "J": this.nextFile(1, cx); break;
      case "K": this.nextFile(-1, cx); break;
      case "v": this.anchor = this.anchor == null ? this.cur : null; break;
      case "space": this.stageHunk(cx); break;
      case "d": this.discardHunk(cx); break;
      case "a": this.addNote(cx); break;
      case "X": this.deleteNotes(cx); break;
      case "p": this.askAI(cx, "notes"); break;
      case "o": if (rows[this.cur]?.block) this.resolve("ours", cx); else this.openEditor(this.main.path, lineOf(rows[this.cur])); break;
      case "t": if (rows[this.cur]?.block) this.resolve("theirs", cx); else return false; break;
      case "b": if (rows[this.cur]?.block) this.resolve("both", cx); else return false; break;
      case "e": this.openEditor(this.main.path, lineOf(rows[this.cur])); break;
      case "escape": case "h": case "left":
        this.dragging = null;
        if (this.anchor != null) this.anchor = null; else this.mainFocus = false;
        break;
      default: return false;
    }
    cx.notify();
    return true;
  }

  // ---- Files: the panel widens while Files shows ---------------------------------

  // The column holding the panel's stack (what the tab bar shows and hides), as panel.js's hidePanel finds it.
  panelColumn() {
    const path = pathTo(layout(), "git");
    if (!path) return null;
    for (let i = path.length - 2; i >= 0; i--) if (path[i].type === "stack") return i - 1 > 0 ? path[i - 1] : path[i];
    return null;
  }

  syncWidth() {
    // Widens on Files, then stays wide while the panel shows (moving to 3 / 4 / 5 doesn't jump the
    // layout back and forth); narrows when the panel is hidden or shows another panel.
    const shown = Boolean(this.ctx) && panelOnScreen("git") === true;
    const want = shown && (this.sec === "files" || Boolean(this.widened));
    if (want && !this.widened) {
      const col = this.panelColumn(), px = col?.size?.px, to = Math.min(col?.max ?? WIDE, WIDE);
      this.widened = col?.id && px && px < to - 2 ? { id: col.id, from: px, to } : { skip: true };
      if (!this.widened.skip) run("layout.resize", { id: col.id, px: to });
      setShared("git.widened", this.widened);
    } else if (!want && this.widened) {
      const w = this.widened;
      this.widened = null;
      setShared("git.widened", null);
      if (!w.skip) run("layout.resize", { id: w.id, px: w.from });
    }
  }

  // ---- Running commands ------------------------------------------------------

  flash(text, ms = 3500) { this.flashMsg = { text, until: Date.now() + ms }; }

  // term: a core terminal through the login shell (hooks, network, prompts); otherwise exec.
  cmd(title, script, cx, { term = true, after, onFail } = {}) {
    if (!this.ctx) return;
    if (this.running) { this.flash("Wait for the running git command to finish"); cx.notify(); return; }
    const ctx = this.ctx, entry = { id: ++this.seq, title, script, code: null, output: "", at: Date.now(), running: true };
    this.log.unshift(entry); this.running = entry; this.failure = null;
    cx.notify();
    cx.spawn(async cx => {
      let r;
      if (term) r = await G.runScript(ctx, script, this.shell ?? "/bin/zsh", addr => { entry.addr = addr; cx.notify(); });
      else {
        const e = await exec("sh", ["-c", script], { cwd: ctx.root, on: ctx.on }).catch(e => ({ code: -1, stdout: "", stderr: String(e) }));
        r = { code: e.code, output: [e.stdout, e.stderr].filter(Boolean).join("\n").trim() };
      }
      Object.assign(entry, { code: r.code, output: r.output, running: false, addr: null });
      this.running = null;
      const op = await G.loadOp(ctx).catch(() => null);
      if (r.code === 0) after?.(cx);
      else {
        onFail?.(cx);
        // A merge or rebase that stopped on conflicts shows in the banner, not as a failure.
        if (!op) { this.failure = entry; this.showOutput(entry, cx); }
      }
      if (this.mainOverride?.log === entry) this.syncMain(cx, true);
      this.refresh(cx, true);
      cx.notify();
    });
  }

  confirm(title, label, action, cx, lines) {
    this.openMenu(title, [{ key: "y", label, danger: true, run: action }, { key: "n", label: "Cancel", run: () => {} }], cx, lines);
  }

  openMenu(title, items, cx, lines) {
    this.menu = { title, items: items.filter(Boolean), sel: 0, lines };
    cx.notify();
  }

  menuKey(k, cx) {
    const m = this.menu;
    if (k === "escape" || k === "q") { this.menu = null; }
    else if (k === "j" || k === "down") m.sel = Math.min(m.items.length - 1, m.sel + 1);
    else if (k === "k" || k === "up") m.sel = Math.max(0, m.sel - 1);
    else {
      const item = k === "enter" || k === "space" ? m.items[m.sel] : m.items.find(i => i.key === k);
      if (item && !item.disabled) { this.menu = null; item.run(cx); }
    }
    cx.notify();
  }

  // `onClose(text)`: esc closed it, with what was typed. `select: false` puts the cursor at the end.
  ask(title, value, onSubmit, cx, { hint, live, onClose, select = true } = {}) {
    const input = InputState.new({ value: value ?? "", placeholder: hint ?? "" });
    if (value) input.set_selected_range(select ? { start: 0, end: value.length } : { start: value.length, end: value.length });
    input.on("submit", (_e, cx) => { const v = input.value(); this.prompt = null; this.typing = false; this.handle.focus(); onSubmit(v.trim(), cx); cx.notify(); });
    input.on("change", (_e, cx) => { live?.(input.value(), cx); cx.notify(); });
    input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.prompt = { title, input, onCancel: cx => { live?.("", cx); onClose?.(input.value(), cx); } };
    this.typing = true;
    input.focus();
    cx.notify();
  }

  cancelPrompt(cx) {
    this.prompt?.onCancel?.(cx);
    this.prompt = null; this.typing = false; this.handle.focus(); cx.notify();
  }

  // ---- AI hand-off -----------------------------------------------------------

  conflicts() { return (this.status?.files ?? []).filter(f => f.conflict); }

  // The conflicts pane (mods/git-conflicts) beside the tab, on demand: v, or Resolve on the banner.
  openConflicts() {
    const tab = focused()?.tab, ctx = this.ctx;
    if (!tab || !ctx) return;
    const open = panes().find(p => p.tab === tab && p.mod === "git-conflicts");
    if (open) return run("pane.focus", { pane: open.pane });
    const p = { tab, root: ctx.root, gitDir: ctx.gitDir, on: ctx.on ?? null };
    run("pane.split", { direction: "right", mod: "git-conflicts", props: p });
  }

  conflictPrompt() {
    const op = this.op, root = this.ctx.root, files = this.conflicts().map(f => `- ${f.path}`);
    const what = op.kind === "rebase"
      ? `a rebase of \`${op.branch ?? "HEAD"}\` onto \`${op.other}\`${op.step ? ` (commit ${op.step} of ${op.total})` : ""}${op.current ? `, stopped while applying ${op.current}` : ""}`
      : op.kind === "merge" ? `a merge of \`${op.other}\` into \`${this.status?.info.head}\`${op.message ? ` (${op.message})` : ""}` : `a ${op.kind} of ${op.other}`;
    return [
      `I'm in the middle of ${what} in ${root}. These files have conflicts:`, ...files, "",
      ...(op.kind === "rebase" ? ["During a rebase, \"ours\"/HEAD is the upstream side and \"theirs\" is my commit being replayed.", ""] : []),
      "Please resolve them: check what each side changed and why (git log / git show on the commits involved), edit the files so both intents are kept, remove every conflict marker, run the relevant type-check/lint/tests for the touched files, then `git add` each resolved file.",
      `Don't run \`git ${op.kind} --continue\`, commit, or push: I'll review and continue myself. When you're done, summarize how you resolved each file.`,
    ].join("\n");
  }

  failurePrompt(entry) {
    const lines = entry.output.split("\n"), tail = lines.length > 300 ? ["… (earlier output trimmed)", ...lines.slice(-300)] : lines;
    const commit = /\bgit commit\b/.test(entry.title);
    return [
      `This git command failed in ${this.ctx.root} (exit ${entry.code}):`, "", `$ ${entry.title}`, "", "Output:", "```", ...tail, "```", "",
      commit ? "This is most likely the pre-commit hook. Please fix the reported problems and `git add` the fixes, but don't commit: I'll re-run the commit myself."
        : "Please find the cause and fix it. Don't re-run the git command yourself; tell me when it's safe to retry.",
    ].join("\n");
  }

  // `want` "notes": the review notes, even when there are conflicts or a failure.
  askAI(cx, want) {
    if (!this.ctx) return;
    let prompt, label, sent = null;
    const notes = this.notes();
    if (want !== "notes" && this.op && this.conflicts().length) { prompt = this.conflictPrompt(); label = "resolve conflicts"; }
    else if (want !== "notes" && this.mainOverride?.log && !this.mainOverride.log.running && this.mainOverride.log.code !== 0) { prompt = this.failurePrompt(this.mainOverride.log); label = "fix git failure"; }
    else if (want !== "notes" && this.failure) { prompt = this.failurePrompt(this.failure); label = "fix git failure"; }
    else if (notes.length) {
      prompt = this.notesPrompt(notes); label = `address ${notes.length} review note${notes.length === 1 ? "" : "s"}`;
      // Sent notes are done with; only the ones that went (more may have been added since).
      sent = () => { const ids = new Set(notes.map(n => n.id)); this.setNotes(this.notes().filter(n => !ids.has(n.id))); };
    }
    if (!prompt) { this.flash(want === "notes" ? "No review notes yet: enter on a file, then a on a line" : "Nothing to hand off: no conflicts, failed command or review notes"); cx.notify(); return; }
    this.pickAgent(prompt, label, cx, sent, `Ask AI to ${label}`);
  }

  // Where a prompt goes: an agent in this space, a new agent tab, or the clipboard.
  pickAgent(prompt, label, cx, sent, title) {
    const space = spaces().find(s => s.active);
    const here = agents().filter(a => a.space === space?.id);
    const fresh = this.known?.find(k => k.installed);
    this.openMenu(title ?? `Ask AI: ${label}`, [
      ...here.slice(0, 8).map((a, i) => ({ key: String(i + 1), label: `Send to ${a.program?.name ?? a.app ?? "agent"} · ${a.tab_name === (a.program?.name ?? a.app) ? `tab ${a.tab_index}` : a.tab_name}`, hint: a.status, run: cx => this.sendToAgent(a, prompt, label, cx, sent) })),
      fresh && { key: "n", label: `New ${fresh.name} tab`, run: () => { run("tab.new", { argv: fresh.run, task: prompt, folder: this.ctx.root, name: `AI · ${label}` }); this.ai = { label, address: null }; sent?.(); } },
      { key: "y", label: "Copy prompt", run: cx => { cx.write_to_clipboard(prompt); this.flash("Prompt copied"); } },
    ], cx);
  }

  sendToAgent(agent, prompt, label, cx, sent) {
    cx.spawn(async cx => {
      const r = await hc(["send", agent.address, prompt]).catch(e => ({ code: 1, stderr: String(e) }));
      if (r.code !== 0) this.flash(`Couldn't send: ${(r.stderr || r.stdout).trim()}`, 6000);
      else { this.ai = { label, address: agent.address }; sent?.(); }
      cx.notify();
    });
  }

  // ---- Actions -----------------------------------------------------------------

  async baseOf(sha, depth) {
    const r = await G.git(this.ctx, ["rev-parse", "-q", "--verify", `${sha}~${depth}`]).catch(() => null);
    return r?.code === 0 ? `${sha}~${depth}` : "--root";
  }

  rewrite(title, c, cx, build) { this.rewriteMany(title, [c], cx, build); }

  // A history rewrite touching `commits` (asks first when any is pushed). The
  // range ends with it unless `keepRange` (moving a block keeps it selected).
  rewriteMany(title, commits, cx, build, { keepRange = false, terminal = false } = {}) {
    if (this.tab.commits !== 0) { this.flash("Rewrite commits from the Branch tab (] to switch)"); cx.notify(); return; }
    if (commits.some(c => c.parents.length > 1)) { this.flash("Can't rewrite a merge commit here"); cx.notify(); return; }
    const go = cx => cx.spawn(async cx => {
      const script = await build();
      if (!keepRange) this.clearRange();
      if (terminal) run("terminal.open", { argv: [this.shell ?? "/bin/zsh", "-lic", script], folder: this.ctx.root, place: "tab", name: title });
      else this.cmd(title, script, cx);
      cx.notify();
    });
    const pushed = commits.filter(c => c.state !== "unpushed");
    if (pushed.length) this.confirm(`${pushed.length > 1 ? `${pushed.length} of these commits are` : `${pushed[0].short} is`} already pushed. Rewriting needs a force push.`, "Rewrite anyway", go, cx);
    else go(cx);
  }

  // `a`: a commit, or several comma separated (each cut to 7 characters).
  todo(mode, a, b, op, base) {
    const short = a.split(",").map(x => x.slice(0, 7)).join(",");
    return `HERDR_MODE=${mode} HERDR_A=${short} HERDR_B=${(b ?? "").slice(0, 7)} HERDR_OP=${op ?? ""} GIT_SEQUENCE_EDITOR=${q(`perl ${q(this.seqEditor)}`)} git rebase -i --autostash --rebase-merges ${base}`;
  }

  // ---- lazygit's range select on commits (v, shift-↑/↓) ---------------------

  // The commits from the anchor to the selected one, newest first (as listed).
  rangeRows() {
    if (this.sec !== "commits" || !this.rangeAnchor) return [];
    const rows = this.items(), a = rows.findIndex(r => r.sha === this.rangeAnchor), b = this.selIndex();
    if (a < 0) return [];
    return rows.slice(Math.min(a, b), Math.max(a, b) + 1).filter(r => r.sha);
  }

  clearRange() { this.rangeAnchor = null; }

  rangeActions(range, add) {
    const n = range.length, oldest = range.at(-1), shas = range.map(r => r.sha), list = shas.join(",");
    const many = (title, op, depth) => cx => this.rewriteMany(`${title} ${n} commits`, range, cx, async () => this.todo("replace", list, null, op, await this.baseOf(oldest.sha, depth)));
    add("s", `Squash ${n} commits into the one below`, many("squash", "squash", 2), { chip: `squash ${n}` });
    add("f", `Fixup ${n} commits into the one below`, many("fixup", "fixup", 2), { chip: `fixup ${n}` });
    add("d", `Drop ${n} commits`, cx => this.confirm(`Drop ${n} commits?`, "Drop commits", many("drop", "drop", 1), cx), { chip: `drop ${n}` });
    const rows = this.items(), top = rows.indexOf(range[0]), bottom = rows.indexOf(oldest);
    const below = rows.slice(bottom + 1).find(r => r.sha), above = rows.slice(0, top).reverse().find(r => r.sha);
    const cursorBy = d => { this.sel[this.lk()] = this.selIndex() + d; };
    if (below) add("ctrl-j", `Move ${n} commits down`, cx => this.rewriteMany(`move ${n} commits down`, [...range, below], cx, async () => {
      cursorBy(rows.indexOf(below) - bottom);
      return this.todo("move", list, below.sha, null, await this.baseOf(below.sha, 1));
    }, { keepRange: true }));
    if (above) add("ctrl-k", `Move ${n} commits up`, cx => this.rewriteMany(`move ${n} commits up`, [...range, above], cx, async () => {
      cursorBy(rows.indexOf(above) - top);
      return this.todo("move", list, above.sha, null, await this.baseOf(oldest.sha, 1));
    }, { keepRange: true }));
    add("C", `Mark ${n} commits for cherry-pick`, cx => { this.copied = [...new Set([...this.copied, ...shas])]; this.clearRange(); cx.notify(); });
    add("y", `Copy ${n} commit hashes`, cx => { cx.write_to_clipboard(shas.join("\n")); this.flash(`Copied ${n} hashes`); cx.notify(); });
    add("v", "End the range", cx => { this.clearRange(); cx.notify(); });
  }

  // Amend a commit with `args`: right away on HEAD, else stop at it in a rebase,
  // amend, continue. `terminal`: in a new tab (your editor opens there).
  amendHere(c, args, cx, { title, terminal = false } = {}) {
    const isHead = c.refs.some(r => r.startsWith("HEAD"));
    this.rewriteMany(title, [c], cx, async () => isHead ? `git commit --amend --only ${args}`.trim()
      : `${this.todo("replace", c.sha, null, "edit", await this.baseOf(c.sha, 1))} && git commit --amend --only ${args} && git rebase --continue`, { terminal });
  }

  // The commit's page on the origin remote (GitHub, GitLab, Bitbucket), or null.
  async commitUrl(sha) {
    const r = await G.git(this.ctx, ["remote", "get-url", "origin"]).catch(() => null);
    const url = r?.code === 0 ? r.stdout.trim() : "";
    const m = url.match(/^(?:git@|ssh:\/\/git@|https?:\/\/)([^/:]+)[:/](.+?)(?:\.git)?$/);
    if (!m) return null;
    return `https://${m[1]}/${m[2]}/${m[1].includes("bitbucket") ? "commits" : "commit"}/${sha}`;
  }

  // y: lazygit's copy menu.
  copyMenu(c, cx) {
    const copy = (text, what) => cx => { cx.write_to_clipboard(text); this.flash(`Copied ${what}`); cx.notify(); };
    cx.spawn(async cx => {
      const message = (await G.git(this.ctx, ["log", "-1", "--format=%B", c.sha]).catch(() => null))?.stdout.trim() ?? c.subject;
      const url = await this.commitUrl(c.sha);
      this.openMenu(`Copy from ${c.short}`, [
        { key: "h", label: "Commit hash", hint: c.short, run: copy(c.sha, c.short) },
        { key: "s", label: "Subject", run: copy(c.subject, "subject") },
        { key: "m", label: "Message", run: copy(message, "message") },
        url && { key: "u", label: "URL", run: copy(url, "URL") },
        c.author && { key: "a", label: "Author", hint: c.author, run: copy(c.author, "author") },
      ].filter(Boolean), cx);
      cx.notify();
    });
  }

  push(cx, force) {
    const info = this.status?.info;
    if (!info?.head || info.head === "(detached)") { this.flash("Not on a branch"); cx.notify(); return; }
    if (force) return this.cmd("git push --force-with-lease", "git push --force-with-lease", cx);
    if (!info.upstream) return this.cmd("git push -u origin HEAD", "git push -u origin HEAD", cx);
    if (info.ahead > 0 && info.behind > 0) return this.confirm(`${info.head} has diverged from ${info.upstream} (↑${info.ahead} ↓${info.behind})`, "Force push (with lease)", cx => this.push(cx, true), cx);
    if (info.behind > 0 && !info.ahead) { this.flash("Behind upstream: pull first (p)"); cx.notify(); return; }
    this.cmd("git push", "git push", cx);
  }

  opMenu(cx) {
    const op = this.op;
    if (!op) return;
    const n = this.conflicts().length;
    this.openMenu(`${op.kind} in progress${n ? ` · ${n} conflict${n > 1 ? "s" : ""}` : ""}`, [
      { key: "c", label: `Continue ${op.kind}`, disabled: n > 0, hint: n ? "resolve conflicts first" : null, run: cx => this.cmd(`git ${op.kind} --continue`, `git ${op.kind} --continue`, cx) },
      op.kind !== "merge" && { key: "s", label: `Skip this commit`, run: cx => this.cmd(`git ${op.kind} --skip`, `git ${op.kind} --skip`, cx) },
      { key: "a", label: `Abort ${op.kind}`, danger: true, run: cx => this.confirm(`Abort the ${op.kind}?`, `Abort ${op.kind}`, cx => this.cmd(`git ${op.kind} --abort`, `git ${op.kind} --abort`, cx), cx) },
      n > 0 && { key: "v", label: "Resolve conflicts (chunk picker)", run: () => this.openConflicts() },
      n > 0 && { key: "i", label: "Ask AI to resolve conflicts", run: cx => this.askAI(cx) },
      n > 0 && { key: "e", label: `Open conflicted file${n > 1 ? "s" : ""} in ${this.config?.editor ?? "editor"}`, run: () => cx_open(this, this.conflicts().map(f => f.path)) },
      n > 0 && { key: "r", label: `Mark conflicted file${n > 1 ? "s" : ""} resolved`, hint: "git add", run: cx => this.cmd("git add (resolved)", `git add -- ${this.conflicts().map(f => q(f.path)).join(" ")}`, cx, { term: false }) },
    ], cx, this.conflicts().slice(0, 10).map(f => f.path));
  }

  // Lazygit's "ours"/"theirs" confusion: during a rebase, ours is the upstream.
  sideLabels() {
    return this.op?.kind === "rebase" ? { ours: `upstream (${this.op.other ?? "onto"})`, theirs: "your commit" } : { ours: `current (${this.status?.info.head ?? "HEAD"})`, theirs: `incoming (${this.op?.other ?? "theirs"})` };
  }

  // lazygit's template fields for the selection, for custom commands.
  fill(command) {
    const it = this.selected(), sec = this.sec, info = this.status?.info;
    const fields = {
      "CheckedOutBranch.Name": info?.head,
      "SelectedLocalBranch.Name": sec === "branches" && it?.kind === "local" ? it.name : null,
      "SelectedRemoteBranch.Name": sec === "branches" && it?.kind === "remote" ? it.short : null,
      "SelectedRemoteBranch.RemoteName": sec === "branches" && it?.kind === "remote" ? it.remote : null,
      "SelectedLocalCommit.Hash": sec === "commits" ? it?.sha : null, "SelectedLocalCommit.Sha": sec === "commits" ? it?.sha : null,
      "SelectedLocalCommit.Name": sec === "commits" ? it?.subject : null,
      "SelectedStashEntry.Name": sec === "stash" ? it?.ref : null,
    };
    let missing = null;
    const text = command.replace(/\{\{\s*\.([\w.]+)\s*\}\}/g, (m, name) => { const v = fields[name]; if (v == null) missing = name; return v ?? ""; });
    return { text, missing };
  }

  customActions() {
    return (this.config?.customCommands ?? []).filter(c => c.key && c.command && (CONTEXTS[c.context ?? "global"] ?? (() => false))(this)).map(c => ({
      key: lazyKey(c.key), label: c.description ?? c.command, custom: true,
      run: cx => {
        const { text, missing } = this.fill(c.command);
        if (missing) { this.flash(`Custom command needs {{.${missing}}}: select one first`); cx.notify(); return; }
        if (c.output === "terminal") run("terminal.open", { argv: [this.shell ?? "/bin/zsh", "-lic", text], folder: this.ctx.root, place: "tab" });
        else this.cmd(c.description ?? text, text, cx, { after: () => { this.prsAt = 0; } });
      },
    }));
  }

  openWorktree(path) {
    const on = this.ctx?.on ?? null;
    const inside = cwd => cwd === path || cwd?.startsWith(`${path}/`);
    const all = panes();
    const s = spaces().find(s => (s.machine ?? null) === on && all.some(p => inside(p.cwd) && (s.tabs ?? []).some(t => t.id === p.tab)));
    if (s) run("space.select", { id: s.id });
    else run("space.new", { folder: path, machine: on ?? "" });
  }

  actions() {
    const sec = this.sec, it = this.selected(), A = this.customActions();
    const add = (key, label, run, extra) => A.push({ key, label, run, ...extra });
    const info = this.status?.info, head = info?.head;
    if (sec === "files" && it?.kind === "dir") {
      const files = (this.status?.files ?? []).filter(f => this.under(it.path, f.path)), spec = it.path || ".", where = it.path ? `${it.path}/` : "everything";
      const unstaged = files.some(f => f.unstaged && !f.conflict);
      if (unstaged) add("space", `Stage ${where}`, cx => this.cmd(`git add -A ${spec}`, `git add -A -- ${q(spec)}`, cx, { term: false }), { chip: "stage" });
      else add("space", `Unstage ${where}`, cx => this.cmd(`git restore --staged ${spec}`, `git restore --staged -- ${q(spec)} 2>/dev/null || git reset -q -- ${q(spec)}`, cx, { term: false }), { chip: "unstage" });
      add("enter", it.open ? "Fold" : "Unfold", cx => this.toggleFold(it, cx), { chip: it.open ? "fold" : "unfold" });
      add("d", `Discard ${where}…`, cx => this.confirm(`Discard every change in ${where} (${files.length} file${files.length === 1 ? "" : "s"}, untracked ones deleted)? It can't be undone.`, "Discard all", cx =>
        this.cmd(`discard ${where}`, `git restore --source=HEAD --staged --worktree -- ${q(spec)} 2>/dev/null; git clean -fdq -- ${q(spec)}`, cx, { term: false }), cx), { chip: "discard" });
      add("A", "Ask AI about these changes", cx => this.askAbout(cx), { chip: "ask AI" });
    }
    if (sec === "files") {
      add("-", "Fold every folder", cx => this.foldAll(true, cx));
      add("=", "Unfold every folder", cx => this.foldAll(false, cx));
      add("t", this.flat ? "Show as a tree" : "Show as a flat list", cx => this.toggleFlat(cx), { chip: this.flat ? "tree" : "flat" });
    }
    if (sec === "files" && it?.kind === "file") {
      const f = it.file, files = this.status?.files ?? [], anyUnstaged = files.some(x => x.unstaged && !x.conflict);
      if (f.conflict) add("space", "Mark resolved (stage)", cx => this.cmd(`git add ${f.path}`, `git add -- ${q(f.path)}`, cx, { term: false }), { chip: "resolved" });
      else if (f.unstaged) add("space", "Stage", cx => this.cmd(`git add ${f.path}`, `git add -- ${q(f.path)}`, cx, { term: false }), { chip: "stage" });
      else add("space", "Unstage", cx => this.cmd(`git restore --staged ${f.path}`, `git restore --staged -- ${q(f.path)} 2>/dev/null || git rm -q --cached -- ${q(f.path)}`, cx, { term: false }), { chip: "unstage" });
      add("enter", "Review the diff (hunks, lines, notes)", cx => { this.mainFocus = true; this.clampCursor(); this.revealCursor(); }, { chip: "review" });
      add("a", anyUnstaged ? "Stage all" : "Unstage all", cx => anyUnstaged ? this.cmd("git add -A", "git add -A", cx, { term: false }) : this.cmd("git reset", "git reset -q", cx, { term: false }), { chip: anyUnstaged ? "stage all" : "unstage all" });
      add("d", "Discard…", cx => this.discardFile(f, cx), { chip: "discard" });
      add("o", "Open in editor", () => this.openEditor(f.path, null), { chip: "edit" });
      if (this.notes().length) add("i", `Send ${this.notes().length} review note${this.notes().length === 1 ? "" : "s"} to an agent`, cx => this.askAI(cx, "notes"), { chip: "send notes" });
      add("A", "Ask AI about this change", cx => this.askAbout(cx), { chip: "ask AI" });
      add("y", "Copy path", cx => { cx.write_to_clipboard(f.path); this.flash("Path copied"); });
    }
    if (sec === "branches" && it) {
      const remote = it.kind === "remote", ref = it.name;
      if (remote) add("space", it.local ? `Check out ${it.local}` : `Check out as local ${it.short}`, cx => it.local
        ? this.cmd(`git switch ${it.local}`, `git switch ${q(it.local)}`, cx)
        : this.cmd(`git switch -c ${it.short} --track ${ref}`, `git switch -c ${q(it.short)} --track ${q(ref)}`, cx));
      else add("space", it.worktree ? "Go to its worktree" : "Check out", cx => {
        if (it.head) return;
        // Git won't check a branch out twice: go to its worktree's space instead (opening one if none).
        if (it.worktree) return this.openWorktree(it.worktree);
        this.cmd(`git switch ${ref}`, `git switch ${q(ref)}`, cx);
      });
      add("n", "New branch from here", cx => this.ask(`New branch from ${ref}`, "", (name, cx) => name && this.cmd(`git switch -c ${name} ${ref}`, `git switch -c ${q(name)} ${q(ref)}`, cx), cx));
      if (!it.head) {
        add("M", `Merge into ${head}…`, cx => this.openMenu(`Merge ${ref} into ${head}`, [
          { key: "m", label: "Merge", hint: "fast-forward if possible", run: cx => this.cmd(`git merge ${ref}`, `git merge --no-edit ${q(ref)}`, cx) },
          { key: "n", label: "Merge commit (--no-ff)", run: cx => this.cmd(`git merge --no-ff ${ref}`, `git merge --no-ff --no-edit ${q(ref)}`, cx) },
          { key: "f", label: "Fast-forward only", run: cx => this.cmd(`git merge --ff-only ${ref}`, `git merge --ff-only ${q(ref)}`, cx) },
          { key: "s", label: "Squash (stage only, then commit)", run: cx => this.cmd(`git merge --squash ${ref}`, `git merge --squash ${q(ref)}`, cx) },
        ], cx));
        add("r", `Rebase ${head} onto this…`, cx => this.openMenu(`Rebase ${head} onto ${ref}`, [
          { key: "r", label: "Rebase", hint: "--autostash", run: cx => this.cmd(`git rebase ${ref}`, `git rebase --autostash ${q(ref)}`, cx) },
          { key: "u", label: "Rebase, updating stacked branches", hint: "--update-refs", run: cx => this.cmd(`git rebase --update-refs ${ref}`, `git rebase --autostash --update-refs ${q(ref)}`, cx) },
          { key: "m", label: "Rebase, keeping merge commits", hint: "--rebase-merges", run: cx => this.cmd(`git rebase --rebase-merges ${ref}`, `git rebase --autostash --rebase-merges ${q(ref)}`, cx) },
          { key: "a", label: "Rebase and apply fixup!/squash! commits", hint: "--autosquash", run: cx => this.cmd(`git rebase -i --autosquash ${ref}`, `GIT_SEQUENCE_EDITOR=: git rebase -i --autostash --autosquash ${q(ref)}`, cx) },
          { key: "i", label: "Interactive rebase in editor (new tab)", run: () => run("terminal.open", { argv: [this.shell ?? "/bin/zsh", "-lic", `git rebase -i --autostash ${q(ref)}`], folder: this.ctx.root, place: "tab" }) },
        ], cx));
      }
      if (!remote) {
        if (it.upstream && !it.gone) add("f", "Fast-forward from upstream", cx => it.head
          ? this.cmd("git merge --ff-only @{u}", "git fetch && git merge --ff-only @{u}", cx)
          : this.cmd(`git fetch ${it.upstream.replace("/", " ")}:${ref}`, `git fetch ${q(it.upstream.split("/")[0])} ${q(`${it.upstream.split("/").slice(1).join("/")}:${ref}`)}`, cx));
        add("R", "Rename", cx => this.ask(`Rename ${ref}`, ref, (name, cx) => name && name !== ref && this.cmd(`git branch -m ${ref} ${name}`, `git branch -m ${q(ref)} ${q(name)}`, cx, { term: false }), cx));
        if (!it.head) add("d", "Delete…", cx => this.openMenu(`Delete ${ref}`, [
          { key: "d", label: "Delete local branch", run: cx => this.deleteLocal(it, cx) },
          it.upstream && !it.gone && { key: "r", label: `Delete local and ${it.upstream}`, danger: true, run: cx => this.confirm(`Delete ${it.upstream} on the remote too?`, "Delete both", cx => this.cmd(`git branch -D ${ref} && git push ${it.upstream.split("/")[0]} --delete ${it.upstream.split("/").slice(1).join("/")}`, `git branch -D ${q(ref)} && git push ${q(it.upstream.split("/")[0])} --delete ${q(it.upstream.split("/").slice(1).join("/"))}`, cx), cx) },
        ], cx));
        add("D", "Clean up merged / closed / gone branches", cx => this.cleanup(cx));
      } else add("d", "Delete remote branch", cx => this.confirm(`Delete ${ref} on ${it.remote}?`, "Delete remote branch", cx => this.cmd(`git push ${it.remote} --delete ${it.short}`, `git push ${q(it.remote)} --delete ${q(it.short)}`, cx), cx));
      const pr = this.prs?.[remote ? it.short : ref];
      if (pr) add("o", `Open PR #${pr.number}`, () => exec("open", [pr.url]));
      add("y", "Copy branch name", cx => { cx.write_to_clipboard(remote ? it.short : ref); this.flash("Branch name copied"); });
    }
    if (sec === "commits" && it?.sha) {
      const c = it, range = this.rangeRows();
      if (range.length > 1) this.rangeActions(range, add);
      else {
        // lazygit's commit keys, in its order of usefulness (the footer shows the first).
        add("s", "Squash into the commit below", cx => this.rewrite(`squash ${c.short}`, c, cx, async () => this.todo("replace", c.sha, null, "squash", await this.baseOf(c.sha, 2))), { chip: "squash" });
        add("f", "Fixup into the commit below (drop message)", cx => this.rewrite(`fixup ${c.short}`, c, cx, async () => this.todo("replace", c.sha, null, "fixup", await this.baseOf(c.sha, 2))), { chip: "fixup" });
        add("r", "Reword", cx => this.reword(c, cx), { chip: "reword" });
        add("d", "Drop this commit", cx => this.confirm(`Drop ${c.short} "${c.subject}"?`, "Drop commit", cx => this.rewrite(`drop ${c.short}`, c, cx, async () => this.todo("replace", c.sha, null, "drop", await this.baseOf(c.sha, 1))), cx), { chip: "drop" });
        add("A", "Amend staged changes into this commit", cx => {
          if (!(this.status?.files ?? []).some(f => f.staged)) { this.flash("Stage something first"); cx.notify(); return; }
          const isHead = c.refs.some(r => r.startsWith("HEAD"));
          this.rewrite(`amend into ${c.short}`, c, cx, async () => isHead ? "git commit --amend --no-edit"
            : `git commit --fixup=${c.sha} && GIT_SEQUENCE_EDITOR=: git rebase -i --autostash --autosquash --rebase-merges ${await this.baseOf(c.sha, 1)}`);
        }, { chip: "amend" });
        add("e", "Edit (stop here in a rebase)", cx => this.rewrite(`edit ${c.short}`, c, cx, async () => this.todo("replace", c.sha, null, "edit", await this.baseOf(c.sha, 1))), { chip: "edit" });
        add("v", "Select a range of commits", cx => { this.rangeAnchor = c.sha; cx.notify(); }, { chip: "range" });
        add("R", "Reword in your editor", cx => this.amendHere(c, "", cx, { title: `reword ${c.short}`, terminal: true }));
        add("a", "Amend author / co-author…", cx => this.openMenu(`Amend ${c.short}'s attributes`, [
          { key: "r", label: "Reset author", hint: "to your git user", run: cx => this.amendHere(c, "--reset-author --no-edit", cx, { title: `reset author of ${c.short}` }) },
          { key: "a", label: "Set author…", hint: "Name <email>", run: cx => this.ask(`Author of ${c.short}`, c.author ?? "", (v, cx) => v && this.amendHere(c, `--author=${q(v)} --no-edit`, cx, { title: `set author of ${c.short}` }), cx, { hint: "Name <email>" }) },
          { key: "c", label: "Add co-author…", hint: "Co-authored-by trailer", run: cx => this.ask(`Co-author of ${c.short}`, "", (v, cx) => v && this.amendHere(c, `--no-edit --trailer ${q(`Co-authored-by: ${v}`)}`, cx, { title: `add co-author to ${c.short}` }), cx, { hint: "Name <email>" }) },
        ], cx));
        add("F", "Create fixup! commit for this commit", cx => {
          if (!(this.status?.files ?? []).some(f => f.staged)) { this.flash("Stage something first"); cx.notify(); return; }
          this.cmd(`git commit --fixup=${c.short}`, `git commit --fixup=${c.sha}`, cx, { term: false });
        });
        add("S", "Squash all fixup! commits above (autosquash)", cx => this.rewrite(`autosquash onto ${c.short}`, c, cx, async () => `GIT_SEQUENCE_EDITOR=: git rebase -i --autostash --autosquash --rebase-merges ${await this.baseOf(c.sha, 1)}`));
        add("space", "Check out this commit (detached)", cx => this.cmd(`git checkout ${c.short}`, `git checkout ${c.sha}`, cx));
        const rows = this.items(), i = this.selIndex();
        const below = rows.slice(i + 1).find(r => r.sha), above = rows.slice(0, i).reverse().find(r => r.sha);
        if (below) add("ctrl-j", "Move commit down", cx => this.rewrite(`move ${c.short} down`, c, cx, async () => { this.sel[this.lk()] = rows.indexOf(below); return this.todo("swap", below.sha, c.sha, null, await this.baseOf(c.sha, 2)); }));
        if (above) add("ctrl-k", "Move commit up", cx => this.rewrite(`move ${c.short} up`, c, cx, async () => { this.sel[this.lk()] = rows.indexOf(above); return this.todo("swap", c.sha, above.sha, null, await this.baseOf(c.sha, 1)); }));
        add("g", "Reset to this commit…", cx => this.openMenu(`Reset ${head} to ${c.short}`, [
          { key: "s", label: "Soft", hint: "keep changes staged", run: cx => this.cmd(`git reset --soft ${c.short}`, `git reset --soft ${c.sha}`, cx, { term: false }) },
          { key: "m", label: "Mixed", hint: "keep changes unstaged", run: cx => this.cmd(`git reset --mixed ${c.short}`, `git reset --mixed ${c.sha}`, cx, { term: false }) },
          { key: "h", label: "Hard", hint: "discard changes", danger: true, run: cx => this.confirm(`Hard reset to ${c.short}? Uncommitted changes are lost.`, "Hard reset", cx => this.cmd(`git reset --hard ${c.short}`, `git reset --hard ${c.sha}`, cx, { term: false }), cx) },
        ], cx));
        add("t", "Revert this commit", cx => this.cmd(`git revert ${c.short}`, `git revert --no-edit ${c.sha}`, cx));
        add("T", "Tag this commit", cx => this.ask(`Tag ${c.short}`, "", (name, cx) => name && this.cmd(`git tag ${name} ${c.short}`, `git tag ${q(name)} ${c.sha}`, cx, { term: false }), cx, { hint: "e.g. v1.2.0" }));
        add("C", this.copied.includes(c.sha) ? "Unmark for cherry-pick" : "Mark for cherry-pick", cx => { this.copied = this.copied.includes(c.sha) ? this.copied.filter(s => s !== c.sha) : [...this.copied, c.sha]; cx.notify(); });
        add("n", "New branch from this commit", cx => this.ask(`New branch from ${c.short}`, "", (name, cx) => name && this.cmd(`git switch -c ${name} ${c.short}`, `git switch -c ${q(name)} ${c.sha}`, cx), cx));
        add("o", "Open in browser", cx => this.commitUrl(c.sha).then(url => url ? exec("open", [url]) : (this.flash("No GitHub/GitLab remote"), cx.notify())));
        add("y", "Copy…", cx => this.copyMenu(c, cx));
      }
      if (this.copied.length) add("V", `Cherry-pick ${this.copied.length} marked onto ${head}`, cx => {
        const order = (this.commits ?? []).filter(r => this.copied.includes(r.sha)).reverse().map(r => r.sha);
        this.cmd(`git cherry-pick ${order.map(s => s.slice(0, 8)).join(" ")}`, `git cherry-pick ${order.join(" ")}`, cx, { after: () => { this.copied = []; } });
      });
    }
    if (sec === "stash" && it) {
      add("space", "Apply", cx => this.cmd(`git stash apply ${it.ref}`, `git stash apply ${q(it.ref)}`, cx, { term: false }));
      add("g", "Pop", cx => this.cmd(`git stash pop ${it.ref}`, `git stash pop ${q(it.ref)}`, cx, { term: false }));
      add("d", "Drop", cx => this.confirm(`Drop ${it.ref} "${it.message}"?`, "Drop stash", cx => this.cmd(`git stash drop ${it.ref}`, `git stash drop ${q(it.ref)}`, cx, { term: false }), cx));
      add("n", "New branch from stash", cx => this.ask(`Branch from ${it.ref}`, "", (name, cx) => name && this.cmd(`git stash branch ${name} ${it.ref}`, `git stash branch ${q(name)} ${q(it.ref)}`, cx), cx));
    }
    // Global, after the section's own so a section key wins. The footer shows the
    // section's own first: what's marked global or custom only lives in x / ?.
    const firstGlobal = A.length;
    if (this.op) add("m", `${this.op.kind}: continue / skip / abort…`, cx => this.opMenu(cx));
    if (this.op && this.conflicts().length) add("v", "Resolve conflicts (chunk picker)", () => this.openConflicts());
    add("i", "Ask AI (conflicts, a failed command or your review notes)", cx => this.askAI(cx));
    add("P", "Push", cx => this.push(cx));
    add("p", "Pull", cx => this.cmd("git pull", "git pull", cx));
    add("c", "Commit", cx => this.commit(cx));
    if ((this.status?.files ?? []).length) add("S", "Stash all changes", cx => this.ask("Stash message (optional)", "", (msg, cx) => this.cmd(`git stash push -u${msg ? ` -m "${msg}"` : ""}`, `git stash push -u${msg ? ` -m ${q(msg)}` : ""}`, cx, { term: false }), cx));
    add("@", "Command log", cx => this.logMenu(cx));
    add("f", "Fetch all remotes", cx => this.cmd("git fetch --all --prune", "git fetch --all --prune", cx, { after: () => { this.prsAt = 0; } }));
    add("ctrl-r", "Refresh", cx => { this.prsAt = 0; this.refresh(cx, true); });
    A.forEach((a, i) => { if (i >= firstGlobal) a.global = true; });
    return A;
  }

  commit(cx) {
    const files = this.status?.files ?? [];
    if (this.conflicts().length) { this.flash("Resolve conflicts first"); cx.notify(); return; }
    // The message is kept per repo (shared "git.commitDrafts", by root) until a commit lands:
    // esc and a failed commit keep it for next time; a commit that moved HEAD clears it.
    const ctx = this.ctx, root = ctx.root;
    const head = () => G.git(ctx, ["rev-parse", "-q", "--verify", "HEAD"]).then(r => r.stdout.trim(), () => "");
    const go = (cx, stageAll) => this.ask("Commit message", commitDraft(root), (msg, cx) => {
      if (!msg) return;
      setCommitDraft(root, msg);
      cx.spawn(async cx => {
        const before = await head();
        const settle = async () => { if ((await head()) !== before) setCommitDraft(root, null); };
        this.cmd(`git commit -m "${msg}"`, `${stageAll ? "git add -A && " : ""}git commit -m ${q(msg)}`, cx, { after: settle, onFail: settle });
      });
    }, cx, { hint: "Summary line", select: false, onClose: text => setCommitDraft(root, text.trim()) });
    const amend = (cx, stageAll) => {
      const head = (this.commits ?? []).find(c => c.refs.some(r => r.startsWith("HEAD")));
      const run = cx => this.cmd("git commit --amend --no-edit", `${stageAll ? "git add -A && " : ""}git commit --amend --no-edit`, cx);
      head && head.state !== "unpushed" && this.tab.commits === 0 ? this.confirm("The last commit is already pushed. Amending needs a force push.", "Amend anyway", run, cx) : run(cx);
    };
    const staged = files.filter(f => f.staged).length, changed = files.filter(f => f.unstaged).length;
    if (!files.length) { this.flash("Nothing to commit"); cx.notify(); return; }
    this.openMenu(`${staged} staged · ${changed} unstaged`, [
      staged > 0 && { key: "c", label: "Commit staged changes", run: cx => go(cx, false) },
      changed > 0 && { key: "a", label: "Stage all and commit", run: cx => go(cx, true) },
      staged > 0 && { key: "A", label: "Amend last commit with staged changes", hint: "keeps message", run: cx => amend(cx, false) },
      changed > 0 && { key: "m", label: "Stage all and amend last commit", hint: "keeps message", run: cx => amend(cx, true) },
      { key: "e", label: "Commit in editor (new tab)", run: () => run("terminal.open", { argv: [this.shell ?? "/bin/zsh", "-lic", "git commit"], folder: this.ctx.root, place: "tab" }) },
    ], cx);
  }

  logMenu(cx) {
    if (!this.log.length) { this.flash("No git commands run yet"); cx.notify(); return; }
    this.openMenu("Command log", this.log.slice(0, 20).map((e, i) => ({
      key: i < 9 ? String(i + 1) : null, label: `${e.running ? "…" : e.code === 0 ? "✓" : "✗"} ${e.title}`,
      hint: e.running ? "running" : `${Math.round((Date.now() - e.at) / 60000) || "now"}${Math.round((Date.now() - e.at) / 60000) ? "m" : ""}`,
      run: cx => e.running && e.addr ? run("terminal.peek", { terminal: e.addr }) : this.showOutput(e, cx),
    })), cx);
  }

  reword(c, cx) {
    cx.spawn(async cx => {
      const full = (await G.git(this.ctx, ["log", "-1", "--format=%B", c.sha]).catch(() => null))?.stdout ?? c.subject;
      const body = full.split("\n").slice(1).join("\n").trim();
      this.ask(`Reword ${c.short}`, c.subject, (msg, cx) => {
        if (!msg || msg === c.subject) return;
        const message = body ? `${msg}\n\n${body}` : msg, isHead = c.refs.some(r => r.startsWith("HEAD"));
        this.rewrite(`reword ${c.short}`, c, cx, async () => isHead ? `git commit --amend --only -m ${q(message)}`
          : `${this.todo("replace", c.sha, null, "edit", await this.baseOf(c.sha, 1))} && git commit --amend --only -m ${q(message)} && git rebase --continue`);
      }, cx);
    });
  }

  // Like lazygit: decide merged-ness ourselves rather than via `git branch -d`, which only checks
  // HEAD/upstream ancestry and so refuses every squash-merged branch.
  deleteLocal(b, cx) {
    const run = cx => this.cmd(`git branch -D ${b.name}`, `git branch -D ${q(b.name)}`, cx, { term: false });
    const pr = this.prs?.[b.name];
    if (b.merged || pr?.state === "MERGED") return run(cx);
    const base = this.base ?? "the base branch";
    this.confirm(`${b.name} is not merged into ${base}. Delete anyway?`, "Force delete (-D)", run, cx,
      [`${b.sha}  ${b.subject}`, pr ? `PR #${pr.number} is ${pr.state.toLowerCase()}` : "No PR found for this branch"]);
  }

  cleanup(cx) {
    const keep = new Set([this.status?.info.head, this.base?.replace(/^[^/]+\//, ""), "main", "master", "develop"]);
    const doomed = (this.branches?.local ?? []).filter(b => !b.head && !keep.has(b.name) && !b.worktree && this.prs?.[b.name]?.state !== "OPEN"
      && (this.prs?.[b.name]?.state === "MERGED" || this.prs?.[b.name]?.state === "CLOSED" || b.gone || b.merged));
    if (!doomed.length) { this.flash("No merged, closed or gone branches"); cx.notify(); return; }
    const why = b => this.prs?.[b.name]?.state?.toLowerCase() ?? (b.gone ? "upstream gone" : "merged");
    this.confirm(`Delete ${doomed.length} local branch${doomed.length > 1 ? "es" : ""}?`, "Delete them (-D)",
      cx => this.cmd(`git branch -D ${doomed.map(b => b.name).join(" ")}`, `git branch -D ${doomed.map(b => q(b.name)).join(" ")}`, cx, { term: false }), cx,
      doomed.slice(0, 14).map(b => `${b.name}  ·  ${why(b)}`).concat(doomed.length > 14 ? [`… and ${doomed.length - 14} more`] : []));
  }

  // ---- Expand / collapse -----------------------------------------------------

  // The side panel's Git becomes a tab of its own (one per space, reused); `git.tab` remembers
  // it and the tab it was opened from, so collapsing can go back there.
  expand(cx) {
    if (!this.ctx) return;
    const space = spaces().find(s => s.active), origin = focused()?.tab, rec = shared("git.tab");
    if (!space) return;
    hidePanel("git");
    if (rec?.space === space.id && space.tabs.some(t => t.id === rec.tab)) {
      setShared("git.tab", { ...rec, origin });
      run("tab.select", { id: rec.tab });
      return;
    }
    const before = new Set(space.tabs.map(t => t.id));
    const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    run("tab.new", { mod: "git", props: { cwd: this.ctx.root, on: this.ctx.on, token }, name: `Git · ${this.ctx.root.split("/").pop()}` });
    cx.spawn(async cx => {
      let tab = null;
      for (let i = 0; i < 40 && !tab; i++) {
        tab = spaces().find(s => s.id === space.id)?.tabs.find(t => !before.has(t.id))?.id ?? null;
        if (!tab) await cx.sleep(50);
      }
      if (tab) {
        setShared("git.tab", { space: space.id, tab, origin });
        // Remember which tab the token opened (dropping tabs that are gone).
        const alive = new Set(spaces().flatMap(s => s.tabs.map(t => t.id)));
        setShared("git.tabOf", { ...Object.fromEntries(Object.entries(shared("git.tabOf") ?? {}).filter(([, t]) => alive.has(t))), [token]: tab });
      }
    });
  }

  collapse() {
    const rec = shared("git.tab"), space = spaces().find(s => s.active), tab = rec?.tab ?? focused()?.tab;
    revealPanel("git");
    if (rec?.origin && space?.tabs.some(t => t.id === rec.origin)) run("tab.select", { id: rec.origin });
    if (tab) run("tab.close", { id: tab, confirmed: true });
    setShared("git.tab", null);
    setShared("git.tabHasKeys", false);
    run("git.focus");
  }

  // ---- Keys ------------------------------------------------------------------

  // Leaving the panel: left goes straight back to the terminal the keyboard came from (pane.focus);
  // pane.go doesn't reliably move the keyboard out of a panel. Other directions are pane.go's.
  go(dir) {
    this.focusToken = (this.focusToken ?? 0) + 1; // cancel a pending focus retry
    const pane = focused()?.pane;
    if (dir === "left" && pane && !this.fixed) return run("pane.focus", { pane });
    this.handle.focus();
    run("pane.go", { direction: dir });
  }

  // cmd-alt-arrows (keys.json pane.go) are handled here so leaving never depends on pane.go
  // knowing this panel holds the keyboard.
  navKey(e, cx) {
    const m = e.modifiers ?? {};
    if (!(m.platform && m.alt && !m.control && ["left", "right", "up", "down"].includes(e.key))) return false;
    cx.stop_propagation(); this.go(e.key); return true;
  }

  key(e, cx) {
    if (!this.editorFocused && !this.prompt && this.navKey(e, cx)) return;
    if (this.editorFocused) { if (e.key === "escape") { this.handle.focus(); cx.stop_propagation(); } return; }
    if (this.prompt) { if (e.key === "escape") { this.cancelPrompt(cx); cx.stop_propagation(); } return; }
    const k = keyOf(e);
    if (this.menu) { this.menuKey(k, cx); cx.stop_propagation(); return; }
    if (this.handleKey(k, cx)) cx.stop_propagation();
  }

  handleKey(k, cx) {
    if (this.keysOpen) {
      if (k === "escape" || k === "?" || k === "q") { this.keysOpen = false; cx.notify(); }
      return true;
    }
    if (k === "?") { this.keysOpen = true; cx.notify(); return true; }
    const idx = SECTIONS.findIndex(s => s.id === this.sec);
    const num = SECTIONS.find(s => s.key === k);
    if (num) { this.focusSection(num.id, cx); return true; }
    if (this.mainFocus && this.sec === "files" && this.main?.diff && this.diffKey(k, cx)) return true;
    if (this.mainFocus && (k === "j" || k === "down")) { this.scrollMain(1, cx); return true; }
    if (this.mainFocus && (k === "k" || k === "up")) { this.scrollMain(-1, cx); return true; }
    // shift-↑/↓ on commits: start or grow a range (lazygit).
    if ((k === "shift-down" || k === "shift-up") && this.sec === "commits") {
      if (!this.rangeAnchor && this.selected()?.sha) this.rangeAnchor = this.selected().sha;
      this.move(k === "shift-down" ? 1 : -1, cx); cx.notify(); return true;
    }
    if (k === "escape" && this.rangeRows().length) { this.clearRange(); cx.notify(); return true; }
    switch (k) {
      case "h": case "left": case "shift-tab": this.focusSection(SECTIONS[(idx + SECTIONS.length - 1) % SECTIONS.length].id, cx); return true;
      case "l": case "right": case "tab": this.focusSection(SECTIONS[(idx + 1) % SECTIONS.length].id, cx); return true;
      case "j": case "down": this.move(1, cx); return true;
      case "k": case "up": this.move(-1, cx); return true;
      case "<": case "home": this.move(0, cx, 0); return true;
      case ">": case "end": this.move(0, cx, this.items().length - 1); return true;
      case ",": case "pageup": this.move(-10, cx); return true;
      case ".": case "pagedown": this.move(10, cx); return true;
      case "[": this.switchTab(-1, cx); return true;
      case "]": this.switchTab(1, cx); return true;
      case "ctrl-d": case "J": this.scrollMain(k === "J" ? 3 : 15, cx); return true;
      case "ctrl-u": case "K": this.scrollMain(k === "K" ? -3 : -15, cx); return true;
      case "enter":
        if (this.sec === "files" && !this.mainFocus && this.selected()?.kind === "dir") { this.toggleFold(this.selected(), cx); return true; }
        this.mainFocus = !this.mainFocus;
        if (this.mainFocus && this.main?.diff) { this.clampCursor(); this.revealCursor(); }
        cx.notify(); return true;
      case "escape":
        if (this.mainFocus) this.mainFocus = false;
        else if (this.filter[this.lk()]) this.filter[this.lk()] = "";
        else if (this.mainOverride) { this.mainOverride = null; this.syncMain(cx); }
        else if (this.failure) this.failure = null;
        else return false;
        cx.notify(); return true;
      case "/": {
        const lk = this.lk();
        this.ask(`Filter ${SECTIONS[idx].title.toLowerCase()}`, this.filter[lk] ?? "", (v, cx) => { this.filter[lk] = v; }, cx, { live: (v, cx) => { this.filter[lk] = v; this.sel[lk] = 0; } });
        return true;
      }
      case "q":
        // Like quitting lazygit: put the panel away and give the keyboard back to the terminal.
        if (this.fixed) return false;
        closePanel("git");
        return true;
      case "x": this.openMenu(`${SECTIONS[idx].title} actions`, this.actions().map(a => ({ ...a, hint: a.custom ? "custom" : a.key })), cx); return true;
    }
    const action = this.actions().find(a => a.key === k);
    if (action) { action.run(cx); cx.notify(); return true; }
    return false;
  }

  // ---- Rendering -------------------------------------------------------------

  render(cx) {
    if (JSON.stringify(location(this.fixed, this.loc)) !== this.locKey && !this.refreshing) this.refresh(cx, true);
    this.rangeSet = new Set(this.rangeRows().map(r => r.sha));
    const hasKeys = this.hadKeys = this.keyboard();
    const t = theme(), mono = settings().font_family ?? "JetBrains Mono";
    const width = this.size?.width ?? 400, wide = width >= 720, pane = Boolean(this.fixed);
    const sections = this.ctx ? this.sectionsColumn(t, mono, wide) : null;
    const main = this.ctx ? this.mainView(t, mono) : null;
    const body = !this.ctx
      ? div().flex_1().p(14).text_color(t.dim).child(this.refreshing && !this.locKey ? "Loading…" : `Not a git repository${this.cwd ? `: ${this.cwd}` : ""}`)
      : wide ? h_flex().flex_1().min_h(0).items_stretch().gap(6).p(6).child(sections.w(Math.max(300, Math.min(520, width * 0.42))).flex_none()).child(main.flex_1())
        : this.mainFocus ? v_flex().flex_1().min_h(0).p(6).child(main.flex_1())
          : v_flex().flex_1().min_h(0).gap(6).p(6).child(sections.flex_1()).child(main.h(Math.max(160, (this.size?.height ?? 600) * 0.38)).flex_none());
    return v_flex().id("git").relative().size_full().min_h(0).rounded(pane ? 0 : 10).overflow_hidden().bg(t.background).when(!pane, el => el.border_1().border_color(hasKeys ? t.accent : t.border))
      .text_color(t.foreground).text_size(12.5)
      .track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .on_mouse_down("left", () => { if (!this.prompt) this.handle.focus(); })
      .on_size_change((size, cx) => { this.size = size; cx.notify(); })
      .child(this.header(t, pane))
      .when(Boolean(this.op), el => el.child(this.opBanner(t)))
      .when(Boolean(this.ai), el => el.child(this.aiBanner(t)))
      .child(body)
      .when(Boolean(this.failure) && !this.op, el => el.child(this.failureBanner(t)))
      .child(this.footer(t))
      .when(Boolean(this.menu), el => el.child(this.menuView(t)))
      .when(Boolean(this.prompt), el => el.child(this.promptView(t)))
      .when(Boolean(this.keysOpen), el => el.child(keysCard(t, { id: "git", title: "Git: all keys", groups: this.keysGroups(), onClose: cx => { this.keysOpen = false; cx.notify(); } })));
  }

  keyboard() { return this.handle.is_focused() || Boolean(this.editorFocused || this.typing || this.menu); }

  iconButton(id, icon, action, t, label) {
    return h_flex().id(id).h(24).px(6).gap(4).flex_none().items_center().rounded(6).cursor_pointer().text_size(11.5).text_color(t.muted)
      .hover(s => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => { action(cx); cx.notify(); })
      .child(svg(icon).size(13)).when(Boolean(label), el => el.child(label));
  }

  header(t, pane) {
    const info = this.status?.info, running = this.running, roomy = (this.size?.width ?? 0) >= 560;
    return h_flex().h(42).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
      .child(div().font_semibold().text_size(13).child("Git"))
      .when(Boolean(this.ctx), el => el.child(div().text_color(t.dim).truncate().max_w(160).child(this.ctx.root.split("/").pop()))
        .child(h_flex().gap(4).min_w(0).items_center().text_color(t.foreground)
          .child(svg(`${CHROME}/git-branch.svg`).size(12).flex_none().text_color(t.accent))
          .child(div().truncate().child(info?.head === "(detached)" ? `detached @ ${info.oid?.slice(0, 7)}` : info?.head ?? "…")))
        .when(Boolean(info?.upstream), el => el.child(div().flex_none().text_size(11.5).text_color(info.ahead || info.behind ? t.ansi3 : t.ansi2)
          .child(info.ahead || info.behind ? [info.ahead && `↑${info.ahead}`, info.behind && `↓${info.behind}`].filter(Boolean).join(" ") : "✓")))
        .when(Boolean(info?.head) && !info?.upstream && info?.head !== "(detached)", el => el.child(div().flex_none().text_size(11).text_color(t.dim).child("no upstream")))
        .when(Boolean(this.status?.files.length), el => el.child(div().flex_none().text_size(11).text_color(t.ansi3).child(this.treeSummary()))))
      .child(div().flex_1())
      .when(Boolean(running), el => el.child(h_flex().id("git-running").gap(5).min_w(0).items_center().text_size(11.5).text_color(t.working).cursor_pointer()
        .on_click(() => running.addr && run("terminal.peek", { terminal: running.addr }))
        .child(svg(`${CHROME}/spinner.svg`).size(11).flex_none().spin(900)).child(div().truncate().max_w(180).child(running.title))))
      .children([this.selfUpdate.pill(t)].filter(Boolean))
      .when(Boolean(this.ctx) && !running, el => el
        .child(this.iconButton("git-fetch", "mods/git/fetch.svg", cx => this.cmd("git fetch --all --prune", "git fetch --all --prune", cx, { after: () => { this.prsAt = 0; } }), t, roomy && "Fetch"))
        .child(this.iconButton("git-pull", "mods/git/pull.svg", cx => this.cmd("git pull", "git pull", cx), t, roomy && "Pull"))
        .child(this.iconButton("git-push", "mods/git/push.svg", cx => this.push(cx), t, roomy && "Push")))
      .when(Boolean(this.ctx), el => el.child(this.iconButton("git-popout", "mods/git/popout.svg", cx => pane ? this.collapse() : this.expand(cx), t)));
  }

  treeSummary() {
    const f = this.status.files, staged = f.filter(x => x.staged).length, changed = f.filter(x => x.unstaged).length;
    return [staged && `${staged} staged`, changed && `${changed} changed`].filter(Boolean).join(" · ");
  }

  banner(id, color, t, text, buttons) {
    return h_flex().id(id).flex_none().mx(6).mt(6).px(10).py(7).gap(8).items_center().rounded(8).border_1().border_color(color).bg(t.surface)
      .child(div().size(7).flex_none().rounded_full().bg(color))
      .child(div().flex_1().min_w(0).text_size(12).child(text))
      .children(buttons.filter(Boolean).map(([label, action], i) => h_flex().id(`${id}-b${i}`).h(24).px(8).flex_none().items_center().rounded(6).border_1().border_color(t.input)
        .bg(t.raised).text_size(11.5).cursor_pointer().hover(s => s.bg(t.hover)).on_click((_e, cx) => { action(cx); cx.notify(); }).child(label)));
  }

  opBanner(t) {
    const op = this.op, n = this.conflicts().length;
    const what = op.kind === "rebase" ? `Rebasing ${op.branch ?? "HEAD"} onto ${op.other ?? "?"}${op.step ? ` · ${op.step}/${op.total}` : ""}`
      : op.kind === "merge" ? `Merging ${op.other ?? "?"} into ${this.status?.info.head ?? "HEAD"}` : `${op.kind} of ${op.other ?? "?"} in progress`;
    return this.banner("op", n ? t.ansi1 : t.ansi3, t, `${what}${n ? ` · ${n} conflict${n > 1 ? "s" : ""}` : " · no conflicts left"}`, [
      n > 0 && ["Resolve (v)", () => this.openConflicts()],
      n > 0 && ["Ask AI (i)", cx => this.askAI(cx)],
      !n && [`Continue`, cx => this.cmd(`git ${op.kind} --continue`, `git ${op.kind} --continue`, cx)],
      ["More (m)", cx => this.opMenu(cx)],
    ]);
  }

  aiBanner(t) {
    const a = this.ai.address ? agents().find(x => x.address === this.ai.address) : null;
    const status = a?.status, color = status === "working" ? t.working : status === "blocked" ? t.blocked : status ? t.ansi2 : t.dim;
    const text = !this.ai.address ? `Started a new agent tab to ${this.ai.label}`
      : !a ? `The agent asked to ${this.ai.label} is gone`
        : status === "working" ? `${a.program?.name ?? "Agent"} (${a.tab_name}) is working on: ${this.ai.label}…`
          : status === "blocked" ? `${a.program?.name ?? "Agent"} needs you (${this.ai.label})`
            : `${a.program?.name ?? "Agent"} finished: review, then ${this.op ? "continue (m)" : "retry"}`;
    return this.banner("ai", color, t, text, [
      a && ["Show", () => run("agent.focus", { terminal: a.address })],
      ["Dismiss", () => { this.ai = null; }],
    ]);
  }

  failureBanner(t) {
    const f = this.failure;
    return this.banner("fail", t.ansi1, t, `${f.title} failed (exit ${f.code})`, [
      ["Output", cx => this.showOutput(f, cx)],
      ["Copy", cx => { cx.write_to_clipboard(`$ ${f.title}\n${f.output}`); this.flash("Output copied"); }],
      ["Ask AI (i)", cx => this.askAI(cx)],
      ["×", () => { this.failure = null; }],
    ]);
  }

  footer(t) {
    const flash = this.flashMsg?.text ?? null;
    return keybar(t, { id: "git", chips: this.chips(), flash, width: this.size?.width, onKeys: cx => { this.keysOpen = true; this.handle.focus(); cx.notify(); } });
  }

  // An action's label as a short keycap label: "New branch from here" → "new branch".
  static short(label) { return label.replace(/…$/, "").toLowerCase().split(" ").slice(0, 2).join(" "); }

  // The footer's keycaps for what's on screen now.
  chips() {
    if (this.prompt) return [{ caps: ["enter"], label: "confirm" }, { caps: ["escape"], label: "cancel" }];
    if (this.menu) return [{ caps: ["j", "k"], label: "move" }, { caps: ["enter"], label: "pick" }, { caps: ["escape"], label: "close" }];
    if (this.editorFocused) return [{ caps: ["cmd-c"], label: "copy" }, { caps: ["escape"], label: "back" }];
    if (this.mainFocus && this.main?.diff) {
      const r = this.main.rows?.[this.cur], pick = this.anchor != null, n = this.notes().length, sides = this.sides();
      if (r?.block) return [
        { caps: ["o"], label: `keep ${sides?.oursShort ?? "current"}` }, { caps: ["t"], label: `keep ${sides?.theirsShort ?? "incoming"}` },
        { caps: ["b"], label: "both" }, { caps: ["j", "k"], label: "conflict" }, { caps: ["a"], label: "note" }, { caps: ["escape"], label: "back" },
      ];
      return [
        { caps: ["space"], label: `${r?.side === "staged" ? "unstage" : "stage"} ${pick ? "lines" : "hunk"}` },
        { caps: ["j", "k"], label: pick ? "line" : "hunk" },
        { caps: ["v"], label: pick ? "end selection" : "select lines" }, { caps: ["a"], label: "note" },
        ...(n ? [{ caps: ["p"], label: `send ${n} note${n === 1 ? "" : "s"}` }] : []),
        { caps: ["d"], label: "discard" }, { caps: ["A"], label: "ask AI" }, { caps: ["J", "K"], label: "file" },
        { caps: ["o"], label: "editor" }, { caps: ["escape"], label: "back" },
      ];
    }
    if (this.mainFocus) return [{ caps: ["j", "k"], label: "scroll" }, { caps: ["ctrl-d", "ctrl-u"], label: "page" }, { caps: ["escape"], label: "back" }];
    // The shown section's own actions first (the keybar fits as many as there's room for).
    const all = this.actions().filter(a => a.key !== "ctrl-r");
    const own = all.filter(a => !a.global && !a.custom);
    const acts = (own.length ? own : all).slice(0, 10).map(a => ({ caps: [a.key], label: a.chip ?? Git.short(a.label) }));
    if (this.rangeRows().length > 1) return [{ caps: ["escape"], label: "end range" }, ...acts.filter(a => a.caps[0] !== "v")];
    return [...acts, { caps: ["x"], label: "actions" }];
  }

  keysGroups() {
    const sec = SECTIONS.find(s => s.id === this.sec);
    return [
      { title: `${sec.title}: actions`, chips: this.actions().map(a => ({ caps: [a.key], label: a.label.replace(/…$/, "") })) },
      { title: "Moving", chips: [
        { caps: SECTIONS.map(s => s.key), label: SECTIONS.map(s => s.title.toLowerCase()).join(" / ") },
        { caps: ["h", "l"], label: "previous / next section" },
        { caps: ["j", "k"], label: "move" }, { caps: ["<", ">"], label: "first / last" },
        { caps: [",", "."], label: "page up / down" }, { caps: ["[", "]"], label: "switch tab" },
        { caps: ["enter"], label: "focus the diff" }, { caps: ["J", "K"], label: "scroll the diff" },
        { caps: ["ctrl-d", "ctrl-u"], label: "scroll the diff a page" },
        { caps: ["v"], label: "commits: select a range" }, { caps: ["shift-down", "shift-up"], label: "commits: grow the range" },
      ] },
      { title: "Files: reviewing the diff (enter)", chips: [
        { caps: ["j", "k"], label: "next / previous hunk or conflict (arrows, } / { too)" },
        { caps: ["A"], label: "ask AI about this change (the selected lines, else the file)" },
        { caps: ["J", "K"], label: "next / previous file" }, { caps: ["v"], label: "select lines: then j / k move a line at a time" },
        { caps: ["space"], label: "stage the hunk or lines (unstage on the staged side)" },
        { caps: ["d"], label: "discard the hunk or lines" }, { caps: ["a"], label: "write a note on the line or lines" },
        { caps: ["X"], label: "delete the notes on this line" }, { caps: ["p", "i"], label: "send the notes to an agent" },
        { caps: ["e"], label: "open in your editor at this line (o too, outside a conflict)" },
        { caps: ["o", "t", "b"], label: "on a conflict: keep current / incoming / both" },
        { caps: ["click"], label: "put the cursor on a line" }, { caps: ["shift-click"], label: "select lines (or drag)" },
        { caps: ["escape"], label: "back to the list" },
      ] },
      { title: "Everywhere", chips: [
        { caps: ["/"], label: "filter" }, { caps: ["x"], label: "actions menu" }, { caps: ["escape"], label: "back / clear" },
        { caps: ["q"], label: "close the panel" }, { caps: ["?"], label: "this card" },
      ] },
    ];
  }

  sectionsColumn(t, mono, wide) {
    return v_flex().min_h(0).gap(6).children(SECTIONS.map(s => this.sectionBox(s, t, mono)));
  }

  sectionBox(s, t, mono) {
    const focusedSec = this.sec === s.id, lk = this.lk(s.id), items = this.items(s.id), sel = this.selIndex(s.id);
    const count = s.id === "commits" ? items.filter(r => r.sha).length : s.id === "files" ? (this.filter.files ? items.length : this.status?.files?.length ?? 0) : items.length;
    const head = h_flex().id(`sec-${s.id}`).h(24).flex_none().px(8).gap(6).items_center().cursor_pointer()
      .on_click((_e, cx) => this.focusSection(s.id, cx))
      .child(div().text_size(10.5).font_semibold().px(4).rounded(4).bg(focusedSec && this.hadKeys ? t.accent : t.raised).text_color(focusedSec && this.hadKeys ? t.accent_foreground : t.muted).child(s.key))
      .child(div().font_semibold().text_color(focusedSec ? t.foreground : t.muted).child(s.title))
      .when(Boolean(s.tabs), el => el.children(s.tabs.map((name, i) => div().id(`tab-${s.id}-${i}`).px(5).rounded(4).text_size(11)
        .text_color(this.tab[s.id] === i ? t.foreground : t.dim).when(this.tab[s.id] === i, d => d.bg(t.raised))
        .on_click((_e, cx) => { cx.stop_propagation(); if (this.tab[s.id] !== i) { this.sec = s.id; this.switchTab(i - this.tab[s.id], cx); } }).child(name))))
      .when(Boolean(this.filter[lk]), el => el.child(div().text_size(11).text_color(t.accent).truncate().child(`/${this.filter[lk]}`)))
      .child(div().flex_1())
      .when(s.id === "files" && this.notes().length > 0, el => el.child(div().text_size(11).text_color(t.ansi3).child(`✎ ${this.notes().length}`)))
      .child(div().text_size(11).text_color(t.dim).child(String(count)));
    const row = (it, i, inList) => this.row(s.id, it, i, i === sel, focusedSec, t, mono, inList);
    let body;
    if (!items.length) body = div().px(10).h(ROW).flex_none().flex().items_center().text_size(11.5).text_color(t.dim).child(this.emptyText(s.id));
    else if (focusedSec) {
      const id = `list-${lk}`;
      body = div().flex_1().min_h(0).relative()
        .child(div().size_full().child(v_virtual_list(id, items.length, ROW, i => this.itemKey(s.id, items[i], i), range => items.slice(range.start, range.end).map((it, j) => row(it, range.start + j, true)))
          .track_scroll(this.scrolls[lk]).size_full()
          .on_item_click((key, cx) => this.clickRow(s.id, items.findIndex((it, j) => this.itemKey(s.id, it, j) === key), cx))))
        .child(Scrollbar.vertical(id).viewport_from_layout().absolute().inset_0());
    } else {
      const cap = Math.min(s.cap, items.length), start = Math.max(0, Math.min(sel - Math.floor(cap / 2), items.length - cap));
      body = v_flex().flex_none().children(items.slice(start, start + cap).map((it, j) => row(it, start + j)));
    }
    return v_flex().id(`box-${s.id}`).min_h(0).rounded(8).border_1().border_color(focusedSec && this.hadKeys ? t.accent : t.border).pb(4)
      .when(focusedSec, el => el.flex_1()).when(!focusedSec, el => el.flex_none())
      .child(head).child(body);
  }

  emptyText(sec) {
    return { files: "No changes", branches: "No branches", commits: "No commits", stash: "No stashes" }[sec];
  }

  itemKey(sec, it, i) {
    return sec === "files" ? `${it.kind === "dir" ? "d" : "f"}${it.path}` : sec === "branches" ? `b${it.name}` : sec === "commits" ? it.sha : `s${it.ref}`;
  }

  // Virtual-list rows can't carry handlers, so a second click on the same row within 400 ms counts as a double click.
  clickRow(sec, i, cx) {
    if (i < 0) return;
    const now = Date.now(), double = this.lastClick?.sec === sec && this.lastClick.i === i && now - this.lastClick.at < 400;
    this.lastClick = { sec, i, at: now };
    const it = this.items(sec)[i], again = sec === "files" && it?.kind === "dir" && this.sec === sec && this.selIndex(sec) === i;
    if (this.sec !== sec) this.focusSection(sec, cx);
    this.move(0, cx, i);
    if (again) this.toggleFold(it, cx);
    else if (double && it?.kind !== "dir") this.actions().find(a => a.key === "space")?.run(cx);
    cx.notify();
  }

  row(sec, it, i, selected, focusedSec, t, mono, inList) {
    // In a commit range (v): drawn like the selected row.
    const picked = !selected && sec === "commits" && Boolean(it.sha) && Boolean(this.rangeSet?.has(it.sha));
    const el = h_flex().id(`${sec}-${this.itemKey(sec, it, i)}`).h(ROW).flex_none().px(8).gap(6).items_center().rounded(5).cursor_pointer().min_w(0)
      .when(selected || picked, e => e.bg(focusedSec ? t.selected : t.hover))
      .hover(s => s.bg(selected && focusedSec ? t.selected : t.hover))
      .when(!inList, e => e.on_click((_e, cx) => this.clickRow(sec, i, cx)));
    if (sec === "files") return it.kind === "dir" ? this.dirRow(el, it, t) : this.fileRow(el, it, t);
    if (sec === "branches") return this.branchRow(el, it, t);
    if (sec === "commits") return this.commitRow(el, it, t, mono);
    return el.child(div().flex_none().text_color(t.dim).font_family(mono).text_size(11.5).child(it.ref.replace("stash@", "")))
      .child(div().flex_1().min_w(0).truncate().child(it.message)).child(div().flex_none().text_size(11).text_color(t.dim).child(it.date));
  }

  // lazygit's two status letters: staged (green) then unstaged (red); then the folder, dim, and the name.
  // A folder in the Files tree: ▾ / ▸, its name ("/" at the root), how many files when folded.
  dirRow(el, d, t) {
    const noted = this.notes().some(n => this.under(d.path, n.path));
    return el.pl(8 + d.depth * 14)
      .child(div().w(10).flex_none().text_size(10).text_color(t.dim).child(d.open ? "▾" : "▸"))
      .child(div().flex_1().min_w(0).truncate().text_color(d.conflict ? t.ansi1 : d.root ? t.muted : t.ansi4).child(d.root ? "/" : d.name))
      .when(noted, e => e.child(div().flex_none().text_size(11).text_color(t.ansi3).child("✎")))
      .when(!d.open, e => e.child(div().flex_none().text_size(11).text_color(t.dim).child(String(d.count))));
  }

  fileRow(el, row, t) {
    const f = row.file, tree = !this.flat && !this.filter.files;
    const letter = (c, color) => div().w(8).flex_none().text_color(color).child(c === "." ? "" : c);
    const slash = f.path.lastIndexOf("/"), dir = tree || slash < 0 ? "" : f.path.slice(0, slash + 1), name = f.path.slice(slash + 1);
    const noted = this.notes().some(n => n.path === f.path);
    return el.when(tree, e => e.pl(8 + row.depth * 14)).child(h_flex().flex_none().font_family(settings().font_family ?? "JetBrains Mono").text_size(11.5).font_semibold()
        .child(letter(f.untracked ? "?" : f.x, f.conflict ? t.ansi1 : t.ansi2)).child(letter(f.untracked ? "?" : f.y, t.ansi1)))
      .child(h_flex().flex_1().min_w(0).overflow_hidden()
        .child(div().flex_none().text_color(f.conflict ? t.ansi1 : f.unstaged ? t.foreground : t.ansi2).child(name))
        .child(div().min_w(0).truncate().pl(6).text_size(11).text_color(t.dim).child(dir.replace(/\/$/, ""))))
      .when(noted, e => e.child(div().flex_none().text_size(11).text_color(t.ansi3).child("✎")))
      // During a merge / rebase / pick: conflicts were changed on both sides; others came in from the incoming side.
      .when(f.conflict, e => e.child(div().flex_none().px(4).rounded(4).border_1().border_color(t.ansi1).text_size(10).text_color(t.ansi1).child("both sides")))
      .when(!f.conflict && this.fromIncoming(f.path), e => e.child(div().flex_none().max_w(120).truncate().px(4).rounded(4).border_1().border_color(t.ansi4).text_size(10).text_color(t.ansi4).child(`▼ ${this.sides()?.theirsShort ?? "incoming"}`)));
  }

  branchRow(el, b, t) {
    const remote = b.kind === "remote", pr = this.prs?.[remote ? b.short : b.name];
    const stale = !remote && !b.head && (pr?.state === "MERGED" || pr?.state === "CLOSED" || b.gone);
    const badge = (text, color) => div().flex_none().px(4).rounded(4).border_1().border_color(color).text_size(10.5).text_color(color).child(text);
    return el.child(div().w(10).flex_none().text_color(t.accent).child(b.head ? "*" : ""))
      .child(div().flex_1().min_w(0).truncate().text_color(b.head ? t.accent : stale ? t.dim : t.foreground).when(b.head, d => d.font_semibold()).child(b.name))
      .when(Boolean(pr), e => e.child(badge(`#${pr.number} ${pr.isDraft && pr.state === "OPEN" ? "draft" : pr.state.toLowerCase()}`, pr.isDraft && pr.state === "OPEN" ? t.dim : t[PR_COLOR[pr.state]] ?? t.dim)))
      .when(!remote, e => e.child(
        b.gone ? badge("gone", t.ansi1)
          : !b.upstream ? badge("local", t.dim)
            : b.ahead || b.behind ? div().flex_none().text_size(11).text_color(t.ansi3).child(`${b.ahead ? `↑${b.ahead}` : ""}${b.behind ? `↓${b.behind}` : ""}`)
              : div().flex_none().text_size(11).text_color(t.ansi2).child("✓")))
      .when(!remote && b.merged && !pr && !b.head && b.name !== this.base?.replace(/^[^/]+\//, ""), e => e.child(badge("merged", t.ansi5)))
      .when(!remote && Boolean(b.worktree), e => e.child(badge("worktree", t.dim)))
      .when(remote && Boolean(b.local), e => e.child(badge(`local: ${b.local === b.short ? "✓" : b.local}`, t.ansi2)))
      .when((this.size?.width ?? 0) >= 520, e => e.child(div().flex_none().text_size(11).text_color(t.dim).child(b.date.replace(/ ago$/, ""))));
  }

  palette(t) { return [t.ansi4, t.ansi5, t.ansi6, t.ansi2, t.ansi3, t.ansi1, t.ansi12 ?? t.ansi4, t.ansi13 ?? t.ansi5]; }

  commitRow(el, c, t, mono) {
    const hashColor = c.state === "unpushed" ? t.ansi1 : c.state === "pushed" ? t.ansi3 : t.ansi2;
    const refs = c.refs.map(r => r.replace(/^HEAD -> /, "→ ")).filter(r => r !== "HEAD" && !r.endsWith("/HEAD"));
    const isHead = c.refs.some(r => r.startsWith("HEAD"));
    return el.child(graphCell(c.lane, ROW, this.palette(t), t.background, { highlight: isHead ? t.foreground : null }))
      .child(div().flex_none().font_family(mono).text_size(11.5).text_color(hashColor).child(c.short))
      .when(this.copied.includes(c.sha), e => e.child(div().flex_none().text_size(10.5).text_color(t.ansi6).child("⎘")))
      .children(refs.slice(0, 2).map(r => div().flex_none().max_w(140).truncate().px(4).rounded(4).text_size(10.5)
        .bg(r.startsWith("→") ? t.accent : t.raised).text_color(r.startsWith("→") ? t.accent_foreground : r.startsWith("tag:") ? t.ansi3 : t.ansi6).child(r)))
      .when(refs.length > 2, e => e.child(div().flex_none().text_size(10.5).text_color(t.dim).child(`+${refs.length - 2}`)))
      .child(div().flex_1().min_w(0).truncate().text_color(c.state === "merged" ? t.muted : t.foreground).child(c.subject))
      .when((this.size?.width ?? 0) >= 520, e => e.child(div().flex_none().text_size(11).text_color(t.dim).child(`${c.author.split(" ")[0]} · ${c.date.replace(/ ago$/, "")}`)));
  }

  mainView(t, mono) {
    const m = this.main, log = m?.log;
    // A file: its name, then its folder (dim, cut first), so a long path never hides the name or the buttons.
    const file = !log && m?.diff && m.path != null
      ? m.diff.folder ? { name: m.path ? `${m.path.split("/").pop()}/` : "/", dir: m.path.split("/").slice(0, -1).join("/") }
        : { name: m.path.split("/").pop(), dir: m.path.split("/").slice(0, -1).join("/") }
      : null;
    const head = h_flex().h(28).flex_none().px(10).gap(8).items_center().border_b(1).border_color(t.border)
      .when(!file, el => el.child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(this.mainFocus ? t.foreground : t.muted)
        .child(log ? `${log.running ? "running" : log.code === 0 ? "✓" : `✗ exit ${log.code}`} · ${log.title}` : m?.title ?? "")))
      .when(Boolean(file), el => el
        .child(h_flex().flex_1().min_w(0).gap(6).items_center().overflow_hidden().text_size(11.5)
          .child(div().flex_none().max_w_full().truncate().font_semibold().text_color(this.mainFocus ? t.foreground : t.muted).child(file.name))
          .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(file.dir)))
        .child(this.diffButton("ask-file", "Ask AI", cx => this.askAbout(cx), t, t.accent)))
      .when(Boolean(log), el => el
        .when(Boolean(log.running && log.addr), e => e.child(this.iconButton("main-peek", `${CHROME}/terminal.svg`, () => run("terminal.peek", { terminal: log.addr }), t, "Watch")))
        .child(this.iconButton("main-copy", "mods/git/copy.svg", cx => { cx.write_to_clipboard(`$ ${log.title}\n${log.output}`); this.flash("Output copied"); }, t, "Copy"))
        .when(!log.running && log.code !== 0, e => e.child(this.iconButton("main-ai", "mods/git/ai.svg", cx => this.askAI(cx), t, "Ask AI"))));
    const box = v_flex().min_h(0).min_w(0).rounded(8).border_1().border_color(this.mainFocus && this.hadKeys ? t.accent : t.border).overflow_hidden().child(head);
    if (!m) return box.child(div().p(10).text_color(t.dim).child("Nothing selected"));
    if (log) return box.child(div().id("main-editor").flex_1().min_h(0).on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Editor.new(this.editor).size_full()));
    if (!m.rows) return box.child(div().p(10).text_color(t.dim).child("Loading…"));
    if (m.commits) return box.child(div().flex_1().min_h(0).relative().px(4)
      .child(v_virtual_list("main-commits", m.commits.length, ROW, i => m.commits[i].sha,
        range => m.commits.slice(range.start, range.end).map(c => this.commitRow(h_flex().h(ROW).flex_none().px(6).gap(6).items_center().min_w(0), c, t, mono)))
        .track_scroll(this.scrolls.main).size_full())
      .child(Scrollbar.vertical("main-commits").viewport_from_layout().absolute().inset_0()));
    if (m.diff) return box.child(this.diffView(m, t, mono));
    const palette = { add: [t.ansi2, t.ansi2 + "18"], del: [t.ansi1, t.ansi1 + "18"], hunk: [t.ansi6, t.raised], file: [t.foreground, null], meta: [t.ansi3, null] };
    const line = r => {
      const [fg, bg] = palette[r.kind] ?? [t.foreground, null];
      return div().h(LINE).flex_none().px(10).whitespace_nowrap().text_color(fg).when(Boolean(bg), e => e.bg(bg)).when(r.kind === "file", e => e.font_semibold()).child(r.text || " ");
    };
    return box.child(div().flex_1().min_h(0).relative().font_family(mono).text_size(12)
      .child(div().id("main-x").size_full().overflow_x_scrollbar()
        .child(div().w_full().min_w(m.width).h_full().child(v_virtual_list("main-lines", m.rows.length, LINE, i => String(i),
          range => m.rows.slice(range.start, range.end).map(line)).track_scroll(this.scrolls.main).size_full())))
      .child(Scrollbar.vertical("main-lines").viewport_from_layout().absolute().inset_0()));
  }

  // A small button inside the diff (hunk headers, conflicts, the action bar).
  diffButton(id, label, run, t, color) {
    return div().id(id).flex_none().h(18).px(7).flex().items_center().rounded(4).cursor_pointer()
      .text_size(10.5).border_1().border_color(color ? color + "88" : t.border)
      .text_color(color ?? t.muted).bg(t.background).hover(s => s.bg(t.hover).text_color(color ?? t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); this.handle.focus(); run(cx); cx.notify(); })
      .child(label);
  }

  // A file's diff: old and new line numbers, the change, notes under their lines. Click a line for
  // the cursor, shift-click or drag to select lines; hunk headers and conflicts carry their buttons.
  // During a merge / rebase / pick, conflicts show which side each part comes from.
  diffView(m, t, mono) {
    const rows = this.diffRows(m), on = this.mainFocus, sides = this.sides(), side = rows[this.cur]?.side;
    const [lo, hi] = this.anchor == null ? [-1, -1] : [Math.min(this.anchor, this.cur), Math.max(this.anchor, this.cur)];
    const OURS = t.ansi2, THEIRS = t.ansi4, incoming = this.fromIncoming(m.path);
    const SIDE = { staged: incoming ? THEIRS : t.ansi2, unstaged: t.ansi3, conflict: t.ansi1 };
    const sectionText = r => !sides ? r.text
      : r.side === "staged" && incoming ? `Staged · from ${sides.theirs}` : r.side === "unstaged" ? `${r.text} · your edits` : r.text;
    const num = n => h_flex().w(38).h(LINE).flex_none().items_center().justify_end().pr(6).text_color(t.dim).child(n == null ? "" : String(n));
    const plain = rows.length <= PLAIN_ROWS;
    const line = (r, i) => {
      const cursor = on && i === this.cur, chosen = i >= lo && i <= hi && r.side === side && lineRow(r);
      // Plain rows wrap long lines (the row grows; line numbers stay on its first line); the virtual
      // list's rows must keep one height, so they stay one line and scroll sideways.
      let el = plain ? h_flex().w_full().min_h(LINE).flex_none().items_start()
        : h_flex().h(LINE).flex_none().items_center().whitespace_nowrap().min_w(m.width);
      const text = (content, color) => (plain ? div().flex_1().min_w(0).py(1) : div()).when(Boolean(color), d => d.text_color(color)).child(content);
      if (plain) el = el.id(`dl-${i}`).on_mouse_down("left", (e, cx) => this.pressLine(i, e, cx)).on_mouse_move((_e, cx) => this.dragTo(i, cx));
      // A folder's diff names each file before its hunks.
      if (r.kind === "file") return el.px(10).pt(4).border_t(1).border_color(t.border).font_semibold().text_color(t.foreground).child(text(r.text));
      if (r.kind === "section") return el.px(10).gap(6).font_semibold().text_size(11.5).text_color(SIDE[r.side] ?? t.muted).child(text(sectionText(r)));
      if (r.kind === "hunk") {
        const staged = r.side === "staged";
        // Buttons first: a long @@ line (its function context) never pushes them out of view.
        return el.pl(10).pr(6).gap(6).bg(t.raised).text_color(t.ansi6).when(plain, e => e.items_center())
          .when(plain, e => e
            .child(this.diffButton(`hk-s-${i}`, staged ? "Unstage hunk" : "Stage hunk", cx => this.onHunk(i, "stage", cx), t, staged ? t.ansi3 : t.ansi2))
            .when(r.side === "unstaged", e => e.child(this.diffButton(`hk-d-${i}`, "Discard", cx => this.onHunk(i, "discard", cx), t, t.ansi1))))
          .child(text(r.text).pl(2));
      }
      if (r.kind === "mark") {
        const b = r.block, c = r.part === "ours" ? OURS : r.part === "theirs" ? THEIRS : t.dim;
        const name = r.part === "ours" ? `▲ ${sides?.ours ?? `current · ${b.label || "HEAD"}`}` : r.part === "theirs" ? `▼ ${sides?.theirs ?? `incoming · ${b.theirsLabel || "theirs"}`}` : "BASE · how it was before both";
        return el.pl(10).pr(6).gap(8).bg(c + "22").border_t(1).border_color(c + "66").text_size(11).font_semibold().text_color(c)
          .when(plain, e => e.flex_wrap().items_center().py(2))
          .child(plain ? div().flex_none().max_w_full().child(r.part === "ours" ? `Conflict ${b.index + 1}  ${name}` : name) : (r.part === "ours" ? `Conflict ${b.index + 1}  ${name}` : name))
          .when(plain && r.part === "ours", e => e
            .child(this.diffButton(`cf-o-${i}`, `Keep ${sides?.oursShort ?? "current"}`, cx => this.resolve("ours", cx, b), t, OURS))
            .child(this.diffButton(`cf-t-${i}`, `Keep ${sides?.theirsShort ?? "incoming"}`, cx => this.resolve("theirs", cx, b), t, THEIRS))
            .child(this.diffButton(`cf-b-${i}`, "Both", cx => this.resolve("both", cx, b), t)));
      }
      if (r.kind === "note") return el.pl(86).pr(10).bg(t.ansi3 + "1a").text_color(t.ansi3).child(text(r.text));
      if (r.kind === "meta") return el.px(10).text_color(t.dim).child(text(r.text));
      const tone = { add: t.ansi2, del: t.ansi1, ours: OURS, theirs: THEIRS, base: t.dim }[r.kind];
      const fg = r.kind === "ctx" ? t.foreground : tone;
      const bg = cursor ? t.selected : chosen ? t.selection : tone && r.kind !== "base" ? tone + "18" : null;
      const sign = { add: "+", del: "-", ours: "▲", theirs: "▼", base: "·" }[r.kind] ?? "";
      return el.when(Boolean(bg), e => e.bg(bg)).border_l(2).border_color(cursor ? t.accent : chosen ? t.accent + "66" : bg ?? t.background)
        .child(num(r.old)).child(num(r.new))
        .child(div().w(12).flex_none().h(LINE).flex().items_center().text_color(fg).child(sign))
        .child(text(r.text || " ", fg).pr(10));
    };
    const list = plain
      ? div().id("main-diff").flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.diffScroll).font_family(mono).text_size(12)
        .on_mouse_up("left", () => { this.dragging = null; })
        .on_hover(h => { if (!h) this.dragging = null; })
        .children(rows.map(line))
      : div().flex_1().min_h(0).relative().font_family(mono).text_size(12)
        .child(div().id("main-x").size_full().overflow_x_scrollbar()
          .child(div().w_full().min_w(m.width).h_full().child(v_virtual_list("main-diff-v", rows.length, LINE, i => String(i),
            range => rows.slice(range.start, range.end).map((r, j) => line(r, range.start + j)))
            .track_scroll(this.scrolls.main).size_full()
            .on_item_click((key, cx) => this.pressLine(Number(key), null, cx)))))
        .child(Scrollbar.vertical("main-diff-v").viewport_from_layout().absolute().inset_0());
    return v_flex().flex_1().min_h(0)
      .when(Boolean(sides) && (m.diff.blocks || incoming), e => e.child(this.sidesLegend(sides, t)))
      .child(list)
      .child(this.actionBar(m, t));
  }

  // During an operation: which colour is which side, above the diff.
  sidesLegend(sides, t) {
    const dot = (c, text) => h_flex().gap(5).items_center().child(div().size(7).rounded_full().bg(c)).child(div().text_color(c).child(text));
    return h_flex().h(24).flex_none().px(10).gap(14).items_center().border_b(1).border_color(t.border).text_size(11)
      .child(dot(t.ansi2, `▲ ${sides.ours}`)).child(dot(t.ansi4, `▼ ${sides.theirs}`));
  }

  // What the buttons under the diff do: the selected lines, the cursor's hunk or conflict, and the notes.
  actionBar(m, t) {
    const rows = m.rows ?? [], r = rows[this.cur], entry = this.selected("files"), f = entry?.kind === "file" ? entry.file : null, sides = this.sides();
    const pick = this.picked(), n = this.notes().length, bits = [];
    const b = (id, label, run, color) => bits.push(this.diffButton(id, label, run, t, color));
    let what;
    if (r?.block && this.mainFocus) {
      what = `Conflict ${r.block.index + 1} of ${m.diff.blocks.length}`;
      b("ab-o", `Keep ${sides?.oursShort ?? "current"}`, cx => this.resolve("ours", cx), t.ansi2);
      b("ab-t", `Keep ${sides?.theirsShort ?? "incoming"}`, cx => this.resolve("theirs", cx), t.ansi4);
      b("ab-b", "Keep both", cx => this.resolve("both", cx));
      b("ab-r", "Open resolver", () => this.openConflicts());
    } else if (pick?.size) {
      what = `${pick.size} line${pick.size === 1 ? "" : "s"} selected`;
      b("ab-s", r?.side === "staged" ? "Unstage lines" : "Stage lines", cx => this.stageHunk(cx), r?.side === "staged" ? t.ansi3 : t.ansi2);
      if (r?.side === "unstaged") b("ab-d", "Discard lines", cx => this.discardHunk(cx), t.ansi1);
      b("ab-n", "Note", cx => this.addNote(cx), t.ansi3);
      b("ab-c", "Clear", () => { this.anchor = null; });
    } else if (r?.hunk && this.mainFocus) {
      what = `Line ${lineOf(r) ?? ""} · click, shift-click or drag to select lines`;
      b("ab-s", r.side === "staged" ? "Unstage hunk" : "Stage hunk", cx => this.stageHunk(cx), r.side === "staged" ? t.ansi3 : t.ansi2);
      b("ab-n", "Note", cx => this.addNote(cx), t.ansi3);
    } else what = entry?.kind === "dir" ? `${entry.root ? "Everything" : `${entry.path}/`} · ${entry.count} file${entry.count === 1 ? "" : "s"}`
      : f ? (f.conflict ? "Conflicted: keep a side in each conflict, then stage the file" : "Click a line to review it · shift-click or drag selects") : "";
    if (f && !f.conflict) b("ab-f", f.unstaged ? "Stage file" : "Unstage file", cx => this.actions().find(a => a.key === "space")?.run(cx));
    if (entry?.kind === "dir") b("ab-f", this.actions().find(a => a.key === "space")?.label.startsWith("Stage") ? "Stage folder" : "Unstage folder", cx => this.actions().find(a => a.key === "space")?.run(cx));
    if (f?.conflict && !(r?.block && this.mainFocus)) b("ab-r", "Open resolver", () => this.openConflicts());
    if (n) b("ab-p", `Send ${n} note${n === 1 ? "" : "s"} to AI`, cx => this.askAI(cx, "notes"), t.ansi3);
    return h_flex().h(30).flex_none().px(10).gap(6).items_center().border_t(1).border_color(t.border).bg(t.background)
      .text_size(11)
      .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(what))
      .children(bits);
  }

  menuView(t) {
    const m = this.menu;
    return div().id("menu-scrim").absolute().inset_0().bg("#00000055").flex().items_center().justify_center()
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.menu = null; cx.notify(); })
      .child(v_flex().id("menu").w(380).max_h(520).p(6).rounded(10).border_1().border_color(t.border).bg(t.popover).shadow_lg()
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(div().px(8).py(6).font_semibold().child(m.title))
        .when(Boolean(m.lines?.length), el => el.child(v_flex().px(8).pb(6).text_size(11.5).text_color(t.muted).children(m.lines.map(l => div().truncate().child(l)))))
        .child(v_flex().id("menu-items").overflow_y_scrollbar().children(m.items.map((it, i) => h_flex().id(`mi-${i}`).h(26).flex_none().px(8).gap(8).items_center().rounded(6)
          .when(!it.disabled, e => e.cursor_pointer()).when(i === m.sel, e => e.bg(t.selected)).hover(s => s.bg(t.hover))
          .on_click((_e, cx) => { if (it.disabled) return; this.menu = null; it.run(cx); cx.notify(); })
          .child(div().w(46).flex_none().text_size(11).font_family(settings().font_family ?? "JetBrains Mono").text_color(t.accent).child(it.key ?? ""))
          .child(div().flex_1().min_w(0).truncate().text_color(it.disabled ? t.dim : it.danger ? t.ansi1 : t.foreground).child(it.label))
          .when(Boolean(it.hint) && it.hint !== it.key, e => e.child(div().flex_none().text_size(11).text_color(t.dim).child(it.hint)))))));
  }

  promptView(t) {
    const p = this.prompt;
    return div().id("prompt-scrim").absolute().inset_0().bg("#00000055").flex().items_start().justify_center().pt(70)
      .child(v_flex().id("prompt").w(420).p(12).gap(8).rounded(10).border_1().border_color(t.border).bg(t.popover).shadow_lg()
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(div().font_semibold().child(p.title))
        .child(Input.new(p.input).h(32).px(10).rounded(7).border_1().border_color(t.accent).bg(t.background).text_size(12.5).text_color(t.foreground))
        .child(div().text_size(11).text_color(t.dim).child("enter confirm · esc cancel")));
  }
}

function cx_open(view, paths) {
  const editor = view.config?.editor ? q(view.config.editor) : "${VISUAL:-${EDITOR:-vi}}";
  run("terminal.open", { argv: [view.shell ?? "/bin/zsh", "-lic", `${editor} ${[paths].flat().map(q).join(" ")}`], folder: view.ctx.root, place: "tab" });
}
