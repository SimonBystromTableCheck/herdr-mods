// Edit a space, as a popup at the pointer: its displayed name (space.rename; empty goes back to Herdr's
// name), a color from the theme and an icon (~/.config/herdr-app/pond-space-icons.json, shown in
// pond-sidebar's space rows). Enter in the name saves, Esc cancels.
// Icons: Symbols are Lucide (lucide-static 1.81.0, ISC, in ./lucide with index.json = [[name, tags]]),
// Apps are Herdr's program logos in ~/.config/herdr-app/icons. The search matches names and Lucide's tags.
// props: { space, name, icon, color, overlay }
import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, ScrollHandle } from "gpui-base";
import { run, props, closeOverlay, theme, appHome, spaces, shared, setShared, readTextFile, writeTextFile } from "herdr";
import * as fs from "fs/promises";

// Theme color names, not hex: a space keeps its hue's place in whatever theme is on.
const COLORS = [
  ["accent", "Accent"], ["ansi1", "Red"], ["ansi3", "Yellow"], ["ansi2", "Green"],
  ["ansi6", "Cyan"], ["ansi4", "Blue"], ["ansi5", "Magenta"],
];
const FOLDER = "mods/pond-sidebar/icons/folder.svg";
const LUCIDE = "mods/space-editor/lucide";
const SHOWN = 245; // cells drawn at once (35 rows of 7); the search narrows the rest
// Symbols shown first while the search is empty: common kinds of workspace, then the rest A to Z.
const FEATURED = ("folder-git-2 code terminal rocket star heart flask-conical beaker book-open briefcase chart-bar " +
  "chart-line cloud database globe house layers package palette server shield wrench zap bug git-branch " +
  "git-pull-request box cpu monitor smartphone layout-dashboard brain sparkles bot cog hammer leaf flame coffee " +
  "music camera gamepad-2 graduation-cap pen-tool file-text notebook-pen list-todo calendar mail message-square " +
  "users store shopping-cart credit-card wallet lock key compass map-pin plane anchor puzzle target trophy " +
  "lightbulb crown gem").split(" ");

// Same file and shared key as mods/pond-sidebar/space-icons.js (mods can't import each other).
const KEY = "pond-space-icons";
const stylesPath = () => `${appHome()}/pond-space-icons.json`;
async function saveStyle(id, icon, color) {
  const next = { ...(shared(KEY) ?? {}) };
  if (icon || color) next[id] = { ...(icon ? { icon } : {}), ...(color ? { color } : {}) }; else delete next[id];
  setShared(KEY, next);
  const current = await readTextFile(stylesPath()).catch(() => null);
  let rest = {};
  try { rest = JSON.parse(current ?? "{}") ?? {}; } catch {}
  await writeTextFile(stylesPath(), JSON.stringify({ ...rest, spaces: next }, null, 2) + "\n", current).catch(() => {});
}

/** Items matching the query, best first: name starts with it, then contains it, then a tag does. */
function search(items, query) {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  const words = q.split(/\s+/);
  const scored = [];
  for (const it of items) {
    const name = it.name, hay = `${name} ${it.tags}`;
    if (!words.every((w) => hay.includes(w))) continue;
    scored.push([name.startsWith(q) ? 0 : name.includes(q) ? 1 : words.every((w) => name.includes(w)) ? 2 : 3, it]);
  }
  return scored.sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name)).map((s) => s[1]);
}

