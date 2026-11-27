// The Git panel as a workbench: four columns, Branches · History · Files · Diff, showing as many as fit
// (the expanded tab shows all four). Everything works from the keyboard with vim-ish moves and
// lazygit's letters, and everything works with the mouse: click, shift-click / cmd-click ranges,
// double-click, right-click menus and dragging commits or branches onto each other.
// Writes run in core terminals whose output stays in a copyable log; conflicts, hook failures and
// review notes hand off to an agent. Every action lives in one table per row type (actions()):
// the keys, the right-click / x menu, the footer and the ? card are all built from it.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea, Editor, EditorState, Scrollbar, ScrollHandle, v_virtual_list, VirtualListScrollHandle } from "gpui-base";
import { keybar, keysCard, keycap } from "./keybar.js";
import { spaces, panes, focused, agents, knownAgents, exec, hc, run, theme, settings, props, appHome, watchFolder, nextCommand, readTextFile, setShared, shared, layout } from "herdr";
import * as G from "./git.js";
import { graphCell } from "./graph.js";
import { SelfUpdate } from "./update.js";
import { closePanel, hidePanel, revealPanel, pathTo, panelOnScreen, focusTab } from "./panel.js";
import { loadFileDiff, loadFolderDiff, loadRevFiles, loadRevFileDiff, treeRows, patchFor, snippetOf, lineOf, sidesOf, incomingPaths, loadConflict, resolveBlock } from "./files.js";

const commitDraft = root => (shared("git.commitDrafts") ?? {})[root] ?? "";
function setCommitDraft(root, msg) {
  const all = { ...(shared("git.commitDrafts") ?? {}) };
  if (msg) all[root] = msg; else delete all[root];
  setShared("git.commitDrafts", all);
}

const ROW = 28, HROW = 40, LINE = 18;
const FIXED_W = { 0: 260, 2: 290 };
// "16 minutes ago" → "16m".
const short = d => String(d ?? "").replace(/ ago$/, "").replace(/^(\d+) (second|minute|hour|day|week|month|year)s?(, .*)?$/, (_m, n, u) => `${n}${{ second: "s", minute: "m", hour: "h", day: "d", week: "w", month: "mo", year: "y" }[u]}`);
const CHROME = "mods/workspace-chrome";
const ZONES = [
  { id: "branches", key: "1", title: "Branches" },
  { id: "history", key: "2", title: "History" },
  { id: "files", key: "3", title: "Files" },
  { id: "diff", key: "4", title: "Diff" },
];
const PR_COLOR = { OPEN: "ansi2", MERGED: "ansi5", CLOSED: "ansi1" };
const { q } = G;
// Files rows: a press left of this x toggles staging (the checkbox).
const CHECK_W = 30;
const changeRow = r => r?.kind === "add" || r?.kind === "del";
const lineRow = r => changeRow(r) || ["ctx", "ours", "theirs", "base"].includes(r?.kind);
// Diffs up to this many rows are drawn as plain rows (clicks, shift-click and drag select);
// longer ones as a virtual list (keys and plain clicks).
const PLAIN_ROWS = 2000;
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

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
const CONTEXTS = {
  global: () => true,
  files: v => v.zone === 2 && v.subject().kind === "wip",
  localBranches: v => v.zone === 0 && v.selected(0)?.kind === "local",
  remoteBranches: v => v.zone === 0 && v.selected(0)?.kind === "remote",
  commits: v => v.zone === 1 && Boolean(v.selected(1)?.sha),
  stash: v => v.zone === 0 && v.selected(0)?.kind === "stash",
};

function keyOf(e) {
  const m = e.modifiers ?? {};
  if (m.control || m.platform || m.alt) return e.keystroke;
  if (["enter", "escape", "tab", "space", "up", "down", "left", "right", "backspace", "pageup", "pagedown", "home", "end"].includes(e.key))
    return m.shift && ["tab", "up", "down"].includes(e.key) ? `shift-${e.key}` : e.key;
  return e.key_char ?? (m.shift ? e.key.toUpperCase() : e.key);
}

function lineKind(text) {
  if (/^(diff --git|index |--- |\+\+\+ |new file|deleted file|similarity|rename |old mode|new mode)/.test(text)) return { kind: "file", text };
  if (text.startsWith("@@")) return { kind: "hunk", text };
  if (text.startsWith("+")) return { kind: "add", text };
  if (text.startsWith("-")) return { kind: "del", text };
  if (/^(commit |Author:|AuthorDate:|Commit:|CommitDate:|Merge:|── )/.test(text)) return { kind: "meta", text };
  return { kind: "", text };
}

const zoomOf = () => Number(settings().zoom ?? 1) || 1;

