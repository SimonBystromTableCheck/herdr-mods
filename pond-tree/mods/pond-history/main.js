// History: Claude Code's past sessions, newest first, grouped by day. Type to filter (title, messages, folder,
// branch), pick a project ([ ]), j/k or ↑/↓ to move (the search box keeps ↑/↓ and ctrl-j/k), Enter resumes the session (`claude --resume <id>`) in a new tab of the space
// already open on its folder (or a new space there), ⌘Enter resumes a fork of it. A session still running in a
// terminal goes to that terminal instead. index.py reads ~/.claude/projects and caches what it read.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, ScrollHandle } from "gpui-base";
import { liveSessions } from "./live.js";
import { keybar, keysCard } from "./keybar.js";
import { exec, appHome, home, theme, props, closeOverlay, run, spaces, terminals, panes, shared, notify, checking } from "herdr";

const ICON = (n) => `mods/pond-history/icons/${n}.svg`;
const DAY = 86400000;

function ago(ms) {
  if (!ms) return "";
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function when(ms) {
  if (!ms) return "—";
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) + " · "
    + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function groupOf(ms) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const t0 = start.getTime();
  if (ms >= t0) return "Today";
  if (ms >= t0 - DAY) return "Yesterday";
  if (ms >= t0 - 6 * DAY) return "Earlier this week";
  if (ms >= t0 - 29 * DAY) return "Earlier this month";
  return new Date(ms).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

const oneLine = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

export default class History extends View {
  init(_props, cx) {
    this.sessions = null;
    this.live = new Map();
    this.error = null;
    this.filter = "";
    this.project = null;
    this.at = 0;
    this.scroll = ScrollHandle.new();
    this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "Search sessions…" });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value(); this.at = 0; this.reveal(); cx.notify(); });
    this.input.on("submit", (_e, cx) => this.open(this.list()[this.at], false, cx));
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.typing = false; this.keysOpen = false;
    // The list has the keyboard when the window opens (j / k, enter…); / goes to the search box.
    this.handle.focus();
    cx.timer.after(60, () => { if (!this.typing) this.handle.focus(); });
    cx.timer.after(400, () => { if (!this.typing) this.handle.focus(); });
    if (checking()) { this.sessions = []; return; }
    this.load(cx);
    cx.timer.every(20000, (cx) => this.load(cx));
  }

  load(cx) {
    cx.spawn(async (cx) => {
      try {
        const r = await exec("python3", [`${appHome()}/mods/pond-history/index.py`, "500"], { timeout: 60000 });
        const d = JSON.parse(r.stdout);
        if (!d.ok) throw new Error(d.error ?? "index failed");
        this.sessions = d.sessions;
        this.error = null;
      } catch (e) {
        this.error = String(e?.message ?? e);
        this.sessions ??= [];
      }
      cx.notify();
    });
  }

  close() { closeOverlay(props().overlay); }

  /** session path → the live terminal running it. */
  liveMap() {
    const map = {};
    for (const s of this.sessions ?? []) {
      const address = this.live.get(s.id);
      if (address) map[s.path] = address;
    }
    return map;
  }

  projectName(cwd) {
    if (!cwd) return "unknown";
    if (cwd === home()) return "~";
    return cwd.split("/").filter(Boolean).pop();
  }

  /** The sessions, each titled with the name its tab or pane was given, when someone renamed it. */
  named() {
    const names = shared("pond.history.names") ?? {};
    return (this.sessions ?? []).map((s) => (names[s.id] ? { ...s, title: names[s.id], renamed: true } : s));
  }

  list() {
    const f = this.filter.toLowerCase().trim();
    return this.named().filter((s) => (!this.project || s.cwd === this.project)
      && (!f || [s.title, s.first, s.last, s.cwd, s.branch, s.id].join(" ").toLowerCase().includes(f)));
  }

  reveal() {
    // Children of the scroll area: each group's heading, then its rows.
    const rows = this.list();
    let child = 0, last = null;
    for (let i = 0; i <= this.at && i < rows.length; i++) {
      const g = groupOf(rows[i].updated);
      if (g !== last) { child++; last = g; }
      if (i < this.at) child++;
    }
    this.scroll.scroll_to_item(child);
  }

  /**
   * The space to resume in, on this computer: one already running a Claude session of the same project (its
   * sessions folder), else one whose folder or a terminal's folder is the session's, the shown space first.
   */
  spaceFor(s, folder) {
    const local = spaces().filter((p) => !p.machine);
    const order = (list) => [...list.filter((p) => p.active), ...list.filter((p) => !p.active)];
    const dir = s.path.slice(0, s.path.lastIndexOf("/"));
    const tabSpace = new Map(local.flatMap((p) => p.tabs.map((t) => [t.id, p])));
    const viaSession = [];
    const dirOf = new Map((this.sessions ?? []).map((x) => [x.id, x.path.slice(0, x.path.lastIndexOf("/"))]));
    for (const [id, address] of liveSessions()) {
      if (dirOf.get(id) !== dir) continue;
      const pane = panes().find((p) => p.terminal === address);
      const space = pane && tabSpace.get(pane.tab);
      if (space && !viaSession.includes(space)) viaSession.push(space);
    }
    if (viaSession.length) return order(viaSession)[0];
    const cwds = new Map();
    for (const p of panes()) if (p.cwd) cwds.set(p.tab, [...(cwds.get(p.tab) ?? []), p.cwd]);
    const here = local.filter((p) => p.folder === folder || p.tabs.some((t) => (cwds.get(t.id) ?? []).includes(folder)));
    return order(here)[0] ?? null;
  }

  async open(s, fork, cx) {
    if (!s) return;
    const address = liveSessions().get(s.id);
    if (address && !fork) {
      this.close();
      run("agent.focus", { terminal: address });
      return;
    }
    const folder = s.cwd ?? home();
    const ok = await exec("test", ["-d", folder]).then((r) => r.code === 0).catch(() => false);
    if (!ok) {
      notify({ title: "Can't resume this session", body: `Its folder is gone: ${folder}`, level: "error" });
      return;
    }
    const argv = ["claude", "--resume", s.id, ...(fork ? ["--fork-session"] : [])];
    const space = this.spaceFor(s, folder);
    const name = s.renamed ? s.title : undefined;
    this.close();
    if (space) run("tab.new", { space: space.id, folder, argv, ...(name ? { name } : {}) });
    else run("space.new", { folder, argv, ...(name ? { tab: name } : {}) });
  }

  // ── drawing ──────────────────────────────────────────────────────────────

  chip(t, id, label, count, on, click) {
    return h_flex().id(id).flex_none().h(24).px(9).gap(5).items_center().rounded(6).text_size(12).cursor_pointer()
      .border_1().border_color(on ? t.input : t.border)
      .bg(on ? t.selected ?? t.hover : t.popover).text_color(on ? t.foreground : t.muted)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click(click)
      .child(label)
      .when(count != null, (el) => el.child(div().text_color(t.dim).child(String(count))));
  }

  row(t, s, i, on, live) {
    const title = oneLine(s.title || s.first || "Untitled session");
    const meta = [this.projectName(s.cwd), s.branch, `${s.prompts} msg${s.prompts === 1 ? "" : "s"}`].filter(Boolean).join("  ·  ");
    return h_flex().id(`h-${s.id}`).mx(6).px(10).py(7).gap(10).items_center().rounded(7).cursor_pointer()
      .when(on, (el) => el.bg(t.hover))
      .hover((st) => st.bg(t.hover))
      .on_click((_e, cx) => {
        this.handle.focus(); // a click puts the keyboard in the list (j / k from here)
        if (this.at === i) { this.open(s, false, cx); return; }
        this.at = i; cx.notify();
      })
      .child(svg(ICON(live ? "message-dot" : "message")).size(15).flex_none().text_color(live ? t.working ?? t.accent : t.dim))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().truncate().text_size(13).text_color(t.foreground).when(on, (d) => d.font_semibold()).child(title))
        .child(div().truncate().text_size(11.5).text_color(t.dim).child(meta)))
      .when(live, (el) => el.child(div().flex_none().px(6).py(1).rounded(5).text_size(10.5)
        .bg(t.raised).text_color(t.working ?? t.accent).child("open")))
      .child(div().flex_none().w(64).text_size(11.5).text_color(t.dim).text_right().child(ago(s.updated)));
  }

  field(t, label, value, color) {
    return h_flex().gap(10).items_start().text_size(12)
      .child(div().w(72).flex_none().text_color(t.dim).child(label))
      .child(div().flex_1().min_w(0).text_color(color ?? t.muted).child(value));
  }

  quote(t, label, text) {
    if (!text) return null;
    const s = String(text);
    return v_flex().gap(5)
      .child(div().text_size(11).font_semibold().text_color(t.dim).child(label))
      .child(div().px(10).py(8).rounded(7).bg(t.raised).text_size(12.5).text_color(t.foreground).line_height(1.4)
        .child(s.length > 360 ? s.slice(0, 360) + "…" : s));
  }

  button(t, id, label, icon, primary, click) {
    return h_flex().id(id).h(30).px(12).gap(6).items_center().justify_center().rounded(7).text_size(12.5).cursor_pointer()
      .when(primary, (el) => el.bg(t.solid ?? t.accent).text_color(t.solid_foreground ?? t.accent_foreground)
        .hover((s) => s.opacity(0.9)))
      .when(!primary, (el) => el.border_1().border_color(t.border).text_color(t.foreground).hover((s) => s.bg(t.hover)))
      .on_click(click)
      .when(icon, (el) => el.child(svg(ICON(icon)).size(13)))
      .child(label);
  }

  preview(t, s, live) {
    if (!s) return v_flex().w(300).flex_none().h_full().border_l_1().border_color(t.border).p(16).items_center().justify_center().text_color(t.dim).text_size(12.5)
      .child(this.sessions ? "No session" : "Reading sessions…");
    const name = this.projectName(s.cwd);
    return v_flex().w(300).flex_none().h_full().min_h(0).border_l_1().border_color(t.border)
      .child(v_flex().id("h-preview").flex_1().min_h(0).overflow_y_scrollbar().p(16).gap(14)
        .child(div().text_size(14.5).font_semibold().text_color(t.foreground).line_height(1.3)
          .child(oneLine(s.title || s.first || "Untitled session")))
        .child(v_flex().gap(6)
          .child(this.field(t, "Project", name, t.foreground))
          .child(this.field(t, "Folder", (s.cwd ?? "").replace(home(), "~")))
          .when(s.branch, (el) => el.child(this.field(t, "Branch", s.branch)))
          .child(this.field(t, "Started", when(s.started)))
          .child(this.field(t, "Last active", when(s.updated)))
          .child(this.field(t, "Messages", String(s.prompts)))
          .when(s.model, (el) => el.child(this.field(t, "Model", s.model.split("/").pop())))
          .when(s.cost != null, (el) => el.child(this.field(t, "Cost", `$${Number(s.cost).toFixed(2)}`)))
          .when(s.pr, (el) => el.child(h_flex().gap(10).text_size(12)
            .child(div().w(72).flex_none().text_color(t.dim).child("PR"))
            .child(div().id("h-pr").text_color(t.accent).cursor_pointer().hover((st) => st.underline())
              .on_click((_e, cx) => cx.open_url(s.pr.url)).child(`#${s.pr.number ?? ""} ${s.pr.repo ?? ""}`.trim()))))
          .when(live, (el) => el.child(this.field(t, "Status", "Open in a terminal", t.working ?? t.accent))))
        .child(this.quote(t, "FIRST MESSAGE", s.first))
        .when(s.last && s.last !== s.first, (el) => el.child(this.quote(t, "LAST MESSAGE", s.last))))
      .child(v_flex().flex_none().p(12).gap(8).border_t_1().border_color(t.border)
        .child(this.button(t, "h-resume", live ? "Go to session" : "Resume session", live ? "arrow-right" : "history", true,
          (_e, cx) => this.open(s, false, cx)))
        .child(h_flex().gap(8)
          .child(this.button(t, "h-fork", "Fork", "git-fork", false, (_e, cx) => this.open(s, true, cx)).flex_1())
          .child(this.button(t, "h-copy", "Copy ID", "copy", false, (_e, cx) => {
            cx.write_to_clipboard(s.id);
            notify({ title: "Session ID copied", body: s.id, timeout: 2500 });
          }).flex_1())));
  }

  // ── keys ──────────────────────────────────────────────────────────────────

  /**
   * The list has the keyboard when the window opens, with the other panels' vim keys; / goes to the search box, where
   * typing filters, ↑/↓ (and ctrl-j/k, ctrl-n/p) move, enter resumes, ⌘enter forks and esc goes back to the list. List keys: j/k, g/G, ctrl-d/u, enter, f fork, y copy ID, / search, [ ] project, ? keys, q / esc close.
   */
  key(e, rows, sel, cx) {
    const m = e.modifiers ?? {}, ks = e.keystroke, k = m.control || m.platform || m.alt ? ks : (e.key_char ?? e.key);
    const move = d => { this.at = Math.max(0, Math.min(rows.length - 1, this.at + d)); this.reveal(); };
    if (this.keysOpen) { if (["escape", "?", "q"].includes(e.key === "escape" ? "escape" : k)) this.keysOpen = false; return true; }
    if (e.key === "enter" && (m.platform || m.control)) { this.open(sel, true, cx); return true; }
    if (["down", "ctrl-n", "ctrl-j"].includes(ks) || e.key === "down") { move(1); return true; }
    if (["up", "ctrl-p", "ctrl-k"].includes(ks) || e.key === "up") { move(-1); return true; }
    if (this.typing) {
      if (e.key !== "escape") return false; // the box types
      this.handle.focus(); return true; // back to the list (the filter stays; esc again closes)
    }
    const page = 10;
    switch (e.key === "escape" ? "escape" : e.key === "enter" ? "enter" : k) {
      case "escape": case "q": this.close(); return true;
      case "j": move(1); return true;
      case "k": move(-1); return true;
      case "g": this.at = 0; this.reveal(); return true;
      case "G": this.at = Math.max(0, rows.length - 1); this.reveal(); return true;
      case "ctrl-d": move(page); return true;
      case "ctrl-u": move(-page); return true;
      case "enter": this.open(sel, false, cx); return true;
      case "f": this.open(sel, true, cx); return true;
      case "y": if (sel) { cx.write_to_clipboard(sel.id); notify({ title: "Session ID copied", body: sel.id, timeout: 2500 }); } return true;
      case "/": this.input.focus(); return true;
      case "[": case "]": {
        const list = [null, ...(this.projectList ?? [])], i = Math.max(0, list.indexOf(this.project));
        this.project = list[(i + (k === "]" ? 1 : list.length - 1)) % list.length]; this.at = 0; this.reveal();
        return true;
      }
      case "?": this.keysOpen = true; return true;
    }
    return false;
  }

  chips() {
    if (this.typing) return [
      { caps: ["up", "down"], label: "move" }, { caps: ["enter"], label: "resume" }, { caps: ["cmd", "enter"], label: "fork" },
      { caps: ["escape"], label: "back to the list" },
    ];
    return [
      { caps: ["j", "k"], label: "move" }, { caps: ["enter"], label: "resume" }, { caps: ["f"], label: "fork" },
      { caps: ["/"], label: "search" }, { caps: ["[", "]"], label: "project" }, { caps: ["y"], label: "copy ID" },
      { caps: ["g", "G"], label: "top / bottom" }, { caps: ["q"], label: "close" },
    ];
  }

  keyGroups() {
    return [
      { title: "In the list", chips: [
        { caps: ["j", "k"], label: "move (↓ ↑ too)" }, { caps: ["g", "G"], label: "first / last" },
        { caps: ["ctrl-d", "ctrl-u"], label: "ten down / up" }, { caps: ["enter"], label: "resume (or go to its open terminal)" },
        { caps: ["f"], label: "resume a fork of it" }, { caps: ["y"], label: "copy the session ID" },
        { caps: ["[", "]"], label: "previous / next project" }, { caps: ["/"], label: "search" },
        { caps: ["q"], label: "close (esc too)" },
      ] },
      { title: "In the search box", chips: [
        { caps: ["up", "down"], label: "move (ctrl-j / ctrl-k, ctrl-n / ctrl-p too)" }, { caps: ["enter"], label: "resume" },
        { caps: ["cmd", "enter"], label: "resume a fork" }, { caps: ["escape"], label: "back to the list" },
      ] },
    ];
  }

  render() {
    const t = theme();
    const rows = this.list();
    this.at = Math.max(0, Math.min(this.at, rows.length - 1));
    const sel = rows[this.at];
    this.live = liveSessions();
    const live = this.liveMap();

    // Projects with their session counts, the busiest first.
    const counts = new Map();
    for (const s of this.named()) counts.set(s.cwd, (counts.get(s.cwd) ?? 0) + 1);
    const projects = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    this.projectList = projects.map(([cwd]) => cwd);

    const body = [];
    let last = null;
    rows.forEach((s, i) => {
      const g = groupOf(s.updated);
      if (g !== last) {
        body.push(div().px(16).pt(body.length ? 12 : 4).pb(4).text_size(11).font_semibold().text_color(t.dim).child(g.toUpperCase()));
        last = g;
      }
      body.push(this.row(t, s, i, i === this.at, Boolean(live[s.path])));
    });

    const empty = !rows.length && v_flex().flex_1().items_center().justify_center().gap(6).text_color(t.dim).text_size(12.5)
      .child(this.error ? `Couldn't read sessions: ${this.error}` : this.sessions ? "No sessions match" : "Reading sessions…");

    return v_flex().id("history").relative().track_focus(this.handle).size_full().bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => { if (this.key(e, rows, sel, cx)) { cx.stop_propagation(); cx.notify(); } })
      // Header
      .child(h_flex().flex_none().px(18).pt(16).pb(10).gap(10).items_center()
        .child(svg(ICON("history")).size(17).text_color(t.muted))
        .child(div().text_size(15).font_semibold().child("Session history"))
        .child(div().text_size(12).text_color(t.dim).child(this.sessions ? `${rows.length} of ${this.sessions.length}` : ""))
        .child(div().flex_1())
        .child(div().id("h-esc").px(6).py(2).rounded(5).text_size(11).text_color(t.dim).cursor_pointer()
          .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(() => this.close()).child("Esc")))
      // Search
      .child(h_flex().flex_none().mx(18).h(36).px(10).gap(8).items_center().rounded(9).border_1().border_color(t.input ?? t.border).bg(t.background)
        .child(svg(ICON("search")).size(14).text_color(t.dim))
        .child(Input.new(this.input).flex_1().h_full().text_size(13).text_color(t.foreground)))
      // Projects
      // Project chips wrap onto more rows instead of running off the edge.
      .child(h_flex().id("h-projects").flex_none().flex_wrap().mx(18).mt(10).mb(10).gap(6)
        .child(this.chip(t, "h-all", "All projects", null, !this.project, (_e, cx) => { this.project = null; this.at = 0; cx.notify(); }))
        .children(projects.map(([cwd, n], i) => this.chip(t, `h-p-${i}`, this.projectName(cwd), n, this.project === cwd,
          (_e, cx) => { this.project = this.project === cwd ? null : cwd; this.at = 0; cx.notify(); }))))
      // List | preview
      .child(h_flex().flex_1().min_h(0).items_stretch().border_t_1().border_color(t.border)
        .child(empty || v_flex().id("h-list").flex_1().min_w(0).h_full().overflow_y_scrollbar().track_scroll(this.scroll).py(6).children(body))
        .child(this.preview(t, sel, Boolean(sel && live[sel.path]))))
      // Keys, as the other panels' footers: the ones for where the keyboard is, ? for all of them.
      .child(keybar(t, { id: "history", chips: this.chips(), width: 860, onKeys: cx => { this.keysOpen = true; this.handle.focus(); cx.notify(); } }))
      .when(this.keysOpen, el => el.child(keysCard(t, { id: "history", title: "Session history: keys", groups: this.keyGroups(), onClose: cx => { this.keysOpen = false; cx.notify(); } })));
  }
}
