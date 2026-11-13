// Claude skills: personal ones (~/.claude/skills) and the focused repo's (.claude/skills),
// with run (to an agent here or a new tab), edit in nvim, and new-skill scaffolding.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { keybar, keysCard } from "./keybar.js";
import { spaces, panes, focused, agents, knownAgents, exec, hc, run, theme, settings, home, readTextFile, writeTextFile, watchFolder, nextCommand, setShared } from "herdr";
import { SelfUpdate } from "./update.js";
import { closePanel } from "./panel.js";

const ICON = "mods/skills";
const CARD = 90, GROUP = 26, GAP = 6;
const q = s => `'${String(s).replace(/'/g, `'\\''`)}'`;
const base = p => p.split("/").filter(Boolean).pop();
const tilde = p => p.startsWith(home()) ? "~" + p.slice(home().length) : p;

function focusedPane() {
  const f = focused();
  return f?.pane ? panes().find(x => x.pane === f.pane) ?? null : null;
}

function location() {
  return focusedPane()?.cwd || focused()?.cwd || spaces().find(s => s.active)?.folder || null;
}

const branchOf = address => panes().find(p => p.terminal === address)?.branch ?? null;

function keyOf(e) {
  const m = e.modifiers ?? {};
  if (m.control || m.platform || m.alt) return e.keystroke;
  if (["enter", "escape", "tab", "space", "up", "down", "left", "right", "backspace"].includes(e.key)) return e.key;
  return e.key_char ?? e.key;
}

// Enough YAML for skill frontmatter: `key: value`, quoted values, and folded/literal blocks.
function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/), fm = {};
  if (!m) return fm;
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([\w-]+):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^[>|][-+]?$/.test(v)) { const parts = []; while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) parts.push(lines[++i].trim()); v = parts.join(" "); }
    fm[kv[1]] = v.replace(/^(["'])(.*)\1$/, "$2");
  }
  return fm;
}

function short(desc) {
  const first = (desc ?? "").match(/^.*?[.!?](?=\s|$)/)?.[0] ?? desc ?? "";
  return first.length > 120 ? first.slice(0, 117).trimEnd() + "…" : first;
}

async function scan(dir, scope, repo) {
  const script = 'for d in "$1"/*/; do [ -f "$d/SKILL.md" ] && printf "%s\\n" "${d%/}/SKILL.md"; done; for f in "$1"/*.md; do [ -f "$f" ] && printf "%s\\n" "$f"; done; true';
  const r = await exec("sh", ["-c", script, "skills", dir]).catch(() => null);
  const paths = (r?.stdout ?? "").split("\n").filter(Boolean);
  const out = [];
  for (const path of paths) {
    const text = await readTextFile(path).catch(() => null);
    if (text === null) continue;
    const fm = frontmatter(text), folder = path.endsWith("/SKILL.md");
    const name = fm.name || (folder ? base(path.slice(0, -9)) : base(path).replace(/\.md$/, ""));
    out.push({ name, description: fm.description ?? "", hint: fm["argument-hint"] ?? "", path, scope, repo });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const KEYS = {
  actions: [
    { caps: ["enter"], label: "run" }, { caps: ["e"], label: "edit" }, { caps: ["n"], label: "new" },
    { caps: ["y"], label: "copy" }, { caps: ["/"], label: "filter" }, { caps: ["q"], label: "close" },
  ],
  moving: [
    { caps: ["j", "k"], label: "move" }, { caps: ["<", ">"], label: "first / last" },
    { caps: ["r"], label: "refresh" }, { caps: ["escape"], label: "clear the filter" },
  ],
  menu: [{ caps: ["j", "k"], label: "move" }, { caps: ["enter"], label: "pick" }, { caps: ["escape"], label: "close" }],
};

export default class Skills extends View {
  init(_props, cx) {
    this.selfUpdate = new SelfUpdate("skills", "Skills panel"); this.selfUpdate.start(cx);
    this.handle = cx.focus_handle();
    this.skills = []; this.sel = 0; this.filter = "";
    this.localDir = `${home()}/.claude/skills`;
    cx.spawn(async cx => {
      const r = await exec("sh", ["-c", 'printf %s "$SHELL"']).catch(() => null);
      this.shell = r?.stdout.trim() || "/bin/zsh";
      this.known = await knownAgents().catch(() => []);
      cx.notify();
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
    this.watch(this.localDir, cx);
    cx.timer.every(1000, cx => { if (location() !== this.cwd) this.refresh(cx); });
    cx.timer.every(30000, cx => this.refresh(cx));
    // No blur event for a focus handle: poll it, redraw only on change, and share it for the leader.
    cx.timer.every(300, cx => {
      const k = this.keyboard();
      if (k !== this.sharedKeys) { this.sharedKeys = k; setShared("skills.hasKeys", k); }
      if (k !== this.hadKeys) { this.hadKeys = k; cx.notify(); }
    });
    this.refresh(cx);
  }

  keyboard() { return this.handle.is_focused() || Boolean(this.prompt || this.menu); }

  watch(dir, cx) {
    this.watching ??= new Set();
    if (!dir || this.watching.has(dir)) return;
    this.watching.add(dir);
    cx.spawn(async cx => {
      try { for (;;) { await watchFolder(dir); this.refresh(cx); } } catch { this.watching.delete(dir); }
    });
  }

  refresh(cx) {
    if (this.loading) { this.again = true; return; }
    this.loading = true;
    const cwd = location();
    cx.spawn(async cx => {
      try {
        const top = cwd ? await exec("git", ["rev-parse", "--show-toplevel"], { cwd }).catch(() => null) : null;
        const repo = top?.code === 0 ? top.stdout.trim() : null;
        const repoDir = repo ? `${repo}/.claude/skills` : null;
        if (repoDir && repoDir !== this.repoDir) this.watch(repoDir, cx);
        const [local, repoSkills] = await Promise.all([scan(this.localDir, "local"), repoDir ? scan(repoDir, "repo", repo) : []]);
        Object.assign(this, { cwd, repo, repoDir, skills: [...repoSkills, ...local], error: null });
      } catch (e) { this.error = String(e); }
      finally {
        this.loading = false; this.loaded = true; cx.notify();
        if (this.again) { this.again = false; this.refresh(cx); }
      }
    });
  }

  items() {
    const f = this.filter.toLowerCase();
    return f ? this.skills.filter(s => `${s.name} ${s.description}`.toLowerCase().includes(f)) : this.skills;
  }
  selected() { const items = this.items(); return items[Math.min(this.sel, items.length - 1)] ?? null; }
  flash(text) { this.flashMsg = text; this.flashAt = Date.now(); }

  // ---- Actions -------------------------------------------------------------

  runSkill(s, cx) {
    const go = (args, cx) => this.chooseTarget(s, `/${s.name}${args ? ` ${args}` : ""}`, cx);
    if (s.hint) this.ask(`/${s.name} ${s.hint}`, "", go, cx, "Arguments (optional), enter to run");
    else go("", cx);
  }

  chooseTarget(s, text, cx) {
    const space = spaces().find(x => x.active);
    const here = agents().filter(a => a.space === space?.id).sort((a, b) => Number(b.focused) - Number(a.focused));
    const folder = s.scope === "repo" ? s.repo : this.repo ?? this.cwd ?? home();
    const fresh = this.known?.find(k => k.installed);
    const name = a => a.program?.name ?? a.app ?? "agent";
    this.openMenu(`Run ${text}`, [
      ...here.slice(0, 8).map((a, i) => ({ key: String(i + 1), label: `Send to ${name(a)} · ${a.tab_name === name(a) ? `tab ${a.tab_index}` : a.tab_name}${a.focused ? " (current)" : ""}`, hint: [branchOf(a.address), a.status].filter(Boolean).join(" · "), run: cx => this.send(a, text, cx) })),
      fresh && { key: "n", label: `New ${fresh.name} tab in ${base(folder)}`, hint: folder === this.repo ? focusedPane()?.branch ?? null : null, run: () => run("tab.new", { argv: fresh.run, task: text, folder, name: text.split(" ")[0] }) },
      { key: "y", label: "Copy command", run: cx => { cx.write_to_clipboard(text); this.flash(`Copied ${text}`); } },
    ], cx);
  }

  send(agent, text, cx) {
    cx.spawn(async cx => {
      const r = await hc(["send", agent.address, text]).catch(e => ({ code: 1, stderr: String(e) }));
      this.flash(r.code === 0 ? `Sent ${text.split(" ")[0]} to ${agent.program?.name ?? "agent"}` : `Couldn't send: ${(r.stderr || r.stdout).trim()}`);
      cx.notify();
    });
  }

  edit(s) {
    run("terminal.open", { argv: [this.shell ?? "/bin/zsh", "-lic", `nvim ${q(s.path)}`], folder: s.path.slice(0, s.path.lastIndexOf("/")), place: "tab", name: `edit ${s.name}` });
  }

  create(cx) {
    this.ask("New skill name", "", (raw, cx) => {
      const name = raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      if (!name) return;
      this.ask(`Describe /${name} in a sentence`, "", (description, cx) => {
        const make = (dir, cx) => cx.spawn(async cx => {
          const path = `${dir}/${name}/SKILL.md`;
          try {
            if (await readTextFile(path).catch(() => null) !== null) { this.flash(`${tilde(path)} already exists`); this.edit({ name, path }); return; }
            await exec("mkdir", ["-p", `${dir}/${name}`]);
            await writeTextFile(path, `---\nname: ${name}\ndescription: ${description || "TODO: what this skill does and when to use it"}\n---\n\n# ${name}\n\nTODO: what Claude should do when this skill runs.\n`, null);
            this.edit({ name, path });
            this.refresh(cx);
          } catch (e) { this.flash(`Couldn't create: ${e}`); }
          cx.notify();
        });
        if (!this.repoDir) return make(this.localDir, cx);
        this.openMenu(`Where should /${name} live?`, [
          { key: "l", label: "Local, available in every repo", hint: tilde(this.localDir), run: cx => make(this.localDir, cx) },
          { key: "r", label: `Only in ${base(this.repo)}`, hint: ".claude/skills", run: cx => make(this.repoDir, cx) },
        ], cx);
      }, cx, "Shown on the card; Claude uses it to decide when to run the skill");
    }, cx, "kebab-case, e.g. prune-comments");
  }

  // ---- Menus, prompts, keys --------------------------------------------------

  openMenu(title, items, cx) { this.menu = { title, items: items.filter(Boolean), sel: 0 }; cx.notify(); }

  ask(title, value, onSubmit, cx, hint) {
    const input = InputState.new({ value, placeholder: hint ?? "" });
    input.on("submit", (_e, cx) => { const v = input.value().trim(); this.prompt = null; this.handle.focus(); onSubmit(v, cx); cx.notify(); });
    this.prompt = { title, input };
    input.focus();
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

  key(e, cx) {
    if (this.navKey(e, cx)) return;
    if (this.press(keyOf(e), cx)) cx.stop_propagation();
  }

  // Real keys and "skills.key:<k>" commands both come through here, so menus and prompts see them first.
  press(k, cx) {
    if (this.keysOpen) {
      if (k === "escape" || k === "?" || k === "q") { this.keysOpen = false; cx.notify(); }
      return true;
    }
    if (this.prompt) { if (k === "escape") { this.prompt = null; this.handle.focus(); cx.notify(); return true; } return false; }
    if (this.menu) {
      const m = this.menu;
      if (k === "escape" || k === "q") this.menu = null;
      else if (k === "j" || k === "down") m.sel = Math.min(m.items.length - 1, m.sel + 1);
      else if (k === "k" || k === "up") m.sel = Math.max(0, m.sel - 1);
      else { const it = k === "enter" || k === "space" ? m.items[m.sel] : m.items.find(i => i.key === k); if (it) { this.menu = null; it.run(cx); } }
      cx.notify(); return true;
    }
    return this.handleKey(k, cx);
  }

  handleKey(k, cx) {
    const items = this.items(), s = this.selected();
    const move = i => { this.sel = Math.max(0, Math.min(items.length - 1, i)); this.reveal = true; cx.notify(); };
    switch (k) {
      case "j": case "down": move(this.sel + 1); return true;
      case "k": case "up": move(this.sel - 1); return true;
      case "<": move(0); return true;
      case ">": move(items.length - 1); return true;
      case "enter": case "space": if (s) this.runSkill(s, cx); return true;
      case "e": if (s) this.edit(s); return true;
      case "n": this.create(cx); return true;
      case "y": if (s) { cx.write_to_clipboard(`/${s.name}`); this.flash(`Copied /${s.name}`); cx.notify(); } return true;
      case "r": case "ctrl-r": this.refresh(cx); return true;
      case "/": this.ask("Filter skills", this.filter, (v, cx) => { this.filter = v; this.sel = 0; }, cx); return true;
      case "escape": if (this.filter) { this.filter = ""; cx.notify(); return true; } return false;
      case "?": this.keysOpen = true; cx.notify(); return true;
      case "q":
        closePanel("skills");
        return true;
    }
    return false;
  }

  // ---- Rendering -------------------------------------------------------------

  button(id, icon, label, action, t, primary) {
    return h_flex().id(id).h(24).px(7).gap(4).flex_none().items_center().rounded(6).cursor_pointer().text_size(11.5)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground)
      .hover(s => s.opacity(0.85)).on_click((_e, cx) => { cx.stop_propagation(); action(cx); cx.notify(); })
      .child(svg(icon).size(11)).child(label);
  }

  card(s, i, t, mono) {
    const on = i === this.sel, repo = s.scope === "repo";
    const color = repo ? t.ansi6 : t.ansi5;
    return v_flex().id(`skill-${s.scope}-${s.name}`).h(CARD).flex_none().overflow_hidden().p(10).gap(5).rounded(9).cursor_pointer()
      .border_1().border_color(on ? (this.hadKeys ? t.accent : t.input) : t.border).bg(on ? t.surface : t.background).hover(st => st.bg(t.surface))
      .on_click((_e, cx) => { this.sel = i; this.handle.focus(); cx.notify(); })
      .child(h_flex().gap(7).items_center().min_w(0)
        .child(div().flex_none().px(5).rounded(4).border_1().border_color(color).text_size(10.5).text_color(color).child(repo ? `repo · ${base(s.repo)}` : "local"))
        .child(div().flex_1().min_w(0).truncate().font_family(mono).font_semibold().child(`/${s.name}`))
        .child(this.button(`run-${s.scope}-${s.name}`, `${ICON}/run.svg`, "Run", cx => this.runSkill(s, cx), t, true))
        .child(this.button(`edit-${s.scope}-${s.name}`, `${ICON}/edit.svg`, "Edit", () => this.edit(s), t)))
      .child(div().text_size(12).text_color(t.muted).truncate().child(short(s.description) || "No description"))
      .when(Boolean(s.hint), el => el.child(div().text_size(11).font_family(mono).text_color(t.dim).child(`args ${s.hint}`)));
  }

  group(title, sub, t) {
    return h_flex().h(GROUP).pt(6).px(2).gap(6).items_center().flex_none()
      .child(div().text_size(11).font_semibold().text_color(t.muted).child(title))
      .child(div().text_size(11).text_color(t.dim).truncate().child(sub));
  }

  // Every skill runs against the same checkout, so it's shown once above the list.
  target(t, mono) {
    const branch = focusedPane()?.branch;
    return h_flex().h(30).flex_none().px(12).gap(6).items_center().border_b(1).border_color(t.border).bg(t.surface).text_size(12)
      .child(div().flex_none().text_color(t.dim).child("Runs on"))
      .when(!this.repo, el => el.child(div().truncate().text_color(t.muted).child(this.cwd ? `${tilde(this.cwd)} (not a git repo)` : "no folder")))
      .when(Boolean(this.repo), el => el
        .child(div().flex_none().font_semibold().child(base(this.repo)))
        .child(svg("mods/workspace-chrome/git-branch.svg").size(12).flex_none().text_color(t.accent))
        .child(div().min_w(0).truncate().font_family(mono).text_color(branch ? t.accent : t.ansi3).child(branch ?? "detached HEAD"))
        .child(div().flex_1())
        .when(this.cwd !== this.repo, e => e.child(div().flex_none().max_w(140).truncate().text_size(11).text_color(t.dim).child(this.cwd.slice(this.repo.length + 1)))));
  }

  rows(items, t) {
    const repoItems = items.filter(s => s.scope === "repo"), localItems = items.filter(s => s.scope === "local"), rows = [];
    const note = text => rows.push({ h: GROUP, el: () => div().h(GROUP).flex_none().px(4).flex().items_center().text_size(11.5).text_color(t.dim).child(text) });
    if (this.repo) {
      rows.push({ h: GROUP, el: () => this.group(`Repo · ${base(this.repo)}`, tilde(this.repoDir), t) });
      repoItems.forEach(s => rows.push({ h: CARD, skill: s }));
      if (!repoItems.length) note(this.filter ? "No matches" : "No skills in this repo");
    }
    rows.push({ h: GROUP, el: () => this.group("Local", tilde(this.localDir), t) });
    localItems.forEach(s => rows.push({ h: CARD, skill: s }));
    if (!localItems.length) note(this.loaded ? (this.filter ? "No matches" : "No local skills yet: press n to create one") : "Loading…");
    return rows;
  }

  // A plain scroll area can't be scrolled from code, so the list shows a window of fixed-height
  // rows that follows the keyboard selection; the wheel moves the window.
  list(items, t, mono) {
    const rows = this.rows(items, t), space = Math.max(CARD, (this.size?.height ?? 600) - 42 - 30 - 24 - 16);
    const fits = (from, to) => rows.slice(from, to + 1).reduce((n, r) => n + r.h + GAP, -GAP) <= space;
    let maxTop = rows.length - 1;
    while (maxTop > 0 && fits(maxTop - 1, rows.length - 1)) maxTop--;
    let top = Math.min(this.top ?? 0, maxTop);
    const at = rows.findIndex(r => r.skill === items[this.sel]);
    if (this.reveal && at >= 0) {
      if (at < top) top = at > 0 && !rows[at - 1].skill ? at - 1 : at;
      while (top < at && !fits(top, at)) top++;
      this.reveal = false;
    }
    this.top = top = Math.max(0, top);
    let used = 0, end = top;
    while (end < rows.length && used + rows[end].h <= space + CARD / 2) used += rows[end++].h + GAP;
    return v_flex().id("skill-list").relative().flex_1().min_h(0).overflow_hidden().p(8).gap(GAP)
      .on_scroll_wheel((e, cx) => {
        this.wheel = (this.wheel ?? 0) + e.delta.y;
        const step = this.wheel >= 30 ? -1 : this.wheel <= -30 ? 1 : 0;
        if (!step) return;
        this.wheel = 0; this.top = Math.max(0, Math.min(maxTop, (this.top ?? 0) + step)); cx.notify();
      })
      .children(rows.slice(top, end).map(r => r.skill ? this.card(r.skill, items.indexOf(r.skill), t, mono) : r.el()))
      .when(end < rows.length, el => el.child(div().absolute().bottom(4).right(12).px(6).rounded(4).bg(t.raised).text_size(10.5).text_color(t.dim)
        .child(`${rows.slice(end).filter(r => r.skill).length} more ↓`)));
  }

  render() {
    this.hadKeys = this.keyboard();
    const t = theme(), mono = settings().font_family ?? "JetBrains Mono", items = this.items();
    if (this.flashMsg && Date.now() - this.flashAt > 4000) this.flashMsg = null;
    const repoItems = items.filter(s => s.scope === "repo"), localItems = items.filter(s => s.scope === "local");
    return v_flex().id("skills").relative().size_full().on_size_change((size, cx) => { this.size = size; cx.notify(); }).min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(this.hadKeys ? t.accent : t.border)
      .text_color(t.foreground).text_size(12.5)
      .track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .on_mouse_down("left", () => { if (!this.prompt) this.handle.focus(); })
      .child(h_flex().h(42).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().text_size(13).child("Skills"))
        .child(div().text_size(11.5).text_color(t.dim).child(`${localItems.length} local${this.repo ? ` · ${repoItems.length} in ${base(this.repo)}` : ""}`))
        .when(Boolean(this.filter), el => el.child(div().text_size(11).text_color(t.accent).child(`/${this.filter}`)))
        .child(div().flex_1())
        .children([this.selfUpdate.pill(t)].filter(Boolean))
        .child(this.button("skill-new", `${ICON}/plus.svg`, "New", cx => this.create(cx), t)))
      .child(this.target(t, mono))
      .child(this.list(items, t, mono))
      .child(keybar(t, { id: "skills", chips: this.chips(), flash: this.flashMsg, width: this.size?.width, onKeys: cx => { this.keysOpen = true; this.handle.focus(); cx.notify(); } }))
      .when(Boolean(this.menu), el => el.child(this.menuView(t, mono)))
      .when(Boolean(this.prompt), el => el.child(this.promptView(t)))
      .when(Boolean(this.keysOpen), el => el.child(keysCard(t, { id: "skills", title: "Skills: all keys", onClose: cx => { this.keysOpen = false; cx.notify(); }, groups: [
        { title: "Skills", chips: KEYS.actions }, { title: "Moving", chips: KEYS.moving }, { title: "Menus", chips: KEYS.menu }] })));
  }

  // The footer's keycaps for what's on screen now.
  chips() {
    if (this.prompt) return [{ caps: ["enter"], label: "confirm" }, { caps: ["escape"], label: "cancel" }];
    if (this.menu) return KEYS.menu;
    return KEYS.actions;
  }

  menuView(t, mono) {
    const m = this.menu;
    return div().id("sk-scrim").absolute().inset_0().bg("#00000055").flex().items_center().justify_center()
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.menu = null; cx.notify(); })
      .child(v_flex().id("sk-menu").w(440).p(6).rounded(10).border_1().border_color(t.border).bg(t.popover).shadow_lg()
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(div().px(8).py(6).font_semibold().truncate().child(m.title))
        .children(m.items.map((it, i) => h_flex().id(`sk-mi-${i}`).h(26).px(8).gap(8).items_center().rounded(6).cursor_pointer()
          .when(i === m.sel, e => e.bg(t.selected)).hover(s => s.bg(t.hover))
          .on_click((_e, cx) => { this.menu = null; it.run(cx); cx.notify(); })
          .child(div().w(18).flex_none().text_size(11).font_family(mono).text_color(t.accent).child(it.key ?? ""))
          .child(div().flex_1().min_w(0).truncate().child(it.label))
          .when(Boolean(it.hint), e => e.child(div().flex_none().text_size(11).text_color(t.dim).child(it.hint))))));
  }

  promptView(t) {
    const p = this.prompt;
    return div().id("sk-prompt-scrim").absolute().inset_0().bg("#00000055").flex().items_start().justify_center().pt(70)
      .child(v_flex().id("sk-prompt").w(340).p(12).gap(8).rounded(10).border_1().border_color(t.border).bg(t.popover).shadow_lg()
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(div().font_semibold().child(p.title))
        .child(Input.new(p.input).h(32).px(10).rounded(7).border_1().border_color(t.accent).bg(t.background).text_size(12.5).text_color(t.foreground))
        .child(div().text_size(11).text_color(t.dim).child("enter confirm · esc cancel")));
  }
}
