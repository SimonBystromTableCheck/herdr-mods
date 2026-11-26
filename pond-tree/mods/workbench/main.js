// Workbench: IDE-style tools for files on disk — search across files, mass find & replace,
// go to file, format with the repo's own formatter, and delete duplicate lines.
// Writes are guarded: a file is only written if it still matches what was read.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, Input, InputState, Editor, EditorState, ScrollHandle } from "gpui-base";
import { keybar, keysCard } from "./keybar.js";
import { closePanel, hidePanel, revealPanel } from "./panel.js";
import { KEYS, keyOf } from "./keys.js";
import { SelfUpdate } from "./update.js";
import { detect, runPipeline, rulesFor } from "./format.js";
import { spaces, panes, focused, props, nextCommand, setShared, shared, run, exec, readTextFile, writeTextFile, theme, settings, checking } from "herdr";

const TOOLS = ["search", "goto", "format", "dedupe"];
const MAX_MATCHES = 2000, MAX_ROWS = 600, MAX_FILES_LIST = 20000;
const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", cjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html", yml: "yaml", py: "python", rb: "ruby", rs: "rust", md: "markdown" };
const NB = s => s.replace(/ /g, " ").replace(/\t/g, "  ");


function guessLocation() {
  const p = props() ?? {};
  if (p.folder) return { cwd: p.folder, on: p.machine ?? null };
  const space = spaces().find(s => s.active), f = focused();
  let pane = f?.pane ? panes().find(x => x.pane === f.pane) : null;
  if (!pane?.cwd) pane = panes().find(x => x.cwd && x.tab === f?.tab) ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder || null, on: space?.machine ?? null };
}

function buildRegex(q, o) {
  let src = o.regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (o.word) src = `\\b(?:${src})\\b`;
  return new RegExp(src, o.case ? "g" : "gi");
}

function fuzzy(q, s) {
  // Subsequence match; lower is better. Rewards matches in the file name and contiguity.
  let qi = 0, score = 0, last = -2;
  const ls = s.toLowerCase(), base = ls.lastIndexOf("/") + 1;
  for (let i = 0; i < ls.length && qi < q.length; i++) {
    if (ls[i] === q[qi]) { score += i === last + 1 ? 0 : 3; if (i < base) score += 1; last = i; qi++; }
  }
  return qi === q.length ? score + s.length * 0.01 : null;
}

export default class Workbench extends View {
  init(_props, cx) {
    this.tab = "search";
    this.opts = { case: false, word: false, regex: false };
    this.showReplace = false;
    this.results = []; this.info = null; this.seq = 0; this.collapsed = new Set();
    this.file = null; this.status = null; this.undo = null; this.busy = false;
    this.fmt = { det: null, chosen: null, scope: "changed", fixes: true, builtins: true, onSave: false, running: false, progress: null, result: null, undo: null, open: new Set() };
    this.dd = { trim: true, keepBlank: true, adjacent: false };
    this.allFiles = null; this.goto = "";
    this.size = { width: 800, height: 600 };
    this.handle = cx.focus_handle();
    this.selfUpdate = new SelfUpdate("workbench", "Find panel"); if (!checking()) this.selfUpdate.start(cx);
    this.sel = { search: 0, goto: 0, dedupe: 0 };
    this.scroll = { search: ScrollHandle.new(), goto: ScrollHandle.new(), dedupe: ScrollHandle.new() };
    this.typing = null; this.editing = false; this.menu = null; this.keysOpen = false;

    this.q = InputState.new({ placeholder: "Search across files" });
    this.r = InputState.new({ placeholder: "Replace with" });
    this.g = InputState.new({ placeholder: "Files to include, e.g. *.ts, src/**, !dist" });
    this.o = InputState.new({ placeholder: "Go to file… (fuzzy)" });
    this.q.on("change", (_e, cx) => this.schedule(cx));
    this.g.on("change", (_e, cx) => this.schedule(cx));
    this.r.on("change", (_e, cx) => cx.notify());
    this.o.on("change", (_e, cx) => { this.goto = this.o.value(); cx.notify(); });
    this.o.on("submit", (_e, cx) => { const p = this.gotoMatches()[this.sel.goto] ?? this.gotoMatches()[0]; if (p) this.open(p, null, cx); });
    this.o.on("change", (_e, cx) => { this.sel.goto = 0; });
    // Enter in the search box: search now and move to the results.
    this.q.on("submit", (_e, cx) => { this.toList(cx); });
    for (const [name, st] of [["q", this.q], ["r", this.r], ["g", this.g], ["o", this.o]]) {
      st.on("focus", (_e, cx) => { this.typing = name; cx.notify(); });
      st.on("blur", (_e, cx) => { if (this.typing === name) this.typing = null; cx.notify(); });
    }

    const p = props() ?? {};
    if (p.query) this.q.set_value(p.query);
    if (p.replace != null) { this.r.set_value(p.replace); this.showReplace = true; }
    if (p.tool) this.tab = p.tool;
    if (p.file) this.pendingFile = { path: p.file, line: p.line ?? null };
    if (p.include) this.g.set_value(p.include);
    if (p.opts) this.opts = { ...this.opts, ...p.opts };
    // The expanded view: a tab of its own, opened by expand() with a token naming it.
    this.token = p.token ?? null;
    // Commands reach every shown copy (the panel and an expanded tab); expand/collapse are for the
    // copy that last had the keyboard.
    this.copyId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    this.expanded = Boolean(this.token);
    if (this.expanded && !checking()) cx.timer.after(150, () => this.handle.focus());
    cx.timer.every(250, cx => { if (this.tab === "dedupe" && this.file && this.syncSel()) cx.notify(); });
    this.fixed = Boolean(p.folder);
    this.spaceId = spaces().find(s => s.active)?.id;
    this.setRoot(guessLocation(), cx);
    if (!checking() && !this.pendingFile) cx.timer.after(300, () => this.q.focus());
    cx.spawn(async cx => {
      for (;;) {
        const c = await nextCommand();
        if (c === "focus") {
          this.takeHandoff(cx);
          // Nothing searched yet: land in the search box. Otherwise on the list.
          // One retry in case the first focus didn't land (as the other panels do).
          const token = this.focusToken = (this.focusToken ?? 0) + 1;
          const target = () => { if (this.tab === "search" && !this.q.value()) this.q.focus(); else if (this.tab === "goto") this.o.focus(); else this.handle.focus(); };
          target();
          cx.timer.after(40, () => { if (this.keyboard()) this.focusToken++; });
          cx.timer.after(150, cx => { if (this.focusToken === token && !this.keyboard()) { target(); cx.notify(); } });
        }
        else if (c === "expand" && this.mine()) this.expanded ? this.collapse(cx) : this.expand(cx);
        else if (c === "collapse" && this.expanded && this.mine()) this.collapse(cx);
        else if (typeof c === "string" && c.startsWith("go:")) this.go(c.slice(3));
        else if (typeof c === "string" && c.startsWith("key:")) this.press(c.slice(4), cx);
        else if (typeof c === "string" && c.startsWith("reveal:") && this.file) this.reveal(Number(c.slice(7)), cx);
        cx.notify();
      }
    });
    // No blur event for a focus handle: poll it, redraw on change, share it for the leader.
    cx.timer.every(300, cx => {
      const k = this.keyboard();
      if (k !== this.sharedKeys) { this.sharedKeys = k; setShared("workbench.hasKeys", k); }
      if (k && shared("workbench.owner") !== this.copyId) setShared("workbench.owner", this.copyId);
      if (k !== this.hadKeys) { this.hadKeys = k; cx.notify(); }
      if (this.expanded) this.refocus(cx);
      if (!this.fixed && Date.now() < (this.followUntil ?? 0)) {
        const loc = guessLocation();
        if (loc.cwd && loc.cwd !== this.followCwd) { this.followCwd = loc.cwd; this.setRoot(loc, cx); }
      }
    });
  }