export default class SpaceEditor extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.name = p.name ?? "";
    this.icon = p.icon ?? null;
    this.color = p.color ?? null;
    this.query = "";
    // Open on the set the chosen icon comes from.
    this.tab = this.icon?.startsWith("icons/") ? "apps" : "symbols";
    this.input = InputState.new({ value: this.name });
    this.input.set_selected_range({ start: 0, end: this.name.length });
    this.input.on("change", (_e, cx) => { this.name = this.input.value(); cx.notify(); });
    this.input.on("submit", () => this.submit());
    this.focusedField = "name";
    this.input.on("focus", (_e, cx) => { this.focusedField = "name"; cx.notify(); });
    this.input.on("blur", (_e, cx) => { if (this.focusedField === "name") this.focusedField = null; cx.notify(); });
    this.search = InputState.new({ value: "", placeholder: "Search icons" });
    this.search.on("change", (_e, cx) => { this.query = this.search.value(); this.grid.scroll_to_item(0); cx.notify(); });
    this.search.on("focus", (_e, cx) => { this.focusedField = "search"; cx.notify(); });
    this.search.on("blur", (_e, cx) => { if (this.focusedField === "search") this.focusedField = null; cx.notify(); });
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
    this.grid = ScrollHandle.new();
    this.apps = [];
    this.symbols = [];
    cx.spawn(async (cx) => {
      try {
        const files = await fs.readdir(`${appHome()}/icons`);
        this.apps = files.filter((f) => /\.(svg|png)$/i.test(f) && !/^LICENSE/i.test(f)).sort()
          .map((f) => ({ name: f.replace(/\.[^.]+$/, "").toLowerCase(), tags: "", path: `icons/${f}` }));
      } catch { this.apps = []; }
      try {
        const index = JSON.parse(await readTextFile(`${appHome()}/${LUCIDE}/index.json`));
        const all = index.map(([name, tags]) => ({ name, tags, path: `${LUCIDE}/${name}.svg` }));
        const rank = new Map(FEATURED.map((n, i) => [n, i]));
        this.symbols = [
          ...all.filter((it) => rank.has(it.name)).sort((a, b) => rank.get(a.name) - rank.get(b.name)),
          ...all.filter((it) => !rank.has(it.name)),
        ];
      } catch { this.symbols = []; }
      cx.notify();
    });
  }

  submit() {
    const p = props();
    const sp = spaces().find((s) => s.id === p.space);
    const name = this.name.trim();
    if (sp && name !== (sp.name ?? "")) run("space.rename", { id: p.space, name });
    if (this.icon !== (p.icon ?? null) || this.color !== (p.color ?? null)) saveStyle(p.space, this.icon, this.color);
    closeOverlay(p.overlay);
  }

  key(e, cx) {
    if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); }
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    const tint = this.color ? t[this.color] : null;
    const mix = (a, b, share) => {
      const rgb = (c) => /^#[0-9a-f]{6}/i.test(c ?? "") ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : null;
      const [x, y] = [rgb(a), rgb(b)];
      if (!x || !y) return b;
      return "#" + x.map((v, i) => Math.round(v * share + y[i] * (1 - share)).toString(16).padStart(2, "0")).join("");
    };
    const glyph = (path, size, color) => (path.endsWith(".svg")
      ? svg(path).size(size).flex_none().text_color(color)
      : image(path).w(size).h(size).flex_none());
    const label = (text) => div().pt(12).pb(6).text_size(11).text_color(t.dim).child(text);
    const field = (state, focused) => Input.new(state).h(30).flex_none().px(9).rounded(8).border_1()
      .border_color(focused ? t.accent : t.input).bg(t.background).text_size(12.5).text_color(t.foreground);
    const button = (id, text, primary, action) => h_flex().id(id).h(28).px(12).items_center().rounded(7)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12).font_medium().cursor_pointer()
      .hover((s) => s.opacity(0.88)).on_click(action).child(text);
    const swatch = (id, name, fill, selected, action) => div().id(id).size(24).flex_none().rounded_full().flex().items_center().justify_center()
      .border_2().border_color(selected ? t.foreground : "#00000000").cursor_pointer().tooltip(name)
      .on_click((_e, cx) => { action(); cx.notify(); })
      .child(div().size(16).rounded_full().bg(fill ?? "#00000000").when(!fill, (d) => d.border_1().border_color(t.input)));
    const cell = (id, path, name) => {
      const selected = (this.icon ?? FOLDER) === path;
      return div().id(id).size(32).flex_none().flex().items_center().justify_center().rounded(7)
        .border_1().border_color(selected ? (tint ?? t.accent) : "#00000000")
        .bg(selected ? (tint ? mix(tint, t.popover, 0.2) : t.selected) : t.popover)
        .cursor_pointer().hover((s) => s.bg(t.hover)).tooltip(name)
        .on_click((_e, cx) => { this.icon = path === FOLDER ? null : path; cx.notify(); })
        .child(glyph(path, 16, tint ?? t.foreground));
    };
    const found = { apps: search(this.apps, this.query), symbols: search(this.symbols, this.query) };
    const list = found[this.tab];
    const tabButton = (key, text) => h_flex().id(`tab-${key}`).h(22).px(8).gap(5).items_center().rounded(6).cursor_pointer()
      .text_size(11.5).font_medium()
      .bg(this.tab === key ? t.selected : "#00000000").text_color(this.tab === key ? t.foreground : t.dim)
      .hover((s) => s.text_color(t.foreground))
      .on_click((_e, cx) => { this.tab = key; this.grid.scroll_to_item(0); cx.notify(); })
      .child(text).child(div().text_size(10.5).text_color(t.dim).child(String(found[key].length)));
    const preview = div().size(26).flex_none().rounded(6).flex().items_center().justify_center()
      .bg(tint ? mix(tint, t.popover, 0.2) : t.raised)
      .child(glyph(this.icon ?? FOLDER, 15, tint ?? t.foreground));
    return v_flex().id("space-editor").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .size_full().p(14).bg(t.popover).text_color(t.foreground)
      .child(h_flex().gap(8).items_center().child(preview)
        .child(div().flex_1().min_w(0).truncate().text_size(13).font_semibold().child(this.name.trim() || "Edit space")))
      .child(label("Name"))
      .child(field(this.input, this.focusedField === "name"))
      .child(label("Color"))
      .child(h_flex().gap(4).items_center()
        .child(swatch("color-none", "Default", null, this.color === null, () => { this.color = null; }))
        .children(COLORS.map(([key, name]) => swatch(`color-${key}`, name, t[key], this.color === key, () => { this.color = key; }))))
      .child(h_flex().pt(12).pb(6).items_center()
        .child(div().flex_1().text_size(11).text_color(t.dim).child("Icon"))
        .child(h_flex().gap(2).child(tabButton("symbols", "Symbols")).child(tabButton("apps", "Apps"))))
      .child(field(this.search, this.focusedField === "search"))
      .child(div().h(10).flex_none())
      .child(div().id("icon-grid").h(180).flex_none().overflow_y_scrollbar().track_scroll(this.grid).child(
        h_flex().flex_wrap().gap(4).children([
          ...(this.query.trim() ? [] : [cell("icon-none", FOLDER, "Default folder")]),
          ...list.slice(0, SHOWN).map((it) => cell(`icon-${this.tab}-${it.name}`, it.path, it.name)),
        ]))
        .when(list.length === 0, (el) => el.child(div().pt(8).text_size(11.5).text_color(t.dim)
          .child(found[this.tab === "apps" ? "symbols" : "apps"].length ? `No ${this.tab}. Try ${this.tab === "apps" ? "Symbols" : "Apps"}.` : "No icons match."))))
      .when(list.length > SHOWN, (el) => el.child(div().pt(6).text_size(10.5).text_color(t.dim)
        .child(`Showing ${SHOWN} of ${list.length}. Type to narrow.`)))
      .child(div().flex_1())
      .child(h_flex().pt(10).gap(6).justify_end()
        .child(button("se-cancel", "Cancel", false, () => closeOverlay(p.overlay)))
        .child(button("se-save", "Save", true, () => this.submit())));
  }
}
