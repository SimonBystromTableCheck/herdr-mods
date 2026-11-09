// A lazy file browser for the focused pane's folder, with bounded read-only previews,
// keyboard-focusable (pane.go) with vim motions.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Scrollbar, v_virtual_list, VirtualListScrollHandle } from "gpui-base";
import { keybar, keysCard } from "./keybar.js";
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, settings, window, run, nextCommand, setShared } from "herdr";

function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on, space: space?.id };
}
const key = () => JSON.stringify(location());
const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };
const PER_FOLDER = 500, TOTAL = 5000;

async function directory(path, on) {
  const windowsDirectory = async () => {
    // Windows PowerShell otherwise uses the console code page; exec decodes UTF-8.
    // Links keep directory attributes even when dangling; check their target.
    // Other reparse points (OneDrive's folders) have no LinkType and are folders.
    // PowerShell reads curly single quotes as quotes too, so they're doubled like '.
    const r = await exec("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & { param($p) @(Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and (-not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or -not $_.LinkType -or ($_.Target -and [IO.Directory]::Exists(([IO.Path]::Combine([IO.Path]::GetDirectoryName($_.FullName), $_.Target[0])))))) } }) | ConvertTo-Json -Compress } '" + path.replace(/['‘’‚‛]/g, "$&$&") + "'"], { on });
    if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
    const result = JSON.parse(r.stdout || "[]");
    return Array.isArray(result) ? result : [result];
  };
  if (!on && window()?.platform === "windows") return windowsDirectory();
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  let r;
  try { r = await exec("sh", ["-c", script, "files", path], { on }); }
  catch (e) {
    if (on && String(e).includes("cannot start sh: program not found")) return windowsDirectory();
    throw e;
  }
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}

// Keys, like the git and gitview panels (vim motions). Tree:
//   j/k ↓/↑ move · g/G first/last · ctrl-d/ctrl-u half a page
//   l → enter    open a folder (again: into it) / preview a file
//   h ←          close a folder, else go to its parent
//   space o      fold or unfold a folder · r refresh
//   esc          keyboard back to the terminal · q hide the panel
// Preview: j/k ctrl-d/ctrl-u g/G move the line · J/K next/previous file
//   h ← esc backspace  back to the tree
const ROW = 28, LINE = 18, MAX_LINES = 20000;

function keyOf(e) {
  const m = e.modifiers ?? {};
  if (m.control && !m.platform && !m.alt && !m.shift) return `ctrl-${e.key}`;
  if (m.control || m.platform || m.alt) return null;
  if (["enter", "escape", "tab", "space", "up", "down", "left", "right", "backspace", "pageup", "pagedown", "home", "end"].includes(e.key)) return e.key;
  return e.key_char ?? (m.shift ? e.key.toUpperCase() : e.key);
}

const KEYS = {
  tree: [{ caps: ["j", "k"], label: "move" }, { caps: ["l"], label: "open" }, { caps: ["h"], label: "up" }, { caps: ["g", "G"], label: "ends" }, { caps: ["q"], label: "hide" }],
  preview: [{ caps: ["j", "k"], label: "line" }, { caps: ["J", "K"], label: "file" }, { caps: ["h"], label: "back" }, { caps: ["q"], label: "hide" }],
  treeAll: [
    { caps: ["j", "k"], label: "move" }, { caps: ["g", "G"], label: "first / last" }, { caps: ["ctrl-d", "ctrl-u"], label: "half a page" },
    { caps: ["l", "enter"], label: "open folder / preview file" }, { caps: ["h"], label: "close folder, else parent" },
    { caps: ["space", "o"], label: "fold / unfold" }, { caps: ["escape"], label: "keyboard to the terminal" },
  ],
  previewAll: [
    { caps: ["j", "k"], label: "move the line" }, { caps: ["g", "G"], label: "first / last line" }, { caps: ["ctrl-d", "ctrl-u"], label: "half a page" },
    { caps: ["J", "K"], label: "next / previous file" }, { caps: ["h", "escape"], label: "back to the tree" },
  ],
  everywhere: [{ caps: ["r"], label: "refresh" }, { caps: ["q"], label: "hide the panel" }, { caps: ["?"], label: "this card" }],
};

const parentOf = (path) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : null);

export default class Files extends View {
  init(_props, cx) {
    this.saved = new Map();
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set(); this.marks = {};
    this.handle = cx.focus_handle();
    this.treeScroll = VirtualListScrollHandle.new();
    this.lineScroll = VirtualListScrollHandle.new();
    this.sel = null; this.line = 0;
    this.refresh(cx);
    cx.timer.every(10000, cx => this.refresh(cx));
    // pane.go moved the keyboard here, or `my-files.key:<k>` from keys.json.
    cx.spawn(async cx => {
      for (;;) {
        const c = await nextCommand();
        if (c === "focus") this.takeKeyboard(cx);
        else if (c.startsWith("key:")) this.handleKey(c.slice(4), cx);
        else if (c.startsWith("go:")) { this.handle.focus(); run("pane.go", { direction: c.slice(3) }); }
        cx.notify();
      }
    });
    // GPUI has no blur event: notice the keyboard coming and going (redraws only on change).
    cx.timer.every(300, cx => {
      const k = this.handle.is_focused();
      if (k !== this.sharedKeys) { this.sharedKeys = k; setShared("my-files.hasKeys", k); }
      if (k !== this.hadKeys) { this.hadKeys = k; cx.notify(); }
    });
  }

  // The app may hand the keyboard over a moment after it says so; ask again once.
  takeKeyboard(cx) {
    try { this.handle.focus(); } catch { /* not drawn yet */ }
    cx.timer.after(150, cx => { if (!this.handle.is_focused()) { try { this.handle.focus(); } catch { /* gone */ } cx.notify(); } });
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    const context = this.context;
    cx.spawn(async cx => {
      try { while (this.context === context) { await watchFolder(root); if (this.current(context)) this.refresh(cx); } }
      catch { if (this.context === context) this.watched = null; }
    });
  }

  current(context) {
    return this.context === context && key() === context.key;
  }

  async loadFolder(path, context) {
    const { on, cwd: root } = context;
    const entries = await directory(path ? `${root}/${path}` : root, on);
    if (!this.current(context) || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    this.entries.set(path, entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used))).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  refresh(cx) {
    const { cwd, on } = location(), next = key();
    if (next !== this.context?.key) {
      if (this.context) this.saved.set(this.context.key, { folders: this.folders, file: this.file });
      const saved = this.saved.get(next);
      this.context = { key: next, cwd, on }; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set(saved?.folders);
      this.pending = new Set(); this.marks = {}; this.show(null); this.watched = null; this.error = null; this.limited = false;
      this.loading = false;
      if (saved?.file) this.show(saved.file, cx);
    }
    if (!cwd || this.loading) return;
    const context = this.context;
    this.loading = true;
    this.limited = false;
    cx.spawn(async cx => {
      try {
        for (const path of ["", ...this.folders]) {
          if (!this.current(context)) return;
          await this.loadFolder(path, context);
        }
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
        const marks = {};
        if (top?.code === 0) {
          // Writes nothing under .git (index lock, fsmonitor cookie): the folder watch would refresh again.
          const status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd, on }).catch(() => null);
          if (status?.code === 0) for (const entry of status.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) {
            const xy = entry.slice(0, 2);
            marks[`${top.stdout.trim()}/${entry.slice(3)}`] = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
          }
        }
        if (!this.current(context)) return;
        this.marks = marks; this.error = null; this.watch(cwd, cx);
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally { if (this.context === context) this.loading = false; cx.notify(); }
    });
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path + "/")) {
        this.folders.delete(folder);
        this.entries.delete(folder);
      }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const context = this.context;
        this.pending.add(path);
        cx.spawn(async cx => {
          try { await this.loadFolder(path, context); }
          catch (e) { if (this.current(context)) this.error = String(e); }
          finally { if (this.context === context) this.pending.delete(path); cx.notify(); }
        });
      }
    }
    cx.notify();
  }

  show(path, cx) {
    this.file = path; this.fileError = null; this.lines = null; this.line = 0;
    if (!path || !cx) return;
    const context = this.context, root = this.root, on = this.on;
    cx.spawn(async cx => {
      try {
        const text = await readTextFile(`${root}/${path}`, { on });
        if (this.file !== path || !this.current(context)) return;
        if (text === null) { this.fileError = "This file is no longer available"; return; }
        if (text.includes("\0")) { this.fileError = "Binary file · no text preview"; return; }
        const lines = text.slice(0, 400000).replace(/\t/g, "    ").split("\n");
        if (lines.length > MAX_LINES || text.length > 400000) { lines.length = Math.min(lines.length, MAX_LINES); lines.push("… (file truncated)"); }
        this.lines = lines;
        this.lineScroll.scroll_to_item(0);
      } catch { if (this.file === path && this.current(context)) this.fileError = "Cannot preview this file (binary, too large, or unreadable)"; }
      finally { cx.notify(); }
    });
  }

  // The tree as shown, one item per row.
  flat(prefix = "", depth = 0, out = []) {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      out.push({ path, entry, depth });
      if (entry.dir && this.folders.has(path)) this.flat(path, depth + 1, out);
    }
    return out;
  }

  // ---- Keys ------------------------------------------------------------------

  page() { return Math.max(1, Math.floor((this.size?.height ?? 600) / (this.file ? LINE : ROW) / 2)); }

  select(items, i, cx) {
    if (!items.length) return;
    const at = Math.max(0, Math.min(items.length - 1, i));
    this.sel = items[at].path;
    this.treeScroll.scroll_to_item(at);
    cx.notify();
  }

  moveLine(to, cx) {
    if (!this.lines?.length) return;
    this.line = Math.max(0, Math.min(this.lines.length - 1, to));
    this.lineScroll.scroll_to_item(this.line);
    cx.notify();
  }

  // Preview the file `step` rows away in the tree, skipping folders.
  neighbour(step, cx) {
    const items = this.flat();
    let i = items.findIndex(r => r.path === this.file);
    for (i += step; i >= 0 && i < items.length; i += step) {
      if (items[i].entry.dir) continue;
      this.select(items, i, cx);
      this.show(items[i].path, cx);
      return;
    }
  }

  back(cx) {
    const file = this.file;
    this.show(null);
    const items = this.flat(), i = items.findIndex(r => r.path === file);
    if (i >= 0) this.select(items, i, cx);
    cx.notify();
  }

  key(e, cx) {
    const k = keyOf(e);
    if (k && this.handleKey(k, cx)) cx.stop_propagation();
  }

  handleKey(k, cx) {
    if (this.keysOpen) {
      if (k === "escape" || k === "?" || k === "q") this.keysOpen = false;
      cx.notify(); return true;
    }
    if (k === "?") { this.keysOpen = true; cx.notify(); return true; }
    if (k === "q") {
      run("layout.hide", { id: "panel" });
      if (focused()?.pane) run("pane.focus", { pane: focused().pane });
      return true;
    }
    if (k === "r") { this.refresh(cx); return true; }
    return this.file ? this.previewKey(k, cx) : this.treeKey(k, cx);
  }

  previewKey(k, cx) {
    switch (k) {
      case "j": case "down": this.moveLine(this.line + 1, cx); return true;
      case "k": case "up": this.moveLine(this.line - 1, cx); return true;
      case "ctrl-d": case "pagedown": this.moveLine(this.line + this.page(), cx); return true;
      case "ctrl-u": case "pageup": this.moveLine(this.line - this.page(), cx); return true;
      case "g": case "home": this.moveLine(0, cx); return true;
      case "G": case "end": this.moveLine(Infinity, cx); return true;
      case "J": this.neighbour(1, cx); return true;
      case "K": this.neighbour(-1, cx); return true;
      case "h": case "left": case "escape": case "backspace": this.back(cx); return true;
    }
    return false;
  }

  treeKey(k, cx) {
    const items = this.flat();
    let i = items.findIndex(r => r.path === this.sel);
    const row = items[i];
    if (i < 0 && ["j", "k", "down", "up"].includes(k)) { this.select(items, 0, cx); return true; }
    switch (k) {
      case "j": case "down": this.select(items, i + 1, cx); return true;
      case "k": case "up": this.select(items, i - 1, cx); return true;
      case "ctrl-d": case "pagedown": this.select(items, i + this.page(), cx); return true;
      case "ctrl-u": case "pageup": this.select(items, i - this.page(), cx); return true;
      case "g": case "home": this.select(items, 0, cx); return true;
      case "G": case "end": this.select(items, items.length - 1, cx); return true;
      case "l": case "right": case "enter":
        if (!row) return true;
        if (!row.entry.dir) { this.show(row.path, cx); cx.notify(); }
        else if (!this.folders.has(row.path)) this.toggle(row.path, cx);
        else if (items[i + 1]?.depth > row.depth) this.select(items, i + 1, cx);
        return true;
      case "h": case "left": {
        if (!row) return true;
        if (row.entry.dir && this.folders.has(row.path)) { this.toggle(row.path, cx); return true; }
        const up = parentOf(row.path);
        if (up) this.select(items, items.findIndex(r => r.path === up), cx);
        return true;
      }
      case "space": case "o":
        if (row?.entry.dir) this.toggle(row.path, cx);
        return true;
      case "escape":
        if (focused()?.pane) { run("pane.focus", { pane: focused().pane }); return true; }
        return false;
    }
    return false;
  }

  // ---- Drawing ---------------------------------------------------------------

  treeRow(r, t, keys) {
    const { path, entry, depth } = r, open = this.folders.has(path), mark = this.marks[`${this.root}/${path}`];
    const on = path === this.sel;
    return h_flex().id(`file-${path}`).h(ROW).flex_none().pl(8 + depth * 18).pr(8).gap(7).items_center().rounded(7).cursor_pointer()
      .when(on, el => el.bg(keys ? t.selected : t.raised))
      .hover(s => s.bg(t.hover))
      .child(entry.dir ? svg(`mods/my-files/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
      .child(svg(`mods/my-files/${entry.dir ? "folder" : "file"}.svg`).size(14).flex_none().text_color(t.muted))
      .child(div().flex_1().min_w(0).truncate().child(entry.name))
      .when(Boolean(mark), el => el.child(div().text_size(11).text_color(mark === "A" ? t.ansi2 : mark === "D" || mark === "U" ? t.ansi1 : t.blocked).child(mark)));
  }

  clickRow(path, cx) {
    const items = this.flat(), i = items.findIndex(r => r.path === path);
    if (i < 0) return;
    this.sel = path;
    items[i].entry.dir ? this.toggle(path, cx) : this.show(path, cx);
    cx.notify();
  }

  tree(t, keys) {
    const items = this.flat();
    const empty = Boolean(this.error) || !this.entries.get("")?.length;
    return v_flex().flex_1().min_h(0).p(6)
      .when(!empty, el => el.child(div().flex_1().min_h(0).relative()
        .child(div().size_full().child(v_virtual_list("files-tree", items.length, ROW, i => items[i].path,
          range => items.slice(range.start, range.end).map(r => this.treeRow(r, t, keys)))
          .track_scroll(this.treeScroll).size_full()
          .on_item_click((path, cx) => this.clickRow(path, cx))))
        .child(Scrollbar.vertical("files-tree").viewport_from_layout().absolute().inset_0())))
      .when(empty, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.error || (this.loading ? "Loading files…" : this.root ? "No files" : "No folder"))))
      .when(this.limited, el => el.child(div().p(8).text_size(11).text_color(t.dim).child("File list limited to 500 entries per folder and 5,000 total")));
  }

  preview(t, keys) {
    if (!this.lines) return div().p(12).text_color(t.dim).child(this.fileError || "Loading file…");
    const lines = this.lines, digits = String(lines.length).length, mono = settings().font_family ?? "JetBrains Mono";
    return div().flex_1().min_h(0).relative().font_family(mono).text_size(12)
      .child(div().size_full().child(v_virtual_list("files-lines", lines.length, LINE, i => String(i),
        range => lines.slice(range.start, range.end).map((text, j) => {
          const n = range.start + j, on = n === this.line;
          return h_flex().id(`line-${n}`).h(LINE).w_full().gap(10).px(8).items_center().overflow_hidden()
            .when(on, el => el.bg(keys ? t.selected : t.raised))
            .child(div().w(digits * 7.5).flex_none().text_right().text_color(on ? t.muted : t.dim).child(String(n + 1)))
            .child(div().flex_1().min_w(0).whitespace_nowrap().overflow_hidden().child(text || " "));
        }))
        .track_scroll(this.lineScroll).size_full()
        .on_item_click((key, cx) => { this.line = Number(key); cx.notify(); })))
      .child(Scrollbar.vertical("files-lines").viewport_from_layout().absolute().inset_0());
  }

  render(cx) {
    if (key() !== this.context?.key) this.refresh(cx);
    const t = theme(), keys = this.handle.is_focused();
    return v_flex().id("files").relative().size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(keys ? t.accent : t.border).text_color(t.foreground).text_size(13)
      .track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .on_mouse_down("left", () => this.handle.focus())
      .on_size_change((size, cx) => { this.size = size; cx.notify(); })
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .when(Boolean(this.file), el => el.child(div().id("files-back").w(20).cursor_pointer().text_color(t.muted).on_click((_e, cx) => this.back(cx)).child("←")))
        .child(div().font_semibold().child("Files"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(this.file ?? this.root?.split(/[\\/]/).pop() ?? "")))
      .child(this.file ? this.preview(t, keys) : this.tree(t, keys))
      .child(keybar(t, { id: "files", chips: this.file ? KEYS.preview : KEYS.tree, width: this.size?.width, onKeys: cx => { this.keysOpen = true; this.handle.focus(); cx.notify(); } }))
      .when(Boolean(this.keysOpen), el => el.child(keysCard(t, { id: "files", title: "Files: all keys", onClose: cx => { this.keysOpen = false; cx.notify(); }, groups: [
        { title: "Tree", chips: KEYS.treeAll }, { title: "Preview", chips: KEYS.previewAll }, { title: "Everywhere", chips: KEYS.everywhere }] })));
  }
}