  // ── location ────────────────────────────────────────────────────────────
  setRoot(loc, cx) {
    this.root = loc.cwd; this.on = loc.on; this.allFiles = null; this.fmt.det = null; this.fmt.result = null; this.fmt.undo = null;
    if (!this.root || checking()) return;
    cx.spawn(async cx => {
      const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: loc.cwd, on: loc.on }).catch(() => null);
      if (top?.code === 0 && top.stdout.trim()) this.root = top.stdout.trim();
      this.results = []; this.info = null;
      if (this.q.value()) this.search(cx);
      this.detectFormatters(cx);
      this.loadFiles(cx);
      if (this.pendingFile) { const f = this.pendingFile; this.pendingFile = null; this.open(f.path.startsWith("/") ? f.path.slice(this.root.length + 1) : f.path, f.line, cx); }
      cx.notify();
    });
  }

  get remote() { return Boolean(this.on); }
  abs(path) { return `${this.root}/${path}`; }

  // ── search ──────────────────────────────────────────────────────────────
  schedule(cx) {
    const seq = ++this.seq;
    cx.timer.after(250, cx => { if (seq === this.seq) this.search(cx); });
  }

  search(cx) {
    const seq = ++this.seq, q = this.q.value(), o = { ...this.opts };
    if (!q || !this.root) { this.results = []; this.info = null; cx.notify(); return; }
    let re;
    try { re = buildRegex(q, o); } catch (e) { this.info = { error: `Invalid regex: ${e.message}` }; this.results = []; cx.notify(); return; }
    const globs = this.g.value().split(",").map(s => s.trim()).filter(Boolean);
    const args = ["--json", "--max-columns", "2000", "--max-count", "500", o.case ? "-s" : "-i", ...(o.word ? ["-w"] : []), ...(o.regex ? [] : ["-F"]),
      ...globs.flatMap(g => ["-g", g]), "--", q, "."];
    this.info = { ...(this.info ?? {}), searching: true }; cx.notify();
    const started = Date.now();
    cx.spawn(async cx => {
      let r;
      try { r = await exec("rg", args, { cwd: this.root, on: this.on, timeout: 30000 }); }
      catch (e) { if (seq === this.seq) { this.info = { error: String(e) }; cx.notify(); } return; }
      if (seq !== this.seq) return;
      if (r.code === 2 && !r.stdout) { this.info = { error: (r.stderr || "rg failed").trim().split("\n")[0] }; this.results = []; cx.notify(); return; }
      const byFile = new Map(); let matches = 0, truncated = false;
      for (const line of r.stdout.split("\n")) {
        if (!line.startsWith('{"type":"match"')) continue;
        if (matches >= MAX_MATCHES) { truncated = true; break; }
        let m; try { m = JSON.parse(line).data; } catch { continue; }
        const path = m.path?.text?.replace(/^\.\//, ""), text = m.lines?.text;
        if (!path || text == null) continue;
        if (!byFile.has(path)) byFile.set(path, { path, lines: [] });
        const clean = text.replace(/\r?\n$/, "");
        const hits = (clean.match(new RegExp(re.source, re.flags)) ?? []).length || 1;
        byFile.get(path).lines.push({ n: m.line_number, text: clean, hits, sel: true });
        matches += hits;
      }
      this.results = [...byFile.values()].sort((a, b) => a.path.localeCompare(b.path));
      this.re = re; this.lastQuery = { q, o };
      this.info = { files: this.results.length, matches, truncated, ms: Date.now() - started };
      cx.notify();
    });
  }

  segments(text, re, repl) {
    // Returns [{t, kind: "plain"|"hit"|"new"}] for one result line, trimmed and windowed.
    const lead = text.length - text.trimStart().length;
    let s = text.slice(lead), offset = 0;
    const r = new RegExp(re.source, re.flags), out = [];
    const first = s.search(new RegExp(re.source, re.flags.replace("g", "")));
    if (first > 60) { offset = first - 30; s = "…" + s.slice(offset); }
    if (s.length > 260) s = s.slice(0, 260) + "…";
    let last = 0, m, guard = 0;
    r.lastIndex = 0;
    while ((m = r.exec(s)) && guard++ < 50) {
      if (m[0] === "") { r.lastIndex++; continue; }
      if (m.index > last) out.push({ t: s.slice(last, m.index), kind: "plain" });
      out.push({ t: m[0], kind: "hit" });
      if (repl != null) out.push({ t: m[0].replace(new RegExp(re.source, re.flags.replace("g", "")), repl), kind: "new" });
      last = m.index + m[0].length;
    }
    if (last < s.length) out.push({ t: s.slice(last), kind: "plain" });
    return out;
  }

  replacement() {
    const v = this.r.value();
    return this.lastQuery?.o.regex ? v.replace(/\\n/g, "\n").replace(/\\t/g, "\t") : v.replace(/\$/g, "$$$$");
  }

  replaceAll(cx) {
    if (this.busy || !this.re || this.remote) return;
    const re = this.re, repl = this.replacement(), files = this.results.filter(f => f.lines.some(l => l.sel));
    this.busy = true; this.status = { text: "Replacing…" }; cx.notify();
    cx.spawn(async cx => {
      const undo = [], skipped = []; let count = 0, changedFiles = 0;
      for (const f of files) {
        const abs = this.abs(f.path);
        if (this.file?.path === f.path && this.file.dirty) { skipped.push(`${f.path} (unsaved in preview)`); continue; }
        try {
          const before = await readTextFile(abs);
          if (before == null) { skipped.push(`${f.path} (gone)`); continue; }
          const lines = before.split("\n");
          let stale = false, n = 0;
          for (const l of f.lines) {
            if (!l.sel) continue;
            const cur = lines[l.n - 1];
            if (cur == null || cur.replace(/\r$/, "") !== l.text) { stale = true; break; }
            const cr = cur.endsWith("\r") ? "\r" : "";
            const body = cr ? cur.slice(0, -1) : cur;
            n += (body.match(new RegExp(re.source, re.flags)) ?? []).length;
            lines[l.n - 1] = body.replace(new RegExp(re.source, re.flags), repl) + cr;
          }
          if (stale) { skipped.push(`${f.path} (changed since search)`); continue; }
          const after = lines.join("\n");
          if (after === before) continue;
          await writeTextFile(abs, after, before);
          undo.push({ abs, path: f.path, before, after }); count += n; changedFiles++;
        } catch (e) { skipped.push(`${f.path} (${String(e).slice(0, 80)})`); }
      }
      this.undo = undo.length ? undo : this.undo;
      this.busy = false;
      this.status = { text: `Replaced ${count} occurrence${count === 1 ? "" : "s"} in ${changedFiles} file${changedFiles === 1 ? "" : "s"}` + (skipped.length ? ` · skipped ${skipped.length}` : ""), detail: skipped, undo: undo.length > 0 };
      if (this.file && undo.some(u => u.path === this.file.path)) this.open(this.file.path, null, cx);
      this.search(cx);
      cx.notify();
    });
  }

  undoReplace(cx) {
    const undo = this.undo; if (!undo || this.busy) return;
    this.busy = true; cx.notify();
    cx.spawn(async cx => {
      let ok = 0; const failed = [];
      for (const u of undo) {
        try { await writeTextFile(u.abs, u.before, u.after); ok++; } catch { failed.push(`${u.path} (changed after replace)`); }
      }
      this.undo = null; this.busy = false;
      this.status = { text: `Restored ${ok} file${ok === 1 ? "" : "s"}` + (failed.length ? ` · ${failed.length} not restored` : ""), detail: failed };
      if (this.file && undo.some(u => u.path === this.file.path)) this.open(this.file.path, null, cx);
      this.search(cx);
      cx.notify();
    });
  }

  // ── go to file ──────────────────────────────────────────────────────────
  loadFiles(cx) {
    if (this.allFiles || this.loadingFiles || !this.root || checking()) return;
    this.loadingFiles = true;
    cx.spawn(async cx => {
      try {
        const r = await exec("rg", ["--files", "--hidden", "-g", "!.git"], { cwd: this.root, on: this.on, timeout: 20000 });
        this.allFiles = r.stdout.split("\n").filter(Boolean).slice(0, MAX_FILES_LIST).sort();
      } catch (e) { this.allFiles = []; this.status = { text: `Cannot list files: ${e}` }; }
      this.loadingFiles = false; cx.notify();
    });
  }

  gotoMatches() {
    if (!this.allFiles) return [];
    const q = this.goto.toLowerCase().replace(/\s+/g, "");
    if (!q) return this.allFiles.slice(0, 100);
    const scored = [];
    for (const f of this.allFiles) { const s = fuzzy(q, f); if (s != null) scored.push([s, f]); }
    return scored.sort((a, b) => a[0] - b[0]).slice(0, 100).map(x => x[1]);
  }

  // ── file preview / editor ───────────────────────────────────────────────
  open(path, line, cx, { focus = true } = {}) {
    if (this.file?.dirty && this.file.path !== path) { this.status = { text: `Save or revert ${this.file.path} first` }; cx.notify(); return; }
    const token = {};
    this.openToken = token;
    cx.spawn(async cx => {
      let text;
      try { text = await readTextFile(this.abs(path), { on: this.on }); }
      catch { text = undefined; }
      if (this.openToken !== token) return;
      if (text == null || text.includes("\0")) { this.status = { text: text === undefined ? `${path}: too large (>1 MiB) or unreadable` : text === null ? `${path}: no longer exists` : `${path}: binary file` }; cx.notify(); return; }
      this.file?.state?.release();
      const t = theme(), ext = path.includes(".") ? path.split(".").pop() : "txt";
      const state = EditorState.new({ language: LANG[ext] ?? ext, value: text, readonly: this.remote,
        font_family: settings().font_family, font_size: 12.5,
        syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } });
      const file = { path, original: text, state, dirty: false };
      state.on("change", (_e, cx) => { const d = state.value() !== file.original; if (d !== file.dirty) { file.dirty = d; cx.notify(); } else if (this.tab === "dedupe") cx.notify(); });
      this.file = file; this.userSel = null; this.programSel = null; this.revealing = false;
      state.on("blur", (_e, cx) => { this.editing = false; this.syncSel(); cx.notify(); });
      state.on("focus", (_e, cx) => { this.editing = true; cx.notify(); });
      cx.notify();
      if (line) this.reveal(line, cx, { fresh: true, focus });
      else if (focus) cx.timer.after(60, () => { if (this.file === file) state.focus(); });
    });
  }

  // Selects the match on `line` (or the whole line) with the line centred, and focuses the editor
  // so the selection shows. The editor only scrolls just enough to show the cursor, so: jump to the
  // top, then to half a screen below the target (target lands mid-view), then select the match.
  reveal(line, cx, { fresh = false, match = true, focus = true } = {}) {
    const file = this.file; if (!file) return;
    const state = file.state, text = state.value(), lines = text.split("\n");
    line = Math.max(1, Math.min(line, lines.length));
    const startOf = n => { let o = 0; for (let i = 0; i < n - 1; i++) o += lines[i].length + 1; return o; };
    const body = (lines[line - 1] ?? "").replace(/\r$/, ""), lineStart = startOf(line);
    const rangeNow = () => {
      if (match && this.re) {
        const m = new RegExp(this.re.source, this.re.flags.replace("g", "")).exec(body);
        if (m && m[0]) return { start: lineStart + m.index, end: lineStart + m.index + m[0].length };
      }
      return { start: lineStart, end: lineStart + body.length };
    };
    const half = Math.max(3, Math.floor((this.editorHeight ?? 400) / 20 / 2));
    const below = Math.min(lines.length, line + half);
    this.revealing = true;
    const at = o => state.set_selected_range({ start: o, end: Math.min(text.length, o + 1) }); // empty ranges don't scroll
    const finish = cx => {
      if (this.file !== file) { this.revealing = false; return; }
      const range = rangeNow();
      state.set_selected_range(range);
      // Focus a moment later: focusing in the same tick leaves the selection hidden.
      cx.timer.after(50, cx => {
        this.revealing = false;
        if (this.file !== file) return;
        if (focus) state.focus();
        state.set_selected_range(range); this.programSel = range; cx.notify();
      });
    };
    // A freshly opened file's editor needs a frame or two of layout before it can scroll.
    at(0);
    cx.timer.after(fresh ? 120 : 32, cx => {
      if (this.file !== file) return;
      at(startOf(below));
      cx.timer.after(32, cx => { finish(cx); cx.notify(); });
      cx.notify();
    });
    cx.notify();
  }

  save(cx, then) {
    const f = this.file; if (!f || !f.dirty || this.remote) return;
    const text = f.state.value();
    cx.spawn(async cx => {
      try {
        await writeTextFile(this.abs(f.path), text, f.original); f.original = text; f.dirty = f.state.value() !== text; this.status = { text: `Saved ${f.path}` };
        if (then) then();
        else if (this.fmt.onSave && this.fmt.det) this.runFormat(cx, { files: [f.path] }, res => { this.status = { text: `Saved ${f.path}${res.changed.includes(f.path) ? " · formatted" : ""}` }; });
      }
      catch { this.status = { text: `${f.path} changed on disk since it was opened — Revert to reload (your edits will be lost)` }; }
      cx.notify();
    });
  }

  revert(cx) { const f = this.file; if (!f) return; f.dirty = false; this.open(f.path, null, cx); }
  closeFile(cx) { if (this.file?.dirty) { this.status = { text: "Unsaved changes — Save or Revert first" }; cx.notify(); return; } this.file?.state?.release(); this.file = null; cx.notify(); }

  // ── format ──────────────────────────────────────────────────────────────
  detectFormatters(cx) {
    if (this.fmt.det || this.fmt.detecting || !this.root || checking()) return;
    this.fmt.detecting = true;
    const root = this.root;
    cx.spawn(async cx => {
      try {
        const det = await detect(root, this.on);
        if (root !== this.root) return;
        this.fmt.det = det;
        this.fmt.chosen = det.recipes[0]?.id ?? null;
        this.fmt.onSave = det.formatOnSave;
        // Lint fixes on by default when the team's own setup applies them.
        this.fmt.fixes = det.recipes[0] ? det.recipes[0].rules.some(r => r.steps.some(s => s.kind === "fix")) : true;
      } catch (e) { this.fmt.det = { recipes: [], notes: [`Detection failed: ${e}`], env: {} }; }
      finally { this.fmt.detecting = false; cx.notify(); }
    });
  }

  recipe() { return this.fmt.det?.recipes.find(r => r.id === this.fmt.chosen) ?? null; }

  async changedFiles() {
    const r = await exec("git", ["--no-optional-locks", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd: this.root, on: this.on });
    if (r.code !== 0) throw new Error(r.stderr || "not a git repository");
    return r.stdout.split("\0").filter(Boolean).filter(e => !e.slice(0, 2).includes("D")).map(e => e.slice(3));
  }

  // scope: "file" | "changed" | "repo" | {files:[...]} (format on save)
  runFormat(cx, scope = this.fmt.scope, after) {
    const f = this.fmt, det = f.det;
    if (!det || f.running) return;
    if (scope === "file" && !this.file) { f.result = { error: "Open a file first (Search or Files)." }; cx.notify(); return; }
    if (scope === "file" && this.file.dirty) { this.save(cx, () => this.runFormat(cx, "file")); return; }
    f.running = true; f.result = null; f.progress = "Collecting files…"; cx.notify();
    const root = this.root;
    cx.spawn(async cx => {
      try {
        let files;
        if (scope?.files) files = scope.files;
        else if (scope === "file") files = [this.file.path];
        else if (scope === "changed") files = await this.changedFiles();
        else files = (await exec("rg", ["--files"], { cwd: root, on: this.on, timeout: 30000 })).stdout.split("\n").filter(Boolean);
        if (!files.length) { f.result = { error: scope === "changed" ? "No changed files." : "No files." }; return; }
        const res = await runPipeline({ det, recipe: this.recipe(), files, fixes: f.fixes, builtins: f.builtins,
          onProgress: text => { f.progress = text; cx.notify(); } });
        if (root !== this.root) return;
        f.result = { ...res, total: files.length };
        f.undo = res.undo.length ? res.undo : null;
        if (this.file && !this.file.dirty && files.includes(this.file.path)) this.open(this.file.path, null, cx);
        after?.(res);
      } catch (e) { f.result = { error: String(e) }; }
      finally { f.running = false; f.progress = null; cx.notify(); }
    });
  }

  runScript(cx) {
    const s = this.fmt.det?.script; if (!s || this.fmt.running) return;
    this.fmt.running = true; this.fmt.progress = `${s.run.join(" ")}`; this.fmt.result = null; cx.notify();
    cx.spawn(async cx => {
      try {
        const r = await exec(s.run[0], s.run.slice(1), { cwd: this.root, on: this.on, timeout: 600000 });
        this.fmt.result = { steps: [{ label: s.run.join(" "), kind: "format", ok: r.code === 0, files: 0, output: `${r.stdout}\n${r.stderr}`.trim() }], changed: [], counted: false, script: true };
        if (this.file && !this.file.dirty) this.open(this.file.path, null, cx);
      } catch (e) { this.fmt.result = { error: String(e) }; }
      finally { this.fmt.running = false; this.fmt.progress = null; cx.notify(); }
    });
  }

  undoFormat(cx) {
    const undo = this.fmt.undo; if (!undo) return;
    cx.spawn(async cx => {
      let ok = 0; const failed = [];
      for (const u of undo) { try { await writeTextFile(u.abs, u.before, u.after); ok++; } catch { failed.push(u.path); } }
      this.fmt.undo = null;
      this.fmt.result = { error: `Restored ${ok} file${ok === 1 ? "" : "s"}${failed.length ? ` · ${failed.length} changed since, not restored: ${failed.slice(0, 5).join(", ")}` : ""}` };
      if (this.file && !this.file.dirty) this.open(this.file.path, null, cx);
      cx.notify();
    });
  }

  // ── dedupe ──────────────────────────────────────────────────────────────
  // The Duplicates scope: the person's own selection, when it spans 2+ lines. Selections the mod
  // makes (search-result highlight, jumping to a line) are ignored and leave the scope as it was.
  syncSel() {
    const f = this.file; if (!f || this.revealing) return false;
    const r = f.state.selected_range();
    if (this.programSel && r.start === this.programSel.start && r.end === this.programSel.end) return false;
    const text = f.state.value(), multi = r.end > r.start && text.slice(r.start, r.end).replace(/\n$/, "").includes("\n");
    const next = multi ? { start: r.start, end: r.end } : null;
    this.programSel = null;
    if (JSON.stringify(next) === JSON.stringify(this.userSel ?? null)) return false;
    this.userSel = next; return true;
  }

  clearScope(cx) {
    if (this.file) this.programSel = this.file.state.selected_range();
    this.userSel = null; cx.notify();
  }

  dedupePlan() {
    const f = this.file; if (!f) return null;
    this.syncSel();
    const text = f.state.value(), sel = this.userSel ?? { start: 0, end: 0 }, o = this.dd;
    const memo = `${o.trim}${o.keepBlank}${o.adjacent}${sel.start}:${sel.end}`;
    if (this.ddMemo && this.ddMemo.text === text && this.ddMemo.key === memo) return this.ddMemo.plan;
    const lines = text.split("\n");
    let from = 0, to = lines.length - 1, scoped = false;
    if (sel.end > sel.start) {
      const before = text.slice(0, sel.start), upto = text.slice(0, sel.end);
      from = before.split("\n").length - 1; to = upto.split("\n").length - 1;
      if (upto.endsWith("\n") && to > from) to--;
      scoped = true;
    }
    const seen = new Set(), keep = [], removed = [];
    let prev = null;
    lines.forEach((line, i) => {
      if (i < from || i > to) { keep.push(line); return; }
      const raw = line.replace(/\r$/, ""), k = o.trim ? raw.trim() : raw;
      if (o.keepBlank && k.trim() === "") { keep.push(line); prev = null; return; }
      const dup = o.adjacent ? prev === k : seen.has(k);
      if (dup) removed.push({ n: i + 1, text: raw }); else keep.push(line);
      seen.add(k); prev = k;
    });
    const plan = { removed, result: keep.join("\n"), scoped, from: from + 1, to: to + 1 };
    this.ddMemo = { text, key: memo, plan };
    return plan;
  }

  applyDedupe(cx) {
    const plan = this.dedupePlan(); if (!plan?.removed.length || this.remote) return;
    this.file.state.set_value(plan.result);
    this.file.dirty = plan.result !== this.file.original;
    this.status = { text: `Removed ${plan.removed.length} duplicate line${plan.removed.length === 1 ? "" : "s"} — review, then Save` };
    cx.notify();
  }

  // ── expanded view ───────────────────────────────────────────────────────
  // The side panel becomes a tab of its own (one per space, reused), like Git's. `workbench.tab`
  // remembers it and the tab it was opened from, so collapsing goes back there. What you were
  // doing (tool, query, options, open file) goes along both ways.
  snapshot() {
    return { tool: this.tab, query: this.q.value(), replace: this.showReplace ? this.r.value() : null, include: this.g.value(),
      opts: { ...this.opts }, file: this.file?.path ?? null, line: this.file ? this.activeLine ?? null : null };
  }

  applySnapshot(snap, cx) {
    if (!snap) return;
    this.tab = snap.tool ?? this.tab;
    this.q.set_value(snap.query ?? ""); this.g.set_value(snap.include ?? "");
    if (snap.replace != null) { this.r.set_value(snap.replace); this.showReplace = true; }
    this.opts = { ...this.opts, ...(snap.opts ?? {}) };
    this.search(cx);
    if (snap.file && !this.file?.dirty) { this.activeLine = snap.line; this.open(snap.file, snap.line, cx, { focus: false }); }
  }

  // A snapshot left for this copy (the panel after collapse, the reused tab after expand).
  takeHandoff(cx) {
    const key = this.expanded ? "workbench.toTab" : "workbench.toPanel", snap = shared(key);
    if (!snap) return;
    setShared(key, null);
    this.applySnapshot(snap, cx);
  }

  expand(cx) {
    if (this.expanded) return;
    if (this.file?.dirty) { this.status = { text: "Save or revert the open file before expanding" }; cx.notify(); return; }
    const space = spaces().find(s => s.active), origin = focused()?.tab, rec = shared("workbench.tab");
    if (!space || !this.root) return;
    const snap = this.snapshot();
    hidePanel("workbench");
    if (rec?.space === space.id && space.tabs.some(t => t.id === rec.tab)) {
      setShared("workbench.tab", { ...rec, origin });
      setShared("workbench.toTab", snap);
      run("tab.select", { id: rec.tab });
      run("workbench.focus");
      return;
    }
    const before = new Set(space.tabs.map(t => t.id));
    const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    run("tab.new", { mod: "workbench", name: `Find · ${this.root.split("/").pop()}`,
      props: { folder: this.root, machine: this.on, token, ...snap, tool: snap.tool } });
    cx.spawn(async cx => {
      let tab = null;
      for (let i = 0; i < 40 && !tab; i++) {
        tab = spaces().find(s => s.id === space.id)?.tabs.find(t => !before.has(t.id))?.id ?? null;
        if (!tab) await cx.sleep(50);
      }
      if (!tab) return;
      setShared("workbench.tab", { space: space.id, tab, origin });
      const alive = new Set(spaces().flatMap(s => s.tabs.map(t => t.id)));
      setShared("workbench.tabOf", { ...Object.fromEntries(Object.entries(shared("workbench.tabOf") ?? {}).filter(([, t]) => alive.has(t))), [token]: tab });
    });
  }

  collapse(cx) {
    if (!this.expanded) return;
    if (this.file?.dirty) { this.status = { text: "Save or revert the open file before collapsing" }; cx.notify(); return; }
    const rec = shared("workbench.tab"), space = spaces().find(s => s.active), tab = shared("workbench.tabOf")?.[this.token] ?? rec?.tab ?? focused()?.tab;
    setShared("workbench.toPanel", this.snapshot());
    revealPanel("workbench");
    if (rec?.origin && space?.tabs.some(t => t.id === rec.origin)) run("tab.select", { id: rec.origin });
    if (tab) run("tab.close", { id: tab, confirmed: true });
    setShared("workbench.tab", null);
    setShared("workbench.hasKeys", false);
    run("workbench.focus");
  }

  // Coming back to the expanded tab (tab.select, a click on its tab) shows the pane as focused, but
  // only pane.go hands a mod its "focus": take the keyboard when this pane becomes the focused one.
  refocus(cx) {
    const mine = shared("workbench.tabOf")?.[this.token];
    const pane = panes().find(p => p.mod === "workbench" && p.tab === mine);
    const active = Boolean(pane) && focused()?.pane === pane.pane;
    if (active && !this.wasActive) { this.takeHandoff(cx); if (!this.keyboard() && !this.menu) { this.handle.focus(); cx.notify(); } }
    this.wasActive = active;
  }

  // Whether this copy last had the keyboard (or is the only one around).
  mine() { const o = shared("workbench.owner"); return !o || o === this.copyId; }

  // A closed copy can't report losing the keyboard any more.
  close() { if (this.sharedKeys) setShared("workbench.hasKeys", false); }

  // ── keyboard ────────────────────────────────────────────────────────────
  keyboard() { return this.handle.is_focused() || Boolean(this.typing || this.editing || this.menu); }

  // Leaving: left goes straight back to the terminal (pane.go doesn't reliably leave a panel).
  go(dir) {
    this.focusToken = (this.focusToken ?? 0) + 1;
    const pane = focused()?.pane;
    if (dir === "left" && pane) return run("pane.focus", { pane });
    this.handle.focus();
    run("pane.go", { direction: dir });
  }

  setTool(id, cx) {
    this.tab = id;
    if (id === "goto") this.loadFiles(cx);
    if (id === "format") this.detectFormatters(cx);
    this.handle.focus();
    cx.notify();
  }

  // The search box's Enter / ↓: results now, keyboard on the list.
  toList(cx) {
    if (this.q.value() !== this.lastQuery?.q || JSON.stringify(this.opts) !== JSON.stringify(this.lastQuery?.o)) this.search(cx);
    this.sel.search = Math.max(0, this.searchItems().findIndex(i => i.l));
    this.handle.focus();
    cx.notify();
  }

  // The search results as the rows drawn: file headers, and their lines unless folded.
  searchItems() {
    const out = [];
    for (const f of this.results) {
      if (out.length >= MAX_ROWS) break;
      out.push({ f });
      if (!this.collapsed.has(f.path)) for (const l of f.lines) { if (out.length >= MAX_ROWS) break; out.push({ f, l }); }
    }
    return out;
  }

  listLen() {
    return this.tab === "search" ? this.searchItems().length : this.tab === "goto" ? this.gotoMatches().length
      : this.tab === "dedupe" ? Math.min(300, this.dedupePlan()?.removed.length ?? 0) : 0;
  }

  move(to) {
    const n = this.listLen(); if (!n) return;
    this.sel[this.tab] = Math.max(0, Math.min(n - 1, to));
    this.scroll[this.tab]?.scroll_to_item(this.sel[this.tab]);
  }

  // Opens (focus: into the editor) or peeks at the selected row.
  activate(cx, focus) {
    const i = this.sel[this.tab];
    if (this.tab === "search") {
      const it = this.searchItems()[i]; if (!it) return;
      if (!it.l) { this.collapsed.has(it.f.path) ? this.collapsed.delete(it.f.path) : this.collapsed.add(it.f.path); return; }
      this.activeLine = it.l.n;
      if (this.file?.path === it.f.path) this.reveal(it.l.n, cx, { focus }); else this.open(it.f.path, it.l.n, cx, { focus });
    } else if (this.tab === "goto") {
      const p = this.gotoMatches()[i]; if (p) this.open(p, null, cx, { focus });
    } else if (this.tab === "dedupe") {
      const r = this.dedupePlan()?.removed[i]; if (r) this.reveal(r.n, cx, { match: false, focus });
    }
  }

  // cmd-alt-arrows (keys.json pane.go) leave from here, so leaving never depends on pane.go.
  navKey(e, cx) {
    const m = e.modifiers ?? {};
    if (!(m.platform && m.alt && !m.control && ["left", "right", "up", "down"].includes(e.key))) return false;
    cx.stop_propagation(); this.go(e.key); return true;
  }

  key(e, cx) {
    if (this.navKey(e, cx)) return;
    const k = keyOf(e);
    if (k === "cmd-s") { this.save(cx); cx.stop_propagation(); return; }
    if (k === "cmd-shift-f") { this.tab = "search"; this.q.focus(); cx.stop_propagation(); cx.notify(); return; }
    if (k === "cmd-p") { this.tab = "goto"; this.o.focus(); this.loadFiles(cx); cx.stop_propagation(); cx.notify(); return; }
    // In the file view: Esc goes back to the list; everything else is the editor's.
    if (this.editing) { if (k === "escape") { this.handle.focus(); cx.stop_propagation(); cx.notify(); } return; }
    // In a text box: Esc stops typing; ↓ moves to the results; ↑↓ ctrl-n/p move the file list.
    if (this.typing) {
      if (k === "escape") { this.handle.focus(); cx.stop_propagation(); cx.notify(); return; }
      if (this.typing === "o" && ["down", "up", "ctrl-n", "ctrl-p"].includes(k)) { this.move(this.sel.goto + (k === "down" || k === "ctrl-n" ? 1 : -1)); cx.stop_propagation(); cx.notify(); return; }
      if (this.typing === "q" && k === "down") { this.toList(cx); cx.stop_propagation(); return; }
      return;
    }
    if (this.press(k, cx)) cx.stop_propagation();
  }

  // Real keys and "workbench.key:<k>" commands both come through here.
  press(k, cx) {
    if (this.keysOpen) { if (["escape", "?", "q"].includes(k)) this.keysOpen = false; cx.notify(); return true; }
    if (this.menu) {
      if (k === "y" || k === "enter") { const m = this.menu; this.menu = null; m.run(cx); }
      else if (k === "n" || k === "escape" || k === "q") this.menu = null;
      cx.notify(); return true;
    }
    const half = Math.max(5, Math.floor((this.size.height - 200) / 24 / 2));
    const sel = this.sel[this.tab] ?? 0;
    switch (k) {
      case "?": this.keysOpen = true; break;
      case "q": if (this.expanded) this.collapse(cx); else closePanel("workbench"); return true;
      case "E": this.expanded ? this.collapse(cx) : this.expand(cx); return true;
      case "escape": this.go("left"); return true;
      case "1": case "2": case "3": case "4": this.setTool(TOOLS[Number(k) - 1], cx); break;
      case "tab": case "shift-tab": case "]": case "[": this.setTool(TOOLS[(TOOLS.indexOf(this.tab) + (k === "tab" || k === "]" ? 1 : 3)) % 4], cx); break;
      case "/": if (this.tab === "goto") this.o.focus(); else { this.tab = "search"; this.q.focus(); } break;
      case "e": if (this.file) this.file.state.focus(); break;
      default: {
        const listy = this.tab !== "format";
        if (listy && (k === "j" || k === "down")) this.move(sel + 1);
        else if (listy && (k === "k" || k === "up")) this.move(sel - 1);
        else if (listy && k === "g") this.move(0);
        else if (listy && k === "G") this.move(this.listLen() - 1);
        else if (listy && k === "ctrl-d") this.move(sel + half);
        else if (listy && k === "ctrl-u") this.move(sel - half);
        else if (listy && k === "enter") this.activate(cx, true);
        else if (listy && k === "space") this.activate(cx, false);
        else if (this.tab === "search") { if (!this.searchKey(k, cx)) return false; }
        else if (this.tab === "goto") { if (k === "l" || k === "right") this.activate(cx, true); else return false; }
        else if (this.tab === "format") { if (!this.formatKey(k, cx)) return false; }
        else if (this.tab === "dedupe") { if (!this.dedupeKey(k, cx)) return false; }
        else return false;
      }
    }
    cx.notify();
    return true;
  }

  searchKey(k, cx) {
    const it = this.searchItems()[this.sel.search];
    const toHeader = () => { const at = this.searchItems().findIndex(x => !x.l && x.f === it.f); if (at >= 0) this.move(at); };
    switch (k) {
      case "l": case "right": if (it && !it.l && this.collapsed.has(it.f.path)) this.collapsed.delete(it.f.path); else if (it?.l) this.activate(cx, true); return true;
      case "h": case "left": if (it) { this.collapsed.add(it.f.path); toHeader(); } return true;
      case "z": if (this.collapsed.size) this.collapsed.clear(); else this.results.forEach(f => this.collapsed.add(f.path)); this.move(0); return true;
      case "r": this.showReplace = true; this.r.focus(); return true;
      case "f": this.g.focus(); return true;
      case "x": if (it) { if (it.l) it.l.sel = !it.l.sel; else { const all = it.f.lines.every(l => l.sel); it.f.lines.forEach(l => (l.sel = !all)); } this.showReplace = true; } return true;
      case "c": this.opts.case = !this.opts.case; this.search(cx); return true;
      case "w": this.opts.word = !this.opts.word; this.search(cx); return true;
      case ".": this.opts.regex = !this.opts.regex; this.search(cx); return true;
      case "u": if (this.undo) this.undoReplace(cx); return true;
      case "R": {
        if (!this.showReplace) { this.showReplace = true; this.r.focus(); return true; }
        const n = this.results.reduce((a, f) => a + f.lines.filter(l => l.sel).reduce((m, l) => m + l.hits, 0), 0);
        const files = this.results.filter(f => f.lines.some(l => l.sel)).length;
        if (n && !this.remote) this.menu = { title: `Replace ${n} occurrence${n === 1 ? "" : "s"} in ${files} file${files === 1 ? "" : "s"} with “${this.r.value()}”?`, run: cx => this.replaceAll(cx) };
        return true;
      }
    }
    return false;
  }

  formatKey(k, cx) {
    const f = this.fmt, recipes = f.det?.recipes ?? [];
    switch (k) {
      case "f": this.runFormat(cx); return true;
      case "s": { const s = ["file", "changed", "repo"]; f.scope = s[(s.indexOf(f.scope) + 1) % 3]; return true; }
      case "{": case "}": if (recipes.length) { const i = recipes.findIndex(r => r.id === f.chosen); f.chosen = recipes[(i + (k === "}" ? 1 : recipes.length - 1)) % recipes.length].id; } return true;
      case "x": f.fixes = !f.fixes; return true;
      case "o": f.onSave = !f.onSave; return true;
      case "b": f.builtins = !f.builtins; return true;
      case "p": this.runScript(cx); return true;
      case "u": this.undoFormat(cx); return true;
      case "R": f.det = null; this.detectFormatters(cx); return true;
    }
    return false;
  }

  dedupeKey(k, cx) {
    const o = this.dd;
    switch (k) {
      case "d": this.applyDedupe(cx); return true;
      case "t": o.trim = !o.trim; return true;
      case "b": o.keepBlank = !o.keepBlank; return true;
      case "a": o.adjacent = !o.adjacent; return true;
      case "W": this.clearScope(cx); return true;
      case "l": case "right": this.activate(cx, true); return true;
    }
    return false;
  }

  // The footer's keycaps for what has the keyboard now.
  chips() {
    if (this.menu) return KEYS.menu;
    if (this.editing) return KEYS.editor;
    if (this.typing) return this.typing === "o" ? KEYS.typingGoto : KEYS.typing;
    return KEYS[this.tab] ?? KEYS.everywhere;
  }

  menuView(t) {
    const m = this.menu;
    return div().id("wb-menu-scrim").absolute().inset_0().bg("#00000055").flex().items_center().justify_center().p(16)
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.menu = null; cx.notify(); })
      .child(v_flex().id("wb-menu").w_full().max_w(340).p(12).gap(10).rounded(10).border_1().border_color(t.border).bg(t.popover).shadow_lg()
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(div().text_size(12.5).child(m.title))
        .child(h_flex().gap(8).justify_end()
          .child(this.btn("wb-menu-no", "Cancel  n", cx => { this.menu = null; cx.notify(); }, t))
          .child(this.btn("wb-menu-yes", "Replace  y", cx => { this.menu = null; m.run(cx); cx.notify(); }, t, { primary: true }))));
  }

  // A list row's look when it's the keyboard's row.
  rowSel(el, on, t) {
    if (!on) return el;
    const list = this.handle.is_focused();
    return el.bg(list ? t.selected : t.hover).border_l_2().border_color(list ? t.accent : t.border);
  }


  // ── ui pieces ───────────────────────────────────────────────────────────
  btn(id, label, onClick, t, { primary = false, disabled = false, active = false, title } = {}) {
    return div().id(id).flex_none().h(26).px(10).flex().items_center().rounded(6).text_size(12)
      .border_1().border_color(primary ? t.solid : active ? t.accent : t.border)
      .bg(disabled ? t.surface : primary ? t.solid : active ? t.selected : t.surface)
      .when(disabled, el => el.border_color(t.border))
      .text_color(disabled ? t.dim : primary ? t.solid_foreground : active ? t.foreground : t.muted)
      .when(!disabled, el => el.cursor_pointer().hover(s => s.bg(primary ? t.solid : t.hover).text_color(primary ? t.solid_foreground : t.foreground)).on_click((_e, cx) => onClick(cx)))
      .child(title ?? label);
  }

  toggle(id, label, on, onClick, t) {
    return div().id(id).flex_none().h(24).min_w(26).px(6).flex().items_center().justify_center().rounded(5).text_size(11.5).font_semibold()
      .when(on, el => el.bg(t.accent)).text_color(on ? t.accent_foreground : t.muted).cursor_pointer()
      .hover(s => s.bg(on ? t.accent : t.hover)).on_click((_e, cx) => onClick(cx)).child(label);
  }

  check(id, on, onClick, t) {
    const box = div().id(id).flex_none().size(14).rounded(3).border_1().border_color(on ? t.accent : t.input ?? t.border).bg(on ? t.accent : t.background)
      .flex().items_center().justify_center().text_size(10).text_color(t.accent_foreground).child(on ? "✓" : "");
    return onClick ? box.cursor_pointer().on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => onClick(cx)) : box;
  }

  field(state, t, id) {
    const on = this.typing && this[this.typing] === state;
    return div().id(id).flex_1().min_w(0).h(30).px(8).flex().items_center().rounded(7).border_1().border_color(on ? t.accent : t.input ?? t.border).bg(t.background).cursor_text()
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(Input.new(state).w_full().text_size(12.5).text_color(t.foreground));
  }

  option(id, label, on, onClick, t) {
    return h_flex().id(id).gap(6).items_center().cursor_pointer().on_click((_e, cx) => onClick(cx))
      .child(this.check(`${id}-box`, on, null, t)).child(div().text_size(12).text_color(t.muted).child(label));
  }

  searchPanel(t) {
    const repl = this.showReplace ? this.replacement() : null;
    const showPreview = this.showReplace && this.re;
    const items = this.searchItems(), shown = items.length;
    const rows = items.map((it, idx) => {
      const f = it.f, keySel = idx === this.sel.search;
      if (!it.l) {
        const open = !this.collapsed.has(f.path), allSel = f.lines.every(l => l.sel), slash = f.path.lastIndexOf("/");
        return this.rowSel(h_flex().id(`f-${f.path}`).h(26).flex_none().px(6).gap(6).items_center().rounded(5).cursor_pointer().hover(s => s.bg(t.hover)), keySel, t)
          .on_click((_e, cx) => { this.sel.search = idx; open ? this.collapsed.add(f.path) : this.collapsed.delete(f.path); cx.notify(); })
          .child(div().w(10).text_size(10).text_color(t.dim).child(open ? "▾" : "▸"))
          .when(this.showReplace, el => el.child(this.check(`fc-${f.path}`, allSel, cx => { f.lines.forEach(l => (l.sel = !allSel)); cx.notify(); }, t)))
          .child(div().flex_none().text_size(12.5).font_medium().text_color(t.foreground).child(f.path.slice(slash + 1)))
          .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(slash > 0 ? f.path.slice(0, slash) : ""))
          .child(div().flex_none().px(6).rounded(8).bg(t.raised).text_size(10.5).text_color(t.muted).child(String(f.lines.reduce((n, l) => n + l.hits, 0))));
      }
      const l = it.l, active = this.file?.path === f.path && this.activeLine === l.n;
      return this.rowSel(h_flex().id(`l-${f.path}:${l.n}`).h(24).flex_none().pl(22).pr(6).gap(6).items_center().rounded(5).cursor_pointer()
        .when(active && !keySel, el => el.bg(t.hover)).hover(s => s.bg(t.hover)), keySel, t)
        .on_click((_e, cx) => { this.sel.search = idx; this.activeLine = l.n; if (this.file?.path === f.path) this.reveal(l.n, cx); else this.open(f.path, l.n, cx); })
        .when(this.showReplace, el => el.child(this.check(`lc-${f.path}:${l.n}`, l.sel, cx => { l.sel = !l.sel; cx.notify(); }, t)))
        .child(div().w(34).flex_none().text_right().text_size(10.5).text_color(active ? t.foreground : t.dim).child(String(l.n)))
        .child(h_flex().flex_1().min_w(0).overflow_hidden().whitespace_nowrap().text_size(12).font_family(settings().font_family)
          .children(this.segments(l.text, this.re, showPreview ? repl : null).map(s =>
            s.kind === "plain" ? div().flex_none().text_color(t.muted).child(NB(s.t))
            : s.kind === "hit" ? div().flex_none().rounded(2).text_color(t.foreground).bg(showPreview ? `${t.ansi1}40` : `${t.accent}55`).when(Boolean(showPreview), el => el.line_through()).child(NB(s.t))
            : div().flex_none().rounded(2).text_color(t.foreground).bg(`${t.ansi2}40`).child(NB(s.t)))));
    });
    const i = this.info, selCount = this.results.reduce((n, f) => n + f.lines.filter(l => l.sel).reduce((m, l) => m + l.hits, 0), 0);
    return v_flex().flex_1().min_h(0).gap(8)
      .child(h_flex().gap(6).items_center()
        .child(div().id("rep-toggle").w(18).flex_none().text_color(t.dim).cursor_pointer().hover(s => s.text_color(t.foreground))
          .on_click((_e, cx) => { this.showReplace = !this.showReplace; cx.notify(); }).child(this.showReplace ? "▾" : "▸"))
        .child(this.field(this.q, t, "q-field"))
        .child(this.toggle("opt-case", "Aa", this.opts.case, cx => { this.opts.case = !this.opts.case; this.search(cx); }, t))
        .child(this.toggle("opt-word", "ab", this.opts.word, cx => { this.opts.word = !this.opts.word; this.search(cx); }, t))
        .child(this.toggle("opt-regex", ".*", this.opts.regex, cx => { this.opts.regex = !this.opts.regex; this.search(cx); }, t)))
      .when(this.showReplace, el => el.child(h_flex().pl(24).gap(6).items_center()
        .child(this.field(this.r, t, "r-field"))
        .child(this.btn("replace-all", "Replace", cx => this.replaceAll(cx), t, { primary: true, disabled: !selCount || this.busy || this.remote, title: `Replace ${selCount || ""}`.trim() }))))
      .child(h_flex().pl(24).gap(6).items_center().child(this.field(this.g, t, "g-field")))
      .child(h_flex().pl(2).gap(8).items_center().text_size(11.5).text_color(i?.error ? t.blocked : t.dim)
        .child(div().flex_1().min_w(0).truncate().child(
          i?.error ? i.error : i?.searching ? "Searching…" : i ? `${i.matches} result${i.matches === 1 ? "" : "s"} in ${i.files} file${i.files === 1 ? "" : "s"}${i.truncated ? ` (first ${MAX_MATCHES})` : ""} · ${i.ms} ms` : this.remote ? "Remote space: search only, replace disabled" : "Type to search. Enter searches now."))
        .when(this.results.length > 0, el => el
          .child(div().id("expand-all").cursor_pointer().hover(s => s.text_color(t.foreground)).on_click((_e, cx) => { if (this.collapsed.size) this.collapsed.clear(); else this.results.forEach(f => this.collapsed.add(f.path)); cx.notify(); }).child(this.collapsed.size ? "Expand all" : "Collapse all"))))
      .child(v_flex().id("results").flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.scroll.search).children(rows)
        .when(shown >= MAX_ROWS, el => el.child(div().p(8).text_size(11).text_color(t.dim).child(`Showing the first ${MAX_ROWS} lines — narrow the search or include filter.`))));
  }

  gotoPanel(t) {
    const list = this.gotoMatches();
    return v_flex().flex_1().min_h(0).gap(8)
      .child(h_flex().gap(6).child(this.field(this.o, t, "o-field")))
      .child(div().text_size(11.5).text_color(t.dim).child(this.allFiles ? `${this.allFiles.length} files (respects .gitignore) · ↑↓ move · Enter opens` : "Listing files…"))
      .child(v_flex().id("goto-list").flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.scroll.goto).children(list.map((p, idx) => {
        const slash = p.lastIndexOf("/");
        return this.rowSel(h_flex().id(`g-${p}`).h(26).flex_none().px(8).gap(8).items_center().rounded(5).cursor_pointer()
          .when(this.file?.path === p && idx !== this.sel.goto, el => el.bg(t.hover)).hover(s => s.bg(t.hover)), idx === this.sel.goto, t)
          .on_click((_e, cx) => { this.sel.goto = idx; this.open(p, null, cx); })
          .child(div().flex_none().text_size(12.5).text_color(t.foreground).child(p.slice(slash + 1)))
          .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(slash > 0 ? p.slice(0, slash) : ""));
      })));
  }

  formatPanel(t) {
    const f = this.fmt, det = f.det, res = f.result, recipe = this.recipe();
    const mono = settings().font_family;
    const label = txt => div().text_size(11).font_semibold().text_color(t.dim).child(txt);
    if (!det) return v_flex().flex_1().gap(8).child(div().text_size(12).text_color(t.dim).child(f.detecting ? "Reading this repo's setup (commit hooks, .vscode, config files)…" : "No folder"));
    const fileRules = this.file ? rulesFor(recipe, this.file.path) : [];
    const kindColor = k => k === "fix" ? t.ansi3 : k === "format" ? t.ansi4 : t.dim;
    const step = (s, key) => h_flex().gap(6).items_center().min_w(0)
      .child(div().flex_none().px(5).rounded(4).text_size(10).bg(t.raised).text_color(kindColor(s.kind)).child(s.kind === "other" ? "skip" : s.kind))
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).font_family(mono).text_color(s.kind === "other" || (s.kind === "fix" && !f.fixes && !s.formatCmd) ? t.dim : t.foreground)
        .when(s.kind === "other" || (s.kind === "fix" && !f.fixes && !s.formatCmd), el => el.line_through())
        .child(s.kind === "fix" && !f.fixes && s.formatCmd ? s.formatCmd : s.cmd));
    const scopes = [["file", this.file ? `Open file · ${this.file.path.split("/").pop()}` : "Open file"], ["changed", "Changed files (git)"], ["repo", "Every file in the repo"]];

    return v_flex().id("fmt-panel").flex_1().min_h(0).gap(12).overflow_y_scrollbar()
      // Where the rules come from
      .child(v_flex().gap(6).child(label("HOW THIS REPO FORMATS"))
        .child(det.recipes.length === 0
          ? div().text_size(12).text_color(t.muted).child("No repo formatter found (no lint-staged/nano-staged, no .vscode formatter, no formatter config). Built-ins still apply.")
          : h_flex().flex_wrap().gap(6).children(det.recipes.map(r => this.btn(`rc-${r.id}`, r.label, cx => { f.chosen = r.id; cx.notify(); }, t, { active: f.chosen === r.id }))))
        .when(Boolean(recipe), el => el.child(div().text_size(11).text_color(t.dim).child(`From ${recipe.source}`)))
        .when(Boolean(recipe), el => el.child(v_flex().gap(6).p(8).rounded(7).bg(t.surface).border_1().border_color(t.border)
          .children(recipe.rules.map((r, i) => v_flex().gap(3)
            .child(div().text_size(11.5).font_family(mono).text_color(t.muted).truncate().child(r.label))
            .children(r.steps.map((s, j) => step(s, `${i}-${j}`)))))))
        .children(det.notes.map((n, i) => div().id(`note-${i}`).text_size(11).text_color(t.blocked).child(n))))
      // Always-available built-ins
      .child(v_flex().gap(6).child(label("ALWAYS ON"))
        .child(this.option("fo-builtin", "Built-in JSON formatting for files the repo doesn't cover", f.builtins, cx => { f.builtins = !f.builtins; cx.notify(); }, t))
        .child(div().text_size(11).text_color(t.dim).pl(20).child(det.hasEditorconfig ? ".editorconfig whitespace rules (trailing spaces, final newline) also apply to uncovered files." : "No .editorconfig in this repo.")))
      // Options
      .child(v_flex().gap(6).child(label("OPTIONS"))
        .child(this.option("fo-fix", "Apply lint fixes (eslint --fix, oxlint --fix, rubocop -a…)", f.fixes, cx => { f.fixes = !f.fixes; cx.notify(); }, t))
        .child(this.option("fo-save", `Format on save in the Workbench editor${det.formatOnSave ? " (on in .vscode)" : ""}`, f.onSave, cx => { f.onSave = !f.onSave; cx.notify(); }, t)))
      .when(Boolean(this.file), el => el.child(div().text_size(11.5).text_color(t.muted).child(
        fileRules.length ? `${this.file.path.split("/").pop()}: ${fileRules.flatMap(r => r.steps).filter(s => s.kind !== "other" && (f.fixes || s.kind === "format" || s.formatCmd)).map(s => (s.kind === "fix" && !f.fixes && s.formatCmd ? s.formatCmd : s.cmd).split(" ")[0]).join(" → ") || "nothing"}`
        : `${this.file.path.split("/").pop()}: no repo formatter — built-ins${det.hasEditorconfig ? " + .editorconfig" : ""} only`)))
      // Scope + run
      .child(v_flex().gap(6).child(label("WHAT"))
        .child(v_flex().gap(6).children(scopes.map(([id, l]) => this.option(`scope-${id}`, l, f.scope === id, cx => { f.scope = id; cx.notify(); }, t)))))
      .child(h_flex().gap(8).items_center().flex_wrap()
        .child(this.btn("fmt-run", "Format", cx => this.runFormat(cx), t, { primary: true, disabled: f.running, title: f.running ? "Formatting…" : "Format" }))
        .when(Boolean(det.script), el => el.child(this.btn("fmt-script", "script", cx => this.runScript(cx), t, { disabled: f.running, title: `Run ${det.script.run.join(" ")}` })))
        .when(Boolean(f.undo) && !f.running, el => el.child(this.btn("fmt-undo", "Undo format", cx => this.undoFormat(cx), t)))
        .child(div().id("fmt-redetect").text_size(11.5).text_color(t.dim).cursor_pointer().hover(s => s.text_color(t.foreground)).on_click((_e, cx) => { f.det = null; this.detectFormatters(cx); cx.notify(); }).child("Re-read setup")))
      .when(Boolean(f.progress), el => el.child(div().text_size(11.5).font_family(mono).text_color(t.muted).child(f.progress)))
      // Result
      .when(Boolean(res), el => el.child(v_flex().gap(6).p(8).rounded(7).bg(t.surface).border_1().border_color(t.border)
        .when(Boolean(res.error), el => el.child(div().text_size(12).text_color(t.muted).child(res.error)))
        .when(!res.error, el => el
          .child(div().text_size(12).font_semibold().text_color(res.steps.every(s => s.ok) ? t.ansi2 : t.blocked).child(
            res.script ? (res.steps[0].ok ? "Script finished" : "Script failed")
            : res.counted ? `Changed ${res.changed.length} of ${res.total} file${res.total === 1 ? "" : "s"}${res.steps.some(s => !s.ok) ? " · some steps reported problems" : ""}`
            : `Ran on ${res.total} files${res.steps.some(s => !s.ok) ? " · some steps reported problems" : ""} (too many to diff; check git)`))
          .children(res.changed.slice(0, 40).map(p => div().id(`ch-${p}`).text_size(11.5).font_family(mono).text_color(t.foreground).cursor_pointer().hover(s => s.text_color(t.accent)).truncate()
            .on_click((_e, cx) => this.open(p, null, cx)).child(p)))
          .children(res.steps.map((s, i) => {
            const open = f.open.has(i), lines = s.output ? s.output.split("\n") : [];
            return v_flex().gap(2)
              .child(h_flex().id(`st-${i}`).gap(6).items_center().cursor_pointer().on_click((_e, cx) => { open ? f.open.delete(i) : f.open.add(i); cx.notify(); })
                .child(div().w(12).text_size(11).text_color(s.ok ? t.ansi2 : t.blocked).child(s.ok ? "✓" : "!"))
                .child(div().flex_1().min_w(0).truncate().text_size(11.5).font_family(mono).text_color(t.muted).child(`${s.label}${s.files ? ` · ${s.files}` : ""}`))
                .when(lines.length > 0, el => el.child(div().text_size(10.5).text_color(t.dim).child(open ? "hide" : `${lines.length} lines`))))
              .when(open, el => el.children(lines.slice(-120).map((l, k) => div().id(`so-${i}-${k}`).pl(18).text_size(10.5).font_family(mono).text_color(t.dim).child(l || "\u00a0"))));
          })))));
  }

  dedupePanel(t) {
    const o = this.dd;
    if (!this.file) return v_flex().flex_1().gap(8).child(div().text_size(12.5).text_color(t.muted).child("Open a file first — from Search results or Go to file."))
      .child(div().text_size(11.5).text_color(t.dim).child("Select lines in the editor to dedupe only those; otherwise the whole file."));
    const plan = this.dedupePlan();
    return v_flex().flex_1().min_h(0).gap(10)
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().min_w(0).text_size(12).text_color(t.muted).child(plan.scoped ? `Selected lines ${plan.from}–${plan.to} of ${this.file.path.split("/").pop()}` : `Whole file: ${this.file.path.split("/").pop()} · select 2+ lines in the editor to limit`))
        .when(plan.scoped, el => el.child(this.btn("dd-whole", "Use whole file", cx => this.clearScope(cx), t))))
      .child(v_flex().gap(6)
        .child(this.option("dd-trim", "Ignore leading/trailing whitespace", o.trim, cx => { o.trim = !o.trim; cx.notify(); }, t))
        .child(this.option("dd-blank", "Keep blank lines", o.keepBlank, cx => { o.keepBlank = !o.keepBlank; cx.notify(); }, t))
        .child(this.option("dd-adj", "Only consecutive duplicates", o.adjacent, cx => { o.adjacent = !o.adjacent; cx.notify(); }, t)))
      .child(h_flex().gap(8).items_center()
        .child(this.btn("dd-apply", "Delete", cx => this.applyDedupe(cx), t, { primary: true, disabled: !plan.removed.length || this.remote, title: plan.removed.length ? `Delete ${plan.removed.length} duplicate line${plan.removed.length === 1 ? "" : "s"}` : "No duplicates" })))
      .child(v_flex().id("dd-list").flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.scroll.dedupe).children(plan.removed.slice(0, 300).map((r, idx) =>
        this.rowSel(h_flex().id(`dd-${r.n}`).h(22).flex_none().gap(8).px(4).items_center().rounded(4).cursor_pointer().hover(s => s.bg(t.hover)), idx === this.sel.dedupe, t)
          .on_click((_e, cx) => { this.sel.dedupe = idx; this.reveal(r.n, cx, { match: false }); })
          .child(div().w(38).flex_none().text_right().text_size(10.5).text_color(t.dim).child(String(r.n)))
          .child(div().flex_1().min_w(0).truncate().text_size(12).font_family(settings().font_family).text_color(t.ansi1).line_through().child(NB(r.text) || " ")))));
  }

  preview(t) {
    const f = this.file;
    if (!f) return v_flex().flex_1().min_h(0).items_center().justify_center().text_size(12).text_color(t.dim).child("Click a result to open the file here");
    return v_flex().flex_1().min_h(0).min_w(0)
      .child(h_flex().h(34).flex_none().px(10).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.foreground).child(f.path))
        .when(f.dirty, el => el.child(div().size(7).rounded(4).bg(t.accent)))
        .when(f.dirty && !this.remote, el => el.child(this.btn("f-revert", "Revert", cx => this.revert(cx), t)).child(this.btn("f-save", "Save  ⌘S", cx => this.save(cx), t, { primary: true })))
        .when(this.remote, el => el.child(div().text_size(11).text_color(t.dim).child("read-only (remote)")))
        .child(div().id("f-close").px(6).text_color(t.dim).cursor_pointer().hover(s => s.text_color(t.foreground)).on_click((_e, cx) => this.closeFile(cx)).child("✕")))
      .child(v_flex().id("editor-wrap").flex_1().min_h(0).on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_size_change((size, _cx) => { this.editorHeight = size.height; })
        .child(Editor.new(f.state).flex_1().min_h(0)));
  }

  render(cx) {
    // As a side panel it outlives space switches: follow the shown space's repo.
    const sid = spaces().find(s => s.active)?.id;
    if (!this.fixed && sid !== this.spaceId && !this.file?.dirty) {
      this.spaceId = sid; this.file?.state?.release(); this.file = null; this.undo = null; this.status = null;
      const loc = guessLocation();
      this.setRoot(loc, cx);
      // Focus can lag the space switch (still the old space's terminal): keep following briefly.
      this.followUntil = Date.now() + 1500; this.followCwd = loc.cwd;
    }
    const t = theme(), wide = this.size.width >= 700;
    const narrow = this.size.width < 560;
    const tabs = narrow ? [["search", "Search"], ["goto", "Files"], ["format", "Format"], ["dedupe", "Dupes"]] : [["search", "Search & Replace"], ["goto", "Go to file"], ["format", "Format"], ["dedupe", "Duplicates"]];
    const panel = this.tab === "search" ? this.searchPanel(t) : this.tab === "goto" ? this.gotoPanel(t) : this.tab === "format" ? this.formatPanel(t) : this.dedupePanel(t);
    const st = this.status;
    const tools = v_flex().p(10).gap(10).min_h(0).min_w(0)
      .when(wide, el => el.w(Math.min(560, Math.max(360, this.size.width * 0.42))).flex_none().h_full().border_r(1).border_color(t.border))
      .when(!wide, el => el.flex_1())
      .child(panel)
      .when(Boolean(st), el => el.child(v_flex().flex_none().gap(4).p(8).rounded(7).bg(t.raised)
        .child(h_flex().gap(8).items_center()
          .child(div().flex_1().min_w(0).text_size(12).text_color(t.foreground).child(st.text))
          .when(Boolean(st.undo && this.undo), el => el.child(this.btn("undo", "Undo replace", cx => this.undoReplace(cx), t)))
          .child(div().id("st-x").px(4).text_color(t.dim).cursor_pointer().on_click((_e, cx) => { this.status = null; cx.notify(); }).child("✕")))
        .children((st.detail ?? []).slice(0, 8).map((d, i) => div().id(`sd-${i}`).text_size(11).text_color(t.dim).truncate().child(d)))));

    return v_flex().id("workbench").relative().size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).text_color(t.foreground).text_size(13)
      .border_1().border_color(this.hadKeys ? t.accent : t.border)
      .track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .on_mouse_down("left", () => this.handle.focus())
      .on_size_change((size, cx) => { if (Math.abs(size.width - this.size.width) > 1 || Math.abs(size.height - this.size.height) > 1) { this.size = size; cx.notify(); } })
      .child(h_flex().h(40).flex_none().px(10).gap(4).items_center().border_b(1).border_color(t.border)
        .children(tabs.map(([id, label]) => div().id(`tab-${id}`).flex_none().h(26).px(narrow ? 7 : 10).flex().items_center().rounded(6).text_size(12.5).cursor_pointer()
          .when(this.tab === id, el => el.bg(t.selected)).text_color(this.tab === id ? t.foreground : t.muted).hover(s => s.bg(this.tab === id ? t.selected : t.hover))
          .on_click((_e, cx) => { this.setTool(id, cx); if (id === "search") this.q.focus(); if (id === "goto") this.o.focus(); }).child(label)))
        .child(div().flex_1())
        .children([this.selfUpdate.pill(t)].filter(Boolean))
        .child(div().id("root-chip").min_w(0).max_w(260).truncate().px(8).h(24).flex().items_center().rounded(6).bg(t.surface).text_size(11.5).text_color(t.dim).cursor_pointer()
          .hover(s => s.text_color(t.foreground).bg(t.hover))
          .on_click((_e, cx) => this.setRoot(guessLocation(), cx))
          .child(`${this.on ? `${this.on}: ` : ""}${this.root ? this.root.split("/").pop() : "no folder"}${this.fixed ? "" : "  ↻"}`))
        .child(div().id("wb-expand").flex_none().h(24).px(7).flex().items_center().rounded(6).text_size(13).text_color(t.dim).cursor_pointer()
          .hover(s => s.bg(t.hover).text_color(t.foreground)).tooltip(this.expanded ? "Back to the side panel (E)" : "Expand to a tab (E)")
          .on_click((_e, cx) => this.expanded ? this.collapse(cx) : this.expand(cx)).child(this.expanded ? "⤡" : "⤢")))
      .child((wide ? h_flex().items_start() : v_flex()).flex_1().min_h(0)
        .child(tools)
        .when(wide || Boolean(this.file), el => el.child(v_flex().flex_1().min_h(0).min_w(0).when(wide, el => el.h_full()).when(!wide, el => el.border_t(1).border_color(t.border)).child(this.preview(t)))))
      .child(keybar(t, { id: "workbench", chips: this.chips(), width: this.size.width, onKeys: cx => { this.keysOpen = true; this.handle.focus(); cx.notify(); } }))
      .when(Boolean(this.menu), el => el.child(this.menuView(t)))
      .when(this.keysOpen, el => el.child(keysCard(t, { id: "workbench", title: "Workbench: all keys", onClose: cx => { this.keysOpen = false; cx.notify(); }, groups: [
        { title: "Search & Replace", chips: KEYS.search }, { title: "Go to file", chips: KEYS.goto }, { title: "Format", chips: KEYS.format },
        { title: "Duplicates", chips: KEYS.dedupe }, { title: "In a text box", chips: [...KEYS.typing.slice(1), ...KEYS.typingGoto.slice(0, 1)] },
        { title: "In the file", chips: KEYS.editor }, { title: "Everywhere", chips: KEYS.everywhere }] })));
  }
}
