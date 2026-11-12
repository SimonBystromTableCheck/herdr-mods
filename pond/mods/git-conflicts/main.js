// Merge/rebase conflicts, lazygit-style: the conflicting files, a chunk picker for each
// conflict (ours / theirs / both, undo), Ask AI, and continue / abort. Opened by the `git`
// panel as a pane at the tab's right edge when an operation stops on conflicts; closes
// itself when the operation ends. Props: {tab, root, gitDir, on}.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, v_virtual_list, VirtualListScrollHandle, Scrollbar } from "gpui-base";
import { agents, exec, hc, knownAgents, nextCommand, panes, props, readTextFile, run, settings, spaces, theme, writeTextFile } from "herdr";
import { KINDS, conflictsOf, parse, resolve, rows, unmerged } from "./logic.mjs";
import { SelfUpdate } from "./update.js";

const ROW = 18, CROW = 22; // CROW: every row of the chunk list (one size: per-row sizes drew nothing)
const MARKER = "__herdr_git_output__";
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "color.ui=false"];

function keyOf(e) {
  const m = e.modifiers ?? {};
  if (m.control || m.platform || m.alt) return e.keystroke;
  if (["enter", "escape", "tab", "space", "up", "down", "left", "right", "pageup", "pagedown"].includes(e.key)) return m.shift && e.key === "tab" ? "shift-tab" : e.key;
  return e.key_char ?? (m.shift ? e.key.toUpperCase() : e.key);
}

// A theme color with alpha (theme colors are #rrggbb).
const tint = (c, a) => (typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c) ? c + a : c);