export default class Git extends View {
  init(_props, cx) {
    this.selfUpdate = new SelfUpdate("git", "Git panel"); this.selfUpdate.start(cx);
    this.handle = cx.focus_handle();
    // A reload runs init on the same copy: drop overlays the old code opened (their handlers are gone).
    this.prompt = null; this.menu = null; this.commitBox = null; this.switcher = null; this.typing = false; this.keysOpen = false;
    // Props read later can belong to another copy, so read them once.
    const p = props();
    this.fixed = p?.cwd ? { cwd: p.cwd, on: p.on ?? null } : null;
    // Which expanded tab this copy is in: expand() names it with a token (tabs from before: the only Git pane).
    this.token = p?.token ?? null;
    if (this.fixed) cx.timer.after(150, () => this.handle.focus());
    this.scrolls = Object.fromEntries([...ZONES.map(z => z.id), "main"].map(k => [k, VirtualListScrollHandle.new()]));
    this.diffScroll = ScrollHandle.new();
    this._zone = 1; this.branchTab = "local"; this.sel = { branches: 0, history: 0, files: 0 }; this.filter = {}; this.scope = "head";
    this.log = []; this.seq = 0; this.copied = []; this.undoStack = [];
    this.mainTop = 0; this.mainToken = 0; this.cur = 0; this.anchor = null;
    this.rangeAnchor = null; this.picks = new Set(); this.stashRef = null; this.detail = null; this.detailToken = 0;
    this.drag = null; this.dragStart = null; this.ctxPending = null; this.gToken = 0;
    // Files as a tree (t: flat); folded folders by path ("" is "/"). Folded branch groups are kept across restarts.
    this.folded = new Set(); this.flat = shared("git.flatFiles") !== false;
    this.foldedGroups = new Set(shared("git.foldedGroups") ?? []);
    // A reload or restart while the panel was widened: this copy puts the width back.
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
        try {
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
          // One key for both (cmd-g): the side panel expands, the expanded tab collapses.
          else if (c === "toggle") { if (this.fixed) this.collapse(); else this.expand(cx); }
          else if (c.startsWith("go:")) this.go(c.slice(3));
          else if (c.startsWith("key:")) { const k = c.slice(4); this.menu ? this.menuKey(k, cx) : this.handleKey(k, cx); }
        } catch (e) { this.flash(`git.${c}: ${e?.message ?? e}`, 6000); } // a failing command must not end the loop
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

  // The column with the keyboard: 0 branches, 1 history, 2 files, 3 the diff.
  get zone() { return this._zone; }
  set zone(z) { this._zone = Math.max(0, Math.min(3, z)); }
  // The diff has the keyboard (the old panel's "main focus").
  get mainFocus() { return this._zone === 3; }
  set mainFocus(v) { if (v) this._zone = 3; else if (this._zone === 3) this._zone = 2; }

  setZone(z, cx) {
    const before = this.zone;
    this.zone = z;
    if (this.zone === 3 && this.main?.diff) { this.clampCursor(); this.revealCursor(); }
    if (this.zone !== before) this.ctxPending = null;
    this.handle.focus();
    cx?.notify();
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

  commitTarget() { return this.scope === "all" ? ["--all"] : this.scope?.ref ? [this.scope.ref] : ["HEAD"]; }

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
          Object.assign(this, { status: null, op: null, branches: null, commits: null, stash: null, prs: null, main: null, mainOverride: null, detail: null,
            sel: { branches: 0, history: 0, files: 0 }, filter: {}, copied: [], folded: new Set(), scope: "head", stashRef: null, rangeAnchor: null, picks: new Set(), undoStack: [] });
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
        this.numstat = await G.numstat(ctx).catch(() => null);
        const opKey = op ? `${op.kind}:${op.other}:${op.current ?? ""}` : null;
        if (opKey !== this.incoming?.key) this.incoming = op ? { key: opKey, paths: await incomingPaths(ctx, op).catch(() => new Set()) } : null;
        if (heavy) {
          const [branches, commits, stash] = await Promise.all([G.loadBranches(ctx, this.base), G.loadCommits(ctx, this.commitTarget(), this.base), G.loadStash(ctx)]);
          if (ctx !== this.ctx) return;
          // The cursors stay on the same commit and branch when the lists change under them.
          const keepCommit = this.keepHistory === false ? null : this.selected(1)?.sha, keepBranch = this.itemKey(0, this.selected(0));
          Object.assign(this, { branches, commits, stash, lastHeavy: Date.now() });
          this.keepHistory = true;
          if (keepCommit) { const i = this.items(1).findIndex(r => r.sha === keepCommit); if (i >= 0) this.sel.history = i; }
          const bi = this.items(0).findIndex(r => this.itemKey(0, r) === keepBranch);
          if (bi >= 0) this.sel.branches = bi;
        }
        if (Date.now() - (this.prsAt ?? 0) > 120000) {
          this.prsAt = Date.now();
          cx.spawn(async cx => { const prs = await G.loadPRs(ctx); if (prs && ctx === this.ctx) { this.prs = prs; cx.notify(); } });
        }
        this.syncDetail(cx);
        this.syncMain(cx, true);
      } catch (e) { this.flash(`Refresh failed: ${e}`); }
      finally {
        this.refreshing = false; cx.notify();
        if (this.again) { const h = this.again === "heavy"; this.again = null; this.refresh(cx, h); }
      }
    });
  }

  // ---- Lists ----------------------------------------------------------------------

  // Branches: the tab's list (Local, Remote or Stashes, chosen in the column's header). Remote groups
  // its branches under a foldable header per remote when there is more than one.
  branchRows() {
    const f = this.filter.branches?.toLowerCase(), b = this.branches, match = s => !f || s.toLowerCase().includes(f);
    this.branchIndent = false;
    if (this.branchTab === "stash") return (this.stash ?? []).map(s => ({ kind: "stash", ...s })).filter(s => match(s.message));
    if (this.branchTab !== "remote") return (b?.local ?? []).filter(x => match(`${x.name} ${x.subject}`));
    const remotes = new Map();
    for (const r of b?.remote ?? []) {
      if (!remotes.has(r.remote)) remotes.set(r.remote, []);
      if (match(`${r.name} ${r.subject}`)) remotes.get(r.remote).push(r);
    }
    if (remotes.size <= 1) return [...remotes.values()].flat();
    const rows = [];
    this.branchIndent = true;
    for (const [name, list] of remotes) {
      if (!list.length && f) continue;
      const id = `remote:${name}`, open = Boolean(f) || !this.foldedGroups.has(id);
      rows.push({ kind: "group", id, title: name, count: list.length, open });
      if (open) rows.push(...list);
    }
    return rows;
  }

  // [ / ] and the header's tabs: Local, Remote, Stashes.
  setBranchTab(tab, cx) {
    if (tab === this.branchTab) return;
    this.branchTab = tab; this.sel.branches = 0;
    this.scrolls.branches.scroll_to_item(0);
    cx.notify();
  }

  // History: the working tree on top, then the commits of the scope (this branch, all, or one branch's log).
  historyRows() {
    const f = this.filter.history?.toLowerCase(), commits = this.commits ?? [];
    return [{ kind: "wip" }, ...(f ? commits.filter(c => `${c.short} ${c.subject} ${c.author} ${c.refs.join(" ")}`.toLowerCase().includes(f)) : commits)];
  }

  // Files of the subject: the working tree's (a tree, or flat with t or a filter), or a commit's / stash's.
  fileRows() {
    const s = this.subject(), f = this.filter.files?.toLowerCase();
    if (s.kind === "wip") {
      const files = this.status?.files ?? [];
      if (this.flat || f) return files.filter(x => !f || x.path.toLowerCase().includes(f)).map(x => ({ kind: "file", path: x.path, file: x, depth: 0 }));
      return files.length ? treeRows(files, this.folded) : [];
    }
    return (this.detail?.files ?? []).filter(x => !f || x.path.toLowerCase().includes(f)).map(x => ({ kind: "file", path: x.path, file: x, depth: 0, ro: true }));
  }

  items(z = this.zone) { return z === 0 ? this.branchRows() : z === 1 ? this.historyRows() : z === 2 ? this.fileRows() : []; }
  selIndex(z = this.zone) { const n = this.items(z).length; return Math.max(0, Math.min(this.sel[ZONES[z].id] ?? 0, n - 1)); }
  selected(z = this.zone) { return z > 2 ? null : this.items(z)[this.selIndex(z)] ?? null; }

  itemKey(z, it, i) {
    if (!it) return null;
    if (z === 0) return it.kind === "group" ? `g:${it.id}` : it.kind === "stash" ? `s:${it.ref}` : `${it.kind[0]}:${it.name}`;
    if (z === 1) return it.kind === "wip" ? "wip" : it.sha;
    return `${it.kind === "dir" ? "d" : "f"}:${it.path}:${i}`;
  }

  move(delta, cx, absolute, z = this.zone) {
    if (z > 2) return;
    const items = this.items(z);
    if (!items.length) return;
    let i = absolute != null ? absolute : this.selIndex(z) + delta;
    i = Math.max(0, Math.min(i, items.length - 1));
    this.sel[ZONES[z].id] = i;
    this.scrolls[ZONES[z].id].scroll_to_item(i);
    if (z === 1) { this.stashRef = null; this.syncDetail(cx); }
    if (z === 2) { this.mainOverride = null; this.syncMain(cx); }
    cx.notify();
  }

  // What Files and the diff show: the working tree, the history cursor's commit, or a stash (enter on one).
  subject() {
    if (this.stashRef) { const s = (this.stash ?? []).find(x => x.ref === this.stashRef); if (s) return { kind: "stash", s }; }
    const r = this.selected(1);
    return r?.sha ? { kind: "commit", c: r } : { kind: "wip" };
  }

  syncDetail(cx) {
    const s = this.subject(), ctx = this.ctx;
    const key = s.kind === "wip" ? "wip" : s.kind === "commit" ? `c:${s.c.sha}` : `s:${s.s.ref}:${s.s.message}`;
    if (key === this.detail?.key) return;
    const was = this.detail?.key;
    this.detail = { key, files: s.kind === "wip" ? null : undefined };
    if (was) { this.sel.files = 0; this.mainOverride = null; }
    if (s.kind !== "wip" && ctx) {
      const token = ++this.detailToken, detail = this.detail;
      cx.spawn(async cx => {
        const files = s.kind === "commit" ? await loadRevFiles(ctx, s.c.sha, s.c.parents[0] ?? null) : await loadRevFiles(ctx, s.s.ref, `${s.s.ref}^1`);
        if (token !== this.detailToken) return;
        detail.files = files;
        this.syncMain(cx); cx.notify();
      });
    }
    this.syncMain(cx);
  }

  // History rows picked as a group: a range (v, shift-click) or single picks (cmd-click), newest first.
  selectedCommits() {
    const rows = this.items(1);
    if (this.rangeAnchor) {
      const a = rows.findIndex(r => r.sha === this.rangeAnchor), b = this.selIndex(1);
      if (a < 0) return [];
      return rows.slice(Math.min(a, b), Math.max(a, b) + 1).filter(r => r.sha);
    }
    if (this.picks.size) return rows.filter(r => r.sha && this.picks.has(r.sha));
    return [];
  }
  rangeRows() { return this.selectedCommits(); }
  contiguous(list) {
    const rows = this.items(1), idx = list.map(c => rows.indexOf(c));
    return idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
  }
  clearRange() { this.rangeAnchor = null; this.picks = new Set(); }

  // ---- Main view (the diff column) -------------------------------------------------

  mainSpec() {
    const ctx = this.ctx, s = this.subject(), it = this.selected(2);
    if (!ctx) return null;
    if (s.kind === "wip") {
      if (!it) return null;
      if (it.kind === "dir") return { key: `d:${it.path}`, title: it.path || "/", path: it.path, diff: () => loadFolderDiff(ctx, it.path, this.status?.files ?? []) };
      return { key: `f:${it.path}`, title: it.path, path: it.path, diff: () => it.file.conflict ? loadConflict(ctx, it.file, this.sides()) : loadFileDiff(ctx, it.file) };
    }
    if (this.detail?.files == null) return null;
    if (!it) return s.kind === "commit" ? { key: `c:${s.c.sha}`, title: `${s.c.short} · ${s.c.subject}`, load: () => G.commitShow(ctx, s.c.sha) } : null;
    const rev = s.kind === "commit" ? s.c.sha : s.s.ref, parent = s.kind === "commit" ? s.c.parents[0] ?? null : `${s.s.ref}^1`;
    return { key: `r:${rev}:${it.path}`, title: it.path, path: it.path, diff: () => loadRevFileDiff(ctx, rev, it.file, parent) };
  }

  syncMain(cx, force) {
    const spec = this.mainOverride ?? this.mainSpec();
    if (!spec) { this.main = null; return; }
    if (spec.log) { this.showLogEditor(spec.log); this.main = { key: spec.key, log: spec.log }; return; }
    if (spec.key === this.main?.key && !force) return;
    const same = spec.key === this.main?.key;
    this.main = { key: spec.key, title: spec.title, path: spec.path, rows: same ? this.main.rows : null, diff: same ? this.main.diff : null, notesSig: same ? this.main.notesSig : null, width: same ? this.main.width : 0 };
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
    cx.spawn(async cx => {
      const lines = await spec.load().catch(e => [String(e)]);
      if (token !== this.mainToken) return;
      main.rows = lines.map(l => lineKind(l.replace(/\t/g, "    ")));
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
    const notes = this.subject().kind !== "wip" ? [] : this.notes().filter(n => main.diff.folder ? this.under(main.path, n.path) : n.path === main.path), sig = notes.map(n => n.id).join(",");
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
    const row = this.selected(2);
    this.folded = fold ? new Set(treeRows(this.status?.files ?? [], new Set()).filter(r => r.kind === "dir" && !r.root).map(r => r.path)) : new Set();
    // The selection climbs to its outermost folded folder.
    const top = row && fold ? treeRows(this.status?.files ?? [], this.folded).find(r => r.kind === "dir" && !r.root && this.under(r.path, row.path)) : row;
    this.keepSelected(top ?? row, cx);
  }
  keepSelected(row, cx) {
    const i = this.items(2).findIndex(r => row && r.kind === row.kind && r.path === row.path);
    if (i >= 0) this.sel.files = i;
    this.mainOverride = null; this.syncMain(cx); cx.notify();
  }
  toggleFlat(cx) {
    const row = this.selected(2);
    this.flat = !this.flat; setShared("git.flatFiles", this.flat);
    this.keepSelected(row?.kind === "file" ? row : null, cx);
    this.flash(this.flat ? "Files: flat list" : "Files: tree");
  }
  // Branch groups (Local, each remote, Stashes) fold like folders; kept across restarts.
  toggleGroup(id, cx) {
    if (this.foldedGroups.has(id)) this.foldedGroups.delete(id); else this.foldedGroups.add(id);
    setShared("git.foldedGroups", [...this.foldedGroups]);
    const i = this.items(0).findIndex(r => r.kind === "group" && r.id === id);
    if (i >= 0) this.sel.branches = i;
    cx.notify();
  }
  // J / K in the diff: the next / previous file row (folders skipped).
  nextFile(dir, cx) {
    const items = this.items(2);
    let i = this.selIndex(2) + dir;
    while (i >= 0 && i < items.length && items[i].kind !== "file") i += dir;
    if (i >= 0 && i < items.length) this.move(0, cx, i, 2);
  }

  // The operation's two sides, named (null when no merge / rebase / pick is running).
  sides() { return sidesOf(this.op, this.status?.info?.head); }
  fromIncoming(path) { return Boolean(this.incoming?.paths?.has(path)); }

  revealCursor() {
    if ((this.main?.rows?.length ?? 0) > PLAIN_ROWS) this.scrolls.main.scroll_to_item(this.cur);
    else this.diffScroll.scroll_to_item(this.cur);
  }

  // A press on a diff line: the cursor goes there; shift extends the selection from the cursor;
  // holding the button and moving selects the lines dragged over. A double press writes a note.
  pressLine(i, e, cx) {
    const rows = this.main?.rows ?? [];
    if (!lineRow(rows[i])) return;
    this.handle.focus();
    this.mainFocus = true;
    if (e?.modifiers?.shift) { if (this.anchor == null) this.anchor = this.cur; this.cur = i; }
    else { this.cur = i; this.anchor = null; this.dragging = i; }
    if (e?.click_count === 2 && this.subject().kind === "wip") { this.dragging = null; this.addNote(cx); }
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
    if (r?.side === "commit") { this.flash("This change is committed: nothing to stage"); return; }
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
    if (r?.side === "commit") { this.flash("This change is committed: revert the commit instead (t in History)"); return; }
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
    if (this.subject().kind !== "wip") { this.flash("Notes are for uncommitted changes"); return; }
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
    }, cx, { hint: "What should change here? Enter saves; p sends your notes to an agent" });
  }

  // Ask AI (the diff's button, A): a question about this file's change, or the selected lines,
  // with the diff in the prompt; then where to send it.
  askAbout(cx) {
    const m = this.main, ctx = this.ctx, f = m?.path != null ? { path: m.diff?.folder ? `${m.path || "."}/` : m.path } : null;
    if (!f || !m?.diff || !ctx) return;
    const rows = m.rows ?? [], sides = this.sides(), s = this.subject();
    const [a, b] = this.anchor == null ? [0, rows.length - 1] : [Math.min(this.anchor, this.cur), Math.max(this.anchor, this.cur)];
    const part = rows.slice(a, b + 1), picked = this.anchor != null;
    const text = r => r.kind === "section" ? `## ${r.text}` : r.kind === "hunk" ? r.text
      : r.kind === "mark" ? (r.part === "ours" ? `<<<<<<< ${sides?.ours ?? "current"}` : r.part === "theirs" ? `======= (below: ${sides?.theirs ?? "incoming"})` : "||||||| base")
        : r.kind === "note" ? null : ({ add: "+", del: "-", ours: " ", theirs: " ", base: " " }[r.kind] ?? " ") + (r.text ?? "");
    let lines = part.map(text).filter(x => x != null);
    if (lines.length > 400) lines = [...lines.slice(0, 400), `… (${lines.length - 400} more lines)`];
    const what = picked ? `${f.path}:${lineOf(part.find(lineRow)) ?? ""}-${lineOf([...part].reverse().find(lineRow)) ?? ""}` : f.path;
    const name = m.diff.folder ? `${m.path.split("/").pop() || "/"}/` : f.path.split("/").pop();
    const about = s.kind === "commit" ? `the change commit ${s.c.short} ("${s.c.subject}") made to ` : s.kind === "stash" ? `the change ${s.s.ref} holds for ` : "the uncommitted change to ";
    this.ask(`Ask AI about ${picked ? `these ${part.filter(lineRow).length} lines of ` : ""}${name}`, "", (question, cx) => {
      const head = this.status?.info?.head;
      const prompt = [
        `About ${picked ? "these lines of " : about}${what} in ${ctx.root}${head ? ` (branch ${head})` : ""}${sides ? `, during a ${this.op.kind}: ${sides.ours} vs ${sides.theirs}` : ""}:`,
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

  // Keys while the diff has the keyboard. False: not a diff key.
  diffKey(k, cx) {
    const rows = this.main?.rows ?? [];
    switch (k) {
      // Hunk to hunk; while selecting lines (v), line by line.
      case "j": case "down": if (this.anchor != null) this.cursorTo(this.cur + 1, 1); else this.hunkJump(1); break;
      case "k": case "up": if (this.anchor != null) this.cursorTo(this.cur - 1, -1); else this.hunkJump(-1); break;
      case "ctrl-d": case "pagedown": this.cursorTo(this.cur + 15, 1); break;
      case "ctrl-u": case "pageup": this.cursorTo(this.cur - 15, -1); break;
      case "<": case "home": case "gg": this.cursorTo(0, 1); break;
      case ">": case "end": case "G": this.cursorTo(rows.length - 1, -1); break;
      case "}": this.hunkJump(1); break;
      case "{": this.hunkJump(-1); break;
      case "A": this.askAbout(cx); break;
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
      case "escape":
        this.dragging = null;
        if (this.anchor != null) this.anchor = null; else this.setZone(2, cx);
        break;
      default: return false;
    }
    cx.notify();
    return true;
  }

  // ---- Width ------------------------------------------------------------------------

  // The panel no longer widens itself (it took the keyboard away when it opened). A width an older
  // version widened to is put back once.
  syncWidth() {
    if (!this.widened) return;
    const w = this.widened;
    this.widened = null;
    setShared("git.widened", null);
    if (!w.skip && w.id) run("layout.resize", { id: w.id, px: w.from });
  }

  // ---- Running commands ------------------------------------------------------

  flash(text, ms = 3500) { this.flashMsg = { text, until: Date.now() + ms }; }

  // term: a core terminal through the login shell (hooks, network, prompts); otherwise exec.
  // undo: remember where HEAD was, so u can put it back (git reset --keep).
  cmd(title, script, cx, opts = {}) {
    const { term = true, after, onFail, undo = false } = opts;
    if (!this.ctx) return;
    if (this.running) { this.flash("Wait for the running git command to finish"); cx.notify(); return; }
    const ctx = this.ctx, entry = { id: ++this.seq, title, script, opts, code: null, output: "", at: Date.now(), running: true };
    const branch = this.status?.info?.head;
    this.log.unshift(entry); this.running = entry; this.failure = null;
    cx.notify();
    cx.spawn(async cx => {
      const headNow = async () => (await G.git(ctx, ["rev-parse", "-q", "--verify", "HEAD"]).catch(() => null))?.stdout?.trim() || null;
      const before = undo ? await headNow() : null;
      let r;
      if (term) r = await G.runScript(ctx, script, this.shell ?? "/bin/zsh", addr => { entry.addr = addr; cx.notify(); });
      else {
        const e = await exec("sh", ["-c", script], { cwd: ctx.root, on: ctx.on }).catch(e => ({ code: -1, stdout: "", stderr: String(e) }));
        r = { code: e.code, output: [e.stdout, e.stderr].filter(Boolean).join("\n").trim() };
      }
      Object.assign(entry, { code: r.code, output: r.output, running: false, addr: null });
      this.running = null;
      const op = await G.loadOp(ctx).catch(() => null);
      if (r.code === 0) {
        if (before) {
          const now = await headNow();
          if (now && now !== before) { this.undoStack.push({ title, before, after: now, branch, soft: undo === "soft" }); if (this.undoStack.length > 30) this.undoStack.shift(); }
        }
        after?.(cx);
      } else {
        onFail?.(cx);
        // A merge or rebase that stopped on conflicts shows in the banner, not as a failure;
        // anything else (a hook failing `merge --continue`, say) is a failure even mid-op.
        const conflicted = op ? (await exec("git", ["diff", "--name-only", "--diff-filter=U"], { cwd: ctx.root, on: ctx.on }).catch(() => null))?.stdout?.trim() : "";
        if (!conflicted) { this.failure = entry; this.showOutput(entry, cx); }
      }
      if (this.mainOverride?.log === entry) this.syncMain(cx, true);
      this.refresh(cx, true);
      cx.notify();
    });
  }

  // u: puts the branch back where it was before the last commit, amend, rewrite, merge, pull or reset
  // made from this panel. A commit or amend comes back as staged changes (--soft); a rewrite that left
  // the files as they were (squash, reword, move) keeps the index as it is (--soft too); anything else
  // (a merge, a pull, a drop) uses --keep, which leaves uncommitted changes alone and refuses if they'd be lost.
  undo(cx) {
    const u = this.undoStack.at(-1), head = this.status?.info?.head;
    if (!u) { this.flash("Nothing to undo: u undoes commits, amends, rewrites, merges, pulls and resets made here"); cx.notify(); return; }
    if (u.branch !== head) { this.flash(`The last change was on ${u.branch}: switch back to it to undo`); cx.notify(); return; }
    const later = this.status?.info?.oid !== u.after;
    this.confirm(`Undo “${u.title}”? ${head} goes back to ${u.before.slice(0, 7)}${later ? " (commits made since go too)" : ""}. Uncommitted changes stay.`, "Undo", cx => {
      this.undoStack.pop();
      const b = q(u.before), same = `[ "$(git rev-parse HEAD)" = ${q(u.after)} ]`;
      const script = u.soft ? `if ${same}; then git reset --soft ${b}; else git reset --keep ${b}; fi`
        : `if ${same} && [ "$(git rev-parse HEAD^{tree})" = "$(git rev-parse ${b}^{tree})" ]; then git reset --soft ${b}; else git reset --keep ${b}; fi`;
      this.cmd(`undo: ${u.title}`, script, cx, { term: false });
    }, cx);
  }

  confirm(title, label, action, cx, lines) {
    this.openMenu(title, [{ key: "y", label, danger: true, run: action }, { key: "n", label: "Cancel", run: () => {} }], cx, lines);
  }

  // `at`: {x, y} in the panel (a right-click or a drop); otherwise centered.
  openMenu(title, items, cx, lines, at) {
    this.menu = { title, items: items.filter(Boolean), sel: 0, lines, at: at ?? null };
    cx.notify();
  }

  menuKey(k, cx) {
    const m = this.menu;
    if (k === "escape" || k === "q") { this.menu = null; }
    else if (k === "j" || k === "down") m.sel = Math.min(m.items.length - 1, m.sel + 1);
    else if (k === "k" || k === "up") m.sel = Math.max(0, m.sel - 1);
    else {
      const item = k === "enter" ? m.items[m.sel] : m.items.find(i => i.key === k) ?? (k === "space" ? m.items[m.sel] : null);
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

  // / : filters the column with the keyboard (Diff has none).
  startFilter(cx) {
    const z = Math.min(this.zone, 2), id = ZONES[z].id;
    if (this.zone === 3) this.setZone(2, cx);
    this.ask(`Filter ${ZONES[z].title.toLowerCase()}`, this.filter[id] ?? "", (v, cx) => { this.filter[id] = v; }, cx,
      { live: (v, cx) => { this.filter[id] = v; this.sel[id] = 0; if (z === 1) this.syncDetail(cx); if (z === 2) this.syncMain(cx); } });
  }

  // ---- Branch switcher (b, or a click on the branch name) -----------------------------

  openSwitcher(cx) {
    if (!this.ctx) return;
    const input = InputState.new({ placeholder: "Switch to a branch, or type a new name…" });
    input.on("change", (_e, cx) => { if (this.switcher) this.switcher.sel = 0; cx.notify(); });
    input.on("submit", (_e, cx) => this.pickSwitch(cx));
    input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.switcher = { input, sel: 0 };
    this.typing = true;
    input.focus();
    cx.notify();
  }

  closeSwitcher(cx) {
    this.switcher?.input.release();
    this.switcher = null; this.typing = false; this.handle.focus(); cx.notify();
  }

  // Locals (most recent first), then remotes nobody tracks; letters in order match ("pfl" finds perf-lab).
  switchMatches() {
    const query = this.switcher?.input.value().trim() ?? "", ql = query.toLowerCase();
    const fz = name => { let i = 0; for (const ch of name.toLowerCase()) if (ch === ql[i]) i++; return i === ql.length; };
    const local = this.branches?.local ?? [], remote = (this.branches?.remote ?? []).filter(r => !r.local);
    const out = [...local, ...remote].filter(b => fz(b.name)).slice(0, 12);
    if (query && !local.some(b => b.name === query)) out.push({ kind: "create", name: query });
    return out;
  }

  pickSwitch(cx) {
    const list = this.switchMatches(), b = list[Math.min(this.switcher?.sel ?? 0, list.length - 1)];
    this.closeSwitcher(cx);
    if (b) this.checkout(b, cx);
  }

  // Switch to a branch row: a local one, a remote one (its local, or a new tracking branch),
  // one checked out in another worktree (its space), or a new one ("create").
  checkout(b, cx) {
    if (b.kind === "create") return this.cmd(`git switch -c ${b.name}`, `git switch -c ${q(b.name)}`, cx);
    if (b.kind === "remote") return b.local
      ? this.cmd(`git switch ${b.local}`, `git switch ${q(b.local)}`, cx)
      : this.cmd(`git switch -c ${b.short} --track ${b.name}`, `git switch -c ${q(b.short)} --track ${q(b.name)}`, cx);
    if (b.head) { this.flash(`Already on ${b.name}`); cx.notify(); return; }
    // Git won't check a branch out twice: go to its worktree's space instead (opening one if none).
    if (b.worktree) return this.openWorktree(b.worktree);
    this.cmd(`git switch ${b.name}`, `git switch ${q(b.name)}`, cx);
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
      /--continue\b/.test(entry.title) ? "Every conflict is already resolved and staged, so this is most likely a commit hook (lint, type-check, tests). Please fix the reported problems and `git add` the fixes, but don't run the continue, commit or push yourself: I'll continue from the panel."
        : commit ? "This is most likely the pre-commit hook. Please fix the reported problems and `git add` the fixes, but don't commit: I'll re-run the commit myself."
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
    if (!prompt) { this.flash(want === "notes" ? "No review notes yet: in the diff, a on a line" : "Nothing to hand off: no conflicts, failed command or review notes"); cx.notify(); return; }
    this.pickAgent(prompt, label, cx, sent, `Ask AI to ${label}`);
  }

  // Where a prompt goes: an agent in this space, a new agent tab, or the clipboard.
  pickAgent(prompt, label, cx, sent, title) {
    const space = spaces().find(s => s.active);
    const here = agents().filter(a => a.space === space?.id);
    const fresh = this.known?.find(k => k.installed);
    this.openMenu(title ?? `Ask AI: ${label}`, [
      ...here.slice(0, 8).map((a, i) => ({ key: String(i + 1), label: `Send to ${a.program?.name ?? a.app ?? "agent"} · ${a.tab_name === (a.program?.name ?? a.app) ? `tab ${a.tab_index}` : a.tab_name}`, hint: a.status, run: cx => this.sendToAgent(a, prompt, label, cx, sent) })),
      fresh && { key: "n", label: `New ${fresh.name} tab`, run: () => { run("tab.new", { argv: fresh.run, task: prompt, folder: this.ctx.root, name: `AI · ${label}` }); this.ai = { label, address: null, failure: this.failure }; sent?.(); } },
      { key: "y", label: "Copy prompt", run: cx => { cx.write_to_clipboard(prompt); this.flash("Prompt copied"); } },
    ], cx);
  }

  sendToAgent(agent, prompt, label, cx, sent) {
    cx.spawn(async cx => {
      const r = await hc(["send", agent.address, prompt]).catch(e => ({ code: 1, stderr: String(e) }));
      if (r.code !== 0) this.flash(`Couldn't send: ${(r.stderr || r.stdout).trim()}`, 6000);
      else { this.ai = { label, address: agent.address, failure: this.failure }; sent?.(); }
      cx.notify();
    });
  }

  // ---- History rewriting ---------------------------------------------------------

  async baseOf(sha, depth) {
    const r = await G.git(this.ctx, ["rev-parse", "-q", "--verify", `${sha}~${depth}`]).catch(() => null);
    return r?.code === 0 ? `${sha}~${depth}` : "--root";
  }

  rewrite(title, c, cx, build) { this.rewriteMany(title, [c], cx, build); }

  // A history rewrite touching `commits` (asks first when any is pushed). The
  // range ends with it unless `keepRange` (moving a block keeps it selected).
  rewriteMany(title, commits, cx, build, { keepRange = false, terminal = false } = {}) {
    if (this.scope !== "head") { this.flash("Rewrite commits from This branch: [ or ] to switch"); cx.notify(); return; }
    if (commits.some(c => c.parents.length > 1)) { this.flash("Can't rewrite a merge commit here"); cx.notify(); return; }
    const go = cx => cx.spawn(async cx => {
      const script = await build();
      if (!keepRange) this.clearRange();
      if (terminal) run("terminal.open", { argv: [this.shell ?? "/bin/zsh", "-lic", script], folder: this.ctx.root, place: "tab", name: title });
      else this.cmd(title, script, cx, { undo: true });
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

  // The commits a range or set of picks acts on. A range is next to each other; picks may not be.
  rangeActions(range, add) {
    const n = range.length, oldest = range.at(-1), shas = range.map(r => r.sha), list = shas.join(",");
    const many = (title, op, depth) => cx => this.rewriteMany(`${title} ${n} commits`, range, cx, async () => this.todo("replace", list, null, op, await this.baseOf(oldest.sha, depth)));
    const together = this.contiguous(range);
    if (together) {
      add("s", `Squash ${n} commits into the one below`, many("squash", "squash", 2), { chip: `squash ${n}` });
      add("f", `Fixup ${n} commits into the one below`, many("fixup", "fixup", 2), { chip: `fixup ${n}` });
    }
    add("d", `Drop ${n} commits`, cx => this.confirm(`Drop ${n} commits?`, "Drop commits", many("drop", "drop", 1), cx), { chip: `drop ${n}` });
    const rows = this.items(1), top = rows.indexOf(range[0]), bottom = rows.indexOf(oldest);
    const below = rows.slice(bottom + 1).find(r => r.sha), above = rows.slice(0, top).reverse().find(r => r.sha && r !== range[0]);
    const cursorBy = d => { this.sel.history = this.selIndex(1) + d; };
    if (together && below) add("ctrl-j", `Move ${n} commits down`, cx => this.rewriteMany(`move ${n} commits down`, [...range, below], cx, async () => {
      cursorBy(rows.indexOf(below) - bottom);
      return this.todo("move", list, below.sha, null, await this.baseOf(below.sha, 1));
    }, { keepRange: true }));
    if (together && above) add("ctrl-k", `Move ${n} commits up`, cx => this.rewriteMany(`move ${n} commits up`, [...range, above], cx, async () => {
      cursorBy(rows.indexOf(above) - top);
      return this.todo("move", list, above.sha, null, await this.baseOf(oldest.sha, 1));
    }, { keepRange: true }));
    add("C", `Mark ${n} commits for cherry-pick`, cx => { this.copied = [...new Set([...this.copied, ...shas])]; this.clearRange(); cx.notify(); });
    add("y", `Copy ${n} commit hashes`, cx => { cx.write_to_clipboard(shas.join("\n")); this.flash(`Copied ${n} hashes`); cx.notify(); });
    add("v", this.rangeAnchor ? "End the range" : "Clear the picks", cx => { this.clearRange(); cx.notify(); }, { chip: "clear" });
  }

  // Commits dropped on a commit (a drag in History): squash / fixup into it, or move them just above it.
  dropCommits(dragged, target, at, cx) {
    const rows = this.items(1), all = [...dragged, target];
    const oldest = all.reduce((a, c) => rows.indexOf(c) > rows.indexOf(a) ? c : a);
    const list = dragged.map(c => c.sha).join(","), n = dragged.length, what = n > 1 ? `${n} commits` : `“${dragged[0].subject}”`;
    const go = (title, op) => cx => this.rewriteMany(title, all, cx, async () => this.todo("onto", list, target.sha, op, await this.baseOf(oldest.sha, 1)));
    this.openMenu(`Drop ${what} on ${target.short} “${target.subject}”`, [
      { key: "s", label: "Squash into it", hint: "keeps both messages", run: go(`squash ${n} into ${target.short}`, "squash") },
      { key: "f", label: "Fixup into it", hint: "keeps its message", run: go(`fixup ${n} into ${target.short}`, "fixup") },
      { key: "m", label: "Move just above it", run: go(`move ${n} above ${target.short}`, "pick") },
      { key: "n", label: "Cancel", run: () => {} },
    ], cx, null, at);
  }

  // A branch dropped on a branch (a drag in Branches): merge or rebase one onto the other.
  dropBranch(src, dst, at, cx) {
    const head = this.status?.info?.head, from = src.name, to = dst.kind === "remote" ? dst.name : dst.name;
    const items = [];
    if (dst.head) {
      items.push({ key: "m", label: `Merge ${from} into ${to}`, run: cx => this.cmd(`git merge ${from}`, `git merge --no-edit ${q(from)}`, cx, { undo: true }) });
      items.push({ key: "n", label: `Merge commit (--no-ff)`, run: cx => this.cmd(`git merge --no-ff ${from}`, `git merge --no-ff --no-edit ${q(from)}`, cx, { undo: true }) });
    } else if (src.head) {
      items.push({ key: "r", label: `Rebase ${head} onto ${to}`, run: cx => this.cmd(`git rebase ${to}`, `git rebase --autostash ${q(to)}`, cx, { undo: true }) });
      items.push({ key: "u", label: "Rebase, updating stacked branches", hint: "--update-refs", run: cx => this.cmd(`git rebase --update-refs ${to}`, `git rebase --autostash --update-refs ${q(to)}`, cx, { undo: true }) });
    } else if (dst.kind === "local") {
      items.push({ key: "m", label: `Switch to ${to} and merge ${from}`, run: cx => this.cmd(`git switch ${to} && git merge ${from}`, `git switch ${q(to)} && git merge --no-edit ${q(from)}`, cx) });
    }
    if (src.kind === "local" && !src.worktree) items.push({ key: "b", label: `Rebase ${from} onto ${to}`, hint: "switches to it", run: cx => this.cmd(`git rebase ${to} ${from}`, `git rebase --autostash ${q(to)} ${q(from)}`, cx) });
    if (!items.length) { this.flash("Drop a branch on the current branch to merge, or the current branch on another to rebase"); cx.notify(); return; }
    this.openMenu(`Drop ${from} on ${to}`, [...items, { key: "c", label: "Cancel", run: () => {} }], cx, null, at);
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

  pull(cx, rebase) {
    this.cmd(rebase ? "git pull --rebase" : "git pull", rebase ? "git pull --rebase --autostash" : "git pull", cx, { undo: true });
  }

  // The ⌄ next to pull / push: every way to sync, and the custom commands from config.json.
  syncMenu(cx, at) {
    const custom = (this.config?.customCommands ?? []).filter(c => c.command && (c.context ?? "global") === "global");
    this.openMenu("Sync", [
      { key: "p", label: "Pull", run: cx => this.pull(cx) },
      { key: "r", label: "Pull, rebasing my commits", hint: "--rebase", run: cx => this.pull(cx, true) },
      { key: "P", label: "Push", run: cx => this.push(cx) },
      { key: "F", label: "Force push (with lease)", danger: true, run: cx => this.confirm("Force push? Commits on the remote that you don't have are replaced (lease: only if nobody pushed since your last fetch).", "Force push", cx => this.push(cx, true), cx) },
      { key: "f", label: "Fetch all remotes", hint: "--prune", run: cx => this.cmd("git fetch --all --prune", "git fetch --all --prune", cx, { after: () => { this.prsAt = 0; } }) },
      { key: "D", label: "Clean up merged / closed / gone branches", run: cx => this.cleanup(cx) },
      ...custom.map(c => ({ key: lazyKey(c.key ?? ""), label: c.description ?? c.command, hint: "custom", run: cx => this.runCustom(c, cx) })),
    ], cx, null, at);
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
      n > 0 && { key: "e", label: `Open conflicted file${n > 1 ? "s" : ""} in ${this.config?.editor ?? "editor"}`, run: () => openInEditor(this, this.conflicts().map(f => f.path)) },
      n > 0 && { key: "r", label: `Mark conflicted file${n > 1 ? "s" : ""} resolved`, hint: "git add", run: cx => this.cmd("git add (resolved)", `git add -- ${this.conflicts().map(f => q(f.path)).join(" ")}`, cx, { term: false }) },
    ], cx, this.conflicts().slice(0, 10).map(f => f.path));
  }

  // lazygit's template fields for the selection, for custom commands.
  fill(command) {
    const info = this.status?.info, b = this.selected(0), c = this.selected(1);
    const fields = {
      "CheckedOutBranch.Name": info?.head,
      "SelectedLocalBranch.Name": b?.kind === "local" ? b.name : null,
      "SelectedRemoteBranch.Name": b?.kind === "remote" ? b.short : null,
      "SelectedRemoteBranch.RemoteName": b?.kind === "remote" ? b.remote : null,
      "SelectedLocalCommit.Hash": c?.sha ?? null, "SelectedLocalCommit.Sha": c?.sha ?? null,
      "SelectedLocalCommit.Name": c?.subject ?? null,
      "SelectedStashEntry.Name": b?.kind === "stash" ? b.ref : null,
    };
    let missing = null;
    const text = command.replace(/\{\{\s*\.([\w.]+)\s*\}\}/g, (m, name) => { const v = fields[name]; if (v == null) missing = name; return v ?? ""; });
    return { text, missing };
  }

  runCustom(c, cx) {
    const { text, missing } = this.fill(c.command);
    if (missing) { this.flash(`Custom command needs {{.${missing}}}: select one first`); cx.notify(); return; }
    if (c.output === "terminal") run("terminal.open", { argv: [this.shell ?? "/bin/zsh", "-lic", text], folder: this.ctx.root, place: "tab" });
    else this.cmd(c.description ?? text, text, cx, { after: () => { this.prsAt = 0; } });
  }

  customActions() {
    return (this.config?.customCommands ?? []).filter(c => c.key && c.command && (CONTEXTS[c.context ?? "global"] ?? (() => false))(this)).map(c => ({
      key: lazyKey(c.key), label: c.description ?? c.command, custom: true, run: cx => this.runCustom(c, cx),
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

  // enter on a branch: History shows its log (esc, [ or ] go back to this branch).
  viewLog(b, cx) {
    this.scope = { ref: b.name }; this.keepHistory = false;
    this.sel.history = 1; this.clearRange(); this.zone = 1; this.stashRef = null;
    this.refresh(cx, true);
    cx.notify();
  }
  setScope(scope, cx) {
    if (JSON.stringify(scope) === JSON.stringify(this.scope)) return;
    this.scope = scope; this.clearRange(); this.sel.history = 0; this.keepHistory = false;
    this.refresh(cx, true);
    cx.notify();
  }

  // ---- The action table: what each row can do, with its key --------------------------

  // The diff's keys as actions (diffKey does the work), so the menu and ? card list them too.
  diffActions(add) {
    const rows = this.main?.rows ?? [], r = rows[this.cur], d = this.main?.diff, s = this.subject(), sides = this.sides();
    const k = key => cx => this.diffKey(key, cx);
    if (!d) return;
    if (r?.block) {
      add("o", `Keep ${sides?.oursShort ?? "current"} in this conflict`, k("o"), { chip: `keep ${sides?.oursShort ?? "current"}` });
      add("t", `Keep ${sides?.theirsShort ?? "incoming"} in this conflict`, k("t"), { chip: `keep ${sides?.theirsShort ?? "incoming"}` });
      add("b", "Keep both", k("b"), { chip: "both" });
      add("v", "Open the conflict resolver pane", () => this.openConflicts());
    } else if (s.kind === "wip") {
      const pick = this.anchor != null;
      add("space", `${r?.side === "staged" ? "Unstage" : "Stage"} ${pick ? "the selected lines" : "this hunk"}`, k("space"), { chip: `${r?.side === "staged" ? "unstage" : "stage"} ${pick ? "lines" : "hunk"}` });
      add("v", pick ? "End the line selection" : "Select lines (then j / k)", k("v"), { chip: pick ? "end select" : "select lines" });
      add("d", `Discard ${pick ? "the selected lines" : "this hunk"}…`, k("d"), { chip: "discard" });
      add("a", "Write a review note here", k("a"), { chip: "note" });
      if (this.notes().length) add("p", `Send ${plural(this.notes().length, "review note")} to an agent`, k("p"), { chip: "send notes" });
      add("X", "Delete the notes on this line", k("X"));
    }
    add("A", "Ask AI about this change", k("A"), { chip: "ask AI" });
    add("}", "Next hunk", k("}"));
    add("{", "Previous hunk", k("{"));
    add("J", "Next file", k("J"));
    add("K", "Previous file", k("K"));
    add("e", "Open in your editor at this line", k("e"));
  }

  actions() {
    const z = this.zone, it = this.selected(), A = this.customActions();
    const add = (key, label, run, extra) => A.push({ key, label, run, ...extra });
    const info = this.status?.info, head = info?.head;
    const files = this.status?.files ?? [];

    if (z === 3) this.diffActions(add);

    if (z === 2 && it && this.subject().kind !== "wip") {
      add("enter", "Show the diff", cx => this.setZone(3, cx), { chip: "diff" });
      add("o", "Open the file in your editor", () => this.openEditor(it.path, null), { chip: "edit" });
      add("y", "Copy path", cx => { cx.write_to_clipboard(it.path); this.flash("Path copied"); });
    }
    if (z === 2 && it?.kind === "dir" && this.subject().kind === "wip") {
      const under = files.filter(f => this.under(it.path, f.path)), spec = it.path || ".", where = it.path ? `${it.path}/` : "everything";
      const unstaged = under.some(f => f.unstaged && !f.conflict);
      if (unstaged) add("space", `Stage ${where}`, cx => this.cmd(`git add -A ${spec}`, `git add -A -- ${q(spec)}`, cx, { term: false }), { chip: "stage" });
      else add("space", `Unstage ${where}`, cx => this.cmd(`git restore --staged ${spec}`, `git restore --staged -- ${q(spec)} 2>/dev/null || git reset -q -- ${q(spec)}`, cx, { term: false }), { chip: "unstage" });
      add("enter", it.open ? "Fold" : "Unfold", cx => this.toggleFold(it, cx), { chip: it.open ? "fold" : "unfold" });
      add("d", `Discard ${where}…`, cx => this.confirm(`Discard every change in ${where} (${plural(under.length, "file")}, untracked ones deleted)? It can't be undone.`, "Discard all", cx =>
        this.cmd(`discard ${where}`, `git restore --source=HEAD --staged --worktree -- ${q(spec)} 2>/dev/null; git clean -fdq -- ${q(spec)}`, cx, { term: false }), cx), { chip: "discard" });
      add("A", "Ask AI about these changes", cx => { this.setZone(3, cx); this.askAbout(cx); }, { chip: "ask AI" });
    }
    if (z === 2 && this.subject().kind === "wip") {
      add("-", "Fold every folder", cx => this.foldAll(true, cx));
      add("=", "Unfold every folder", cx => this.foldAll(false, cx));
      add("t", this.flat ? "Show as a tree" : "Show as a flat list", cx => this.toggleFlat(cx), { chip: this.flat ? "tree" : "flat" });
    }
    if (z === 2 && it?.kind === "file" && this.subject().kind === "wip") {
      const f = it.file, anyUnstaged = files.some(x => x.unstaged && !x.conflict);
      if (f.conflict) add("space", "Mark resolved (stage)", cx => this.cmd(`git add ${f.path}`, `git add -- ${q(f.path)}`, cx, { term: false }), { chip: "resolved" });
      else if (f.unstaged) add("space", "Stage", cx => this.cmd(`git add ${f.path}`, `git add -- ${q(f.path)}`, cx, { term: false }), { chip: "stage" });
      else add("space", "Unstage", cx => this.cmd(`git restore --staged ${f.path}`, `git restore --staged -- ${q(f.path)} 2>/dev/null || git rm -q --cached -- ${q(f.path)}`, cx, { term: false }), { chip: "unstage" });
      add("enter", "Review the diff (hunks, lines, notes)", cx => this.setZone(3, cx), { chip: "review" });
      add("a", anyUnstaged ? "Stage all" : "Unstage all", cx => anyUnstaged ? this.cmd("git add -A", "git add -A", cx, { term: false }) : this.cmd("git reset", "git reset -q", cx, { term: false }), { chip: anyUnstaged ? "stage all" : "unstage all" });
      add("d", "Discard…", cx => this.discardFile(f, cx), { chip: "discard" });
      add("o", "Open in editor", () => this.openEditor(f.path, null), { chip: "edit" });
      if (this.notes().length) add("p", `Send ${plural(this.notes().length, "review note")} to an agent`, cx => this.askAI(cx, "notes"), { chip: "send notes" });
      add("A", "Ask AI about this change", cx => { this.setZone(3, cx); this.askAbout(cx); }, { chip: "ask AI" });
      add("y", "Copy path", cx => { cx.write_to_clipboard(f.path); this.flash("Path copied"); });
    }

    if (z === 0 && it?.kind === "group") {
      add("enter", it.open ? `Fold ${it.title}` : `Unfold ${it.title}`, cx => this.toggleGroup(it.id, cx), { chip: it.open ? "fold" : "unfold" });
      add("space", it.open ? `Fold ${it.title}` : `Unfold ${it.title}`, cx => this.toggleGroup(it.id, cx));
      if (it.id === "local") add("D", "Clean up merged / closed / gone branches", cx => this.cleanup(cx), { chip: "clean up" });
      if (it.id.startsWith("remote:")) add("f", `Fetch ${it.title}`, cx => this.cmd(`git fetch ${it.title} --prune`, `git fetch ${q(it.title)} --prune`, cx, { after: () => { this.prsAt = 0; } }), { chip: "fetch" });
    }
    if (z === 0 && (it?.kind === "local" || it?.kind === "remote")) {
      const remote = it.kind === "remote", ref = it.name;
      add("space", remote ? (it.local ? `Switch to ${it.local}` : `Check out as local ${it.short}`) : it.head ? "Current branch" : it.worktree ? "Go to its worktree" : "Switch to it",
        cx => this.checkout(it, cx), { chip: remote ? "check out" : "switch" });
      add("enter", "Show its log in History", cx => this.viewLog(it, cx), { chip: "log" });
      add("n", "New branch from here", cx => this.ask(`New branch from ${ref}`, "", (name, cx) => name && this.cmd(`git switch -c ${name} ${ref}`, `git switch -c ${q(name)} ${q(ref)}`, cx), cx));
      if (!it.head) {
        add("M", `Merge into ${head}…`, cx => this.openMenu(`Merge ${ref} into ${head}`, [
          { key: "m", label: "Merge", hint: "fast-forward if possible", run: cx => this.cmd(`git merge ${ref}`, `git merge --no-edit ${q(ref)}`, cx, { undo: true }) },
          { key: "n", label: "Merge commit (--no-ff)", run: cx => this.cmd(`git merge --no-ff ${ref}`, `git merge --no-ff --no-edit ${q(ref)}`, cx, { undo: true }) },
          { key: "f", label: "Fast-forward only", run: cx => this.cmd(`git merge --ff-only ${ref}`, `git merge --ff-only ${q(ref)}`, cx, { undo: true }) },
          { key: "s", label: "Squash (stage only, then commit)", run: cx => this.cmd(`git merge --squash ${ref}`, `git merge --squash ${q(ref)}`, cx) },
        ], cx), { chip: "merge" });
        add("r", `Rebase ${head} onto this…`, cx => this.openMenu(`Rebase ${head} onto ${ref}`, [
          { key: "r", label: "Rebase", hint: "--autostash", run: cx => this.cmd(`git rebase ${ref}`, `git rebase --autostash ${q(ref)}`, cx, { undo: true }) },
          { key: "u", label: "Rebase, updating stacked branches", hint: "--update-refs", run: cx => this.cmd(`git rebase --update-refs ${ref}`, `git rebase --autostash --update-refs ${q(ref)}`, cx, { undo: true }) },
          { key: "m", label: "Rebase, keeping merge commits", hint: "--rebase-merges", run: cx => this.cmd(`git rebase --rebase-merges ${ref}`, `git rebase --autostash --rebase-merges ${q(ref)}`, cx, { undo: true }) },
          { key: "a", label: "Rebase and apply fixup!/squash! commits", hint: "--autosquash", run: cx => this.cmd(`git rebase -i --autosquash ${ref}`, `GIT_SEQUENCE_EDITOR=: git rebase -i --autostash --autosquash ${q(ref)}`, cx, { undo: true }) },
          { key: "i", label: "Interactive rebase in editor (new tab)", run: () => run("terminal.open", { argv: [this.shell ?? "/bin/zsh", "-lic", `git rebase -i --autostash ${q(ref)}`], folder: this.ctx.root, place: "tab" }) },
        ], cx), { chip: "rebase" });
      }
      if (!remote) {
        if (it.upstream && !it.gone) add("f", "Fast-forward from upstream", cx => it.head
          ? this.cmd("git merge --ff-only @{u}", "git fetch && git merge --ff-only @{u}", cx, { undo: true })
          : this.cmd(`git fetch ${it.upstream.replace("/", " ")}:${ref}`, `git fetch ${q(it.upstream.split("/")[0])} ${q(`${it.upstream.split("/").slice(1).join("/")}:${ref}`)}`, cx));
        add("R", "Rename", cx => this.ask(`Rename ${ref}`, ref, (name, cx) => name && name !== ref && this.cmd(`git branch -m ${ref} ${name}`, `git branch -m ${q(ref)} ${q(name)}`, cx, { term: false }), cx));
        if (!it.head) add("d", "Delete…", cx => this.openMenu(`Delete ${ref}`, [
          { key: "d", label: "Delete local branch", run: cx => this.deleteLocal(it, cx) },
          it.upstream && !it.gone && { key: "r", label: `Delete local and ${it.upstream}`, danger: true, run: cx => this.confirm(`Delete ${it.upstream} on the remote too?`, "Delete both", cx => this.cmd(`git branch -D ${ref} && git push ${it.upstream.split("/")[0]} --delete ${it.upstream.split("/").slice(1).join("/")}`, `git branch -D ${q(ref)} && git push ${q(it.upstream.split("/")[0])} --delete ${q(it.upstream.split("/").slice(1).join("/"))}`, cx), cx) },
        ], cx), { chip: "delete" });
        add("D", "Clean up merged / closed / gone branches", cx => this.cleanup(cx));
      } else add("d", "Delete remote branch", cx => this.confirm(`Delete ${ref} on ${it.remote}?`, "Delete remote branch", cx => this.cmd(`git push ${it.remote} --delete ${it.short}`, `git push ${q(it.remote)} --delete ${q(it.short)}`, cx), cx));
      const pr = this.prs?.[remote ? it.short : ref];
      if (pr) add("o", `Open PR #${pr.number}`, () => exec("open", [pr.url]), { chip: "open PR" });
      add("y", "Copy branch name", cx => { cx.write_to_clipboard(remote ? it.short : ref); this.flash("Branch name copied"); });
    }
    if (z === 0 && it?.kind === "stash") {
      add("enter", "Show its files", cx => { this.stashRef = it.ref; this.detail = null; this.syncDetail(cx); this.setZone(2, cx); }, { chip: "files" });
      add("space", "Apply", cx => this.cmd(`git stash apply ${it.ref}`, `git stash apply ${q(it.ref)}`, cx, { term: false }), { chip: "apply" });
      add("g", "Pop", cx => this.cmd(`git stash pop ${it.ref}`, `git stash pop ${q(it.ref)}`, cx, { term: false }), { chip: "pop" });
      add("d", "Drop", cx => this.confirm(`Drop ${it.ref} "${it.message}"?`, "Drop stash", cx => this.cmd(`git stash drop ${it.ref}`, `git stash drop ${q(it.ref)}`, cx, { term: false }), cx), { chip: "drop" });
      add("n", "New branch from stash", cx => this.ask(`Branch from ${it.ref}`, "", (name, cx) => name && this.cmd(`git stash branch ${name} ${it.ref}`, `git stash branch ${q(name)} ${q(it.ref)}`, cx), cx));
    }

    if (z === 1 && it?.kind === "wip") {
      const anyUnstaged = files.some(x => x.unstaged && !x.conflict);
      add("c", "Commit…", cx => this.commit(cx), { chip: "commit" });
      if (files.length) add("a", anyUnstaged ? "Stage all" : "Unstage all", cx => anyUnstaged ? this.cmd("git add -A", "git add -A", cx, { term: false }) : this.cmd("git reset", "git reset -q", cx, { term: false }), { chip: anyUnstaged ? "stage all" : "unstage all" });
      add("enter", "Show the changed files", cx => this.setZone(2, cx), { chip: "files" });
    }
    if (z === 1 && it?.sha) {
      const c = it, range = this.selectedCommits();
      if (range.length > 1) this.rangeActions(range, add);
      else {
        // lazygit's commit keys, in its order of usefulness (the footer shows the first).
        add("s", "Squash into the commit below", cx => this.rewrite(`squash ${c.short}`, c, cx, async () => this.todo("replace", c.sha, null, "squash", await this.baseOf(c.sha, 2))), { chip: "squash" });
        add("f", "Fixup into the commit below (drop message)", cx => this.rewrite(`fixup ${c.short}`, c, cx, async () => this.todo("replace", c.sha, null, "fixup", await this.baseOf(c.sha, 2))), { chip: "fixup" });
        add("r", "Reword", cx => this.reword(c, cx), { chip: "reword" });
        add("v", "Select a range (then j / k)", cx => { this.rangeAnchor = c.sha; this.picks = new Set(); cx.notify(); }, { chip: "range" });
        add("d", "Drop this commit", cx => this.confirm(`Drop ${c.short} "${c.subject}"?`, "Drop commit", cx => this.rewrite(`drop ${c.short}`, c, cx, async () => this.todo("replace", c.sha, null, "drop", await this.baseOf(c.sha, 1))), cx), { chip: "drop" });
        add("A", "Amend staged changes into this commit", cx => {
          if (!files.some(f => f.staged)) { this.flash("Stage something first"); cx.notify(); return; }
          const isHead = c.refs.some(r => r.startsWith("HEAD"));
          this.rewrite(`amend into ${c.short}`, c, cx, async () => isHead ? "git commit --amend --no-edit"
            : `git commit --fixup=${c.sha} && GIT_SEQUENCE_EDITOR=: git rebase -i --autostash --autosquash --rebase-merges ${await this.baseOf(c.sha, 1)}`);
        }, { chip: "amend" });
        add("enter", "Show its files", cx => this.setZone(2, cx));
        add("e", "Edit (stop here in a rebase)", cx => this.rewrite(`edit ${c.short}`, c, cx, async () => this.todo("replace", c.sha, null, "edit", await this.baseOf(c.sha, 1))));
        add("R", "Reword in your editor", cx => this.amendHere(c, "", cx, { title: `reword ${c.short}`, terminal: true }));
        add("a", "Amend author / co-author…", cx => this.openMenu(`Amend ${c.short}'s attributes`, [
          { key: "r", label: "Reset author", hint: "to your git user", run: cx => this.amendHere(c, "--reset-author --no-edit", cx, { title: `reset author of ${c.short}` }) },
          { key: "a", label: "Set author…", hint: "Name <email>", run: cx => this.ask(`Author of ${c.short}`, c.author ?? "", (v, cx) => v && this.amendHere(c, `--author=${q(v)} --no-edit`, cx, { title: `set author of ${c.short}` }), cx, { hint: "Name <email>" }) },
          { key: "c", label: "Add co-author…", hint: "Co-authored-by trailer", run: cx => this.ask(`Co-author of ${c.short}`, "", (v, cx) => v && this.amendHere(c, `--no-edit --trailer ${q(`Co-authored-by: ${v}`)}`, cx, { title: `add co-author to ${c.short}` }), cx, { hint: "Name <email>" }) },
        ], cx));
        add("F", "Create fixup! commit for this commit", cx => {
          if (!files.some(f => f.staged)) { this.flash("Stage something first"); cx.notify(); return; }
          this.cmd(`git commit --fixup=${c.short}`, `git commit --fixup=${c.sha}`, cx, { term: false, undo: "soft" });
        });
        add("S", "Squash all fixup! commits above (autosquash)", cx => this.rewrite(`autosquash onto ${c.short}`, c, cx, async () => `GIT_SEQUENCE_EDITOR=: git rebase -i --autostash --autosquash --rebase-merges ${await this.baseOf(c.sha, 1)}`));
        add("space", "Check out this commit (detached)", cx => this.cmd(`git checkout ${c.short}`, `git checkout ${c.sha}`, cx));
        const rows = this.items(1), i = this.selIndex(1);
        const below = rows.slice(i + 1).find(r => r.sha), above = rows.slice(0, i).reverse().find(r => r.sha);
        if (below) add("ctrl-j", "Move commit down", cx => this.rewrite(`move ${c.short} down`, c, cx, async () => { this.sel.history = rows.indexOf(below); return this.todo("swap", below.sha, c.sha, null, await this.baseOf(c.sha, 2)); }));
        if (above) add("ctrl-k", "Move commit up", cx => this.rewrite(`move ${c.short} up`, c, cx, async () => { this.sel.history = rows.indexOf(above); return this.todo("swap", c.sha, above.sha, null, await this.baseOf(c.sha, 1)); }));
        add("g", "Reset to this commit…", cx => this.openMenu(`Reset ${head} to ${c.short}`, [
          { key: "s", label: "Soft", hint: "keep changes staged", run: cx => this.cmd(`git reset --soft ${c.short}`, `git reset --soft ${c.sha}`, cx, { term: false, undo: true }) },
          { key: "m", label: "Mixed", hint: "keep changes unstaged", run: cx => this.cmd(`git reset --mixed ${c.short}`, `git reset --mixed ${c.sha}`, cx, { term: false, undo: true }) },
          { key: "h", label: "Hard", hint: "discard changes", danger: true, run: cx => this.confirm(`Hard reset to ${c.short}? Uncommitted changes are lost.`, "Hard reset", cx => this.cmd(`git reset --hard ${c.short}`, `git reset --hard ${c.sha}`, cx, { term: false, undo: true }), cx) },
        ], cx));
        add("t", "Revert this commit", cx => this.cmd(`git revert ${c.short}`, `git revert --no-edit ${c.sha}`, cx, { undo: true }));
        add("T", "Tag this commit", cx => this.ask(`Tag ${c.short}`, "", (name, cx) => name && this.cmd(`git tag ${name} ${c.short}`, `git tag ${q(name)} ${c.sha}`, cx, { term: false }), cx, { hint: "e.g. v1.2.0" }));
        add("C", this.copied.includes(c.sha) ? "Unmark for cherry-pick" : "Mark for cherry-pick", cx => { this.copied = this.copied.includes(c.sha) ? this.copied.filter(s => s !== c.sha) : [...this.copied, c.sha]; cx.notify(); });
        add("n", "New branch from this commit", cx => this.ask(`New branch from ${c.short}`, "", (name, cx) => name && this.cmd(`git switch -c ${name} ${c.short}`, `git switch -c ${q(name)} ${c.sha}`, cx), cx));
        add("o", "Open in browser", cx => this.commitUrl(c.sha).then(url => url ? exec("open", [url]) : (this.flash("No GitHub/GitLab remote"), cx.notify())));
        add("y", "Copy…", cx => this.copyMenu(c, cx));
      }
      if (this.copied.length) add("V", `Cherry-pick ${this.copied.length} marked onto ${head}`, cx => {
        const order = (this.commits ?? []).filter(r => this.copied.includes(r.sha)).reverse().map(r => r.sha);
        this.cmd(`git cherry-pick ${order.map(s => s.slice(0, 8)).join(" ")}`, `git cherry-pick ${order.join(" ")}`, cx, { after: () => { this.copied = []; }, undo: true });
      });
    }
    // Global, after the column's own so a column key wins. The footer shows the column's
    // own first: what's marked global or custom only lives in x / ?.
    const firstGlobal = A.length;
    if (this.op) add("m", `${this.op.kind}: continue / skip / abort…`, cx => this.opMenu(cx));
    if (this.op && this.conflicts().length) add("v", "Resolve conflicts (chunk picker)", () => this.openConflicts());
    add("i", "Ask AI (conflicts, a failed command or your review notes)", cx => this.askAI(cx));
    add("b", "Switch branch (fuzzy)", cx => this.openSwitcher(cx));
    add("P", "Push", cx => this.push(cx));
    add("p", "Pull", cx => this.pull(cx));
    add("c", "Commit", cx => this.commit(cx));
    add("u", this.undoStack.length ? `Undo: ${this.undoStack.at(-1).title}` : "Undo the last commit / rewrite / merge", cx => this.undo(cx));
    if (files.length) add("S", "Stash all changes", cx => this.ask("Stash message (optional)", "", (msg, cx) => this.cmd(`git stash push -u${msg ? ` -m "${msg}"` : ""}`, `git stash push -u${msg ? ` -m ${q(msg)}` : ""}`, cx, { term: false }), cx));
    add("@", "Command log", cx => this.logMenu(cx));
    add("f", "Fetch all remotes", cx => this.cmd("git fetch --all --prune", "git fetch --all --prune", cx, { after: () => { this.prsAt = 0; } }));
    add("ctrl-r", "Refresh", cx => { this.prsAt = 0; this.refresh(cx, true); });
    A.forEach((a, i) => { if (i >= firstGlobal) a.global = true; });
    return A;
  }

  commit(cx) {
    if (!this.ctx) { this.flash("Not a git repository"); cx.notify(); return; }
    const files = this.status?.files ?? [];
    if (this.conflicts().length) { this.flash("Resolve conflicts first"); cx.notify(); return; }
    // The message is kept per repo (shared "git.commitDrafts", by root) until a commit lands:
    // esc and a failed commit keep it for next time; a commit that moved HEAD clears it.
    const ctx = this.ctx, root = ctx.root;
    const head = () => G.git(ctx, ["rev-parse", "-q", "--verify", "HEAD"]).then(r => r.stdout.trim(), () => "");
    const go = (cx, stageAll) => this.openCommit(cx, stageAll, (summary, body, cx) => {
      const msg = body ? `${summary}\n\n${body}` : summary;
      setCommitDraft(root, msg);
      cx.spawn(async cx => {
        const before = await head();
        const settle = async () => { if ((await head()) !== before) setCommitDraft(root, null); };
        this.cmd(`git commit -m "${summary}"${body ? " -m …" : ""}`, `${stageAll ? "git add -A && " : ""}git commit -m ${q(summary)}${body ? ` -m ${q(body)}` : ""}`, cx, { after: settle, onFail: settle, undo: "soft" });
      });
    });
    const amend = (cx, stageAll) => {
      const head = (this.commits ?? []).find(c => c.refs.some(r => r.startsWith("HEAD")));
      const run = cx => this.cmd("git commit --amend --no-edit", `${stageAll ? "git add -A && " : ""}git commit --amend --no-edit`, cx, { undo: "soft" });
      head && head.state !== "unpushed" && this.scope === "head" ? this.confirm("The last commit is already pushed. Amending needs a force push.", "Amend anyway", run, cx) : run(cx);
    };
    const staged = files.filter(f => f.staged).length, changed = files.filter(f => f.unstaged).length;
    if (!files.length) { this.flash("Nothing to commit"); cx.notify(); return; }
    // Something staged: straight to the message (the menu is for the other ways: x on Working changes).
    if (staged > 0 && !this.commitMenu) return go(cx, false);
    this.openMenu(`${staged} staged · ${changed} unstaged`, [
      staged > 0 && { key: "c", label: "Commit staged changes", run: cx => go(cx, false) },
      changed > 0 && { key: "a", label: "Stage all and commit", run: cx => go(cx, true) },
      staged > 0 && { key: "A", label: "Amend last commit with staged changes", hint: "keeps message", run: cx => amend(cx, false) },
      changed > 0 && { key: "m", label: "Stage all and amend last commit", hint: "keeps message", run: cx => amend(cx, true) },
      { key: "e", label: "Commit in editor (new tab)", run: () => run("terminal.open", { argv: [this.shell ?? "/bin/zsh", "-lic", "git commit"], folder: this.ctx.root, place: "tab" }) },
    ], cx);
  }

  // The commit's ⌄: every way to commit (amend, stage all, editor).
  commitOptions(cx) { this.commitMenu = true; try { this.commit(cx); } finally { this.commitMenu = false; } }

  // The commit dialog, as lazygit's: a one-line summary (with its length) over a multi-line
  // description. tab switches between them, enter in the summary or cmd-enter commits, esc cancels.
  // The draft (summary, blank line, description) is kept per repo until a commit lands.
  openCommit(cx, stageAll, onCommit) {
    const root = this.ctx.root, draft = commitDraft(root);
    const [first = "", ...rest] = draft.split("\n");
    const summary = InputState.new({ value: first, placeholder: "Summary line" });
    const body = TextareaState.new({ value: rest.join("\n").replace(/^\n+/, ""), placeholder: "Description (optional): why, and what it affects", rows: 7 });
    body.set_soft_wrap(true);
    summary.set_selected_range({ start: first.length, end: first.length });
    summary.on("submit", (_e, cx) => this.submitCommit(cx));
    // The description takes enter as a new line; cmd-enter (the input's "secondary" submit) commits.
    body.on("submit", (e, cx) => { if (e?.secondary) this.submitCommit(cx); });
    summary.on("change", (_e, cx) => cx.notify());
    for (const [field, st] of [["summary", summary], ["body", body]]) {
      st.on("focus", (_e, cx) => { if (this.commitBox) { this.commitBox.field = field; this.typing = true; } cx.notify(); });
    }
    this.commitBox = { root, stageAll, summary, body, field: "summary", onCommit };
    this.typing = true;
    summary.focus();
    cx.notify();
  }
  commitText() {
    const c = this.commitBox, s = c.summary.value().trim(), b = c.body.value().replace(/\s+$/, "");
    return b ? `${s}\n\n${b}` : s;
  }
  closeCommit(cx, keep = true) {
    const c = this.commitBox;
    if (!c) return;
    if (keep) setCommitDraft(c.root, this.commitText().trim());
    this.commitBox = null; this.typing = false;
    c.summary.release(); c.body.release();
    this.handle.focus();
    cx.notify();
  }
  submitCommit(cx) {
    const c = this.commitBox;
    if (!c) return;
    const summary = c.summary.value().trim(), body = c.body.value().replace(/\s+$/, "");
    if (!summary) { this.flash("Write a summary first"); c.summary.focus(); cx.notify(); return; }
    this.closeCommit(cx, false);
    c.onCommit(summary, body, cx);
  }
  // tab / shift-tab: the other box. A tab the description typed is taken back out.
  switchCommitField(cx) {
    const c = this.commitBox;
    if (c.field === "body") { const v = c.body.value(); if (v.includes("\t")) c.body.set_value(v.replace(/\t/g, "")); c.summary.focus(); }
    else c.body.focus();
    cx.notify();
  }

  logMenu(cx) {
    if (!this.log.length) { this.flash("No git commands run yet"); cx.notify(); return; }
    this.openMenu("Command log", this.log.slice(0, 20).map((e, i) => ({
      key: i < 9 ? String(i + 1) : null, label: `${e.running ? "…" : e.code === 0 ? "✓" : "✗"} ${e.title}`,
      hint: e.running ? "running" : `${Math.round((Date.now() - e.at) / 60000) || "now"}${Math.round((Date.now() - e.at) / 60000) ? "m" : ""}`,
      run: cx => { if (e.running && e.addr) run("terminal.peek", { terminal: e.addr }); else { this.showOutput(e, cx); this.setZone(3, cx); } },
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
    if (dir === "left" && pane && !this.fixed) return focusTab();
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
    if (this.commitBox) {
      const k = e.keystroke;
      if (e.key === "escape") this.closeCommit(cx);
      else if (k === "tab" || k === "shift-tab") this.switchCommitField(cx);
      // lazygit's confirm keys in the description: ctrl-s (and alt-enter); cmd-enter as on macOS.
      else if (["ctrl-s", "cmd-s", "alt-enter", "cmd-enter", "ctrl-enter"].includes(k)) this.submitCommit(cx);
      else return;
      cx.stop_propagation();
      return;
    }
    if (this.switcher) {
      const k = e.keystroke, n = this.switchMatches().length;
      if (e.key === "escape") this.closeSwitcher(cx);
      else if (["down", "ctrl-n", "ctrl-j"].includes(k)) this.switcher.sel = Math.min(n - 1, this.switcher.sel + 1);
      else if (["up", "ctrl-p", "ctrl-k"].includes(k)) this.switcher.sel = Math.max(0, this.switcher.sel - 1);
      else return;
      cx.stop_propagation(); cx.notify();
      return;
    }
    if (!this.editorFocused && !this.prompt && this.navKey(e, cx)) return;
    if (this.editorFocused) { if (e.key === "escape") { this.handle.focus(); cx.stop_propagation(); } return; }
    if (this.prompt) { if (e.key === "escape") { this.cancelPrompt(cx); cx.stop_propagation(); } return; }
    const k = keyOf(e);
    if (this.menu) { this.menuKey(k, cx); cx.stop_propagation(); return; }
    if (this.handleKey(k, cx)) cx.stop_propagation();
  }

  // g alone is an action in some rows (reset, pop); g g goes to the top. So a first g waits a moment.
  gKey(cx) {
    const z = this.zone;
    if (this.gAt && Date.now() - this.gAt < 400) {
      this.gAt = 0; this.gToken++;
      if (z === 3) this.diffKey("gg", cx); else this.move(0, cx, 0);
      return true;
    }
    this.gAt = Date.now();
    const act = this.actions().find(a => a.key === "g"), token = ++this.gToken;
    if (act) cx.timer.after(400, cx => { if (this.gToken === token && this.gAt) { this.gAt = 0; act.run(cx); cx.notify(); } });
    return true;
  }

  handleKey(k, cx) {
    if (k !== "g") { this.gToken++; this.gAt = 0; }
    if (this.keysOpen) {
      if (k === "escape" || k === "?" || k === "q") { this.keysOpen = false; cx.notify(); }
      return true;
    }
    if (k === "?") { this.keysOpen = true; cx.notify(); return true; }
    const num = ZONES.findIndex(z => z.key === k);
    if (num >= 0) { this.setZone(num, cx); return true; }
    if (k === "g") return this.gKey(cx);
    if (this.zone === 3) {
      if (this.main?.diff && this.diffKey(k, cx)) return true;
      if (!this.main?.diff && ["j", "down", "k", "up", "ctrl-d", "ctrl-u", "G", "escape"].includes(k)) {
        if (k === "escape") { if (this.mainOverride) { this.mainOverride = null; this.syncMain(cx); } this.setZone(2, cx); return true; }
        this.scrollMain({ j: 1, down: 1, k: -1, up: -1, "ctrl-d": 15, "ctrl-u": -15, G: 1e9 }[k], cx); return true;
      }
    }
    // shift-↑/↓ in History: start or grow a range (lazygit).
    if ((k === "shift-down" || k === "shift-up") && this.zone === 1) {
      if (!this.rangeAnchor && this.selected(1)?.sha) { this.rangeAnchor = this.selected(1).sha; this.picks = new Set(); }
      this.move(k === "shift-down" ? 1 : -1, cx); return true;
    }
    const page = Math.max(5, Math.floor(((this.size?.height ?? 600) / zoomOf()) / ROW / 2));
    switch (k) {
      case "h": case "left": this.setZone(this.zone - 1, cx); return true;
      case "l": case "right": this.setZone(this.zone + 1, cx); return true;
      case "tab": this.setZone((this.zone + 1) % 4, cx); return true;
      case "shift-tab": this.setZone((this.zone + 3) % 4, cx); return true;
      case "j": case "down": this.move(1, cx); return true;
      case "k": case "up": this.move(-1, cx); return true;
      case "<": case "home": this.move(0, cx, 0); return true;
      case ">": case "end": case "G": this.move(0, cx, this.items().length - 1); return true;
      case ",": case "pageup": case "ctrl-u": this.move(-page, cx); return true;
      case ".": case "pagedown": case "ctrl-d": this.move(page, cx); return true;
      case "[": case "]": {
        if (this.zone === 0) {
          const tabs = ["local", "remote", "stash"], i = tabs.indexOf(this.branchTab);
          this.setBranchTab(tabs[(i + (k === "]" ? 1 : tabs.length - 1)) % tabs.length], cx);
          return true;
        }
        const order = ["head", "all"], i = order.indexOf(typeof this.scope === "string" ? this.scope : "head");
        this.setScope(typeof this.scope !== "string" ? "head" : order[(i + (k === "]" ? 1 : order.length - 1)) % order.length], cx);
        this.setZone(1, cx);
        return true;
      }
      case "escape":
        if (this.selectedCommits().length) this.clearRange();
        else if (this.filter[ZONES[Math.min(this.zone, 2)].id]) { this.filter[ZONES[Math.min(this.zone, 2)].id] = ""; this.syncDetail(cx); }
        else if (this.zone === 1 && typeof this.scope !== "string") this.setScope("head", cx);
        else if (this.stashRef && this.zone === 2) { this.stashRef = null; this.syncDetail(cx); this.setZone(0, cx); }
        else if (this.mainOverride) { this.mainOverride = null; this.syncMain(cx); }
        else if (this.failure) this.failure = null;
        else return false;
        cx.notify(); return true;
      case "/": this.startFilter(cx); return true;
      case "q":
        // Like quitting lazygit: put the panel away and give the keyboard back to the terminal.
        if (this.fixed) return false;
        closePanel("git");
        return true;
      case "x": this.openActions(cx); return true;
    }
    const action = this.actions().find(a => a.key === k);
    if (action) { action.run(cx); cx.notify(); return true; }
    return false;
  }

  // x, or a right-click: every action for the row under the cursor (with its key).
  openActions(cx, at) {
    const it = this.selected(), z = this.zone;
    const what = z === 3 ? (this.main?.path ?? "Diff") : z === 1 ? (it?.sha ? (this.selectedCommits().length > 1 ? `${this.selectedCommits().length} commits` : `${it.short} · ${it.subject}`) : "Working changes")
      : z === 0 ? (it?.kind === "group" ? it.title : it?.name ?? it?.ref ?? "Branches") : it?.path ?? "Files";
    this.openMenu(what, this.actions().map(a => ({ ...a, hint: a.custom ? "custom" : null })), cx, null, at);
  }

  // ---- Mouse: presses, right-clicks, drags ------------------------------------------

  // A press on a list (before its row's click): which button modifiers and how many clicks,
  // where (the checkbox lane in Files), and the start of a possible drag.
  press(z, e, cx) {
    const zoom = zoomOf(), ly = (e.local_position?.y ?? 0) / zoom;
    this.lastPress = { z, mods: e.modifiers ?? {}, count: e.click_count ?? 1, x: (e.local_position?.x ?? 999) / zoom };
    if (z <= 1) {
      const index = Math.floor((ly + (this.scrolls[ZONES[z].id].offset()?.y ?? 0)) / this.rowH(z));
      this.dragStart = { z, index, y: e.position.y, top: e.position.y - (e.local_position?.y ?? 0) };
    }
  }

  clickRow(z, key, cx) {
    if (this.justDragged) return;
    const items = this.items(z), i = items.findIndex((it, j) => this.itemKey(z, it, j) === key);
    if (i < 0) return;
    const p = this.lastPress?.z === z ? this.lastPress : null, mods = p?.mods ?? {}, double = (p?.count ?? 1) >= 2;
    const it = items[i], prev = this.selIndex(z), again = this.zone === z && prev === i;
    this.zone = z; this.handle.focus();
    if (z === 1 && it.sha && mods.shift) {
      if (!this.rangeAnchor) this.rangeAnchor = items[prev]?.sha ?? it.sha;
      this.picks = new Set();
      return this.move(0, cx, i, 1);
    }
    if (z === 1 && it.sha && (mods.platform || mods.control)) {
      const cur = items[prev];
      if (!this.picks.size && !this.rangeAnchor && cur?.sha && cur.sha !== it.sha) this.picks.add(cur.sha);
      this.rangeAnchor = null;
      if (this.picks.has(it.sha)) this.picks.delete(it.sha); else this.picks.add(it.sha);
      return this.move(0, cx, i, 1);
    }
    if (z === 1) this.clearRange();
    this.move(0, cx, i, z);
    // Files: the checkbox stages; a second click on a folder folds it.
    if (z === 2 && this.subject().kind === "wip" && p && p.x < CHECK_W) { this.actions().find(a => a.key === "space")?.run(cx); cx.notify(); return; }
    if (z === 0 && it.kind === "group") { this.toggleGroup(it.id, cx); return; }
    if (z === 2 && it.kind === "dir" && again && !double) { this.toggleFold(it, cx); return; }
    if (double) {
      if (z === 0) this.actions().find(a => a.key === (it.kind === "stash" ? "enter" : "space"))?.run(cx);
      else if (z === 1) it.sha ? this.actions().find(a => a.key === "r")?.run(cx) : this.commit(cx);
      else if (z === 2 && it.kind === "file") this.setZone(3, cx);
    }
    cx.notify();
  }

  // The root's right press, after a row's: the row (and column) was noted, the menu opens where pressed.
  rightPress(e, cx) {
    const p = this.ctxPending;
    this.ctxPending = null;
    if (!p) return;
    const zoom = zoomOf(), at = { x: (e.local_position?.x ?? 100) / zoom, y: (e.local_position?.y ?? 100) / zoom };
    this.zone = p.z; this.handle.focus();
    if (p.z === 3) { if (lineRow(this.main?.rows?.[p.i])) this.cur = p.i; }
    else {
      const items = this.items(p.z), i = items.findIndex((it, j) => this.itemKey(p.z, it, j) === p.key);
      // Right-clicking inside the range keeps it; elsewhere the cursor moves there.
      const inRange = p.z === 1 && this.selectedCommits().some(c => c.sha === items[i]?.sha);
      if (i >= 0 && !inRange) { if (p.z === 1) this.clearRange(); this.move(0, cx, i, p.z); }
    }
    this.openActions(cx, at);
  }

  draggable(z, it) { return z === 1 ? Boolean(it?.sha) && this.scope === "head" : z === 0 && (it?.kind === "local" || it?.kind === "remote"); }

  dragMove(e, cx) {
    const d = this.dragStart;
    if (!d) return;
    if (e.pressed_button !== "left") { this.dragStart = null; if (this.drag) { this.drag = null; cx.notify(); } return; }
    if (!this.drag && Math.abs(e.position.y - d.y) < 6) return;
    const items = this.items(d.z);
    if (!this.drag) {
      if (!this.draggable(d.z, items[d.index])) { this.dragStart = null; return; }
      const src = items[d.index], inRange = d.z === 1 && this.selectedCommits().some(c => c.sha === src.sha);
      this.drag = { z: d.z, from: d.index, to: d.index, set: d.z === 1 ? (inRange ? this.selectedCommits() : [src]) : [src] };
    }
    const to = Math.floor(((e.position.y - d.top) / zoomOf() + (this.scrolls[ZONES[d.z].id].offset()?.y ?? 0)) / this.rowH(d.z));
    if (to !== this.drag.to) { this.drag.to = to; cx.notify(); }
  }

  dragEnd(e, cx) {
    const d = this.drag;
    this.dragStart = null;
    if (!d) return;
    this.drag = null; this.justDragged = true;
    cx.timer.after(60, () => { this.justDragged = false; });
    const items = this.items(d.z), dst = items[d.to], zoom = zoomOf();
    const at = { x: (e.local_position?.x ?? 100) / zoom, y: (e.local_position?.y ?? 100) / zoom };
    if (dst && d.to !== d.from) {
      if (d.z === 1 && dst.sha && !d.set.includes(dst)) this.dropCommits(d.set, dst, at, cx);
      if (d.z === 0 && (dst.kind === "local" || dst.kind === "remote")) this.dropBranch(d.set[0], dst, at, cx);
    }
    cx.notify();
  }

  // ---- Rendering -------------------------------------------------------------

  keyboard() { return this.handle.is_focused() || Boolean(this.editorFocused || this.typing || this.menu || this.switcher); }
  width() { return (this.size?.width ?? 400 * zoomOf()) / zoomOf(); }

  // How many columns fit, and which: the one with the keyboard and its neighbours (History first).
  visibleZones() {
    const w = this.width(), cap = w >= 1080 ? 4 : w >= 780 ? 3 : w >= 500 ? 2 : 1, z = this.zone;
    if (cap >= 4) return [0, 1, 2, 3];
    if (cap === 1) return [z];
    const ds = 1, start = z < ds ? z : z > ds + cap - 1 ? z - cap + 1 : ds;
    return Array.from({ length: cap }, (_, i) => start + i);
  }

  render(cx) {
    if (JSON.stringify(location(this.fixed, this.loc)) !== this.locKey && !this.refreshing) this.refresh(cx, true);
    this.rangeSet = new Set(this.selectedCommits().map(r => r.sha));
    const hasKeys = this.hadKeys = this.keyboard();
    const t = theme(), mono = settings().font_family ?? "JetBrains Mono", pane = Boolean(this.fixed);
    const zones = this.shown = this.ctx ? this.visibleZones() : [];
    const body = !this.ctx
      ? div().flex_1().p(14).text_color(t.dim).child(this.refreshing && !this.locKey ? "Loading…" : `Not a git repository${this.cwd ? `: ${this.cwd}` : ""}`)
      : h_flex().size_full().min_h(0).items_stretch().children(zones.map((z, i) => this.column(z, t, mono, zones, i === zones.length - 1)));
    return v_flex().id("git").relative().size_full().min_h(0).rounded(pane ? 0 : 10).overflow_hidden().bg(t.chrome ?? t.background).when(!pane, el => el.border_1().border_color(hasKeys ? t.accent : t.border))
      .text_color(t.foreground).text_size(12.5)
      .track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .on_mouse_down("left", () => { if (!this.prompt && !this.commitBox && !this.switcher) this.handle.focus(); })
      .on_mouse_down("right", (e, cx) => this.rightPress(e, cx))
      .on_window_mouse_move((e, cx) => this.dragMove(e, cx))
      .on_window_mouse_up("left", (e, cx) => this.dragEnd(e, cx))
      .when(!this.ctx || zones.length < 4, el => el.child(this.header(t, pane, zones)))
      .when(Boolean(this.op), el => el.child(this.opBanner(t)))
      .when(Boolean(this.failure), el => el.child(this.failureBanner(t, mono)))
      .when(Boolean(this.ai), el => el.child(this.aiBanner(t)))
      .child(div().id("git-body").flex_1().min_h(0).flex().on_size_change((size, cx) => { this.size = size; cx.notify(); }).child(body))
      .child(this.footer(t))
      .when(Boolean(this.menu), el => el.child(this.menuView(t)))
      .when(Boolean(this.prompt), el => el.child(this.promptView(t)))
      .when(Boolean(this.switcher), el => el.child(this.switcherView(t)))
      .when(Boolean(this.commitBox), el => el.child(this.commitView(t)))
      .when(Boolean(this.keysOpen), el => el.child(keysCard(t, { id: "git", title: "Git: all keys", groups: this.keysGroups(), onClose: cx => { this.keysOpen = false; cx.notify(); } })));
  }

  iconButton(id, icon, action, t, label, tip) {
    return h_flex().id(id).h(24).px(6).gap(4).flex_none().items_center().rounded(6).cursor_pointer().text_size(11.5).text_color(t.muted)
      .hover(s => s.bg(t.hover).text_color(t.foreground)).when(Boolean(tip), e => e.tooltip(tip))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((e, cx) => { action(cx, e); cx.notify(); })
      .when(Boolean(icon), el => el.child(svg(icon).size(13))).when(Boolean(label), el => el.child(label));
  }

  // The branch name (opens the switcher), in the top bar or History's header.
  branchPill(t, max = 220) {
    const info = this.status?.info;
    const name = info?.head === "(detached)" ? `detached @ ${info.oid?.slice(0, 7)}` : info?.head ?? "…";
    return h_flex().id("git-branch").h(24).px(7).gap(6).min_w(0).flex_shrink_1().items_center().rounded(6).cursor_pointer().hover(s => s.bg(t.hover)).tooltip("Switch branch (b)")
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => this.openSwitcher(cx))
      .child(svg(`${CHROME}/git-branch.svg`).size(12).flex_none().text_color(t.muted))
      .child(div().min_w(0).max_w(max).truncate().font_semibold().text_size(12.5).child(name))
      .child(svg(`${CHROME}/chevron-down.svg`).size(11).flex_none().text_color(t.dim));
  }

  // Pull ↓n · push ↑n · ⌄ (every way to sync), or what's running.
  syncControl(t) {
    const info = this.status?.info, running = this.running;
    if (running) return h_flex().id("git-running").gap(5).min_w(0).flex_shrink_1().items_center().text_size(11.5).text_color(t.working).cursor_pointer()
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click(() => running.addr && run("terminal.peek", { terminal: running.addr })).tooltip("Watch it run")
      .child(svg(`${CHROME}/spinner.svg`).size(11).flex_none().spin(900)).child(div().truncate().max_w(180).child(running.title));
    const part = (id, label, tip, action) => h_flex().id(id).h_full().px(7).gap(4).items_center().cursor_pointer().text_color(t.muted)
      .hover(s => s.bg(t.hover).text_color(t.foreground)).tooltip(tip)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { action(cx); cx.notify(); }).child(label);
    const sep = () => div().w(1).h_full().bg(t.border);
    return h_flex().flex_none().h(24).items_center().rounded(6).border_1().border_color(t.border).overflow_hidden().text_size(11.5).font_family(settings().font_family ?? "JetBrains Mono")
      .child(part("git-pull", `↓${info?.behind ?? 0}`, "Pull (p)", cx => this.pull(cx))).child(sep())
      .child(part("git-push", `↑${info?.ahead ?? 0}`, "Push (P)", cx => this.push(cx))).child(sep())
      .child(part("git-sync", "⌄", "Fetch, pull --rebase, force push, clean up, custom commands", cx => this.syncMenu(cx)));
  }

  // The top bar, only while some columns don't fit (with all four, History's header holds the branch and sync).
  header(t, pane, zones) {
    const roomy = this.width() >= 560;
    return h_flex().h(40).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border)
      .when(!this.ctx, el => el.child(div().pl(2).font_semibold().text_size(13).child("Git")))
      .when(Boolean(this.ctx), el => el.child(this.branchPill(t, roomy ? 220 : 140)))
      .child(div().flex_1())
      .children([this.selfUpdate.pill(t)].filter(Boolean))
      .when(Boolean(this.ctx), el => el.child(h_flex().flex_none().gap(1).p(2).rounded(7).bg(t.surface).children(ZONES.map((z, i) => {
        const shown = zones.includes(i), on = this.zone === i;
        return div().id(`zt-${i}`).h(20).px(6).flex().items_center().rounded(5).cursor_pointer().text_size(11)
          .text_color(on ? t.foreground : shown ? t.muted : t.dim).when(on, e => e.bg(t.raised)).hover(s => s.text_color(t.foreground))
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => this.setZone(i, cx)).tooltip(`${z.title} (${z.key})`)
          .child(roomy ? z.title : z.key);
      })))
        .child(this.syncControl(t)))
      .when(Boolean(this.ctx), el => el.child(this.iconButton("git-popout", "mods/git/popout.svg", cx => pane ? this.collapse() : this.expand(cx), t, null, pane ? "Back to the side panel" : "Open as a tab")));
  }

  // Branches and Files keep a fixed width beside a flexible column (History or the diff), which share the rest.
  isFlexible(z, zones) { return zones.length === 1 || !FIXED_W[z] || !zones.some(x => x === 1 || x === 3); }
  colWidth(z) {
    const zones = this.shown ?? this.visibleZones();
    if (!this.isFlexible(z, zones)) return FIXED_W[z];
    const fixed = zones.filter(x => !this.isFlexible(x, zones)).reduce((a, x) => a + FIXED_W[x], 0);
    return (this.width() - fixed) / Math.max(1, zones.filter(x => this.isFlexible(x, zones)).length);
  }
  rowH(z) { return z === 1 ? HROW : ROW; }

  // One column: its header (number, title, what it shows) and its list or the diff.
  column(z, t, mono, zones, last) {
    const fixedW = FIXED_W[z], flexible = this.isFlexible(z, zones);
    const col = v_flex().min_w(0).min_h(0).h_full().when(!last, e => e.border_r(1).border_color(t.border))
      .when(flexible, e => e.flex_1()).when(!flexible, e => e.w(fixedW).flex_none());
    if (z === 3) return col.child(this.mainView(t, mono));
    return col.child(this.zoneHead(z, t)).child(this.list(z, t, mono)).when(z === 2 && this.subject().kind === "wip" && (this.status?.files?.length ?? 0) > 0, e => e.child(this.filesFooter(t)));
  }

  zoneBadge(z, t) {
    const on = this.zone === z;
    return div().flex_none().size(16).flex().items_center().justify_center().rounded(4).border_1()
      .border_color(on ? (this.hadKeys ? t.accent : t.foreground) : t.border).text_color(on ? t.foreground : t.dim)
      .font_family(settings().font_family ?? "JetBrains Mono").text_size(10).child(ZONES[z].key);
  }

  // A tab in a column's header (Local / Remote / Stashes, This branch / All).
  chipButton(id, label, on, t, action, tip) {
    return div().id(id).flex_none().h(20).px(7).flex().items_center().rounded(5).cursor_pointer().text_size(11.5)
      .text_color(on ? t.foreground : t.dim).when(on, e => e.bg(t.raised)).hover(s => s.text_color(t.foreground))
      .when(Boolean(tip), e => e.tooltip(tip))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { action(cx); cx.notify(); }).child(label);
  }

  iconChip(id, icon, t, action, tip) {
    return div().id(id).flex_none().size(22).flex().items_center().justify_center().rounded(5).cursor_pointer().text_color(t.dim)
      .hover(s => s.bg(t.hover).text_color(t.foreground)).tooltip(tip)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { action(cx); cx.notify(); }).child(svg(icon).size(13));
  }

  label(text, on, t) {
    return div().flex_none().text_size(11).font_semibold().text_color(on ? t.foreground : t.dim).child(text.toUpperCase());
  }

  zoneHead(z, t) {
    const on = this.zone === z, id = ZONES[z].id, filter = this.filter[id], all = (this.shown ?? []).length === 4;
    const head = h_flex().id(`zh-${z}`).h(38).flex_none().px(10).gap(6).items_center().overflow_hidden().cursor_pointer()
      .on_click((_e, cx) => this.setZone(z, cx))
      .child(this.zoneBadge(z, t));
    const find = this.iconChip(`find-${z}`, "mods/git/search.svg", t, cx => { this.zone = z; this.startFilter(cx); }, "Filter (/)");
    const filterChip = filter ? div().flex_none().min_w(0).max_w(90).truncate().text_size(11).text_color(t.accent).child(`/${filter}`) : null;
    if (z === 0) return head
      .child(this.chipButton("bt-local", "Local", this.branchTab === "local", t, cx => this.setBranchTab("local", cx), "[ / ]"))
      .child(this.chipButton("bt-remote", "Remote", this.branchTab === "remote", t, cx => this.setBranchTab("remote", cx), "[ / ]"))
      .child(this.chipButton("bt-stash", "Stashes", this.branchTab === "stash", t, cx => this.setBranchTab("stash", cx), "[ / ]"))
      .children([filterChip].filter(Boolean)).child(div().flex_1()).child(find);
    if (z === 1) {
      const ref = typeof this.scope !== "string" ? this.scope.ref : null;
      // With all four columns the branch and sync share this header: the tabs alone name the column then.
      return head.when(!all, e => e.child(this.label("History", on, t)))
        .child(this.chipButton("sc-head", "This branch", this.scope === "head", t, cx => this.setScope("head", cx), "[ / ]"))
        .child(this.chipButton("sc-all", "All", this.scope === "all", t, cx => this.setScope("all", cx), "[ / ]"))
        .when(Boolean(ref), e => e.child(this.chipButton("sc-ref", `${ref} ×`, true, t, cx => this.setScope("head", cx), "Back to this branch (esc)").max_w(150).truncate()))
        .children([filterChip].filter(Boolean))
        .child(div().flex_1())
        .when(all, e => e.child(this.branchPill(t, Math.max(80, this.colWidth(1) - 300))).child(this.syncControl(t)))
        .when(!all, e => e.child(find));
    }
    const s = this.subject();
    const what = s.kind === "wip" ? this.treeSummary() || "clean" : s.kind === "commit" ? s.c.short : s.s.ref;
    return head.child(this.label("Files", on, t))
      .child(div().flex_none().min_w(0).truncate().text_size(11).text_color(t.dim).when(s.kind !== "wip", e => e.font_family(settings().font_family ?? "JetBrains Mono")).child(what))
      .when(s.kind === "stash", e => e.child(this.chipButton("fl-x", "×", false, t, cx => { this.stashRef = null; this.syncDetail(cx); }, "Back to History's selection (esc)")))
      .when(this.notes().length > 0 && s.kind === "wip", e => e.child(div().flex_none().text_size(11).text_color(t.ansi3).child(`✎ ${this.notes().length}`)))
      .children([filterChip].filter(Boolean)).child(div().flex_1()).child(find);
  }

  emptyText(z) {
    if (z === 2) return this.subject().kind === "wip" ? "Working tree clean" : this.detail?.files == null ? "Loading…" : "No file changes";
    return z === 0 ? { local: "No local branches", remote: "No remote branches: f fetches", stash: "No stashes" }[this.branchTab] : "No commits";
  }

  list(z, t, mono) {
    const id = ZONES[z].id, items = this.items(z), h = this.rowH(z);
    if (!items.length || (z === 2 && this.subject().kind !== "wip" && this.detail?.files == null))
      return div().flex_1().px(16).py(8).text_size(12).text_color(t.dim).child(this.emptyText(z));
    const listId = `list-${id}`;
    return div().id(`wrap-${id}`).flex_1().min_h(0).relative()
      .on_mouse_down("left", (e, cx) => this.press(z, e, cx))
      .child(div().size_full().child(v_virtual_list(listId, items.length, h, i => this.itemKey(z, items[i], i), range => items.slice(range.start, range.end).map((it, j) => this.row(z, it, range.start + j, t, mono)))
        .track_scroll(this.scrolls[id]).size_full()
        .on_item_click((key, cx) => this.clickRow(z, key, cx))
        .on_item_secondary_click((key, _e, _cx) => { this.ctxPending = { z, key }; })))
      .child(Scrollbar.vertical(listId).viewport_from_layout().absolute().inset_0());
  }

  row(z, it, i, t, mono) {
    const cursor = i === this.selIndex(z), active = this.zone === z;
    const picked = z === 1 && Boolean(it.sha) && this.rangeSet.has(it.sha);
    const drag = this.drag?.z === z ? this.drag : null;
    const dragged = drag && (z === 1 ? drag.set.includes(it) : i === drag.from), target = drag && drag.to === i && !dragged;
    const el = h_flex().id(`${id(z)}-${this.itemKey(z, it, i)}`).h(this.rowH(z)).flex_none().relative().mx(6).px(8).gap(8).items_center().rounded(6).cursor_pointer().min_w(0).overflow_hidden()
      .when(picked, e => e.bg(t.selection))
      .when(cursor && !picked, e => e.bg(active ? t.selected : t.hover))
      .when(Boolean(target), e => e.border_1().border_color(t.accent))
      .when(Boolean(dragged), e => e.opacity(0.45))
      .hover(s => s.bg(cursor && active ? t.selected : t.hover))
      // The row with the keyboard: a bar on its left edge.
      .when(cursor && active, e => e.child(div().absolute().left(0).top(6).bottom(6).w(2).rounded(1).bg(this.hadKeys ? t.accent : t.foreground)));
    if (z === 0) {
      if (it.kind === "group") return el.child(svg(`${CHROME}/${it.open ? "chevron-down" : "chevron-right"}.svg`).size(11).flex_none().text_color(t.dim))
        .child(div().flex_1().min_w(0).truncate().text_size(11).font_semibold().text_color(t.dim).child(it.title.toUpperCase()))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(String(it.count)));
      if (it.kind === "stash") {
        const m = it.message.match(/^(?:WIP on|On) ([^:]+): (.*)$/);
        return el.child(svg(`${CHROME}/archive.svg`).size(13).flex_none().text_color(t.dim))
          .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(m ? m[2] : it.message))
          .when(Boolean(m) && this.colWidth(0) >= 280, e => e.child(div().flex_none().max_w(90).truncate().text_size(11).text_color(t.dim).child(m[1])))
          .child(div().flex_none().text_size(11).text_color(t.dim).child(short(it.date)));
      }
      return this.branchRow(this.branchIndent ? el.pl(20) : el, it, t, mono);
    }
    if (z === 1) return it.kind === "wip" ? this.wipRow(el, t) : this.commitRow(el, it, t, mono);
    return it.kind === "dir" ? this.dirRow(el, it, t) : this.fileRow(el, it, t, mono);
  }

  treeSummary() {
    const f = this.status?.files ?? [], staged = f.filter(x => x.staged).length, changed = f.filter(x => x.unstaged).length;
    return [staged && `${staged} staged`, changed && `${changed} changed`].filter(Boolean).join(" · ");
  }

  // A small tinted label (no border): gone, worktree, a PR, merged.
  tag(text, color, t) {
    return div().flex_none().px(6).h(17).flex().items_center().rounded(5).text_size(10.5).font_medium().bg(color + "22").text_color(color).child(text);
  }

  // The working tree, as History's first row: what's staged and changed, or clean.
  wipRow(el, t) {
    const files = this.status?.files ?? [], conflicts = files.filter(f => f.conflict).length;
    const staged = files.filter(f => f.staged).length, unstaged = files.filter(f => f.unstaged).length;
    return el.child(h_flex().w(18).flex_none().justify_center().child(div().size(10).rounded_full().border_2().border_color(files.length ? t.foreground : t.dim)))
      .child(v_flex().flex_1().min_w(0).gap(1)
        .child(div().font_semibold().text_size(12.8).text_color(files.length ? t.foreground : t.muted).child("Working changes"))
        .child(div().truncate().text_size(11.5).text_color(conflicts ? t.ansi1 : t.dim)
          .child(conflicts ? plural(conflicts, "conflict") : files.length ? `${staged} staged · ${unstaged} unstaged` : "clean")));
  }

  // A checkbox drawn in a Files row (the press handler sees where it is): all, some or nothing staged.
  checkbox(state, t, conflict) {
    return div().size(14).flex_none().flex().items_center().justify_center().rounded(4).border_1()
      .border_color(conflict ? t.ansi1 : state ? t.foreground : t.input)
      .when(state === "all", e => e.bg(t.foreground)).text_size(10).text_color(state === "all" ? t.background : t.foreground)
      .child(state === "all" ? "✓" : state === "some" ? "–" : "");
  }

  // A folder in the Files tree (t): ▾ / ▸, its name ("/" at the root), how many files when folded.
  dirRow(el, d, t) {
    const files = (this.status?.files ?? []).filter(f => this.under(d.path, f.path) && !f.conflict);
    const staged = files.filter(f => f.staged && !f.unstaged).length, some = files.some(f => f.staged);
    const state = files.length && staged === files.length ? "all" : some ? "some" : null;
    const noted = this.notes().some(n => this.under(d.path, n.path));
    return el.child(this.checkbox(state, t, d.conflict)).child(div().w(d.depth * 12).flex_none())
      .child(svg(`${CHROME}/${d.open ? "chevron-down" : "chevron-right"}.svg`).size(11).flex_none().text_color(t.dim))
      .child(div().flex_1().min_w(0).truncate().text_color(d.conflict ? t.ansi1 : t.muted).child(d.root ? "/" : d.name))
      .when(noted, e => e.child(div().flex_none().text_size(11).text_color(t.ansi3).child("✎")))
      .when(!d.open, e => e.child(div().flex_none().text_size(11).text_color(t.dim).child(String(d.count))));
  }

  // +12 −3 for a file (working tree or a commit's), right-aligned and quiet.
  counts(path, t, mono, stat) {
    const n = stat ?? this.numstat?.get(path);
    if (!n) return null;
    return h_flex().flex_none().gap(5).font_family(mono).text_size(11)
      .when(n.a > 0, e => e.child(div().text_color(t.ansi2).child(`+${n.a}`)))
      .when(n.d > 0, e => e.child(div().text_color(t.ansi1).child(`−${n.d}`)));
  }

  fileRow(el, row, t, mono) {
    const f = row.file, tree = !row.ro && !this.flat && !this.filter.files;
    const slash = f.path.lastIndexOf("/"), dir = tree || slash < 0 ? "" : f.path.slice(0, slash + 1), name = f.path.slice(slash + 1);
    const letterOf = c => ({ A: t.ansi2, D: t.ansi1, R: t.ansi4, C: t.ansi4, "?": t.ansi2, "!": t.ansi1 }[c] ?? t.ansi3);
    const body = (letter, color, nameColor) => el
      .child(div().w(12).flex_none().font_family(mono).text_size(11.5).font_semibold().text_color(color).child(letter))
      .child(h_flex().flex_1().min_w(0).gap(6).items_center().overflow_hidden()
        .child(div().flex_none().max_w_full().truncate().text_color(nameColor).child(name))
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(dir.replace(/\/$/, ""))));
    if (row.ro) return body(f.x, letterOf(f.x), t.foreground).children([this.counts(f.path, t, mono, f.stat)].filter(Boolean));
    const state = f.conflict ? null : f.staged && !f.unstaged ? "all" : f.staged ? "some" : null;
    const letter = f.untracked ? "?" : f.conflict ? "!" : f.unstaged ? (f.y === "." ? f.x : f.y) : f.x;
    const noted = this.notes().some(n => n.path === f.path);
    el = el.child(this.checkbox(state, t, f.conflict)).when(tree, e => e.child(div().w(row.depth * 12).flex_none()));
    return body(letter, letterOf(letter), f.conflict ? t.ansi1 : t.foreground)
      .when(noted, e => e.child(div().flex_none().text_size(11).text_color(t.ansi3).child("✎")))
      // During a merge / rebase / pick: conflicts were changed on both sides; others came in from the incoming side.
      .when(f.conflict, e => e.child(this.tag("both sides", t.ansi1, t)))
      .when(!f.conflict && this.fromIncoming(f.path), e => e.child(this.tag(`▼ ${this.sides()?.theirsShort ?? "incoming"}`, t.ansi4, t).max_w(120).truncate()))
      .children([this.counts(f.path, t, mono)].filter(Boolean));
  }

  // Under the working tree's files: stage all, and commit (its ⌄ has amend, stage-all-and-commit, editor).
  filesFooter(t) {
    const files = this.status?.files ?? [], staged = files.filter(f => f.staged).length, anyUnstaged = files.some(f => f.unstaged && !f.conflict);
    const btn = (id, label, primary, action, tip) => div().id(id).h(28).px(11).flex().flex_none().items_center().justify_center().cursor_pointer().text_size(12)
      .when(primary, e => e.bg(t.solid ?? t.accent).text_color(t.solid_foreground ?? t.accent_foreground).font_medium().hover(s => s.opacity(0.9)))
      .when(!primary, e => e.rounded(7).text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground)))
      .when(Boolean(tip), e => e.tooltip(tip))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { action(cx); cx.notify(); }).child(label);
    return h_flex().flex_none().p(8).gap(6).items_center().border_t(1).border_color(t.border)
      .child(btn("ff-stage", anyUnstaged ? "Stage all" : "Unstage all", false, cx => anyUnstaged ? this.cmd("git add -A", "git add -A", cx, { term: false }) : this.cmd("git reset", "git reset -q", cx, { term: false }), "a"))
      .child(div().flex_1())
      .child(h_flex().flex_none().rounded(7).overflow_hidden()
        .child(btn("ff-commit", staged ? `Commit ${plural(staged, "file")}` : "Commit…", true, cx => this.commit(cx), "c"))
        .child(div().w(1).h(28).bg(t.background))
        .child(btn("ff-more", "⌄", true, cx => this.commitOptions(cx), "Amend, stage all and commit, commit in editor").px(8)));
  }

  branchRow(el, b, t, mono) {
    const remote = b.kind === "remote", pr = this.prs?.[remote ? b.short : b.name];
    const stale = !remote && !b.head && (pr?.state === "MERGED" || pr?.state === "CLOSED" || b.gone);
    const prColor = pr ? (pr.isDraft && pr.state === "OPEN" ? t.dim : t[PR_COLOR[pr.state]] ?? t.dim) : null;
    const roomy = this.colWidth(0) >= 280;
    // To push (↑, warm like unpushed commits) and to pull (↓, blue like remote branches), as tinted labels.
    const track = !remote && (b.ahead || b.behind);
    return el.child(div().w(12).flex_none().child(b.head ? svg(`${CHROME}/check.svg`).size(12).text_color(t.foreground) : ""))
      .child(div().flex_1().min_w(0).truncate().text_color(stale ? t.muted : t.foreground).when(b.head, d => d.font_semibold()).child(remote ? b.short : b.name))
      .when(!remote && b.gone, e => e.child(this.tag("gone", t.ansi1, t)))
      .when(!remote && Boolean(b.worktree), e => e.child(this.tag("worktree", t.muted, t)))
      .when(Boolean(pr) && roomy, e => e.child(this.tag(`#${pr.number}`, prColor, t)))
      .when(!remote && b.merged && !pr && !b.head && b.name !== this.base?.replace(/^[^/]+\//, ""), e => e.child(this.tag("merged", t.ansi5, t)))
      .when(!remote && b.ahead > 0, e => e.child(this.tag(`↑${b.ahead}`, t.ansi3, t).font_family(mono)))
      .when(!remote && b.behind > 0, e => e.child(this.tag(`↓${b.behind}`, t.ansi4, t).font_family(mono)))
      .when(!track && (remote || !b.upstream || roomy), e => e.child(div().flex_none().text_size(11).text_color(t.dim).child(short(b.date))));
  }

  palette(t) { return [t.input]; }

  // Two lines, as the mock: the subject (and branch labels), then hash · author · when. The dot says
  // what it is: filled warm = not pushed yet (safe to rewrite), hollow = pushed, purple ring = a merge.
  commitRow(el, c, t, mono) {
    const refs = c.refs.filter(r => r !== "HEAD" && !r.endsWith("/HEAD") && !r.startsWith("tag: ")).map(r => r.replace(/^HEAD -> /, "→ "));
    const tags = c.refs.filter(r => r.startsWith("tag: ")).length;
    const cw = this.colWidth(1), shown = cw >= 560 ? 2 : cw >= 380 ? 1 : 0;
    const visible = shown ? refs.slice(0, shown) : refs.filter(r => r.startsWith("→")).slice(0, 1);
    const dot = c.lane.merge ? { ring: t.ansi5 } : c.state === "unpushed" ? { fill: t.ansi3, ring: t.ansi3 } : { ring: t.muted };
    const chip = r => div().flex_shrink_1().min_w(36).max_w(150).truncate().px(6).h(17).flex().items_center().rounded(5).text_size(10.5).font_medium()
      .bg(r.startsWith("→") ? t.foreground : t.ansi4 + "22").text_color(r.startsWith("→") ? t.background : t.ansi4).child(r.replace(/^→ /, ""));
    return el.pl(2).child(graphCell(c.lane, HROW, this.palette(t), t.chrome ?? t.background, { dot }))
      .child(v_flex().flex_1().min_w(0).gap(1)
        .child(h_flex().min_w(0).gap(6).items_center()
          .child(div().flex_1().min_w(40).truncate().text_size(12.8).text_color(c.state === "merged" ? t.muted : t.foreground).when(c.subject === "wip", d => d.italic().text_color(t.muted)).child(c.subject))
          .children(visible.map(chip))
          .when(this.copied.includes(c.sha), e => e.child(this.tag("⎘ pick", t.ansi6, t))))
        .child(h_flex().gap(6).min_w(0).text_size(11.5).text_color(t.dim)
          .child(div().flex_none().font_family(mono).text_size(11).text_color(c.state === "unpushed" ? t.ansi3 : t.dim).child(c.short))
          .child(div().flex_none().child(c.author.split(" ")[0]))
          .child(div().flex_none().child(short(c.date)))
          .when(tags > 0 && cw >= 380, e => e.child(div().flex_none().truncate().child(c.refs.find(r => r.startsWith("tag: ")).slice(5))))));
  }

  mainView(t, mono) {
    const m = this.main, log = m?.log, on = this.zone === 3, all = (this.shown ?? []).length === 4;
    const path = !log && m?.diff && m.path != null ? (m.diff.folder ? `${m.path || ""}/` : m.path) : null;
    const head = h_flex().id("zh-3").h(38).flex_none().px(10).gap(8).items_center().cursor_pointer()
      .on_click((_e, cx) => this.setZone(3, cx))
      .child(this.zoneBadge(3, t))
      .child(div().flex_1().min_w(0).truncate().when(Boolean(path), e => e.font_family(mono)).text_size(path ? 12 : 11.5).text_color(on ? t.foreground : t.muted)
        .child(path ?? (log ? `${log.running ? "running" : log.code === 0 ? "✓" : `✗ exit ${log.code}`} · ${log.title}` : m?.title ?? "")))
      .when(Boolean(path), el => el.child(this.diffButton("ask-file", "Ask AI", cx => this.askAbout(cx), t, t.ansi5)))
      .when(Boolean(log), el => el
        .when(Boolean(log.running && log.addr), e => e.child(this.iconButton("main-peek", `${CHROME}/terminal.svg`, () => run("terminal.peek", { terminal: log.addr }), t, "Watch")))
        .child(this.iconButton("main-copy", "mods/git/copy.svg", cx => { cx.write_to_clipboard(`$ ${log.title}\n${log.output}`); this.flash("Output copied"); }, t, "Copy"))
        .when(!log.running && log.code !== 0, e => e.child(this.iconButton("main-ai", "mods/git/ai.svg", cx => this.askAI(cx), t, "Ask AI")))
        .child(this.iconButton("main-close", null, cx => { this.mainOverride = null; this.syncMain(cx); }, t, "×", "Back to the diff (esc)")))
      // With all four columns there's no top bar: its update pill and expand button live here.
      .when(all, el => el.children([this.selfUpdate.pill(t)].filter(Boolean))
        .child(this.iconButton("git-popout", "mods/git/popout.svg", cx => this.fixed ? this.collapse() : this.expand(cx), t, null, this.fixed ? "Back to the side panel" : "Open as a tab")));
    const box = v_flex().flex_1().min_h(0).min_w(0).overflow_hidden().child(head);
    const quiet = text => box.child(div().px(14).py(8).text_size(12).text_color(t.dim).child(text));
    if (!m && this.subject().kind !== "wip" && this.detail?.files == null) return quiet("Loading…");
    if (!m) return quiet(this.subject().kind === "wip" && !(this.status?.files ?? []).length ? "Working tree clean" : this.ctx ? "Pick a file to see its diff" : "");
    if (log) return box.child(div().id("main-editor").flex_1().min_h(0).m(8).mt(0).rounded(8).border_1().border_color(t.border).overflow_hidden().on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Editor.new(this.editor).size_full()));
    if (!m.rows) return quiet("Loading…");
    if (m.diff) return box.child(this.diffView(m, t, mono));
    const palette = { add: [t.ansi2, t.ansi2 + "18"], del: [t.ansi1, t.ansi1 + "18"], hunk: [t.dim, t.surface], file: [t.foreground, null], meta: [t.muted, null] };
    const line = r => {
      const [fg, bg] = palette[r.kind] ?? [t.foreground, null];
      return div().h(LINE).flex_none().px(10).whitespace_nowrap().text_color(fg).when(Boolean(bg), e => e.bg(bg)).when(r.kind === "file", e => e.font_semibold()).child(r.text || " ");
    };
    return box.child(div().flex_1().min_h(0).relative().m(8).mt(0).rounded(8).border_1().border_color(t.border).bg(t.background).overflow_hidden().font_family(mono).text_size(12)
      .child(div().id("main-x").size_full().overflow_x_scrollbar()
        .child(div().w_full().min_w(m.width).h_full().child(v_virtual_list("main-lines", m.rows.length, LINE, i => String(i),
          range => m.rows.slice(range.start, range.end).map(line)).track_scroll(this.scrolls.main).size_full())))
      .child(Scrollbar.vertical("main-lines").viewport_from_layout().absolute().inset_0()));
  }

  // A small button inside the diff (hunk headers, conflicts, the action bar).
  diffButton(id, label, run, t, color) {
    return div().id(id).flex_none().h(20).px(7).flex().items_center().rounded(5).cursor_pointer()
      .text_size(11).text_color(color ?? t.muted).hover(s => s.bg(t.hover).text_color(color ?? t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); this.handle.focus(); run(cx); cx.notify(); })
      .child(label);
  }

  // A file's diff: old and new line numbers, the change, notes under their lines. Click a line for
  // the cursor, shift-click or drag to select lines, double-click to write a note, right-click for
  // its menu; hunk headers and conflicts carry their buttons.
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
      const cursor = i === this.cur && (on || this.anchor != null), chosen = i >= lo && i <= hi && r.side === side && lineRow(r);
      // Plain rows wrap long lines (the row grows; line numbers stay on its first line); the virtual
      // list's rows must keep one height, so they stay one line and scroll sideways.
      let el = plain ? h_flex().w_full().min_h(LINE).flex_none().items_start()
        : h_flex().h(LINE).flex_none().items_center().whitespace_nowrap().min_w(m.width);
      const text = (content, color) => (plain ? div().flex_1().min_w(0).py(1) : div()).when(Boolean(color), d => d.text_color(color)).child(content);
      if (plain) el = el.id(`dl-${i}`).on_mouse_down("left", (e, cx) => this.pressLine(i, e, cx)).on_mouse_move((_e, cx) => this.dragTo(i, cx))
        .on_mouse_down("right", () => { this.ctxPending = { z: 3, i }; });
      // A folder's diff names each file before its hunks.
      if (r.kind === "file") return el.px(10).pt(6).pb(2).when(i > 0, e => e.border_t(1).border_color(t.border)).font_semibold().text_color(t.foreground).child(text(r.text));
      if (r.kind === "section") return el.px(10).pt(i ? 8 : 4).pb(2).gap(6).items_center().text_size(10.5).font_semibold().text_color(t.dim)
        .child(div().size(6).flex_none().rounded_full().bg(SIDE[r.side] ?? t.dim)).child(text(sectionText(r).toUpperCase()));
      if (r.kind === "hunk") {
        const staged = r.side === "staged", editable = r.side === "staged" || r.side === "unstaged";
        // Its buttons show on the hunk under the pointer or the one with the cursor (keys do the same anywhere).
        const live = plain && editable && (this.hoverHunk === r.hunk || rows[this.cur]?.hunk === r.hunk);
        return el.pl(10).pr(6).gap(6).min_h(LINE + 4).bg(t.surface).text_color(t.dim).when(plain, e => e.items_center())
          .when(plain, e => e.on_hover((h, cx) => { const was = this.hoverHunk; this.hoverHunk = h ? r.hunk : this.hoverHunk === r.hunk ? null : this.hoverHunk; if (was !== this.hoverHunk) cx.notify(); }))
          .child(text(r.text).pl(2))
          .when(live, e => e
            .child(this.diffButton(`hk-s-${i}`, staged ? "Unstage" : "Stage", cx => this.onHunk(i, "stage", cx), t, staged ? t.ansi3 : t.ansi2))
            .when(r.side === "unstaged", e => e.child(this.diffButton(`hk-d-${i}`, "Discard", cx => this.onHunk(i, "discard", cx), t, t.ansi1)))
            .child(this.diffButton(`hk-a-${i}`, "Ask AI", cx => { this.cur = i + 1; this.askAbout(cx); }, t, t.ansi5)));
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
      return el.when(Boolean(bg), e => e.bg(bg)).border_l(2).border_color(cursor ? (this.hadKeys ? t.accent : t.foreground) : chosen ? t.accent + "66" : bg ?? t.background)
        .child(num(r.old)).child(num(r.new))
        .child(div().w(12).flex_none().h(LINE).flex().items_center().text_color(fg).child(sign))
        .child(text(r.text || " ", fg).pr(10));
    };
    const list = plain
      ? div().id("main-diff").flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.diffScroll).font_family(mono).text_size(12).pb(4)
        .on_mouse_up("left", () => { this.dragging = null; })
        .on_hover(h => { if (!h) this.dragging = null; })
        .children(rows.map(line))
      : div().flex_1().min_h(0).relative().font_family(mono).text_size(12)
        .child(div().id("main-x").size_full().overflow_x_scrollbar()
          .child(div().w_full().min_w(m.width).h_full().child(v_virtual_list("main-diff-v", rows.length, LINE, i => String(i),
            range => rows.slice(range.start, range.end).map((r, j) => line(r, range.start + j)))
            .track_scroll(this.scrolls.main).size_full()
            .on_item_click((key, cx) => this.pressLine(Number(key), null, cx))
            .on_item_secondary_click((key, _e, _cx) => { this.ctxPending = { z: 3, i: Number(key) }; }))))
        .child(Scrollbar.vertical("main-diff-v").viewport_from_layout().absolute().inset_0());
    return v_flex().flex_1().min_h(0)
      .when(Boolean(sides) && (m.diff.blocks || incoming), e => e.child(this.sidesLegend(sides, t)))
      .child(v_flex().flex_1().min_h(0).mx(8).rounded(8).border_1().border_color(t.border).bg(t.background).overflow_hidden().child(list))
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
    const rows = m.rows ?? [], r = rows[this.cur], entry = this.selected(2), wip = this.subject().kind === "wip";
    const f = wip && entry?.kind === "file" ? entry.file : null, sides = this.sides();
    const pick = this.picked(), n = this.notes().length, bits = [];
    const b = (id, label, run, color) => bits.push(this.diffButton(id, label, run, t, color));
    let what;
    if (!wip) {
      const s = this.subject();
      what = s.kind === "commit" ? `${s.c.short} · ${s.c.author.split(" ")[0]} · ${s.c.date}` : `${s.s.ref} · ${s.s.message}`;
      b("ab-a", "Ask AI", cx => this.askAbout(cx), t.accent);
    } else if (r?.block && this.mainFocus) {
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
      what = `Line ${lineOf(r) ?? ""} · shift-click or drag selects · double-click writes a note`;
      b("ab-s", r.side === "staged" ? "Unstage hunk" : "Stage hunk", cx => this.stageHunk(cx), r.side === "staged" ? t.ansi3 : t.ansi2);
      b("ab-n", "Note", cx => this.addNote(cx), t.ansi3);
    } else what = entry?.kind === "dir" ? `${entry.root ? "Everything" : `${entry.path}/`} · ${plural(entry.count, "file")}`
      : f ? (f.conflict ? "Conflicted: keep a side in each conflict, then stage the file" : "Click a line to review it · shift-click or drag selects") : "";
    if (f && !f.conflict) b("ab-f", f.unstaged ? "Stage file" : "Unstage file", cx => this.stageCurrentFile(cx));
    if (wip && entry?.kind === "dir") b("ab-f", "Stage / unstage folder", cx => this.stageCurrentFile(cx));
    if (f?.conflict && !(r?.block && this.mainFocus)) b("ab-r", "Open resolver", () => this.openConflicts());
    if (wip && n) b("ab-p", `Send ${plural(n, "note")} to AI`, cx => this.askAI(cx, "notes"), t.ansi3);
    return h_flex().h(34).flex_none().px(12).gap(4).items_center()
      .text_size(11)
      .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(what))
      .children(bits);
  }

  // The Files row's space action, from anywhere (the diff's "Stage file").
  stageCurrentFile(cx) {
    const z = this.zone;
    this.zone = 2;
    const a = this.actions().find(a => a.key === "space");
    this.zone = z;
    a?.run(cx);
  }

  // Banners: a merge / rebase / pick in progress, a command that failed (hooks first), an agent at work.
  banner(id, color, t, title, buttons, extra) {
    return v_flex().id(id).flex_none().mx(8).mt(6).px(10).py(7).gap(6).rounded(8).border_1().border_color(color).bg(t.surface)
      .child(h_flex().gap(8).items_center()
        .child(div().size(7).flex_none().rounded_full().bg(color))
        .child(div().flex_1().min_w(0).truncate().text_size(12).font_semibold().child(title))
        .children(buttons.filter(Boolean).map(([label, action, primary], i) => h_flex().id(`${id}-b${i}`).h(24).px(8).flex_none().items_center().rounded(6)
          .when(primary, e => e.bg(color).text_color(t.background).hover(s => s.opacity(0.88)))
          .when(!primary, e => e.border_1().border_color(t.input).bg(t.raised).hover(s => s.bg(t.hover)))
          .text_size(11.5).cursor_pointer()
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => { action(cx); cx.notify(); }).child(label))))
      .when(Boolean(extra), e => e.child(extra));
  }

  opBanner(t) {
    const op = this.op, n = this.conflicts().length;
    const what = op.kind === "rebase" ? `Rebasing ${op.branch ?? "HEAD"} onto ${op.other ?? "?"}${op.step ? ` · ${op.step} of ${op.total}` : ""}`
      : op.kind === "merge" ? `Merging ${op.other ?? "?"} into ${this.status?.info.head ?? "HEAD"}` : `${op.kind} of ${op.other ?? "?"} in progress`;
    // A rebase's progress, one step per commit (the stopped one red while it has conflicts).
    const steps = op.kind === "rebase" && op.total && op.total <= 40 ? h_flex().gap(2).children(Array.from({ length: op.total }, (_, i) => div().flex_1().h(3).rounded(2)
      .bg(i + 1 < op.step ? t.ansi3 : i + 1 === op.step ? (n ? t.ansi1 : t.ansi3) : t.raised))) : null;
    const extra = steps || op.current ? v_flex().gap(4).child(steps ? steps : div())
      .when(Boolean(op.current), e => e.child(div().text_size(11).text_color(t.muted).truncate().child(`Stopped at ${op.current}${n ? ` · ${plural(n, "file")} conflict (Files shows them)` : ""}`))) : null;
    return this.banner("op", n ? t.ansi1 : t.ansi3, t, `${what}${n ? ` · ${plural(n, "conflict")}` : " · no conflicts left"}`, [
      n > 0 && ["Resolve with AI (i)", cx => this.askAI(cx), true],
      n > 0 && ["Resolve (v)", () => this.openConflicts()],
      !n && [`Continue`, cx => this.cmd(`git ${op.kind} --continue`, `git ${op.kind} --continue`, cx), true],
      op.kind !== "merge" && ["Skip", cx => this.cmd(`git ${op.kind} --skip`, `git ${op.kind} --skip`, cx)],
      ["Abort", cx => this.confirm(`Abort the ${op.kind}?`, `Abort ${op.kind}`, cx => this.cmd(`git ${op.kind} --abort`, `git ${op.kind} --abort`, cx), cx)],
    ], extra);
  }

  aiBanner(t) {
    const a = this.ai.address ? agents().find(x => x.address === this.ai.address) : null;
    const status = a?.status, color = status === "working" ? t.working : status === "blocked" ? t.blocked : status ? t.ansi2 : t.dim;
    const done = a && status !== "working" && status !== "blocked";
    const text = !this.ai.address ? `Started a new agent tab to ${this.ai.label}`
      : !a ? `The agent asked to ${this.ai.label} is gone`
        : status === "working" ? `${a.program?.name ?? "Agent"} (${a.tab_name}) is working on: ${this.ai.label}…`
          : status === "blocked" ? `${a.program?.name ?? "Agent"} needs you (${this.ai.label})`
            : `${a.program?.name ?? "Agent"} finished: review, then ${this.op ? "continue" : "retry"}`;
    const retry = this.ai.failure && !this.ai.failure.running ? this.ai.failure : null;
    return this.banner("ai", color, t, text, [
      done && this.op && !this.conflicts().length && ["Continue", cx => { this.ai = null; this.cmd(`git ${this.op.kind} --continue`, `git ${this.op.kind} --continue`, cx); }, true],
      done && !this.op && retry && ["Retry", cx => { this.ai = null; this.cmd(retry.title, retry.script, cx, retry.opts); }, true],
      a && ["Show", () => run("agent.focus", { terminal: a.address })],
      ["Dismiss", () => { this.ai = null; }],
    ]);
  }

  // A failed command: which hook (when it's one), its last lines, and the fix: AI, or retry.
  failureBanner(t, mono) {
    const f = this.failure, out = f.output ?? "";
    const hook = out.match(/\b(pre-commit|commit-msg|pre-push|prepare-commit-msg|post-checkout|pre-rebase)\b/)?.[1] ?? (/husky|lint-staged/i.test(out) ? "commit" : null);
    const title = hook ? `${hook} hook failed · ${f.title}` : `${f.title} failed (exit ${f.code})`;
    const tail = out.split("\n").map(l => l.replace(/\s+$/, "")).filter(l => l.trim()).slice(-5);
    const extra = tail.length ? v_flex().px(8).py(5).rounded(6).bg(t.background).font_family(mono).text_size(11).text_color(t.muted)
      .children(tail.map(l => div().truncate().child(l))) : null;
    return this.banner("fail", t.ansi1, t, title, [
      ["Fix with AI (i)", cx => this.askAI(cx), true],
      ["Retry", cx => this.cmd(f.title, f.script, cx, f.opts)],
      ["Output", cx => { this.showOutput(f, cx); this.setZone(3, cx); }],
      ["×", () => { this.failure = null; }],
    ], extra);
  }

  footer(t) {
    const flash = this.flashMsg?.text ?? null;
    return keybar(t, { id: "git", chips: this.chips(), flash, width: this.width(), onKeys: cx => { this.keysOpen = true; this.handle.focus(); cx.notify(); } });
  }

  // An action's label as a short keycap label: "New branch from here" → "new branch".
  static short(label) { return label.replace(/…$/, "").toLowerCase().split(" ").slice(0, 2).join(" "); }

  // The footer's keycaps for what's on screen now: the row's own actions first.
  chips() {
    if (this.commitBox) return this.commitChips();
    if (this.switcher) return [{ caps: ["up", "down"], label: "move" }, { caps: ["enter"], label: "switch" }, { caps: ["escape"], label: "close" }];
    if (this.prompt) return [{ caps: ["enter"], label: "confirm" }, { caps: ["escape"], label: "cancel" }];
    if (this.menu) return [{ caps: ["j", "k"], label: "move" }, { caps: ["enter"], label: "pick" }, { caps: ["escape"], label: "close" }];
    if (this.editorFocused) return [{ caps: ["cmd-c"], label: "copy" }, { caps: ["escape"], label: "back" }];
    if (this.zone === 3 && !this.main?.diff) return [{ caps: ["j", "k"], label: "scroll" }, { caps: ["ctrl-d", "ctrl-u"], label: "page" }, { caps: ["h"], label: "files" }, { caps: ["escape"], label: "back" }];
    const all = this.actions().filter(a => a.key !== "ctrl-r");
    const own = all.filter(a => !a.global && !a.custom);
    const acts = (own.length ? own : all).filter(a => a.chip || !own.length).slice(0, 8).map(a => ({ caps: [a.key], label: a.chip ?? Git.short(a.label) }));
    const n = this.selectedCommits().length;
    if (n > 1) return [{ caps: ["escape"], label: `clear ${n}` }, ...acts.filter(a => a.caps[0] !== "v")];
    if (this.zone === 3 && this.main?.diff) return [...acts, { caps: ["j", "k"], label: this.anchor != null ? "line" : "hunk" }, { caps: ["x"], label: "actions" }];
    return [...acts, { caps: ["x"], label: "actions" }];
  }

  keysGroups() {
    const z = ZONES[this.zone];
    return [
      { title: `${z.title}: this row`, chips: this.actions().filter(a => !a.global && !a.custom).map(a => ({ caps: [a.key], label: a.label.replace(/…$/, "") })) },
      { title: "Moving", chips: [
        { caps: ["1", "2", "3", "4"], label: "branches / history / files / diff" },
        { caps: ["h", "l"], label: "column left / right (tab too)" },
        { caps: ["j", "k"], label: "move (in the diff: hunk to hunk)" },
        { caps: ["g", "g"], label: "top" }, { caps: ["G"], label: "bottom" },
        { caps: ["ctrl-d", "ctrl-u"], label: "half a page" },
        { caps: ["enter"], label: "open: files, the diff, a branch's log" },
        { caps: ["[", "]"], label: "the column\u2019s tabs: local / remote / stashes, this branch / all" },
        { caps: ["v"], label: "History: select a range, then j / k" }, { caps: ["shift-down", "shift-up"], label: "History: grow the range" },
        { caps: ["escape"], label: "clear the range / filter, back" },
      ] },
      { title: "Anywhere", chips: this.actions().filter(a => a.global || a.custom).map(a => ({ caps: [a.key], label: a.label.replace(/…$/, "") }))
        .concat([{ caps: ["/"], label: "filter this column" }, { caps: ["x"], label: "actions for this row (= right-click)" }, { caps: ["q"], label: "close the panel" }, { caps: ["?"], label: "this card" }]) },
      { title: "The diff (4)", chips: [
        { caps: ["space"], label: "stage the hunk or lines (unstage on the staged side)" },
        { caps: ["v"], label: "select lines: then j / k move a line at a time" },
        { caps: ["d"], label: "discard the hunk or lines" }, { caps: ["a"], label: "write a note on the line or lines" },
        { caps: ["X"], label: "delete the notes on this line" }, { caps: ["p"], label: "send the notes to an agent" },
        { caps: ["A"], label: "ask AI about this change" }, { caps: ["J", "K"], label: "next / previous file" },
        { caps: ["}", "{"], label: "next / previous hunk" }, { caps: ["e"], label: "open in your editor at this line" },
        { caps: ["o", "t", "b"], label: "on a conflict: keep current / incoming / both" },
      ] },
      { title: "Mouse", chips: [
        { caps: ["click"], label: "pick a row (any column)" }, { caps: ["shift-click"], label: "History: a range · diff: lines" },
        { caps: ["cmd-click"], label: "History: pick commits one by one" },
        { caps: ["double-click"], label: "reword · switch branch · open the diff · note a line" },
        { caps: ["right-click"], label: "the row's actions" },
        { caps: ["drag"], label: "commit onto commit: squash / fixup / move · branch onto branch: merge / rebase" },
        { caps: ["checkbox"], label: "Files: stage / unstage" },
      ] },
    ];
  }

  // A menu: centered over a scrim, or at `at` (a right-click, a drop) as a popover.
  menuView(t) {
    const m = this.menu, mono = settings().font_family ?? "JetBrains Mono";
    const close = (_e, cx) => { cx.stop_propagation(); this.menu = null; cx.notify(); };
    const items = v_flex().id("menu-items").overflow_y_scrollbar().children(m.items.map((it, i) => h_flex().id(`mi-${i}`).h(26).flex_none().px(8).gap(8).items_center().rounded(6)
      .when(!it.disabled, e => e.cursor_pointer()).when(i === m.sel, e => e.bg(t.selected)).hover(s => s.bg(t.hover))
      .on_click((_e, cx) => { if (it.disabled) return; this.menu = null; it.run(cx); cx.notify(); })
      .child(div().flex_1().min_w(0).truncate().text_color(it.disabled ? t.dim : it.danger ? t.ansi1 : t.foreground).child(it.label))
      .when(Boolean(it.hint) && it.hint !== it.key, e => e.child(div().flex_none().text_size(11).text_color(t.dim).child(it.hint)))
      .child(div().flex_none().min_w(18).text_size(11).font_family(mono).text_color(t.accent).child(it.key ?? ""))));
    const card = v_flex().id("menu").p(6).rounded(10).border_1().border_color(t.border).bg(t.popover).shadow_lg()
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(div().px(8).py(6).font_semibold().child(m.title))
      .when(Boolean(m.lines?.length), el => el.child(v_flex().px(8).pb(6).text_size(11.5).text_color(t.muted).children(m.lines.map(l => div().truncate().child(l)))))
      .child(items);
    if (!m.at) return div().id("menu-scrim").absolute().inset_0().bg("#00000055").flex().items_center().justify_center()
      .on_mouse_down("left", close).child(card.w(380).max_h(520));
    const w = 300, h = Math.min(440, m.items.length * 26 + 50 + (m.lines?.length ?? 0) * 18);
    const W = this.width(), H = (this.size?.height ?? 600) / zoomOf() + 80;
    const x = Math.max(6, Math.min(m.at.x, W - w - 6)), y = m.at.y + h > H - 8 ? Math.max(6, m.at.y - h) : m.at.y;
    return div().id("menu-scrim").absolute().inset_0().on_mouse_down("left", close).on_mouse_down("right", close)
      .child(card.absolute().left(x).top(y).w(w).max_h(440));
  }

  switcherView(t) {
    const s = this.switcher, list = this.switchMatches(), sel = Math.min(s.sel, list.length - 1);
    return div().id("sw-scrim").absolute().inset_0().bg("#00000044").flex().items_start().justify_center().pt(48)
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.closeSwitcher(cx); })
      .child(v_flex().id("sw").w(Math.max(300, Math.min(460, this.width() - 24))).p(8).gap(4).rounded(10).border_1().border_color(t.border).bg(t.popover).shadow_lg()
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(Input.new(s.input).h(32).px(10).rounded(7).border_1().border_color(t.accent).bg(t.background).text_size(12.5).text_color(t.foreground))
        .child(v_flex().id("sw-list").max_h(360).overflow_y_scrollbar().children(list.map((b, i) => h_flex().id(`sw-${i}`).h(26).flex_none().px(8).gap(8).items_center().rounded(6).cursor_pointer()
          .when(i === sel, e => e.bg(t.selected)).hover(st => st.bg(t.hover))
          .on_click((_e, cx) => { this.switcher.sel = i; this.pickSwitch(cx); })
          .child(div().w(12).flex_none().text_color(t.accent).child(b.head ? "✓" : b.kind === "create" ? "+" : ""))
          .child(div().flex_1().min_w(0).truncate().text_color(b.kind === "create" ? t.accent : t.foreground).child(b.kind === "create" ? `Create branch “${b.name}”` : b.name))
          .child(div().flex_none().text_size(11).text_color(t.dim).child(b.kind === "remote" ? "remote" : b.kind === "create" ? "new" : b.worktree ? "worktree" : (b.date ?? "").replace(/ ago$/, ""))))))
        .child(div().px(4).text_size(10.5).text_color(t.dim).child("↑ ↓ choose · enter switch · esc close · letters in order match")));
  }

  // What the commit dialog's keys do in the box that has the keyboard.
  commitChips() {
    const body = this.commitBox?.field === "body";
    return body
      ? [{ caps: ["ctrl-s"], label: "commit" }, { caps: ["cmd", "enter"], label: "commit" }, { caps: ["enter"], label: "new line" }, { caps: ["tab"], label: "summary" }, { caps: ["escape"], label: "cancel" }]
      : [{ caps: ["enter"], label: "commit" }, { caps: ["ctrl-s"], label: "commit" }, { caps: ["tab"], label: "description" }, { caps: ["escape"], label: "cancel" }];
  }

  commitView(t) {
    const c = this.commitBox, n = c.summary.value().trim().length, onSummary = c.field === "summary";
    const files = this.status?.files ?? [], staged = files.filter(f => f.staged).length, all = files.length;
    const head = (text, on, right) => h_flex().items_center().gap(8).text_size(11.5)
      .child(div().font_semibold().text_color(on ? t.accent : t.muted).child(text)).child(div().flex_1()).child(right);
    return div().id("commit-scrim").absolute().inset_0().bg("#00000055").flex().items_start().justify_center().pt(56)
      .child(v_flex().id("commit").w(Math.max(320, Math.min(640, this.width() - 24))).p(14).gap(6).rounded(10)
        .border_1().border_color(t.border).bg(t.popover).shadow_lg()
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(div().text_size(11).text_color(t.dim).child(c.stageAll ? `Stage all and commit · ${plural(all, "file")}` : `Commit ${staged} staged file${staged === 1 ? "" : "s"}`))
        .child(head("Commit summary", onSummary, div().font_family(settings().font_family ?? "JetBrains Mono").text_size(11)
          .text_color(n > 72 ? t.ansi1 : n > 50 ? t.ansi3 : t.dim).child(String(n))))
        .child(Input.new(c.summary).h(32).px(10).rounded(7).border_1().border_color(onSummary ? t.accent : t.border).bg(t.background).text_size(12.5).text_color(t.foreground))
        .child(head("Commit description", !onSummary, div().text_size(10.5).text_color(t.dim).child("tab to switch")).mt(6))
        .child(Textarea.new(c.body).h(150).px(10).py(8).rounded(7).border_1().border_color(!onSummary ? t.accent : t.border).bg(t.background).text_size(12.5).text_color(t.foreground))
        // Footer: the keys for the box in use (as the panels' key bars), then the buttons.
        .child(h_flex().mt(4).pt(8).gap(10).items_center().border_t(1).border_color(t.border).text_size(11).text_color(t.dim)
          .child(h_flex().flex_1().min_w(0).gap(12).items_center().overflow_hidden()
            .children(this.commitChips().map(c => h_flex().flex_none().gap(4).items_center()
              .child(h_flex().flex_none().gap(2).children(c.caps.map(k => keycap(t, k === "cmd" ? "⌘" : k))))
              .child(div().flex_none().text_color(t.dim).child(c.label)))))
          .child(div().id("commit-cancel").px(9).h(24).flex().items_center().rounded(6).cursor_pointer().text_color(t.muted).hover(s => s.bg(t.hover))
            .on_click((_e, cx) => this.closeCommit(cx)).child("Cancel"))
          .child(div().id("commit-go").px(11).h(24).flex().items_center().rounded(6).cursor_pointer().bg(t.solid ?? t.accent).text_color(t.solid_foreground ?? t.accent_foreground)
            .hover(s => s.opacity(0.88)).on_click((_e, cx) => this.submitCommit(cx)).child("Commit"))));
  }

  promptView(t) {
    const p = this.prompt;
    return div().id("prompt-scrim").absolute().inset_0().bg("#00000055").flex().items_start().justify_center().pt(70)
      .child(v_flex().id("prompt").w(Math.max(280, Math.min(420, this.width() - 24))).p(12).gap(8).rounded(10).border_1().border_color(t.border).bg(t.popover).shadow_lg()
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(div().font_semibold().child(p.title))
        .child(Input.new(p.input).h(32).px(10).rounded(7).border_1().border_color(t.accent).bg(t.background).text_size(12.5).text_color(t.foreground))
        .child(div().text_size(11).text_color(t.dim).child("enter confirm · esc cancel")));
  }
}

const id = z => ZONES[z].id;

function openInEditor(view, paths) {
  const editor = view.config?.editor ? q(view.config.editor) : "${VISUAL:-${EDITOR:-vi}}";
  run("terminal.open", { argv: [view.shell ?? "/bin/zsh", "-lic", `${editor} ${[paths].flat().map(q).join(" ")}`], folder: view.ctx.root, place: "tab" });
}
