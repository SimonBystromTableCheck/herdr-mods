import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, ScrollHandle } from "gpui-base";
import { run, theme, layout, terminals, readTextFile, appHome, settings } from "herdr";
import { pins as pinned, load, save } from "./pins.js";
import { openPanel } from "./enter.js";

// Square shortcut cards for the panels pinned from pond-tabs' hamburger dropdown (shared "pond-pins":
// [panel-body child ids], in pin order; saved in ~/.config/herdr-app/pond-pins.json, see pins.js), in one carousel row: cards that don't fit scroll sideways in
// the rail, with arrows at the edges while more are hidden that way. pond-tabs shows/hides this block
// (anything pinned or not); this mod keeps it one row tall.
const CARD = 52, GAP = 6, PAD = 12, STEP = CARD + GAP;
const TOP = 8, BOTTOM = 8, HEIGHT = TOP + CARD + BOTTOM;
const BY_ID = {
  files: { title: "Files", icon: "mods/files/file.svg" },
  changes: { title: "Changes", icon: "mods/changes/changes.svg" },
};

function find(node, id) {
  if (node?.id === id) return node;
  for (const c of node?.children ?? []) { const f = find(c, id); if (f) return f; }
  return null;
}

// The block showing this mod.
function mine(node) {
  if (node?.content?.mod === "pond-pins") return node;
  for (const c of node?.children ?? []) { const f = mine(c); if (f) return f; }
  return null;
}

export default class Pins extends View {
  init(_props, cx) {
    this.meta = {}; // mod -> {title, icon, leader}
    this.drag = null; // pin id pressed, while held
    this.slot = null; // {id, after}: where the held card would land, beside that card
    this.rail = ScrollHandle.new();
    this.overArrow = 0; // -1/1: the pointer is on that edge arrow, so the card under it stays unhovered
    this.wheel = 0; // a mouse wheel's vertical travel not yet turned into a card step
    this.pinsFile = {};
    const pins = cx => cx.spawn(async () => load(this.pinsFile));
    pins(cx);
    cx.timer.every(3000, pins);
    this.scan(cx);
    this.refresh(cx); // the rail's size is known after the first layout
    cx.timer.every(15000, cx => this.scan(cx));
  }

  scan(cx) {
    cx.spawn(async cx => {
      const mods = [...new Set((find(layout(), "panel-body")?.children ?? []).map(c => c.content?.mod).filter(Boolean))];
      const meta = {};
      for (const m of mods) {
        try {
          const p = JSON.parse(await readTextFile(`${appHome()}/mods/${m}/mod.json`)).panel;
          if (p?.title) meta[m] = { title: p.title, icon: p.icon ? `mods/${m}/${p.icon}` : "mods/workspace-chrome/square.svg", leader: p.leader ?? null };
        } catch {}
      }
      if (JSON.stringify(meta) !== JSON.stringify(this.meta)) { this.meta = meta; cx.notify(); }
    });
  }

  // Arrows follow the rail's position, which is only known after layout: look again shortly.
  refresh(cx) { cx.timer.after(250, cx => cx.notify()); }

  // Which cards are fully in view, from the rail's last layout.
  view(n) {
    const x = this.rail.offset().x, w = this.rail.viewport_size().width;
    const first = Math.max(0, Math.ceil((x - PAD) / STEP - 0.01));
    const last = Math.min(n - 1, Math.floor((x + w - PAD + GAP) / STEP + 0.01) - 1);
    return { first, last, count: Math.max(1, last - first + 1) };
  }

