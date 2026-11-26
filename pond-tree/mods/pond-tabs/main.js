import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, run, openOverlay, closeOverlay, props, theme, window, shared, setShared, layout, settings, terminals, readTextFile, home, appHome } from "herdr";
import * as fs from "fs/promises";
import { SelfUpdate } from "./update.js";
import { pins as pinned, load as loadPins, save as savePins } from "./pins.js";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The block showing `mod`, anywhere in the tree.
function showing(node, mod) {
  if (!node) return null;
  if (node.content?.mod === mod) return node;
  for (const c of [...(node.children ?? []), ...(node.floating ?? [])]) { const f = showing(c, mod); if (f) return f; }
  return null;
}
const shows = (node, mod) => Boolean(showing(node, mod));

// Buttons for the right-hand `panel-body` stack's children. A panel mod names itself in its mod.json
// ("panel": {"title", "icon"}); these are Herdr's own Files and Changes (by child id), which don't.
const BY_ID = {
  files: { title: "Files", icon: "mods/files/file.svg" },
  changes: { title: "Changes", icon: "mods/changes/changes.svg" },
};
const ADDED = "pond-tabs.added"; // {<layout>: [mods this tab bar added to it]}: never re-added once removed
const PINS_MOD = "pond-pins"; // pinned panels as cards; optional: pin buttons show where its block is
const ORDER = "pond-tabs.panelOrder"; // [panel ids] in the order the person dragged them; others keep layout order after

export default class Tabs extends View {
  init(_props, cx) {
    this.popup = Boolean(props()?.overlay); // this copy is the hamburger's dropdown
    this.pressed = null; this.dragPanel = null; this.overPanel = null;
    if (this.popup) return;
    this.selfUpdate = new SelfUpdate("pond-tabs", "tab bar", { short: "Tabs" }); this.selfUpdate.start(cx);
    this.layoutUpdate = new SelfUpdate("pond-tabs", "Pond layout", { layout: true, short: "Pond" }); this.layoutUpdate.start(cx);
    this.pressed = null;
    this.dragPanel = null; // panel id pressed, while held
    this.overPanel = null; // panel id under the pointer
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
    this.docks = {}; // mod -> {into, at, id, size, hidden}: installed mods whose mod.json declares "dock"
    this.pinsFile = {};
    const pins = cx => cx.spawn(async () => loadPins(this.pinsFile));
    pins(cx);
    cx.timer.every(3000, pins);
    this.tried = new Set();
    this.scan(cx);
    cx.timer.every(15000, cx => this.scan(cx));
  }

  // Finds installed panel mods, then adds any missing from this layout's panel stack.
  scan(cx) {
    cx.spawn(async cx => {
      const declared = {}, docks = {};
      let names = [];
      try { names = await fs.readdir(`${appHome()}/mods`); } catch { return; }
      for (const name of names) {
        try {
          const json = JSON.parse(await readTextFile(`${appHome()}/mods/${name}/mod.json`)), panel = json.panel;
          if (json.dock?.into) docks[name] = json.dock;
          if (panel?.title) declared[name] = { title: panel.title, icon: panel.icon ? `mods/${name}/${panel.icon}` : "mods/workspace-chrome/square.svg", leader: panel.leader ?? null };
        } catch { /* not a mod, or no mod.json */ }
      }
      if (JSON.stringify(declared) !== JSON.stringify(this.declared)) { this.declared = declared; cx.notify(); }
      this.docks = docks;
      await this.register();
    });
  }