export default class Conflicts extends View {
  init(_props, cx) {
    this.selfUpdate = new SelfUpdate("git-conflicts", "Conflicts panel"); this.selfUpdate.start(cx);
    const p = props() ?? {};
    Object.assign(this, { p, files: [], order: [], how: {}, advance: null, sel: 0, n: 0, side: "ours", texts: {}, undo: {}, op: null, menu: null, flashMsg: null, running: null, gone: 0, mode: "files", diffs: {}, picked: false });
    this.handle = cx.focus_handle();
    this.scroll = VirtualListScrollHandle.new();
    cx.spawn(async (cx) => {
      this.shell = (await exec("sh", ["-c", 'printf %s "$SHELL"'], { on: p.on }).catch(() => null))?.stdout.trim() || "/bin/zsh";
    });
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "focus") this.handle.focus();
        cx.notify();
      }
    });
    this.refresh(cx);
    cx.timer.every(1500, (cx) => this.refresh(cx));
    // Opened by the Git panel (it focuses this pane): take the keyboard at once, as a click would.
    cx.timer.after(60, (cx) => { this.handle.focus(); cx.notify(); });
    cx.timer.after(250, (cx) => { if (this.me()?.focused && !this.handle.is_focused()) { this.handle.focus(); cx.notify(); } });
  }

  me() { return panes().find((x) => x.tab === this.p.tab && x.mod === "git-conflicts") ?? null; }

  // Herdr focusing this pane (pane.focus, pane.go, the Git panel's Resolve) hands it the
  // keyboard too; only on that change, so a click elsewhere isn't taken back.
  syncFocus() {
    const now = Boolean(this.me()?.focused);
    if (now && !this.appFocused && !this.handle.is_focused()) this.handle.focus();
    this.appFocused = now;
  }

  git(args) { return exec("git", [...READ, ...args], { cwd: this.p.root, on: this.p.on }); }

  // ---- State ----------------------------------------------------------------

  refresh(cx) {
    if (this.busy || !this.p.root) return;
    cx.spawn(async (cx) => {
      if (this.busy) return;
      this.busy = true;
      try {
        const [st, op] = await Promise.all([this.git(["status", "--porcelain=v2", "-z"]).catch(() => null), this.loadOp()]);
        this.op = op;
        if (!op) {
          // Twice in a row (a continue between steps of a rebase can look like none): close.
          if (++this.gone >= 2) return this.closeSelf();
        } else this.gone = 0;
        const now = unmerged(st?.stdout);
        const paths = new Set(now.map((f) => f.path));
        const was = this.file()?.path;
        // Every file seen stays in its place; a decided one turns green (`how`: what was chosen).
        for (const f of now) if (!this.order.includes(f.path)) this.order.push(f.path);
        for (const f of now) delete this.how[f.path];
        this.files = now;
        let i = this.list().findIndex((f) => f.path === was);
        // Just decided: on to the next file still waiting (after it, wrapping round).
        if (this.advance && this.advance === was && !paths.has(was)) {
          const L = this.list(), at = L.findIndex((f) => f.path === was);
          const next = [...L.slice(at + 1), ...L.slice(0, at)].find((f) => !f.done);
          if (next) {
            i = L.indexOf(next);
            this.n = 0;
            this.side = "ours";
            if (!KINDS[next.xy]?.markers) this.mode = "files";
          }
        }
        if (this.advance && !paths.has(this.advance)) this.advance = null;
        // First look: the first file with chunks to pick, as lazygit lands on one.
        const first = !this.picked && !was ? this.list().findIndex((f) => !f.done && KINDS[f.xy]?.markers) : -1;
        this.sel = first >= 0 ? first : i >= 0 ? i : Math.min(this.sel, Math.max(0, this.list().length - 1));
        await this.loadText(this.file());
      } finally {
        this.busy = false;
        cx.notify();
      }
    });
  }

  // Which operation is in progress, from the git dir (as the git panel reads it).
  async loadOp() {
    const g = this.p.gitDir;
    const script = 'g="$1"; r() { [ -f "$1" ] && head -n1 "$1" || echo; };'
      + ' if [ -d "$g/rebase-merge" ]; then echo rebase; r "$g/rebase-merge/head-name"; r "$g/rebase-merge/onto"; r "$g/rebase-merge/msgnum"; r "$g/rebase-merge/end";'
      + ' elif [ -d "$g/rebase-apply" ]; then echo rebase; r "$g/rebase-apply/head-name"; r "$g/rebase-apply/onto"; r "$g/rebase-apply/next"; r "$g/rebase-apply/last";'
      + ' elif [ -f "$g/MERGE_HEAD" ]; then echo merge; echo; r "$g/MERGE_HEAD"; echo; echo; r "$g/MERGE_MSG";'
      + ' elif [ -f "$g/CHERRY_PICK_HEAD" ]; then echo cherry-pick; echo; r "$g/CHERRY_PICK_HEAD"; echo; echo;'
      + ' elif [ -f "$g/REVERT_HEAD" ]; then echo revert; echo; r "$g/REVERT_HEAD"; echo; echo; fi';
    const r = await exec("sh", ["-c", script, "op", g], { on: this.p.on }).catch(() => null);
    if (r === null) return this.op; // couldn't ask: as before
    const [kind, headName, other, step, total, msg] = r.stdout.split("\n");
    if (!kind) return null;
    const head = (await this.git(["branch", "--show-current"]).catch(() => null))?.stdout.trim() || null;
    const name = async (sha) => sha ? (await this.git(["for-each-ref", "--points-at", sha, "--count=1", "--format=%(refname:short)"]).catch(() => null))?.stdout.trim() || sha.slice(0, 8) : null;
    const merged = msg?.match(/^Merge (?:remote-tracking )?branch '([^']+)'/)?.[1];
    return { kind, branch: headName?.replace(/^refs\/heads\//, "") || head, head, other: merged ?? (await name(other)), step: +step || null, total: +total || null };
  }

  async loadText(f) {
    if (!f || f.done) return;
    if (!KINDS[f.xy]?.markers) return this.loadDiff(f);
    const text = await readTextFile(`${this.p.root}/${f.path}`, { on: this.p.on }).catch(() => null);
    if (text === null) return;
    if (this.texts[f.path] !== text) {
      this.texts[f.path] = text;
      const n = conflictsOf(parse(text)).length;
      if (this.file()?.path === f.path && this.n >= n) this.n = Math.max(0, n - 1);
    }
  }

  // A file one side deleted: what the other side changed, against the common base
  // (index stages: 1 base, 2 ours, 3 theirs), so keep-or-delete is an informed choice.
  async loadDiff(f) {
    if (this.diffs[f.path]) return;
    const kept = f.xy === "UD" || f.xy === "AU" ? 2 : f.xy === "DU" || f.xy === "UA" ? 3 : null;
    if (!kept) return;
    const hasBase = f.xy === "UD" || f.xy === "DU";
    const r = hasBase
      ? await this.git(["diff", "--no-color", "--no-ext-diff", `:1:${f.path}`, `:${kept}:${f.path}`]).catch(() => null)
      : await this.git(["show", `:${kept}:${f.path}`]).catch(() => null);
    const lines = (r?.stdout ?? "").replace(/\n$/, "").split("\n");
    this.diffs[f.path] = hasBase ? lines.filter((l) => !/^(diff --git|index |--- |\+\+\+ )/.test(l)) : lines.map((l) => `+${l}`);
  }

  // Unmerged files first, then the ones resolved here (ticked).
  list() {
    const open = new Map(this.files.map((f) => [f.path, f]));
    return this.order.map((path) => open.get(path) ?? { path, done: true, how: this.how[path] ?? "resolved" });
  }
  file() { return this.list()[this.sel] ?? null; }
  segs() { const f = this.file(); const t = f && this.texts[f.path]; return t == null ? null : parse(t); }
  count() { return this.segs() ? conflictsOf(this.segs()).length : 0; }

  // During a rebase "ours" is the upstream being rebased onto, "theirs" your commit.
  sides() {
    const op = this.op;
    if (op?.kind === "rebase") return { ours: `upstream · ${op.other ?? "onto"}`, theirs: `your commit · ${op.branch ?? "HEAD"}` };
    return { ours: `current · ${op?.head ?? "HEAD"}`, theirs: `incoming · ${op?.other ?? "theirs"}` };
  }

  flash(text, ms = 3500) { this.flashMsg = { text, until: Date.now() + ms }; }

  // ---- Actions ----------------------------------------------------------------

  pick(choice, cx) {
    const f = this.file();
    if (!f || f.done) return;
    if (this.p.on) { this.flash("Picking chunks of a file on another machine isn't supported: use the editor (e) or AI (i)"); cx.notify(); return; }
    const text = this.texts[f.path];
    if (text == null || !this.count()) return;
    const next = resolve(text, this.n, choice);
    cx.spawn(async (cx) => {
      try {
        await writeTextFile(`${this.p.root}/${f.path}`, next, text);
      } catch (e) {
        this.flash(`Couldn't write ${f.path}: the file changed on disk, reloaded`);
        delete this.texts[f.path];
        await this.loadText(f);
        cx.notify();
        return;
      }
      (this.undo[f.path] ??= []).push({ text, n: this.n });
      this.texts[f.path] = next;
      const left = conflictsOf(parse(next)).length;
      this.n = Math.min(this.n, Math.max(0, left - 1));
      this.side = "ours";
      // The last chunk picked: mark it resolved, as lazygit does.
      if (!left) this.stage([f.path], cx, `${f.path} resolved and staged`, "resolved");
      cx.notify();
    });
  }

  undoPick(cx) {
    const f = this.file(), stack = f && this.undo[f.path];
    if (!stack?.length) { this.flash("Nothing to undo"); cx.notify(); return; }
    const { text, n } = stack.pop();
    cx.spawn(async (cx) => {
      const cur = await readTextFile(`${this.p.root}/${f.path}`).catch(() => null);
      try { await writeTextFile(`${this.p.root}/${f.path}`, text, cur); } catch { this.flash("Undo failed: the file changed"); cx.notify(); return; }
      this.texts[f.path] = text;
      this.n = n;
      delete this.how[f.path];
      // Back to conflicted: un-stage it so git sees the conflict again.
      if (f.done || !this.files.some((x) => x.path === f.path)) {
        await exec("git", ["checkout", "-m", "--", f.path], { cwd: this.p.root }).catch(() => null);
        const r = await readTextFile(`${this.p.root}/${f.path}`).catch(() => null);
        // checkout -m recreates the original conflict; put the picks made so far back.
        if (r !== null && r !== text) await writeTextFile(`${this.p.root}/${f.path}`, text, r).catch(() => null);
      }
      this.refresh(cx);
      cx.notify();
    });
  }

  // `how`: what the list says once it's decided (resolved / kept / deleted).
  stage(paths, cx, msg, how) {
    cx.spawn(async (cx) => {
    const r = await exec("git", ["add", "--", ...paths], { cwd: this.p.root, on: this.p.on }).catch((e) => ({ code: 1, stderr: String(e) }));
    if (r.code === 0) this.decided(paths, how ?? (KINDS[this.files.find((f) => f.path === paths[0])?.xy]?.markers ? "resolved" : "kept"));
    this.flash(r.code === 0 ? msg : `git add failed: ${(r.stderr || r.stdout).trim()}`, r.code === 0 ? 3500 : 7000);
    this.refresh(cx);
    cx.notify();
    });
  }

  remove(paths, cx) {
    cx.spawn(async (cx) => {
    const r = await exec("git", ["rm", "--quiet", "--", ...paths], { cwd: this.p.root, on: this.p.on }).catch((e) => ({ code: 1, stderr: String(e) }));
    if (r.code === 0) this.decided(paths, "deleted");
    this.flash(r.code === 0 ? `${paths.join(", ")} deleted` : `git rm failed: ${(r.stderr || r.stdout).trim()}`);
    this.refresh(cx);
    cx.notify();
    });
  }

  decided(paths, how) {
    for (const p of paths) this.how[p] = how;
    this.advance = this.file()?.path ?? null;
  }

  openEditor(paths) {
    run("terminal.open", { argv: [this.shell ?? "/bin/zsh", "-lic", `\${VISUAL:-\${EDITOR:-nvim}} ${paths.map(q).join(" ")}`], folder: this.p.root, place: "tab" });
  }

  // continue / abort / skip in a core terminal through the login shell (hooks find node).
  runGit(title, script, cx) {
    if (this.running) return;
    this.running = title;
    this.failure = null;
    cx.notify();
    cx.spawn(async (cx) => {
      const args = ["run", "--bg", "--json", "--no-parent", "--no-notify", "--outlive-parent", "--cwd", this.p.root, "--label", "herdr.git=run"];
      if (this.p.on) args.push("--on", this.p.on);
      args.push("--", this.shell ?? "/bin/zsh", "-lic", `printf '%s\\n' ${MARKER}; export GIT_EDITOR=true; ${script}`);
      let code = null, output = "";
      try {
        const started = await hc(args);
        const addr = JSON.parse(started.stdout).address;
        for (let i = 0; i < 400 && code === null; i++) {
          const w = await hc(["wait", addr, "--timeout", "15", "--json"]).catch(() => null);
          try { const j = JSON.parse(w?.stdout ?? "{}"); if (j.ended) code = j.exit_code ?? 1; } catch { code = 1; }
        }
        output = (await hc(["read", addr, "--lines", "400"]).catch(() => ({ stdout: "" }))).stdout ?? "";
        const at = output.indexOf(MARKER);
        output = (at >= 0 ? output.slice(at + MARKER.length) : output).trim();
        hc(["kill", addr]).catch(() => {});
      } catch (e) { code = 1; output = String(e); }
      this.running = null;
      // A failure stays on screen (its output, Ask AI) until dismissed or the next run.
      this.failure = code !== 0 ? { title: `git ${title}`, code, output: output || `exit ${code}`, open: false } : null;
      this.refresh(cx);
      cx.notify();
    });
  }

  continueOp(cx) {
    const op = this.op;
    if (!op) return;
    if (this.files.length) { this.flash("Resolve every file first"); cx.notify(); return; }
    this.runGit(`${op.kind} --continue`, `git ${op.kind} --continue`, cx);
  }

  closeSelf() {
    const me = this.me();
    if (me) run("pane.close", { pane: me.pane });
  }

  // ---- AI ---------------------------------------------------------------------

  prompt(paths) {
    const op = this.op, s = this.sides();
    const what = op?.kind === "rebase"
      ? `a rebase of \`${op.branch ?? "HEAD"}\` onto \`${op.other}\`${op.step ? ` (commit ${op.step} of ${op.total})` : ""}`
      : op?.kind === "merge" ? `a merge of \`${op.other}\` into \`${op.head}\`` : `a ${op?.kind ?? "git operation"} of ${op?.other ?? "?"}`;
    return [
      `I'm in the middle of ${what} in ${this.p.root}. ${paths.length > 1 ? "These files have" : "This file has"} conflicts:`, ...paths.map((p) => `- ${p}`), "",
      `"Ours" is ${s.ours}; "theirs" is ${s.theirs}.`, "",
      "Please resolve them: check what each side changed and why (git log / git show on the commits involved), edit the files so both intents are kept, remove every conflict marker, run the relevant type-check/lint/tests for the touched files, then `git add` each resolved file.",
      `Don't run \`git ${op?.kind ?? "merge"} --continue\`, commit, or push: I'll review and continue myself. When you're done, summarize how you resolved each file.`,
    ].join("\n");
  }

  askAI(paths, cx) {
    if (!paths.length) return;
    this.aiMenu(this.prompt(paths), paths.length > 1 ? `resolve ${paths.length} conflicted files` : `resolve ${paths[0].split("/").pop()}`, cx);
  }

  failurePrompt(f) {
    const lines = f.output.split("\n"), tail = lines.length > 300 ? ["… (earlier output trimmed)", ...lines.slice(-300)] : lines;
    const op = this.op;
    return [
      `This git command failed in ${this.p.root} (exit ${f.code})${op ? `, during ${op.kind === "merge" ? `a merge of \`${op.other}\` into \`${op.head}\`` : `a ${op.kind} of \`${op.branch ?? "HEAD"}\` onto \`${op.other}\``}` : ""}:`, "",
      `$ ${f.title}`, "", "Output:", "```", ...tail, "```", "",
      /--continue/.test(f.title)
        ? "Every conflict is already resolved and staged, so this is most likely a commit hook (lint, type-check, tests) or something left unstaged. Please find the cause, fix it and `git add` the fixes, but don't run the continue, commit or push yourself: I'll continue from the panel."
        : "Please find the cause and fix it. Don't re-run the git command yourself; tell me when it's safe to retry.",
    ].join("\n");
  }

  aiMenu(prompt, label, cx) {
    const space = spaces().find((s) => s.active);
    const here = agents().filter((a) => a.space === space?.id);
    cx.spawn(async (cx) => {
      const fresh = (await knownAgents({ on: this.p.on }).catch(() => [])).find((k) => k.installed);
      this.menu = {
        title: `Ask AI to ${label}`,
        sel: 0,
        items: [
          ...here.slice(0, 8).map((a, i) => ({ key: String(i + 1), label: `Send to ${a.program?.name ?? a.app ?? "agent"} · ${a.tab_name}`, hint: a.status, run: (cx) => this.send(a, prompt, cx) })),
          fresh && { key: "n", label: `New ${fresh.name} tab`, run: () => run("tab.new", { argv: fresh.run, task: prompt, folder: this.p.root, name: `AI · ${label}` }) },
          { key: "y", label: "Copy prompt", run: (cx) => { cx.write_to_clipboard(prompt); this.flash("Prompt copied"); } },
        ].filter(Boolean),
      };
      cx.notify();
    });
  }

  send(agent, prompt, cx) {
    cx.spawn(async (cx) => {
      const r = await hc(["send", agent.address, prompt]).catch((e) => ({ code: 1, stderr: String(e) }));
      this.flash(r.code === 0 ? `Sent to ${agent.tab_name}` : `Couldn't send: ${(r.stderr || r.stdout).trim()}`, 5000);
      cx.notify();
    });
  }

  // ---- Keys -------------------------------------------------------------------

  key(e, cx) {
    const k = keyOf(e);
    if (this.menu) {
      const m = this.menu;
      if (k === "escape" || k === "q") this.menu = null;
      else if (k === "j" || k === "down") m.sel = Math.min(m.items.length - 1, m.sel + 1);
      else if (k === "k" || k === "up") m.sel = Math.max(0, m.sel - 1);
      else {
        const it = k === "enter" || k === "space" ? m.items[m.sel] : m.items.find((i) => i.key === k);
        if (it) { this.menu = null; it.run(cx); }
      }
      cx.stop_propagation();
      cx.notify();
      return;
    }
    if (this.handleKey(k, cx)) { cx.stop_propagation(); cx.notify(); }
  }

  // Two places to be, as in lazygit: the file list (↑↓ files, enter goes in) and the
  // chunks (←→ conflicts, ↑↓ side, space picks, esc back to the files).
  handleKey(k, cx) {
    const f = this.file(), all = this.files.map((x) => x.path);
    const markers = f && !f.done && KINDS[f.xy]?.markers && this.count() > 0;
    const inChunks = this.mode === "chunks" && markers;
    if (inChunks) {
      switch (k) {
        case "left": case "h": this.go(-1); return true;
        case "right": case "l": this.go(1); return true;
        case "up": case "k": this.side = "ours"; return true;
        case "down": case "j": this.side = "theirs"; return true;
        case "space": case "enter": this.pick(this.side, cx); return true;
        case "escape": case "tab": case "shift-tab": this.mode = "files"; return true;
      }
    } else {
      switch (k) {
        case "up": case "k": this.pickFile(this.sel - 1, cx); return true;
        case "down": case "j": this.pickFile(this.sel + 1, cx); return true;
        case "enter": case "space": case "right": case "l": case "tab":
          if (markers) { this.mode = "chunks"; this.reveal(); } else if (f && !f.done) this.flash(`${KINDS[f.xy]?.label ?? "no markers"}: keep it (r) or delete it (d)`);
          return true;
        case "d": if (f && !f.done && !KINDS[f.xy]?.markers) this.remove([f.path], cx); return true;
        case "escape": run("pane.go", { direction: "right" }); return true;
      }
    }
    switch (k) {
      case "o": if (markers) this.pick("ours", cx); return true;
      case "t": if (markers) this.pick("theirs", cx); return true;
      case "b": if (markers) this.pick("both", cx); return true;
      case "z": this.undoPick(cx); return true;
      case "]": this.pickFile(this.sel + 1, cx); return true;
      case "[": this.pickFile(this.sel - 1, cx); return true;
      case "e": if (f) this.openEditor([f.path]); return true;
      case "a": if (f && !f.done) this.askAI([f.path], cx); return true;
      case "i": this.askAI(all, cx); return true;
      case "r": if (f && !f.done) this.stage([f.path], cx, `${f.path} ${KINDS[f.xy]?.markers ? "marked resolved" : "kept"}`); return true;
      case "c": this.continueOp(cx); return true;
      case "A": this.confirmAbort(cx); return true;
      case "f": if (this.failure) this.aiMenu(this.failurePrompt(this.failure), "fix the failed git command", cx); return true;
      case "x": if (this.failure) this.failure = null; return true;
    }
    return false;
  }

  go(d) {
    const n = this.count();
    if (!n) return;
    this.n = (this.n + d + n) % n;
    this.side = "ours";
    this.reveal();
  }

  reveal() {
    const i = this.rows().findIndex((r) => r.kind === "head" && r.n === this.n);
    if (i >= 0) this.scroll.scroll_to_item(Math.max(0, i - 3), "top");
  }

  pickFile(i, cx) {
    const L = this.list();
    if (!L.length) return;
    this.picked = true;
    this.sel = Math.max(0, Math.min(L.length - 1, i));
    this.n = 0;
    this.side = "ours";
    cx.spawn(async (cx) => { await this.loadText(this.file()); this.reveal(); cx.notify(); });
  }

  confirmAbort(cx) {
    const op = this.op;
    if (!op) return;
    this.menu = { title: `Abort the ${op.kind}? Every resolution is lost.`, sel: 1, items: [
      { key: "y", label: `Abort ${op.kind}`, danger: true, run: (cx) => this.runGit(`${op.kind} --abort`, `git ${op.kind} --abort`, cx) },
      { key: "n", label: "Cancel", run: () => {} },
    ] };
    cx.notify();
  }

  rows() { const s = this.segs(); return s ? (this._rowsFor === s ? this._rows : ((this._rowsFor = s), (this._rows = rows(s)))) : []; }

  // ---- Rendering --------------------------------------------------------------

  render(cx) {
    this.syncFocus();
    const t = theme(), mono = settings().font_family ?? "JetBrains Mono";
    if (this.flashMsg && Date.now() > this.flashMsg.until) this.flashMsg = null;
    const width = this.size?.width ?? 600, wide = width >= 620;
    const files = this.fileList(t, wide);
    const body = (wide ? h_flex().items_stretch() : v_flex()).flex_1().min_h(0)
      .child(files)
      .child(this.chunks(t, mono));
    return v_flex().id("root").size_full().min_h(0).relative().bg(t.background).text_color(t.foreground).text_size(12.5)
      .track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .on_mouse_down("left", () => this.handle.focus())
      .on_size_change((size, cx) => { this.size = size; cx.notify(); })
      .child(this.header(t))
      .when(Boolean(this.failure), (e) => e.child(this.failureBox(t, mono)))
      .child(body)
      .child(this.footer(t))
      .when(Boolean(this.menu), (e) => e.child(this.menuView(t)));
  }

  button(id, label, action, t, { primary = false, disabled = false, color, small = false } = {}) {
    return h_flex().id(id).h(small ? 18 : 24).px(small ? 6 : 8).flex_none().items_center().rounded(6).border_1().text_size(11.5)
      .border_color(primary ? t.solid : color ?? t.input).bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : color ?? t.foreground)
      .when(disabled, (e) => e.opacity(0.45))
      .when(!disabled, (e) => e.cursor_pointer().hover((s) => s.bg(primary ? t.solid : t.hover)).on_click((_e, cx) => { action(cx); cx.notify(); }))
      .child(label);
  }

  header(t) {
    const op = this.op, left = this.files.length;
    const what = !op ? "No merge or rebase in progress"
      : op.kind === "rebase" ? `Rebasing ${op.branch ?? "HEAD"} onto ${op.other ?? "?"}${op.step ? ` · ${op.step}/${op.total}` : ""}`
        : op.kind === "merge" ? `Merging ${op.other ?? "?"} into ${op.head ?? "HEAD"}` : `${op.kind} of ${op.other ?? "?"}`;
    return v_flex().flex_none().border_b(1).border_color(t.border)
      .child(h_flex().h(42).px(12).gap(8).items_center()
        .child(div().size(7).flex_none().rounded_full().bg(left ? t.ansi1 : t.ansi2))
        .child(div().font_semibold().text_size(13).flex_none().child("Conflicts"))
        .child(div().flex_1())
        .children([this.selfUpdate.pill(t)].filter(Boolean))
        .when(Boolean(this.running), (e) => e.child(div().flex_none().text_size(11.5).text_color(t.working).child(`${this.running}…`)))
        .when(left > 0, (e) => e.child(this.button("ai-all", "Ask AI (i)", (cx) => this.askAI(this.files.map((f) => f.path), cx), t)))
        .child(this.button("continue", `Continue (c)`, (cx) => this.continueOp(cx), t, { primary: !left, disabled: left > 0 || !op || Boolean(this.running) }))
        .when(op?.kind && op.kind !== "merge", (e) => e.child(this.button("skip", "Skip", (cx) => this.runGit(`${op.kind} --skip`, `git ${op.kind} --skip`, cx), t, { disabled: Boolean(this.running) })))
        .child(this.button("abort", "Abort (A)", (cx) => this.confirmAbort(cx), t, { color: t.ansi1, disabled: !op || Boolean(this.running) })))
      .child(div().px(12).pb(8).mt(-4).truncate().text_size(11.5).text_color(t.muted).child(`${what} · ${left ? `${left} of ${this.order.length} file${this.order.length > 1 ? "s" : ""} left` : "all resolved: continue (c)"}`));
  }

  failureBox(t, mono) {
    const f = this.failure, lines = f.output.split("\n").filter((l) => l.trim());
    // The reason: git's own "error:"/"fatal:"/hook lines first, else the last lines.
    const key = lines.filter((l) => /^(error|fatal|hint|husky|✖|×)\b|error|failed|ERR!/i.test(l));
    const shown = f.open ? lines : (key.length ? key : lines).slice(-6);
    return v_flex().flex_none().mx(8).mt(8).rounded(8).border_1().border_color(t.ansi1).bg(tint(t.ansi1, "12")).overflow_hidden()
      .child(h_flex().px(10).py(6).gap(6).items_center()
        .child(div().size(7).flex_none().rounded_full().bg(t.ansi1))
        .child(div().flex_1().min_w(0).truncate().font_semibold().text_size(12).child(`${f.title} failed (exit ${f.code})`))
        .child(this.button("fail-ai", "Ask AI (f)", (cx) => this.aiMenu(this.failurePrompt(f), "fix the failed git command", cx), t, { small: true }))
        .child(this.button("fail-copy", "Copy", (cx) => { cx.write_to_clipboard(`$ ${f.title}\n${f.output}`); this.flash("Output copied"); }, t, { small: true }))
        .child(this.button("fail-more", f.open ? "Less" : `All ${lines.length} lines`, () => { f.open = !f.open; }, t, { small: true }))
        .child(this.button("fail-x", "×", () => { this.failure = null; }, t, { small: true })))
      .child(v_flex().id("fail-out").px(10).pb(8).max_h(f.open ? 320 : 120).overflow_y_scrollbar().font_family(mono).text_size(11.5)
        .children(shown.map((l, i) => div().id(`fo${i}`).text_color(/^(error|fatal)|✖|×|ERR!|failed/i.test(l) ? t.ansi1 : t.foreground).child(l))));
  }

  fileList(t, wide) {
    const L = this.list();
    return v_flex().id("files").flex_none().when(wide, (e) => e.w(240).h_full().border_r(1)).when(!wide, (e) => e.w_full().max_h(150).border_b(1))
      .border_color(t.border).overflow_y_scrollbar().py(4)
      .children(L.map((f, i) => {
        const sel = i === this.sel, dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/") + 1) : "", name = f.path.slice(dir.length);
        const kind = KINDS[f.xy];
        const left = !f.done && this.texts[f.path] != null && kind?.markers ? conflictsOf(parse(this.texts[f.path])).length : null;
        const here = this.mode === "files";
        return h_flex().id(`f${i}`).h(24).pr(10).gap(6).items_center().cursor_pointer()
          .bg(sel ? (here ? t.selected : t.hover) : t.background).hover((s) => s.bg(sel ? (here ? t.selected : t.hover) : t.hover))
          .on_click((_e, cx) => { this.mode = "files"; this.pickFile(i, cx); this.handle.focus(); })
          .child(div().w(3).h(CROW).flex_none().mr(7).bg(sel && here ? t.accent : t.background))
          .child(div().w(20).flex_none().text_size(11).font_semibold().text_color(f.done ? t.ansi2 : t.ansi1).child(f.done ? "✓" : kind?.short ?? f.xy))
          .child(h_flex().flex_1().min_w(0).child(div().truncate().text_color(f.done ? t.ansi2 : t.foreground).when(f.how === "deleted", (e) => e.line_through()).child(name)).child(div().flex_shrink(1).min_w(0).truncate().ml(6).text_size(11).text_color(t.dim).child(dir)))
          .when(f.done, (e) => e.child(div().flex_none().text_size(11).text_color(t.ansi2).child(f.how)))
          .when(left !== null && left > 0, (e) => e.child(div().flex_none().text_size(11).text_color(t.muted).child(String(left))));
      }))
      .when(!L.length, (e) => e.child(div().p(12).text_color(t.dim).child("No conflicted files")));
  }

  // The selected file: its conflicts with context, or what to do when it has no markers.
  chunks(t, mono) {
    const f = this.file();
    const box = v_flex().flex_1().min_w(0).min_h(0);
    if (!f) return box.child(div().p(16).text_color(t.dim).child(this.op ? "Nothing left to resolve: continue (c)." : ""));
    if (f.done) {
      return box.p(16).gap(10)
        .child(div().text_color(t.ansi2).child(`✓ ${f.path} ${f.how === "deleted" ? "deleted" : f.how === "kept" ? "kept and staged" : "resolved and staged"}.`))
        .child(h_flex().gap(6).child(this.button("u-undo", "Undo last pick (z)", (cx) => this.undoPick(cx), t, { disabled: !this.undo[f.path]?.length })).child(this.button("u-edit", "Open in editor (e)", () => this.openEditor([f.path]), t)));
    }
    const kind = KINDS[f.xy];
    if (!kind?.markers) {
      const theyDeleted = f.xy === "UD", weDeleted = f.xy === "DU";
      const s = this.sides(), diff = this.diffs[f.path];
      const why = theyDeleted ? `${s.theirs} deleted this file; ${s.ours} changed it (below).`
        : weDeleted ? `${s.ours} deleted this file; ${s.theirs} changed it (below).`
          : f.xy === "AU" || f.xy === "UA" ? `Only one side added this file (below).` : "Both sides deleted this file.";
      const dl = (l, i) => {
        const c = l.startsWith("+") ? t.ansi2 : l.startsWith("-") ? t.ansi1 : l.startsWith("@@") ? t.ansi6 : null;
        return h_flex().id(`d${i}`).w_full().h(ROW).px(12).items_center().font_family(mono).text_size(12).bg(c && !l.startsWith("@@") ? tint(c, "14") : t.background)
          .child(div().flex_1().min_w(0).truncate().text_color(c ?? t.muted).child(l === "" ? " " : l.replace(/\t/g, "  ")));
      };
      return box
        .child(v_flex().flex_none().px(14).py(10).gap(8).border_b(1).border_color(t.border)
          .child(h_flex().gap(8).items_center().child(div().flex_none().text_size(11).font_semibold().text_color(t.ansi1).child(f.xy)).child(div().flex_1().min_w(0).truncate().font_semibold().child(f.path)))
          .child(div().text_color(t.muted).child(why))
          .child(h_flex().gap(6).flex_wrap()
            .when(f.xy !== "DD", (e) => e.child(this.button("keep", "Keep the file (r)", (cx) => this.stage([f.path], cx, `${f.path} kept`), t)))
            .child(this.button("del", "Delete it (d)", (cx) => this.remove([f.path], cx), t, { color: t.ansi1 }))
            .child(this.button("ai-f", "Ask AI (a)", (cx) => this.askAI([f.path], cx), t))))
        .child(!diff ? div().p(14).text_color(t.dim).child("Loading…")
          : div().flex_1().min_h(0).relative()
            .child(div().size_full().child(v_virtual_list("del-diff", diff.length, ROW, (i) => `${f.path}:d${i}`, (range) => diff.slice(range.start, range.end).map((l, j) => dl(l, range.start + j))).size_full()))
            .child(Scrollbar.vertical("del-diff").viewport_from_layout().absolute().inset_0()));
    }
    const segs = this.segs();
    if (!segs) return box.child(div().p(16).text_color(t.dim).child("Loading…"));
    const n = this.count();
    if (!n) {
      return box.p(16).gap(10)
        .child(div().child(`No conflict markers left in ${f.path}.`))
        .child(h_flex().gap(6).child(this.button("mark", "Mark resolved (r)", (cx) => this.stage([f.path], cx, `${f.path} marked resolved`), t, { primary: true })).child(this.button("edit", "Open in editor (e)", () => this.openEditor([f.path]), t)));
    }
    const R = this.rows(), sides = this.sides(), cs = conflictsOf(segs), c = cs[this.n];
    const ours = t.ansi2, theirs = t.ansi4;
    const focusedChunks = this.mode === "chunks";
    const text = (s) => (s === "" ? " " : s.replace(/\t/g, "  "));
    const gutter = (s, color = t.dim) => h_flex().w(44).flex_none().pr(8).justify_end().text_size(10.5).text_color(color).child(s);
    // No click handlers inside the list's rows (they drew nothing): the list's on_item_click.
    const line = (r, i) => {
      const cur = r.n === this.n, lit = cur && focusedChunks;
      if (r.kind === "fold") return h_flex().id(`r${i}`).w_full().h(CROW).px(12).items_center().text_size(11).text_color(t.dim).child(`⋯ ${r.count} unchanged line${r.count > 1 ? "s" : ""}`);
      if (r.kind === "ctx") return h_flex().id(`r${i}`).w_full().h(CROW).pl(3).items_center().font_family(mono).text_size(12).text_color(t.muted).child(gutter(String(r.line))).child(div().flex_1().min_w(0).truncate().child(text(r.text)));
      if (r.kind === "end") return div().id(`r${i}`).w_full().h(CROW).border_t(2).border_color(lit ? t.accent : t.border);
      // Section labels: ▲ ours (the head row) · base · ▼ theirs.
      if (r.kind === "head" || r.kind === "mid") {
        const side = r.kind === "head" ? "ours" : r.text, color = side === "ours" ? ours : side === "theirs" ? theirs : t.dim;
        const on = lit && this.side === side;
        const label = side === "ours" ? `▲ OURS · ${sides.ours}` : side === "theirs" ? `▼ THEIRS · ${sides.theirs}` : "BASE · how it was before both";
        return h_flex().id(`r${i}`).w_full().h(CROW).px(10).gap(8).items_center().text_size(11).font_semibold()
          .when(r.kind === "head", (e) => e.border_t(2).border_color(lit ? t.accent : t.border))
          .bg(tint(color, on ? "40" : "1c")).text_color(color)
          .child(div().flex_1().min_w(0).truncate().child(label))
          .when(r.kind === "head", (e) => e.child(div().flex_none().text_color(lit ? t.accent : t.dim).child(`conflict ${r.n + 1}/${n}`)))
          .when(on, (e) => e.child(div().flex_none().text_color(t.foreground).child("space: keep this")));
      }
      const side = r.kind, color = side === "ours" ? ours : side === "theirs" ? theirs : t.dim;
      const on = lit && this.side === side;
      return h_flex().id(`r${i}`).w_full().h(CROW).items_center().font_family(mono).text_size(12)
        .bg(tint(color, on ? "2e" : cur ? "16" : "0c")).border_l(3).border_color(on ? color : tint(color, "66"))
        .child(gutter(side === "ours" && r.line ? String(r.line) : "", tint(color, "aa")))
        .child(div().flex_1().min_w(0).truncate().text_color(side === "base" ? t.dim : t.foreground).child(text(r.text)));
    };
    // The current conflict's choices, fixed above the list.
    const toolbar = h_flex().h(34).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border).bg(t.surface)
      .child(this.button("prev", "←", (cx) => { this.mode = "chunks"; this.go(-1); }, t, { small: true }))
      .child(div().flex_none().text_size(11.5).font_semibold().text_color(focusedChunks ? t.accent : t.muted).child(`Conflict ${this.n + 1} of ${n}`))
      .child(this.button("next", "→", (cx) => { this.mode = "chunks"; this.go(1); }, t, { small: true }))
      .child(div().flex_1())
      .child(this.button("keep-ours", `Keep ours (o)`, (cx) => this.pick("ours", cx), t, { color: ours }))
      .child(this.button("keep-theirs", `Keep theirs (t)`, (cx) => this.pick("theirs", cx), t, { color: theirs }))
      .child(this.button("keep-both", "Both (b)", (cx) => this.pick("both", cx), t))
      .child(this.button("undo", "Undo (z)", (cx) => this.undoPick(cx), t, { disabled: !this.undo[f.path]?.length }));
    const click = (key, cx) => {
      const r = R[+String(key).split(":").pop()];
      if (r?.n === undefined) return;
      this.n = r.n;
      this.mode = "chunks";
      if (r.kind === "ours" || r.kind === "theirs") this.side = r.kind;
      else if (r.kind === "head") this.side = "ours";
      else if (r.kind === "mid" && r.text === "theirs") this.side = "theirs";
      this.handle.focus();
      cx.notify();
    };
    return box
      .child(h_flex().h(28).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border).text_size(11)
        .child(div().flex_1().min_w(0).truncate().font_semibold().text_color(t.foreground).child(f.path))
        .child(this.button("ai-file", "Ask AI (a)", (cx) => this.askAI([f.path], cx), t, { small: true }))
        .child(this.button("edit-file", "Editor (e)", () => this.openEditor([f.path]), t, { small: true })))
      .child(toolbar)
      .child(div().flex_1().min_h(0).relative()
        .child(div().size_full().child(v_virtual_list("chunks", R.length, CROW, (i) => `${f.path}:${i}`, (range) =>
          R.slice(range.start, range.end).map((r, j) => line(r, range.start + j))).track_scroll(this.scroll).size_full()
          .on_item_click((key, cx) => click(key, cx))))
        .child(Scrollbar.vertical("chunks").viewport_from_layout().absolute().inset_0()));
  }

  footer(t) {
    const f = this.file(), markers = f && !f.done && KINDS[f.xy]?.markers;
    const keys = this.mode === "chunks" && markers
      ? [["←→", "conflict"], ["↑↓", "ours/theirs"], ["space", "pick"], ["b", "both"], ["z", "undo"], ["esc", "files"], ["a", "AI"], ["e", "editor"]]
      : [["↑↓", "file"], ...(markers ? [["enter", "pick chunks"]] : f && !f.done ? [["r", "keep"], ["d", "delete"]] : []), ["a/i", "AI"], ["e", "editor"], ["z", "undo"], ["c", "continue"], ["A", "abort"]];
    if (this.failure) keys.unshift(["f", "AI: fix failure"], ["x", "dismiss"]);
    return h_flex().h(28).flex_none().px(12).gap(10).items_center().border_t(1).border_color(t.border).text_size(11).text_color(t.dim).overflow_hidden()
      .when(Boolean(this.flashMsg), (e) => e.child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(this.flashMsg.text)))
      .when(!this.flashMsg, (e) => e.children(keys.map(([k, l]) => h_flex().flex_none().gap(4).child(div().px(4).rounded(4).bg(t.raised).text_color(t.muted).child(k)).child(l))));
  }

  menuView(t) {
    const m = this.menu;
    return div().absolute().inset_0().bg(tint(t.background, "aa")).flex().items_center().justify_center()
      .on_mouse_down("left", (_e, cx) => { this.menu = null; cx.notify(); })
      .child(v_flex().id("menu").w(380).max_w_full().p(6).gap(2).rounded(10).border_1().border_color(t.border).bg(t.popover).shadow_lg()
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(div().px(8).py(6).font_semibold().text_size(12.5).child(m.title))
        .children(m.items.map((it, i) => h_flex().id(`m${i}`).h(28).px(8).gap(8).items_center().rounded(6).cursor_pointer()
          .bg(i === m.sel ? t.selected : t.popover).hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => { this.menu = null; it.run(cx); cx.notify(); })
          .child(div().w(18).flex_none().text_size(11).text_color(t.dim).child(it.key))
          .child(div().flex_1().min_w(0).truncate().text_color(it.danger ? t.ansi1 : t.foreground).child(it.label))
          .when(Boolean(it.hint), (e) => e.child(div().flex_none().text_size(11).text_color(t.dim).child(it.hint))))));
  }
}