  render() {
    const t = theme(), root = layout(), panel = find(root, "panel"), body = find(root, "panel-body");
    const children = body?.children ?? [];
    const pins = pinned().map(id => {
      const c = children.find(x => x.id === id), meta = c && (BY_ID[id] ?? this.meta[c.content?.mod]);
      return meta ? { id, mod: c.content?.mod, ...meta } : null;
    }).filter(Boolean);
    const live = terminals().filter(x => x.state === "live" && x.labels?.["herdr.server"]).length;
    const ids = pins.map(x => x.id);
    // The slot as an index in the list without the held card; null when it wouldn't move.
    const landing = () => {
      if (!this.drag || !this.slot) return null;
      const rest = ids.filter(id => id !== this.drag), at = rest.indexOf(this.slot.id);
      if (at < 0) return null;
      const to = at + (this.slot.after ? 1 : 0);
      return to === ids.indexOf(this.drag) ? null : to;
    };
    const drop = landing();
    const move = (from, to) => {
      const rest = ids.filter(id => id !== from);
      rest.splice(to, 0, from);
      const hidden = pinned().filter(id => !ids.includes(id)); // pins for panels this layout lacks
      save([...rest, ...hidden]);
    };
    const card = p => {
      const on = panel && !panel.hidden && body?.active === p.id;
      const dragging = this.drag === p.id && drop !== null;
      const line = drop !== null && this.slot.id === p.id ? (this.slot.after ? "right" : "left") : null;
      const badge = p.mod === "servers" ? live : 0;
      return v_flex().id(`pin-${p.id}`).relative().size(CARD).flex_none().items_center().justify_center().gap(4).rounded(8)
        // Same states as the Chat/Terminal toggle: a thin outline on every card, the open one
        // filled with bright text, the rest muted until hovered.
        .border(1).border_color(t.border).bg(on && !dragging ? t.selected : "#00000000")
        .text_color(dragging ? t.dim : on ? t.foreground : t.muted)
        .cursor_pointer()
        .when(!dragging && !this.overArrow, el => el.hover(s => s.bg(on ? t.selected : t.hover).text_color(t.foreground)))
        .on_mouse_down("left", (_e, cx) => { this.drag = p.id; cx.notify(); })
        .on_mouse_move((e, cx) => {
          if (!this.drag) return;
          const after = e.local_position.x >= CARD / 2;
          if (this.slot?.id !== p.id || this.slot.after !== after) { this.slot = { id: p.id, after }; cx.notify(); }
        })
        .on_click((_e, cx) => {
          if (this.overArrow) return;
          if (on) run("layout.hide", { id: "panel" });
          else openPanel(cx, p.id, p.mod);
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); save(pinned().filter(x => x !== p.id)); })
        .child(svg(p.icon).size(18))
        .child(div().max_w(CARD - 6).truncate().text_size(10).child(p.title))
        .when(badge > 0, el => el.child(div().absolute().top(3).right(3).h(14).px(4).flex().items_center() // the sidebar's badge tile
          .rounded(3).bg(t.ansi2).text_color(t.background).text_size(9.5).child(String(badge))))
        .when(Boolean(p.leader), el => el.child(div().absolute().top(3).left(5).text_size(9).text_color(t.dim).child(p.leader)))
        // The insertion mark: a dashed line centred in the gap beside this card.
        .when(Boolean(line), el => el.child(div().absolute().top(2).bottom(2).w(0).border_l(2).border_dashed().border_color(t.accent)
          .when(line === "left", d => d.left(-(GAP / 2) - 1)).when(line === "right", d => d.right(-(GAP / 2) - 1))));
    };
    // This copy's block (whatever id the dock gave it) is kept one carousel row tall.
    const block = mine(root);
    if (block && block.size?.px !== HEIGHT && !this.sized) { this.sized = true; run("layout.resize", { id: block.id, px: HEIGHT }); }
    // The rail's width: end spacers plus cards.
    const x = this.rail.offset().x, w = this.rail.viewport_size().width;
    const total = 2 * PAD + pins.length * STEP - GAP;
    const more = { left: x > 1, right: w > 0 && x + w < total - 1 };
    // Reveals card i; the first and last go to the end spacers instead, so the rail's padding shows too.
    const reveal = i => this.rail.scroll_to_item(i <= 0 ? 0 : i >= pins.length - 1 ? pins.length + 1 : i + 1);
    if ((this.overArrow < 0 && !more.left) || (this.overArrow > 0 && !more.right)) this.overArrow = 0; // gone from under the pointer
    // Pages: forward reveals the card a page past the last whole one (it lands at the right edge),
    // back reveals the card a page before the first (it lands at the left edge).
    const page = (dir, cx) => {
      const v = this.view(pins.length);
      reveal(dir > 0 ? v.last + v.count : v.first - v.count);
      this.refresh(cx);
    };
    const arrow = dir => div().id(`rail-${dir > 0 ? "next" : "prev"}`).absolute().top(TOP + CARD / 2 - 11).size(22)
      .when(dir < 0, el => el.left(4)).when(dir > 0, el => el.right(4))
      .flex().items_center().justify_center().rounded_full().border(1).border_color(this.overArrow === dir ? t.input : t.border).bg(t.surface)
      .text_color(this.overArrow === dir ? t.foreground : t.muted).cursor_pointer()
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); page(dir, cx); })
      .child(div().size_full().rounded_full().flex().items_center().justify_center().bg(this.overArrow === dir ? t.hover : t.raised)
        .child(svg(`mods/workspace-chrome/chevron-${dir > 0 ? "right" : "left"}.svg`).size(12)));
    // Which arrow the pointer is on, from its position here: an arrow's own hover doesn't stop the
    // card under it from showing hovered too, so the cards check this instead.
    const ARROW_Y = TOP + CARD / 2 - 11;
    const track = (e, cx) => {
      const p = e.local_position, wd = e.bounds?.width, z = settings().zoom || 1;
      let v = 0;
      if (p && wd) {
        const px = p.x / z, py = p.y / z, width = wd / z, inY = py >= ARROW_Y && py <= ARROW_Y + 22;
        if (inY && more.left && px >= 4 && px <= 26) v = -1;
        else if (inY && more.right && px >= width - 26 && px <= width - 4) v = 1;
      }
      if (v !== this.overArrow) { this.overArrow = v; cx.notify(); }
    };
    return div().id("pins").size_full().relative()
      .on_mouse_move(track)
      .on_hover((h, cx) => { if (!h && this.overArrow) { this.overArrow = 0; cx.notify(); } })
      // Released anywhere (on a card or in the gap on the line): drops where the line shows.
      .on_window_mouse_up("left", (_e, cx) => { if (this.drag) { const to = landing(); if (to !== null) move(this.drag, to); this.drag = null; this.slot = null; cx.notify(); } })
      .on_window_mouse_move((e, cx) => { if (this.drag && e.pressed_button !== "left") { this.drag = null; this.slot = null; cx.notify(); } })
      .child(
        h_flex().id("pin-rail").size_full().overflow_x_scroll().track_scroll(this.rail).gap(GAP).pt(TOP).pb(BOTTOM).items_start()
          // The rail drops its slot when dragged out of, so letting go outside cancels.
          .on_hover((h, cx) => { if (!h && this.slot) { this.slot = null; cx.notify(); } })
          .on_scroll_wheel((e, cx) => {
            // A trackpad scrolls the rail itself; a plain mouse wheel (vertical) steps a card at a time.
            if (Math.abs(e.delta.y) > Math.abs(e.delta.x)) {
              this.wheel += e.delta.y;
              if (Math.abs(this.wheel) >= 30) {
                const v = this.view(pins.length), dir = this.wheel < 0 ? 1 : -1;
                this.wheel = 0;
                reveal(dir > 0 ? v.last + 1 : v.first - 1);
              }
            }
            this.refresh(cx);
          })
          .on_size_change((_s, cx) => this.refresh(cx))
          // Spacers instead of side padding: scrolling to one shows the padding (to a card, it wouldn't).
          .child(div().w(PAD - GAP).h(CARD).flex_none())
          .children(pins.map(card))
          .child(div().w(PAD - GAP).h(CARD).flex_none()))
      .when(more.left, el => el.child(arrow(-1)))
      .when(more.right, el => el.child(arrow(1)));
  }
}
