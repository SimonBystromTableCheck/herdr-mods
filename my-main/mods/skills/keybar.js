// Keycap footer and "all keys" card, styled like gitview's (the Changes panel).
// Each mod has its own copy: mods can't import each other's code.
//
//   chips: [{ caps: ["j", "k"], label: "move" }, ...] in order of usefulness;
//   the footer shows as many as fit, with a ? keycap at the right for the card.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";

const SYMBOL = {
  enter: "⏎", escape: "esc", tab: "⇥", up: "↑", down: "↓", left: "←", right: "→",
  space: "␣", pageup: "PgUp", pagedown: "PgDn", home: "Home", end: "End", backspace: "⌫",
  "ctrl-d": "^D", "ctrl-u": "^U", "ctrl-r": "^R",
};
const capText = (k) => SYMBOL[k] ?? k;
const MONO = "JetBrains Mono";
// Letters in the mono font; the symbols (⏎ ↑ ←) read better in the UI's.
const symbolic = (k) => k.length > 1 && capText(k).length === 1;

export function keycap(t, k, { size = 10.5 } = {}) {
  return div().flex_none().min_w(16).h(16).px(4).flex().items_center().justify_center()
    .rounded(4).border_1().border_color(t.border).bg(t.raised)
    .when(!symbolic(k), (e) => e.font_family(MONO))
    .text_size(symbolic(k) ? size + 1 : size).text_color(t.foreground)
    .child(capText(k));
}

function chip(t, c) {
  return h_flex().flex_none().gap(4).items_center()
    .child(h_flex().flex_none().gap(2).children(c.caps.map((k) => keycap(t, k))))
    .child(div().flex_none().text_size(11).text_color(t.dim).child(c.label));
}

// About how wide a chip draws (mono ~6.4 px, labels ~6 px a character).
const chipWidth = (c) => c.caps.reduce((w, k) => w + Math.max(16, capText(k).length * 6.4 + 10) + 2, 0) + 4 + c.label.length * 6;

// The footer: `flash` for a moment, else the chips that fit `width`, and ?.
export function keybar(t, { id, chips = [], flash = null, width = 0, onKeys }) {
  let room = (width || 300) - 28 - 30;
  const shown = [];
  for (const c of chips) {
    const w = chipWidth(c) + 12;
    if (w > room) break;
    room -= w;
    shown.push(c);
  }
  return h_flex().h(28).flex_none().px(14).gap(12).items_center().border_t(1).border_color(t.border).text_size(11)
    .child(flash
      ? div().flex_1().min_w(0).truncate().text_color(t.accent).child(flash)
      : h_flex().flex_1().min_w(0).gap(12).overflow_hidden().children(shown.map((c) => chip(t, c))))
    .when(Boolean(onKeys), (el) => el.child(div().id(`${id}-keys`).flex_none().cursor_pointer().rounded(4)
      .hover((s) => s.bg(t.hover)).tooltip("All keys (?)")
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); onKeys(cx); })
      .child(keycap(t, "?"))));
}

// Every key, in groups, over the panel. Esc, ? or a click closes it.
export function keysCard(t, { id, title, groups, onClose }) {
  return div().id(`${id}-card-scrim`).absolute().inset_0().bg("#00000055").flex().items_center().justify_center().p(12)
    .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); onClose(cx); })
    .child(v_flex().id(`${id}-card`).w_full().max_w(360).max_h_full().overflow_y_scrollbar().p(12).gap(10)
      .rounded(10).border_1().border_color(t.border).bg(t.popover).shadow_lg()
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(h_flex().items_center().child(div().flex_1().font_semibold().text_size(12.5).child(title)).child(keycap(t, "escape")))
      .children(groups.filter((g) => g.chips.length).map((g) => v_flex().gap(5)
        .child(div().text_size(10.5).font_medium().text_color(t.dim).child(g.title))
        .children(g.chips.map((c) => h_flex().gap(8).items_center()
          .child(h_flex().w(72).flex_none().gap(2).children(c.caps.map((k) => keycap(t, k))))
          .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.foreground).child(c.label)))))));
}