  // Installing a mod is enough: a panel mod gets a block in this layout's `panel-body` stack (so a
  // button here), and a mod whose mod.json has "dock": {into, at, id, size, hidden, layouts?} gets a
  // block (only in the named layouts, when `layouts` is given) in
  // that node (pond-pins: the sidebar's lists), the first time each is seen. One the person removes
  // stays removed. Herdr's own layouts refuse structure changes (layout.set), so this works on a
  // personal layout (pond, pond-tree, a clone of main); a layout without the node is left alone.
  async register() {
    const name = shared("layout"), root = layout();
    if (!name || !root) return;
    const docked = Object.keys(this.docks).filter(m => !this.docks[m].layouts || this.docks[m].layouts.includes(name));
    const mods = [...new Set([...Object.keys(this.declared), ...docked])];
    const added = shared(ADDED) ?? {}, mine = added[name] ?? [];
    const present = mods.filter(m => shows(root, m) && !mine.includes(m));
    if (present.length) setShared(ADDED, { ...added, [name]: [...mine, ...present] }); // in place by any route
    const missing = mods.filter(m => !shows(root, m) && !mine.includes(m) && !present.includes(m) && !this.tried.has(`${name}/${m}`));
    if (!missing.length) return;
    let tree;
    try { tree = JSON.parse(await readTextFile(`${appHome()}/layouts/${name}.json`)); } catch { return; }
    const ids = new Set(JSON.stringify(tree).match(/"id":\s*"[^"]+"/g)?.map(x => x.split('"')[3]) ?? []);
    const fresh = want => { let id = want, n = 2; while (ids.has(id)) id = `${want}-${n++}`; ids.add(id); return id; };
    let changed = false;
    for (const m of missing) {
      this.tried.add(`${name}/${m}`);
      const dock = this.docks[m], into = find(tree, dock?.into ?? "panel-body");
      if (!into || (!dock && into.type !== "stack")) continue;
      const block = { id: fresh(dock?.id ?? (ids.has(m) ? `${m}-panel` : m)), type: "block", content: { mod: m } };
      if (dock?.size) block.size = { px: dock.size };
      if (dock?.hidden) block.hidden = true;
      const kids = [...(into.children ?? [])];
      kids.splice(dock?.at ?? kids.length, 0, block);
      into.children = kids;
      changed = true;
    }
    if (changed) run("layout.set", { layout: tree });
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

  // The hamburger's dropdown: the panel buttons as a list, drawn from what the tab bar passed.
  renderMenu() {
    const t = theme(), { overlay, items = [] } = props();
    const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body");
    const order = shared(ORDER) ?? [], rank = id => { const i = order.indexOf(id); return i < 0 ? order.length : i; };
    const list = [...items].sort((a, b) => rank(a.id) - rank(b.id));
    const live = terminals().filter(x => x.state === "live" && x.labels?.["herdr.server"]).length;
    const pinnable = shows(root, PINS_MOD), pins = pinned();
    return div().id("menu").size_full().p(5).flex().flex_col().gap(1).bg(t.popover).text_size(12.5)
      .on_mouse_up("left", (_e, cx) => { if (this.dragPanel) { this.dragPanel = null; cx.notify(); } })
      .children(list.map(b => {
        const on = panel && !panel.hidden && body?.active === b.id;
        const target = this.dragPanel && this.dragPanel !== b.id && this.overPanel === b.id;
        const badge = b.mod === "servers" ? live : 0;
        return h_flex().id(`item-${b.id}`).h(28).px(8).gap(8).items_center().rounded(6)
          .bg(on ? t.selected : t.popover).text_color(on ? t.foreground : t.muted)
          .border(1).border_color(target ? t.accent : t.popover)
          .cursor_pointer().hover(s => s.bg(t.hover).text_color(t.foreground))
          .on_mouse_down("left", (_e, cx) => { this.dragPanel = b.id; cx.notify(); })
          .on_hover((h, cx) => { if (h) this.overPanel = b.id; else if (this.overPanel === b.id) this.overPanel = null; if (this.dragPanel) cx.notify(); })
          .on_mouse_up("left", () => {
            const from = this.dragPanel;
            if (from && from !== b.id) {
              const ids = list.map(x => x.id).filter(id => id !== from);
              const at = ids.indexOf(b.id), fromAt = list.findIndex(x => x.id === from), toAt = list.findIndex(x => x.id === b.id);
              ids.splice(fromAt < toAt ? at + 1 : at, 0, from);
              setShared(ORDER, ids);
            }
          })
          .on_click(() => {
            if (this.dragPanel && this.dragPanel !== b.id) return;
            closeOverlay(overlay);
            if (on) run("layout.hide", { id: "panel" });
            else { run("layout.select", { stack: "panel-body", child: b.id }); run("layout.show", { id: "panel" }); }
          })
          .child(svg(b.icon).size(14).flex_none())
          .child(div().flex_1().min_w(0).truncate().child(b.title))
          .when(Boolean(b.dot), el => el.child(div().size(6).flex_none().rounded_full().bg(b.dot)))
          .when(badge > 0, el => el.child(div().flex_none().h(14).px(4).flex().items_center().rounded(3) // the sidebar's badge tile
            .bg(t.ansi2).text_color(t.background).text_size(9.5).child(String(badge))))
          .when(Boolean(b.leader), el => el.child(div().flex_none().px(5).rounded(4).bg(t.raised).text_color(t.dim).text_size(11).child(b.leader)))
          .when(pinnable, el => {
            const pinned = pins.includes(b.id);
            return el.child(div().id(`pin-${b.id}`).size(20).flex_none().flex().items_center().justify_center().rounded(4)
              .text_color(pinned ? t.accent : t.dim).cursor_pointer().hover(s => s.bg(t.raised).text_color(pinned ? t.accent : t.foreground))
              .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
              .on_click((_e, cx) => { cx.stop_propagation(); savePins(pinned ? pins.filter(x => x !== b.id) : [...pins, b.id]); })
              .child(svg(`mods/workspace-chrome/${pinned ? "pin" : "pin-off"}.svg`).size(12)));
          });
      }));
  }

  // Shows pond-pins' block while anything is pinned and the sidebar isn't a rail; pond-pins sizes it.
  syncPins(root, sidebar, enabled) {
    const block = showing(root, PINS_MOD);
    if (!block) return;
    const n = pinned().filter(id => enabled.includes(id)).length;
    const want = n > 0 && !sidebar?.hidden && (sidebar?.size?.px ?? 268) >= 160;
    if (want === !block.hidden) return;
    if (want) { if (!(block.size?.px > 0)) run("layout.resize", { id: block.id, px: 68 }); run("layout.show", { id: block.id }); }
    else run("layout.hide", { id: block.id });
  }

  render() {
    if (this.popup) return this.renderMenu();
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
    const order = shared(ORDER) ?? [], rank = id => { const i = order.indexOf(id); return i < 0 ? order.length : i; };
    buttons.sort((a, b) => rank(a.id) - rank(b.id)); // stable: unranked ones keep layout order
    const movePanel = (from, to) => {
      const ids = buttons.map(b => b.id).filter(id => id !== from);
      const at = ids.indexOf(to), fromAt = buttons.findIndex(b => b.id === from), toAt = buttons.findIndex(b => b.id === to);
      ids.splice(fromAt < toAt ? at + 1 : at, 0, from); // dropped right of where it was: lands after the target
      setShared(ORDER, ids);
    };
    const enabled = buttons.map(b => b.id);
    this.syncPanel(space, panel, body, enabled);
    this.syncPins(root, sidebar, enabled);
    const panelButton = (id, label, icon, badge, dot) => {
      const on = panel && !panel.hidden && body?.active === id;
      const target = this.dragPanel && this.dragPanel !== id && this.overPanel === id;
      return h_flex().id(`panel-${id}`).h(26).px(8).gap(5).flex_none().items_center().rounded(6)
        .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .border(1).border_color(target ? t.accent : this.dragPanel === id && this.overPanel !== id ? t.border : t.chrome)
        .hover(s => s.bg(t.hover))
        .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.dragPanel = id; cx.notify(); })
        .on_hover((h, cx) => { if (h) this.overPanel = id; else if (this.overPanel === id) this.overPanel = null; if (this.dragPanel) cx.notify(); })
        .on_mouse_up("left", () => { const from = this.dragPanel; if (from && from !== id) movePanel(from, id); })
        .on_click(() => {
          if (on) run("layout.hide", { id: "panel" });
          else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
        }).child(svg(icon).size(14)).child(label)
        .when(Boolean(dot), el => el.child(div().size(6).flex_none().rounded_full().bg(dot)))
        .when(badge > 0, el => el.child(div().h(16).min_w(16).px(4).flex().items_center().justify_center().rounded_full()
          .bg(t.ansi2).text_color(t.background).text_size(10.5).font_semibold().child(String(badge))));
    };
    // props {menu: true}: the panels go in a dropdown under one hamburger button instead of a row.
    const labelOf = b => b.mod === "pond-profiles" ? this.accountInfo?.label ?? (this.account ? this.account[0].toUpperCase() + this.account.slice(1) : b.title) : b.title;
    const dotOf = b => b.mod === "pond-profiles" && this.account ? (this.accountInfo?.gateway ? t.ansi5 : t.ansi4) : null;
    const menuButton = () => {
      const open = panel && !panel.hidden && buttons.find(b => b.id === body?.active);
      return h_flex().id("panel-menu").h(26).px(7).gap(5).flex_none().items_center().rounded(6).text_size(12)
        .bg(open ? t.selected : t.chrome).text_color(open ? t.foreground : t.muted).cursor_pointer().hover(s => s.bg(t.hover).text_color(t.foreground))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.menuBounds = e.bounds ?? null; })
        // Drops down from under the button, right edges aligned.
        .on_click(() => openOverlay({ mod: "pond-tabs", kind: "popup", width: 230,
          at: this.menuBounds ? { x: this.menuBounds.x + this.menuBounds.width - 230, y: this.menuBounds.y + this.menuBounds.height + 4 } : "pointer", height: 10 + buttons.length * 29,
          props: { items: buttons.map(b => ({ id: b.id, mod: b.mod, title: labelOf(b), icon: b.icon, leader: b.leader ?? null, dot: dotOf(b) })) } }))
        .when(Boolean(open), el => el.child(svg(open.icon).size(14)).child(labelOf(open)))
        .child(svg("mods/pond-tabs/menu.svg").size(15));
    };
    return h_flex().size_full().min_w(0).px(10).pl(lightsPadding).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_mouse_up("left", (_e, cx) => { this.pressed = null; if (this.dragPanel) { this.dragPanel = null; cx.notify(); } })
      .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar().children(shown.map(item)))
      .children([this.layoutUpdate.pill(t, { compact: true }), this.selfUpdate.pill(t, { compact: true })].filter(Boolean).map(p => p.mr(3)))
      .child(button("tab-new", "+", () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 })))
      .when(Boolean(props()?.menu), el => el.child(menuButton()))
      .children(props()?.menu ? [] : buttons.map(b =>
        b.mod === "servers" ? panelButton(b.id, b.title, b.icon, terminals().filter(x => x.state === "live" && x.labels?.["herdr.server"]).length)
        : b.mod === "pond-profiles" ? panelButton(b.id, this.accountInfo?.label ?? (this.account ? this.account[0].toUpperCase() + this.account.slice(1) : b.title),
          b.icon, 0, this.account ? (this.accountInfo?.gateway ? t.ansi5 : t.ansi4) : null)
        : panelButton(b.id, b.title, b.icon)))
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/pond-tabs/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/pond-tabs/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/pond-tabs/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"))));
  }
}
