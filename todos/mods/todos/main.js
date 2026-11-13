// Todo pages as Markdown files (`# Title` + `- [ ] item` lines) in ~/.config/herdr-app/todos.
// Every change is written to disk at once; lines that aren't todos (your own notes) are kept.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { keybar, keysCard } from "./keybar.js";
import { exec, run, theme, settings, appHome, home, readTextFile, writeTextFile, watchFolder, nextCommand, setShared, focused } from "herdr";
import { SelfUpdate } from "./update.js";
import { closePanel } from "./panel.js";

const ICON = "mods/todos";
const ROW = 30, PAGE_ROW = 46;
const TODO = /^(\s*[-*] \[)([ xX])(\] ?)(.*)$/;
const q = s => `'${String(s).replace(/'/g, `'\\''`)}'`;

// A todo line with its box checked or not.
const mark = (line, done) => line.replace(TODO, (_m, a, _x, b, rest) => `${a}${done ? "x" : " "}${b}${rest}`);
// A todo's line in the file after a line was inserted at `inserted`.
const T2line = (td, inserted) => (td.line >= inserted ? td.line + 1 : td.line);

function keyOf(e) {
  const m = e.modifiers ?? {};
  if (e.key === "tab" && m.shift && !m.control && !m.platform && !m.alt) return "shift-tab";
  if (m.control || m.platform || m.alt) return e.keystroke;
  if (["enter", "escape", "tab", "space", "up", "down", "left", "right", "backspace"].includes(e.key)) return e.key;
  return e.key_char ?? e.key;
}

function parse(path, raw) {
  const lines = raw.replace(/\n$/, "").split("\n");
  const title = lines.find(l => l.startsWith("# "))?.slice(2).trim() || path.split("/").pop().replace(/\.md$/, "");
  const todos = [];
  lines.forEach((l, line) => {
    const m = l.match(TODO);
    if (m) todos.push({ line, done: m[2] !== " ", text: m[4], depth: Math.floor(m[1].replace(/\t/g, "    ").search(/\S/) / 2) });
  });
  const notes = lines.filter(l => l.trim() && !l.startsWith("# ") && !TODO.test(l)).length;
  return { path, raw, lines, title, todos, notes };
}

// Shows a window of fixed-height rows around the selection (a plain scroll area can't be scrolled from code).
// Like windowOf, for rows of different heights: keeps `sel` inside the window.
function windowVar(heights, sel, space, top) {
  const n = heights.length, fits = (a, b) => heights.slice(a, b + 1).reduce((x, h) => x + h, 0) <= space;
  top = Math.max(0, Math.min(top, n - 1));
  if (sel < top) top = sel;
  while (top < sel && !fits(top, sel)) top++;
  let end = top, used = 0;
  while (end < n && (end === top || used + heights[end] <= space)) used += heights[end++];
  return { start: top, end };
}

function windowOf(count, rowH, sel, space, top) {
  const fit = Math.max(1, Math.floor(space / rowH));
  top = Math.max(0, Math.min(top, count - fit));
  if (sel < top) top = sel;
  if (sel >= top + fit) top = sel - fit + 1;
  return { start: Math.max(0, top), end: Math.min(count, Math.max(0, top) + fit) };
}

const KEYS = {
  page: [
    { caps: ["space"], label: "toggle" }, { caps: ["a"], label: "add" }, { caps: ["A"], label: "sub-todo" },
    { caps: ["tab"], label: "nest" }, { caps: ["e"], label: "edit" }, { caps: ["d"], label: "delete" },
    { caps: ["h"], label: "back" }, { caps: ["shift-tab"], label: "un-nest" }, { caps: ["o"], label: "add below" },
    { caps: ["z"], label: "fold sub-todos" }, { caps: ["J", "K"], label: "reorder" },
    { caps: ["u"], label: "undo delete" }, { caps: ["C"], label: "clear done" },
    { caps: ["R"], label: "rename page" }, { caps: ["E"], label: "edit in nvim" },
  ],
  pages: [
    { caps: ["enter"], label: "open" }, { caps: ["n"], label: "new" }, { caps: ["R"], label: "rename" },
    { caps: ["D"], label: "delete" }, { caps: ["E"], label: "nvim" },
  ],
  everywhere: [{ caps: ["j", "k"], label: "move" }, { caps: ["<", ">"], label: "first / last" }, { caps: ["q"], label: "close the panel" }],
};

export default class Todos extends View {
  init(_props, cx) {
    this.selfUpdate = new SelfUpdate("todos", "Todos panel"); this.selfUpdate.start(cx);
    this.handle = cx.focus_handle();
    this.dir = `${appHome()}/todos`;
    this.pages = []; this.page = null; this.sel = 0; this.pageSel = 0; this.top = {};
    this.folded = new Set(JSON.parse((() => { try { return localStorage.getItem("folded"); } catch { return null; } })() ?? "[]"));
    this.writes = Promise.resolve();
    cx.spawn(async cx => {
      await exec("mkdir", ["-p", this.dir]).catch(() => null);
      await this.loadPages();
      let last = null;
      try { last = localStorage.getItem("page"); } catch {}
      if (last && this.pages.some(p => p.path === last)) this.page = this.pages.find(p => p.path === last);
      cx.notify();
      // Edits made elsewhere (nvim, another machine syncing the folder) show up here.
      try { for (;;) { await watchFolder(this.dir); await this.loadPages(); cx.notify(); } } catch {}
    });
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
        else if (c.startsWith("go:")) this.go(c.slice(3));
        else if (c.startsWith("key:")) this.press(c.slice(4), cx);
        cx.notify();
      }
    });
    // No blur event for a focus handle: poll it, redraw only on change, and share it for the leader.
    cx.timer.every(300, cx => {
      const k = this.keyboard();
      if (k !== this.sharedKeys) { this.sharedKeys = k; setShared("todos.hasKeys", k); }
      if (k !== this.hadKeys) { this.hadKeys = k; cx.notify(); }
    });
  }

  keyboard() { return this.handle.is_focused() || Boolean(this.input || this.menu); }

  async loadPages() {
    const r = await exec("sh", ["-c", 'for f in "$1"/*.md; do [ -f "$f" ] && printf "%s\\t%s\\n" "$(stat -f %m "$f")" "$f"; done; true', "todos", this.dir]).catch(() => null);
    const entries = (r?.stdout ?? "").split("\n").filter(Boolean).map(l => { const [m, path] = l.split("\t"); return { mtime: +m, path }; })
      .sort((a, b) => b.mtime - a.mtime);
    const pages = [];
    for (const e of entries) {
      const raw = await readTextFile(e.path).catch(() => null);
      if (raw !== null) pages.push({ ...parse(e.path, raw), mtime: e.mtime });
    }
    this.pages = pages;
    if (this.page) {
      const fresh = pages.find(p => p.path === this.page.path);
      // Our own pending write wins over a reload that raced it.
      if (!fresh) this.page = null;
      else if (!this.pending) this.page = fresh;
    }
  }

  // Applies `edit` to the page's lines now, then writes in order behind earlier writes.
  mutate(edit, cx, page = this.page) {
    if (!page) return;
    const lines = page.lines.slice();
    edit(lines);
    const before = page.raw, after = lines.join("\n") + "\n";
    Object.assign(page, parse(page.path, after));
    this.pending = (this.pending ?? 0) + 1;
    this.writes = this.writes.then(async () => {
      try { await writeTextFile(page.path, after, before); }
      catch { this.flash("The file changed on disk, so it was reloaded"); this.pending = 0; await this.loadPages(); }
    });
    cx.spawn(async cx => { await this.writes; this.pending = Math.max(0, (this.pending ?? 1) - 1); cx.notify(); });
    cx.notify();
  }

  flash(text) { this.flashMsg = text; this.flashAt = Date.now(); }

  // ---- Pages -----------------------------------------------------------------

  open(page, cx) {
    this.page = page; this.sel = 0; this.input = null;
    try { localStorage.setItem("page", page?.path ?? ""); } catch {}
    this.handle.focus();
    cx.notify();
  }

  newPage(cx) {
    this.ask("New page", "", (title, cx) => {
      if (!title) return;
      cx.spawn(async cx => {
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "page";
        let path = `${this.dir}/${slug}.md`;
        for (let i = 2; await readTextFile(path).catch(() => null) !== null; i++) path = `${this.dir}/${slug}-${i}.md`;
        await writeTextFile(path, `# ${title}\n\n`, null);
        await this.loadPages();
        this.open(this.pages.find(p => p.path === path), cx);
        this.startAdd(cx);
      });
    }, cx, "e.g. Release prep");
  }

  renamePage(page, cx) {
    this.ask("Rename page", page.title, (title, cx) => {
      if (!title || title === page.title) return;
      this.mutate(lines => { const i = lines.findIndex(l => l.startsWith("# ")); if (i >= 0) lines[i] = `# ${title}`; else lines.unshift(`# ${title}`, ""); }, cx, page);
    }, cx);
  }

  deletePage(page, cx) {
    this.confirm(`Delete "${page.title}"? It goes to the Trash.`, "Move to Trash", cx => cx.spawn(async cx => {
      const name = page.path.split("/").pop().replace(/\.md$/, "");
      await exec("mv", [page.path, `${home()}/.Trash/${name}-${Date.now()}.md`]).catch(e => this.flash(String(e)));
      if (this.page?.path === page.path) this.page = null;
      await this.loadPages();
      this.pageSel = Math.min(this.pageSel, this.pages.length - 1);
      cx.notify();
    }), cx);
  }

  editInNvim(page) {
    run("terminal.open", { argv: ["/bin/zsh", "-lic", `nvim ${q(page.path)}`], folder: this.dir, place: "tab", name: page.title });
  }

  // ---- Todos -----------------------------------------------------------------

  // Todos nest by indentation (two spaces a level, as Markdown sub-lists). Indexes
  // below are into page.todos (file order); `sel` is a row of visible() (folds hide).

  // The last todo of i's subtree (i itself when it has none).
  end(i) {
    const T = this.page.todos, d = T[i].depth;
    let j = i;
    while (j + 1 < T.length && T[j + 1].depth > d) j++;
    return j;
  }

  parentOf(i) {
    const T = this.page.todos;
    for (let j = i - 1; j >= 0; j--) if (T[j].depth < T[i].depth) return j;
    return -1;
  }

  hasKids(i) { const T = this.page.todos; return T[i + 1]?.depth > T[i].depth; }

  foldKey(td) { return `${this.page.path}:${td.depth}:${td.text}`; }

  // The todos shown: everything not under a folded one.
  visible() {
    const T = this.page?.todos ?? [], out = [];
    let hideBelow = Infinity;
    T.forEach((td, i) => {
      if (td.depth > hideBelow) return;
      hideBelow = Infinity;
      out.push(i);
      if (this.folded.has(this.foldKey(td)) && this.hasKids(i)) hideBelow = td.depth;
    });
    return out;
  }

  cur() { const i = this.visible()[this.sel]; return i == null ? -1 : i; }
  todo() { const i = this.cur(); return i < 0 ? null : this.page.todos[i]; }

  // Select the todo that now starts at file line `line` (after an edit).
  selectLine(line) {
    const i = this.page.todos.findIndex(t => t.line === line);
    const v = this.visible(), k = v.indexOf(i);
    this.sel = k >= 0 ? k : Math.max(0, Math.min(this.sel, v.length - 1));
  }

  // Add a todo: at the end (a), below the selected one's subtree (o), or as its
  // last sub-todo (A). Enter keeps adding right after the one just added.
  startAdd(cx, where = "end") {
    const T = this.page.todos, i = this.cur();
    let at = null;
    if (where !== "end" && i >= 0) {
      const last = T[this.end(i)].line;
      at = { line: last, depth: T[i].depth + (where === "child" ? 1 : 0), parent: where === "child" ? i : this.parentOf(i) };
      if (where === "child") this.folded.delete(this.foldKey(T[i]));
    }
    const input = InputState.new({ value: "", placeholder: `Add a ${at?.depth ? "sub-" : ""}todo, enter to save, esc to stop` });
    input.on("submit", (_e, cx) => {
      const text = input.value().trim();
      if (!text) { this.input = null; this.handle.focus(); cx.notify(); return; }
      const spot = this.input?.at;
      let line;
      this.mutate(lines => {
        if (spot) {
          line = spot.line + 1;
          lines.splice(line, 0, `${"  ".repeat(spot.depth)}- [ ] ${text}`);
          // A new open sub-todo means its parents aren't done any more.
          for (let p = spot.parent; p >= 0; p = this.parentOf(p)) lines[T2line(this.page.todos[p], line)] = mark(lines[T2line(this.page.todos[p], line)], false);
        } else {
          const last = this.page.todos.at(-1)?.line;
          if (last != null) { line = last + 1; lines.splice(line, 0, `- [ ] ${text}`); }
          else { while (lines.length && !lines.at(-1).trim()) lines.pop(); lines.push("", `- [ ] ${text}`); line = lines.length - 1; }
        }
      }, cx);
      if (spot) spot.line = line;
      this.selectLine(line);
      input.set_value("");
    });
    this.input = { kind: "add", state: input, at };
    input.focus();
    cx.notify();
  }

  startEdit(cx) {
    const t = this.todo();
    if (!t) return;
    const input = InputState.new({ value: t.text });
    input.on("submit", (_e, cx) => {
      const text = input.value().trim();
      this.input = null; this.handle.focus();
      if (text && text !== t.text) {
        const was = this.folded.delete(this.foldKey(t));
        this.mutate(lines => { lines[t.line] = lines[t.line].replace(TODO, (_m, a, x, b) => `${a}${x}${b}${text}`); }, cx);
        if (was) this.folded.add(this.foldKey({ ...t, text }));
      }
      cx.notify();
    });
    this.input = { kind: "edit", state: input, line: t.line };
    input.focus();
    cx.notify();
  }

  // Checking a todo checks its whole subtree; then each parent is done exactly
  // when all its sub-todos are.
  toggle(t, cx) {
    if (!t) return;
    const T = this.page.todos, i = T.indexOf(t);
    if (i < 0) return;
    const done = T.map(x => x.done), to = !t.done;
    for (let j = i; j <= this.end(i); j++) done[j] = to;
    for (let p = this.parentOf(i); p >= 0; p = this.parentOf(p)) {
      let all = true;
      for (let j = p + 1; j <= this.end(p); j++) if (!done[j]) { all = false; break; }
      done[p] = all;
    }
    this.mutate(lines => { T.forEach((x, j) => { if (done[j] !== x.done) lines[x.line] = mark(lines[x.line], done[j]); }); }, cx);
  }

  // Deletes the todo and everything under it.
  remove(t, cx) {
    if (!t) return;
    const T = this.page.todos, i = T.indexOf(t);
    if (i < 0) return;
    const from = t.line, to = T[this.end(i)].line;
    this.undo = { path: this.page.path, line: from, texts: this.page.lines.slice(from, to + 1) };
    this.mutate(lines => { lines.splice(from, to - from + 1); }, cx);
    this.sel = Math.max(0, Math.min(this.sel, this.visible().length - 1));
    this.flash(to > from ? "Deleted with its sub-todos · u to undo" : "Deleted · u to undo");
  }

  restore(cx) {
    const u = this.undo;
    if (!u || u.path !== this.page?.path) return;
    this.undo = null;
    this.mutate(lines => { lines.splice(Math.min(u.line, lines.length), 0, ...(u.texts ?? [u.text])); }, cx);
    this.selectLine(u.line);
  }

  // J/K: swap the todo (with its subtree) and the sibling above or below.
  moveTodo(dir, cx) {
    const T = this.page?.todos, i = this.cur();
    if (!T || i < 0) return;
    const d = T[i].depth;
    let j = -1;
    if (dir > 0) { const k = this.end(i) + 1; if (T[k]?.depth === d) j = k; }
    else for (let k = i - 1; k >= 0 && T[k].depth >= d; k--) if (T[k].depth === d) { j = k; break; }
    if (j < 0) return;
    const [a, b] = j < i ? [j, i] : [i, j];
    const aFrom = T[a].line, aTo = T[this.end(a)].line, bFrom = T[b].line, bTo = T[this.end(b)].line;
    let moved;
    this.mutate(lines => {
      const first = lines.slice(aFrom, aTo + 1), middle = lines.slice(aTo + 1, bFrom), second = lines.slice(bFrom, bTo + 1);
      lines.splice(aFrom, bTo - aFrom + 1, ...second, ...middle, ...first);
      moved = dir > 0 ? aFrom + second.length + middle.length : aFrom;
    }, cx);
    this.selectLine(moved);
  }

  // tab / shift-tab: one level in (under the todo above) or out, with the subtree.
  nest(delta, cx) {
    const T = this.page?.todos, i = this.cur();
    if (!T || i < 0) return;
    const d = T[i].depth;
    if (delta > 0 && (i === 0 || T[i - 1].depth < d)) return this.flash("Nothing above to nest it under");
    if (delta < 0 && d === 0) return;
    const line = T[i].line, last = this.end(i);
    this.mutate(lines => {
      for (let j = i; j <= last; j++) lines[T[j].line] = "  ".repeat(Math.max(0, T[j].depth + delta)) + lines[T[j].line].trimStart();
    }, cx);
    if (delta > 0) this.folded.delete(this.foldKey(this.page.todos[this.parentOf(i)] ?? {}));
    this.selectLine(line);
  }

  // z: fold or unfold the selected todo's sub-todos (on a sub-todo: its parent's).
  fold(cx) {
    const i = this.cur();
    if (i < 0) return;
    const target = this.hasKids(i) ? i : this.parentOf(i);
    if (target < 0) return;
    const k = this.foldKey(this.page.todos[target]);
    this.folded.has(k) ? this.folded.delete(k) : this.folded.add(k);
    this.selectLine(this.page.todos[target].line);
  }

  // Removes done todos (a done one goes with its subtree).
  clearDone(cx) {
    const T = this.page?.todos ?? [], ranges = [];
    for (let i = 0; i < T.length; i++) if (T[i].done) { const e = this.end(i); ranges.push([T[i].line, T[e].line, e - i + 1]); i = e; }
    if (!ranges.length) return;
    const n = ranges.reduce((x, r) => x + r[2], 0);
    this.confirm(`Remove ${n} completed todo${n > 1 ? "s" : ""}?`, "Remove", cx => {
      this.mutate(lines => { for (const [from, to] of ranges.reverse()) lines.splice(from, to - from + 1); }, cx);
      this.sel = 0;
    }, cx);
  }

  // ---- Menus, prompts, keys --------------------------------------------------

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

  // Leaving the panel: left goes straight back to the terminal the keyboard came from (pane.focus);
  // pane.go doesn't reliably move the keyboard out of a panel. Other directions are pane.go's.
  go(dir) {
    this.focusToken = (this.focusToken ?? 0) + 1; // cancel a pending focus retry
    const pane = focused()?.pane;
    if (dir === "left" && pane) return run("pane.focus", { pane });
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

  key(e, cx) { if (this.navKey(e, cx)) return; if (this.press(keyOf(e), cx)) cx.stop_propagation(); }

  // Real keys and "todos.key:<k>" commands both come through here.
  press(k, cx) {
    if (this.keysOpen) {
      if (k === "escape" || k === "?" || k === "q") this.keysOpen = false;
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
    if (k === "?") { this.keysOpen = true; cx.notify(); return true; }
    if (k === "q") { closePanel("todos"); return true; }
    const handled = this.page ? this.pageKey(k, cx) : this.pagesKey(k, cx);
    if (handled) cx.notify();
    return handled;
  }

  pagesKey(k, cx) {
    const p = this.pages[this.pageSel];
    const move = i => { this.pageSel = Math.max(0, Math.min(this.pages.length - 1, i)); };
    switch (k) {
      case "j": case "down": move(this.pageSel + 1); return true;
      case "k": case "up": move(this.pageSel - 1); return true;
      case "<": move(0); return true;
      case ">": move(this.pages.length - 1); return true;
      case "enter": case "l": case "right": if (p) this.open(p, cx); return true;
      case "n": this.newPage(cx); return true;
      case "R": if (p) this.renamePage(p, cx); return true;
      case "D": if (p) this.deletePage(p, cx); return true;
      case "E": if (p) this.editInNvim(p); return true;
    }
    return false;
  }

  pageKey(k, cx) {
    const n = this.visible().length;
    const move = i => { this.sel = Math.max(0, Math.min(n - 1, i)); };
    switch (k) {
      case "j": case "down": move(this.sel + 1); return true;
      case "k": case "up": move(this.sel - 1); return true;
      case "<": move(0); return true;
      case ">": move(n - 1); return true;
      case "space": case "x": this.toggle(this.todo(), cx); return true;
      case "a": this.startAdd(cx); return true;
      case "o": this.startAdd(cx, "below"); return true;
      case "A": this.startAdd(cx, "child"); return true;
      case "tab": this.nest(1, cx); return true;
      case "shift-tab": this.nest(-1, cx); return true;
      case "z": this.fold(cx); this.saveFolds(); return true;
      case "e": case "enter": case "i": this.startEdit(cx); return true;
      case "d": this.remove(this.todo(), cx); return true;
      case "u": this.restore(cx); return true;
      case "J": this.moveTodo(1, cx); return true;
      case "K": this.moveTodo(-1, cx); return true;
      case "C": this.clearDone(cx); return true;
      case "R": this.renamePage(this.page, cx); return true;
      case "E": this.editInNvim(this.page); return true;
      case "h": case "left": case "backspace": case "escape": this.open(null, cx); return true;
    }
    return false;
  }

  // ---- Rendering -------------------------------------------------------------

  progress(page, t, w) {
    const total = page.todos.length, done = page.todos.filter(x => x.done).length;
    return h_flex().gap(6).items_center().flex_none()
      .child(div().w(w).h(4).rounded(2).bg(t.raised).child(div().h_full().rounded(2).bg(done === total && total ? t.ansi2 : t.accent).w(total ? (w * done) / total : 0)))
      .child(div().text_size(11).text_color(t.dim).child(`${done}/${total}`));
  }

  iconButton(id, icon, action, t, label) {
    return h_flex().id(id).h(24).px(6).gap(4).flex_none().items_center().rounded(6).cursor_pointer().text_size(11.5).text_color(t.muted)
      .hover(s => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => { cx.stop_propagation(); action(cx); cx.notify(); })
      .child(svg(icon).size(13)).when(Boolean(label), el => el.child(label));
  }

  pagesView(t, space) {
    if (!this.pages.length) return v_flex().flex_1().p(16).gap(10).items_center().text_color(t.dim)
      .child("No pages yet").child(this.iconButton("first-page", `${ICON}/plus.svg`, cx => this.newPage(cx), t, "New page"));
    const { start, end } = windowOf(this.pages.length, PAGE_ROW, this.pageSel, space, this.top.pages ?? 0);
    this.top.pages = start;
    return v_flex().flex_1().min_h(0).overflow_hidden().p(6).children(this.pages.slice(start, end).map((p, j) => {
      const i = start + j, on = i === this.pageSel;
      return h_flex().id(`page-${p.path}`).h(PAGE_ROW).flex_none().px(10).gap(10).items_center().rounded(8).cursor_pointer()
        .when(on, e => e.bg(this.hadKeys ? t.selected : t.hover)).hover(s => s.bg(on && this.hadKeys ? t.selected : t.hover))
        .on_click((e, cx) => { this.pageSel = i; if (e.click_count >= 2 || on) this.open(p, cx); this.handle.focus(); cx.notify(); })
        .child(v_flex().flex_1().min_w(0)
          .child(div().truncate().font_semibold().child(p.title))
          .child(div().truncate().text_size(11).text_color(t.dim).child(p.todos.filter(x => !x.done)[0]?.text ?? (p.todos.length ? "All done" : "Empty"))))
        .child(this.progress(p, t, 48));
    }));
  }

  saveFolds() {
    try { localStorage.setItem("folded", JSON.stringify([...this.folded].slice(-500))); } catch {}
  }

  // i: the row (into visible()); k: the todo (into page.todos); nested: any todo has sub-todos.
  todoRow(td, i, t, k, nested) {
    const on = i === this.sel, editing = this.input?.kind === "edit" && this.input.line === td.line;
    const T = this.page.todos, kids = this.hasKids(k), folded = kids && this.folded.has(this.foldKey(td));
    let doneKids = 0, allKids = 0;
    if (kids) for (let j = k + 1; j <= this.end(k); j++) { allKids++; if (T[j].done) doneKids++; }
    return h_flex().id(`todo-${td.line}`).min_h(ROW).flex_none().pl(8 + td.depth * 20).pr(8).py(6).gap(9).items_start().rounded(6).cursor_pointer()
      .when(on, e => e.bg(this.hadKeys ? t.selected : t.hover)).hover(s => s.bg(on && this.hadKeys ? t.selected : t.hover))
      .on_click((_e, cx) => { this.sel = i; this.handle.focus(); cx.notify(); })
      .when(nested, e => e.child(div().id(`fold-${td.line}`).size(12).mt(2).mr(-4).flex_none().text_color(t.dim)
        .when(kids, e => e.hover(s => s.text_color(t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); const key = this.foldKey(td); this.folded.has(key) ? this.folded.delete(key) : this.folded.add(key); this.saveFolds(); this.selectLine(td.line); cx.notify(); })
          .child(svg(`mods/todos/chevron-${folded ? "right" : "down"}.svg`).size(12)))))
      .child(div().id(`check-${td.line}`).size(15).mt(1).flex_none().rounded(4).border_1().flex().items_center().justify_center()
        .border_color(td.done ? t.ansi2 : t.input).bg(td.done ? t.ansi2 : t.background)
        .on_click((_e, cx) => { cx.stop_propagation(); this.sel = i; this.toggle(td, cx); })
        .when(td.done, e => e.child(svg(`${ICON}/check.svg`).size(11).text_color(t.background))))
      .child(editing
        ? div().flex_1().min_w(0).on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.input.state).h(24).px(6).rounded(5).border_1().border_color(t.accent).bg(t.background).text_size(12.5))
        : div().flex_1().min_w(0).whitespace_normal().when(td.done, e => e.line_through().text_color(t.dim)).child(td.text || " "))
      .when(kids && !editing, e => e.child(div().mt(1).flex_none().text_size(11).text_color(doneKids === allKids ? t.ansi2 : t.dim).child(`${doneKids}/${allKids}`)))
      .when(on && !editing, e => e.child(div().id(`del-${td.line}`).mt(2).flex_none().text_color(t.dim).hover(s => s.text_color(t.ansi1))
        .on_click((_e, cx) => { cx.stop_propagation(); this.remove(td, cx); cx.notify(); }).child(svg(`${ICON}/x.svg`).size(12))));
  }

  pageView(t, space) {
    const p = this.page, adding = this.input?.kind === "add";
    const room = space - (adding ? ROW + 8 : ROW) - (p.notes ? 22 : 0);
    // Wrapped rows: estimate each one's lines from its length and the text column's width.
    const column = Math.max(80, (this.size?.width ?? 360) - 80), perLine = Math.max(8, Math.floor(column / 7));
    const vis = this.visible(), nested = p.todos.some((_, k) => this.hasKids(k)) || p.todos.some(td => td.depth > 0);
    const heights = vis.map(k => { const td = p.todos[k]; return Math.max(ROW, Math.ceil(Math.max(1, td.text.length) / Math.max(8, perLine - td.depth * 3)) * 18 + 12); });
    const { start, end } = windowVar(heights, this.sel, room - 12, this.top.page ?? 0);
    this.top.page = start;
    // o / A: the input sits where the todo will go, indented to its level.
    const at = adding ? this.input.at : null;
    const box = (depth) => div().pt(4).pl(depth * 20).on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(Input.new(this.input.state).h(28).px(8).rounded(6).border_1().border_color(t.accent).bg(t.background).text_size(12.5));
    const inline = at && vis.slice(start, end).some(k => p.todos[k].line === at.line);
    return v_flex().flex_1().min_h(0).overflow_hidden().p(6)
      .children(vis.slice(start, end).flatMap((k, j) => {
        const row = this.todoRow(p.todos[k], start + j, t, k, nested);
        return inline && p.todos[k].line === at.line ? [row, box(at.depth)] : [row];
      }))
      .when(start > 0 || end < vis.length, el => el.child(div().px(8).text_size(10.5).text_color(t.dim)
        .child(`${start ? `${start} above · ` : ""}${vis.length - end ? `${vis.length - end} below` : ""}`.replace(/ · $/, ""))))
      .child(adding && inline ? div() : adding
        ? div().pt(4).on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.input.state).h(28).px(8).rounded(6).border_1().border_color(t.accent).bg(t.background).text_size(12.5))
        : h_flex().id("add-todo").h(ROW).flex_none().px(8).gap(9).items_center().rounded(6).cursor_pointer().text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => this.startAdd(cx)).child(svg(`${ICON}/plus.svg`).size(14)).child("Add a todo"))
      .when(p.notes > 0, el => el.child(div().px(8).pt(4).text_size(11).text_color(t.dim).child(`${p.notes} note line${p.notes > 1 ? "s" : ""} kept in the file · E to open in nvim`)));
  }

  render() {
    this.hadKeys = this.keyboard();
    const t = theme(), p = this.page;
    if (this.flashMsg && Date.now() - this.flashAt > 4000) this.flashMsg = null;
    const space = (this.size?.height ?? 600) - 42 - 24 - 12;
    return v_flex().id("todos").relative().size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background)
      .border_1().border_color(this.hadKeys ? t.accent : t.border).text_color(t.foreground).text_size(12.5)
      .track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .on_mouse_down("left", () => { if (!this.input) this.handle.focus(); })
      .on_size_change((size, cx) => { this.size = size; cx.notify(); })
      .child(h_flex().h(42).flex_none().px(10).gap(8).items_center().border_b(1).border_color(t.border)
        .when(Boolean(p), el => el.child(this.iconButton("todo-back", `${ICON}/back.svg`, cx => this.open(null, cx), t)))
        .child(div().flex_1().min_w(0).truncate().font_semibold().text_size(13).child(p ? p.title : "Todos"))
        .when(Boolean(p), el => el.child(this.progress(p, t, 60)))
        .children([this.selfUpdate.pill(t)].filter(Boolean))
        .when(!p, el => el.child(this.iconButton("page-new", `${ICON}/plus.svg`, cx => this.newPage(cx), t, "New page"))))
      .child(p ? this.pageView(t, space) : this.pagesView(t, space))
      .child(keybar(t, { id: "todos", chips: this.chips(), flash: this.flashMsg, width: this.size?.width, onKeys: cx => { this.keysOpen = true; this.handle.focus(); cx.notify(); } }))
      .when(this.input?.kind === "prompt", el => el.child(this.promptView(t)))
      .when(Boolean(this.menu), el => el.child(this.menuView(t)))
      .when(Boolean(this.keysOpen), el => el.child(keysCard(t, { id: "todos", title: "Todos: all keys", onClose: cx => { this.keysOpen = false; cx.notify(); }, groups: [
        { title: "In a page", chips: KEYS.page }, { title: "Pages", chips: KEYS.pages }, { title: "Everywhere", chips: KEYS.everywhere }] })));
  }

  // The footer's keycaps for what's on screen now.
  chips() {
    if (this.input) return [{ caps: ["enter"], label: "save" }, { caps: ["escape"], label: "stop" }];
    if (this.menu) return [{ caps: ["y"], label: "confirm" }, { caps: ["n"], label: "cancel" }];
    return this.page ? KEYS.page : KEYS.pages;
  }

  promptView(t) {
    const p = this.input;
    return div().id("td-scrim").absolute().inset_0().bg("#00000055").flex().items_start().justify_center().pt(70)
      .child(v_flex().id("td-prompt").w(320).p(12).gap(8).rounded(10).border_1().border_color(t.border).bg(t.popover).shadow_lg()
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(div().font_semibold().child(p.title))
        .child(Input.new(p.state).h(32).px(10).rounded(7).border_1().border_color(t.accent).bg(t.background).text_size(12.5)));
  }

  menuView(t) {
    const m = this.menu;
    return div().id("td-menu-scrim").absolute().inset_0().bg("#00000055").flex().items_center().justify_center()
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.menu = null; cx.notify(); })
      .child(v_flex().id("td-menu").w(320).p(6).rounded(10).border_1().border_color(t.border).bg(t.popover).shadow_lg()
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(div().px(8).py(6).font_semibold().child(m.title))
        .children(m.items.map((it, i) => h_flex().id(`td-mi-${i}`).h(26).px(8).gap(8).items_center().rounded(6).cursor_pointer()
          .when(i === m.sel, e => e.bg(t.selected)).hover(s => s.bg(t.hover))
          .on_click((_e, cx) => { this.menu = null; it.run(cx); cx.notify(); })
          .child(div().w(16).text_size(11).text_color(t.accent).child(it.key)).child(div().child(it.label)))));
  }
}
