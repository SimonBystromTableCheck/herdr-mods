import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, run, openOverlay, theme, window, shared, setShared, layout, settings, terminals, readTextFile, home, appHome } from "herdr";
import * as fs from "fs/promises";
import { SelfUpdate } from "./update.js";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// Any block showing `mod`, anywhere in the tree.
function shows(node, mod) {
  if (!node) return false;
  if (node.content?.mod === mod) return true;
  return [...(node.children ?? []), ...(node.floating ?? [])].some(c => shows(c, mod));
}

// Buttons for the right-hand `panel-body` stack's children. A panel mod names itself in its mod.json
// ("panel": {"title", "icon"}); these are Herdr's own Files and Changes (by child id), which don't.
const BY_ID = {
  files: { title: "Files", icon: "mods/files/file.svg" },
  changes: { title: "Changes", icon: "mods/changes/changes.svg" },
};
const ADDED = "pond-tabs.added"; // {<layout>: [mods this tab bar added to it]}: never re-added once removed

export default class Tabs extends View {
  init(_props, cx) {
    this.selfUpdate = new SelfUpdate("pond-tabs", "tab bar", { short: "Tabs" }); this.selfUpdate.start(cx);
    this.layoutUpdate = new SelfUpdate("pond-tabs", "Pond layout", { layout: true, short: "Pond" }); this.layoutUpdate.start(cx);
    this.pressed = null;
    // The Claude account new sessions use (cvp's global profile), for the Claude button; its
    // name and kind come from pond-profiles' local settings (~/.cvm/herdr/pond-profiles.json).
    const account = cx => cx.spawn(async cx => {
      const name = (await readTextFile(`${home()}/.cvm/active-profile`).catch(() => null))?.trim() || null;
      let info = null;
      try { info = JSON.parse(await readTextFile(`${home()}/.cvm/herdr/pond-profiles.json`) ?? "{}").accounts?.[name] ?? null; } catch {}
      const key = `${name}|${info?.label}|${info?.gateway}`;
      if (key !== this.accountKey) { this.accountKey = key; this.account = name; this.accountInfo = info; cx.notify(); }
    });
    account(cx);
    cx.timer.every(3000, account);
    this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}");
    this.declared = {}; // mod -> {title, icon}: installed mods whose mod.json declares "panel"
    this.tried = new Set();
    this.scan(cx);
    cx.timer.every(15000, cx => this.scan(cx));
  }

  // Finds installed panel mods, then adds any missing from this layout's panel stack.
  scan(cx) {
    cx.spawn(async cx => {
      const declared = {};
      let names = [];
      try { names = await fs.readdir(`${appHome()}/mods`); } catch { return; }
      for (const name of names) {
        try {
          const panel = JSON.parse(await readTextFile(`${appHome()}/mods/${name}/mod.json`)).panel;
          if (panel?.title) declared[name] = { title: panel.title, icon: panel.icon ? `mods/${name}/${panel.icon}` : "mods/workspace-chrome/square.svg" };
        } catch { /* not a mod, or no mod.json */ }
      }
      if (JSON.stringify(declared) !== JSON.stringify(this.declared)) { this.declared = declared; cx.notify(); }
      await this.register();
    });
  }

  // Installing a panel mod is enough: it gets a block in this layout's `panel-body` stack (so a button
  // here) the first time it's seen. One the person removes stays removed. Herdr's own layouts refuse
  // structure changes (layout.set), so this works on a personal layout (pond, a clone of main).
  async register() {
    const name = shared("layout"), root = layout();
    if (!name || !root) return;
    const added = shared(ADDED) ?? {}, mine = added[name] ?? [];
    const present = Object.keys(this.declared).filter(m => shows(root, m) && !mine.includes(m));
    if (present.length) setShared(ADDED, { ...added, [name]: [...mine, ...present] }); // in place by any route
    const missing = Object.keys(this.declared).filter(m => !shows(root, m) && !mine.includes(m) && !present.includes(m) && !this.tried.has(`${name}/${m}`));
    if (!missing.length) return;
    let tree;
    try { tree = JSON.parse(await readTextFile(`${appHome()}/layouts/${name}.json`)); } catch { return; }
    const body = (function find(n) { if (n?.id === "panel-body") return n; for (const c of n?.children ?? []) { const f = find(c); if (f) return f; } return null; })(tree);
    if (!body || body.type !== "stack") return;
    const ids = new Set(JSON.stringify(tree).match(/"id":\s*"[^"]+"/g)?.map(x => x.split('"')[3]) ?? []);
    for (const m of missing) {
      this.tried.add(`${name}/${m}`);
      const id = ids.has(m) ? `${m}-panel` : m;
      ids.add(id);
      body.children = [...(body.children ?? []), { id, type: "block", content: { mod: m } }];
    }
    run("layout.set", { layout: tree });
  }

  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const stored = this.panels[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          if (want) { run("layout.select", { stack: "panel-body", child: want }); run("layout.show", { id: "panel" }); }
          else run("layout.hide", { id: "panel" });
          return;
        }
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  render() {
    const t = theme();
    const space = spaces().find(p => p.active);
    const shown = space?.tabs ?? [];
    const stop = (_e, cx) => cx.stop_propagation();
    const button = (id, label, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(label);
    const item = (c, i) => {
      const program = panes().find(p => p.tab === c.id && p.program?.agent)?.program ?? panes().find(p => p.tab === c.id)?.program;
      const name = /^tb\d+$/.test(c.name) ? program?.name ?? "Terminal" : c.name;
      return h_flex().id(`tab-${c.id}`).h(29).px(10).gap(7).rounded(7).items_center().flex_none().text_size(12.8)
        .border(1).border_color(c.active ? t.border : t.chrome).bg(c.active ? t.raised : t.chrome).text_color(c.active ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(14)))
        .child(div().max_w(170).truncate().child(c.zoomed ? `${name} Z` : name))
        .when(c.status === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
        .when(c.status === "blocked" || c.status === "done", el => el.child(div().size(6).rounded(3).bg(t[c.status])))
        .when(c.active, el => el.child(div().id(`close-${c.id}`).text_color(t.dim).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child(svg("mods/pane/close.svg").size(12))));
    };
    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 10;
    const panel = find(root, "panel"), body = find(root, "panel-body");
    const shipped = shared("workspace.panels") ?? ["files", "changes"];
    // One button per child of the panel stack, in layout order (Herdr's Files/Changes as the welcome chose).
    const buttons = (body?.children ?? []).filter(c => !(c.id in BY_ID) || shipped.includes(c.id)).map(c => {
      const mod = c.content?.mod, meta = BY_ID[c.id] ?? this.declared[mod];
      return meta ? { id: c.id, mod, ...meta } : null;
    }).filter(Boolean);
    const enabled = buttons.map(b => b.id);
    this.syncPanel(space, panel, body, enabled);
    const panelButton = (id, label, icon, badge, dot) => {
      const on = panel && !panel.hidden && body?.active === id;
      return h_flex().id(`panel-${id}`).h(26).px(8).gap(5).flex_none().items_center().rounded(6)
        .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
        .on_click(() => {
          if (on) run("layout.hide", { id: "panel" });
          else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
        }).child(svg(icon).size(14)).child(label)
        .when(Boolean(dot), el => el.child(div().size(6).flex_none().rounded_full().bg(dot)))
        .when(badge > 0, el => el.child(div().h(16).min_w(16).px(4).flex().items_center().justify_center().rounded_full()
          .bg(t.ansi2).text_color(t.background).text_size(10.5).font_semibold().child(String(badge))));
    };
    return h_flex().size_full().min_w(0).px(10).pl(lightsPadding).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar().children(shown.map(item)))
      .children([this.layoutUpdate.pill(t, { compact: true }), this.selfUpdate.pill(t, { compact: true })].filter(Boolean).map(p => p.mr(3)))
      .child(button("tab-new", "+", () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 })))
      .children(buttons.map(b =>
        b.mod === "servers" ? panelButton(b.id, b.title, b.icon, terminals().filter(x => x.state === "live" && x.labels?.["herdr.server"]).length)
        : b.mod === "pond-profiles" ? panelButton(b.id, this.accountInfo?.label ?? (this.account ? this.account[0].toUpperCase() + this.account.slice(1) : b.title),
          b.icon, 0, this.account ? (this.accountInfo?.gateway ? t.ansi5 : t.ansi4) : null)
        : panelButton(b.id, b.title, b.icon)))
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/pond-tabs/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/pond-tabs/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/pond-tabs/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"))));
  }
}
