import { div, svg } from "gpui-kit";
import { v_flex, h_flex, VirtualListScrollHandle, v_virtual_list, InputState, Input } from "gpui-base";
import { ICONS } from "../common.js";
import { COLUMN } from "../ui/primitives.js";
import { designPx, designHeight } from "../measure.js";

const FADE = 32;
const TAIL = FADE;
const MEASURE_AT_ONCE = 12;

/**
 * A fade as tall as FADE from clear to the page's `color`, towards the bottom edge (`down`) or the top one: a step per
 * pixel, so it reads as smooth over the backdrop (herdr's `bg` takes flat colors only, no gradient).
 */
function fade(color, down) {
  const STEPS = FADE;
  return v_flex().absolute().left(0).right(0).h(FADE).when(down, el => el.bottom(0)).when(!down, el => el.top(0))
    .children(Array.from({ length: STEPS }, (_, i) => div().w_full().flex_1().bg(color).opacity(down ? (i + 1) / STEPS : (STEPS - i) / STEPS)));
}
const TURN_GAP = 32;
/** Room kept right of a narrow column for the navigator: its 34 px plus a gap (main.js decides when). */
export const NAV_LANE = 40;

/** One of the person's own messages (a bubble). */
const mine = m => m?.kind === "message" && m.role === "user";

/** What a row says, for searching: a message's text, a command group's commands and files. */
function rowText(m) {
  if (m.text) return m.text;
  if (m.calls) return m.calls.map(c => `${c.d ?? ""} ${c.k === "think" ? c.o ?? "" : ""}`).join("\n");
  if (m.call) return `${m.call.d ?? ""}\n${m.call.o ?? ""}`;
  return "";
}
const gapBefore = m => m.turnGap ? TURN_GAP : m.kind === "copy" || m.kind === "diagram-tools" ? 4 : m.kind === "step" ? 0 : 10;

export class ChatList {
  /** The conversation's scrolling list: row heights, measuring, and staying at the newest message. */
  constructor() {
    this.scroll = VirtualListScrollHandle.new();
    this.following = true; this.visibleStart = 0; this.visibleEnd = 0; this.rowCount = 0; this.above = false;
    this.needsScroll = true; this.scrollAskedAt = Date.now(); this.lastAsk = Date.now(); this.laidOut = 0;
    this.pendingCount = -1; this.settling = true; this.isEmpty = true; this.settleAt = 0;
    this.heights = {}; this.changedAt = {}; this.lastHeight = {}; this.measuredAt = "";
    this.listH = 0; this.sig = ""; this.settledSig = "";
    this.searching = false; this.query = ""; this.hit = -1; this.hits = []; this.rows = [];
  }

  /** Scrolls row `i` into view and stops following the newest message. */
  show(i, cx, strategy = "top") {
    this.following = false; this.needsScroll = false;
    this.scroll.scroll_to_item(i, strategy);
    cx.notify();
  }

  /** To the previous (dir -1) or next (+1) of the person's own messages, from the top of what's on screen. */
  jumpMine(dir, cx) {
    const at = this.visibleStart, rows = this.rows;
    let i = at + dir;
    // The top row is usually cut off: "previous" from a bubble partly shown should still go to the one above it.
    while (i >= 0 && i < rows.length && !mine(rows[i])) i += dir;
    if (i >= 0 && i < rows.length) this.show(i, cx);
    else if (dir > 0) { this.follow(); cx.notify(); }
  }

  /** Opens the search bar (Cmd-F, or the magnifier), with what was searched last selected. */
  openSearch(cx) {
    this.searchInput ??= InputState.new({ placeholder: "Search this chat" });
    if (!this.searchWired) {
      this.searchWired = true;
      this.searchInput.on("change", (_e, cx) => { this.query = this.searchInput.value(); this.findHits(); this.hit = -1; this.step(-1, cx); });
      this.searchInput.on("submit", (_e, cx) => this.step(-1, cx));
    }
    this.searching = true;
    this.searchInput.focus();
    cx.notify();
  }

  closeSearch(cx) {
    this.searching = false; this.hits = []; this.hit = -1;
    this.searchInput?.blur();
    cx.notify();
  }

  findHits() {
    const q = this.query.trim().toLowerCase();
    this.hits = q ? this.rows.map((m, i) => (rowText(m).toLowerCase().includes(q) ? i : -1)).filter(i => i >= 0) : [];
  }

  /** The next match up (-1, newest first, as Enter does) or down (+1, Shift-Enter). */
  step(dir, cx) {
    if (!this.hits.length) { cx.notify(); return; }
    this.hit = this.hit < 0 ? this.hits.length - 1 : (this.hit + dir + this.hits.length) % this.hits.length;
    this.show(this.hits[this.hit], cx, "center");
  }

  /** The search bar over the top of the list: the query, "3 of 7", up, down and close. */
  searchBar(t) {
    const btn = (id, glyph, tip, go) => div().id(id).size(24).flex().items_center().justify_center().rounded(6).cursor_pointer()
      .hover(s => s.bg(t.hover)).tooltip(tip).on_click((_e, cx) => go(cx)).child(svg(`${ICONS}/${glyph}.svg`).size(13).text_color(t.muted));
    const count = !this.query.trim() ? "" : this.hits.length ? `${this.hit + 1 || this.hits.length} of ${this.hits.length}` : "No matches";
    return h_flex().absolute().top(8).left(0).right(0).justify_center().px(24).child(
      h_flex().id("chat-search").w_full().max_w(420).h(36).pl(10).pr(4).gap(6).items_center().rounded(10)
        .bg(t.popover ?? t.surface).border_1().border_color(t.border).shadow_md()
        .on_key_down((e, cx) => {
          if (e.key === "escape") { cx.stop_propagation(); this.closeSearch(cx); }
          else if (e.key === "enter" && e.modifiers.shift) { cx.stop_propagation(); this.step(1, cx); }
        })
        .child(svg(`${ICONS}/search.svg`).size(13).text_color(t.dim))
        .child(div().flex_1().min_w(0).text_size(13).child(Input.new(this.searchInput)))
        .child(div().flex_none().text_size(11.5).text_color(t.dim).child(count))
        .child(btn("search-up", "chevron-up", "Earlier match (Enter)", cx => this.step(-1, cx)))
        .child(btn("search-down", "chevron-down", "Later match (Shift-Enter)", cx => this.step(1, cx)))
        .child(btn("search-close", "x", "Close (Esc)", cx => this.closeSearch(cx))));
  }

  /**
   * The buttons at the list's bottom right, out of the text's way: the previous and next of the person's own messages,
   * search, and back to the newest message (only while scrolled up).
   */
  navigator(t, canJump) {
    const btn = (id, glyph, tip, go) => div().id(id).size(28).flex().items_center().justify_center().rounded(14).cursor_pointer()
      .text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground)).tooltip(tip)
      .on_click((_e, cx) => go(cx)).child(svg(`${ICONS}/${glyph}.svg`).size(14));
    const anyMine = this.rows.some(mine), down = !this.following && !this.needsScroll && canJump;
    return h_flex().absolute().bottom(10).right(14).child(
      v_flex().p(3).gap(2).rounded(17).bg(t.popover ?? t.surface).border_1().border_color(t.border).shadow_md()
        .when(anyMine, el => el.child(btn("mine-prev", "chevron-up", "Your previous message", cx => this.jumpMine(-1, cx)))
          .child(btn("mine-next", "chevron-down", "Your next message", cx => this.jumpMine(1, cx))))
        .child(btn("chat-search-open", "search", "Search this chat (⌘F)", cx => this.openSearch(cx)))
        .when(down, el => el.child(div().id("jump-bottom").size(28).flex().items_center().justify_center().rounded(14).cursor_pointer()
          .bg(t.foreground).text_color(t.background).hover(s => s.opacity(0.85)).tooltip("Back to the newest message")
          .on_click((_e, cx) => { this.follow(); cx.notify(); })
          .child(svg(`${ICONS}/arrow-down.svg`).size(14)))));
  }

  /** Keeps the chat at its newest message. */
  follow(restart = false) {
    this.following = true;
    this.lastAsk = Date.now();
    if (!this.needsScroll || restart) { this.needsScroll = true; this.scrollAskedAt = Date.now(); }
  }

  /** Another conversation is shown: hidden until its newest messages are measured and in view. */
  reset() {
    this.needsScroll = false; this.settling = true; this.pendingCount = -1;
    this.follow();
  }

  /** Back to Chat from elsewhere: to the newest message, hidden until it lands if anything changed. */
  revisit() {
    if (this.sig !== this.settledSig) this.settling = true;
    this.follow(true);
  }

  /**
   * The scrolling part of the view's timer: lands a pending scroll, then keeps `following` (at the newest message) and
   * `above` (messages out of sight above) true to what's on screen.
   */
  tick(cx) {
    if (this.following && this.needsScroll) {
      const drawn = this.laidOut >= this.lastAsk;
      // The timeout must not need `drawn`: a list that never reports a layout would stay hidden for good.
      if ((drawn && this.pendingCount === 0) || Date.now() - this.scrollAskedAt > 1500) {
        this.needsScroll = false;
        this.settledSig = this.sig;
        if (!this.isEmpty) this.settling = false;
        this.scroll.scroll_to_bottom();
      }
      cx.notify();
      return;
    }
    if (this.settling) { if (!this.isEmpty) this.follow(); return; }
    const atBottom = this.isEmpty || this.rowCount === 0 || this.visibleEnd >= this.rowCount;
    const above = !this.isEmpty && this.visibleStart > 0;
    if (atBottom !== this.following || above !== this.above) { this.following = atBottom; this.above = above; cx.notify(); }
  }

  /** The list's body and its off-screen measurer (null when nothing needs measuring). */
  render(cx, { rows, empty, t, inner, gutter = 0, zoom, heightKey, waitsFor, row, onItemClick, canJump, beforeScroll }) {
    this.isEmpty = empty;
    if (rows !== this.rows) { this.rows = rows; if (this.searching) this.findHits(); }
    // Never leave the conversation hidden: settling normally ends in about a second, but a measure or a scroll that
    // never reports must not leave the body invisible for good.
    if (this.settling) {
      this.settleAt ||= Date.now();
      if (Date.now() - this.settleAt > 2500) {
        this.settling = false; this.needsScroll = false; this.settledSig = this.sig;
        this.scroll.scroll_to_bottom();
      }
    } else this.settleAt = 0;
    const measuredAt = `${inner}@${window.rem_size()}`;
    if (measuredAt !== this.measuredAt) { this.heights = {}; this.changedAt = {}; this.lastHeight = {}; this.measuredAt = measuredAt; }
    const unmeasured = rows.filter(m => !(heightKey(m) in this.heights)).slice(-MEASURE_AT_ONCE);
    const now = Date.now();
    const settling = rows.filter(m => { const k = heightKey(m); return k in this.heights && now - (this.changedAt[k] ?? 0) < 2000; });
    const pending = [...settling, ...unmeasured];
    const sizes = rows.map(m => (this.heights[heightKey(m)] ?? this.lastHeight[m.key] ?? 40) + gapBefore(m));
    let bottom = rows.length;
    for (let h = 0; bottom > 0 && h < (this.listH || 900) + 240; ) h += sizes[--bottom];
    const near = rows.slice(bottom);
    this.pendingCount = near.filter(m => !(heightKey(m) in this.heights)).length + near.filter(waitsFor).length;
    this.sig = `${rows.length}:${sizes.reduce((a, b) => a + b, 0)}`;
    beforeScroll?.();
    if (this.needsScroll && this.following && this.pendingCount === 0 && rows.length) {
      this.scroll.scroll_to_bottom();
      this.needsScroll = false; this.settledSig = this.sig;
      if (this.settling) {
        const token = this.revealToken = (this.revealToken ?? 0) + 1;
        const reveal = (cx, tries) => cx.timer.after(20, cx => {
          if (this.revealToken !== token) return;
          if (this.visibleEnd < this.rowCount && tries < 10) { this.scroll.scroll_to_bottom(); cx.notify(); reveal(cx, tries + 1); return; }
          this.settling = false; cx.notify();
        });
        try { reveal(cx, 0); } catch { this.settling = false; }
      }
    }
    this.rowCount = rows.length + 1;
    const body = v_flex().relative().flex_1().min_h(0).when(this.settling, el => el.opacity(0))
      .on_size_change(size => { this.listH = designPx(size.height, zoom); })
      .on_mouse_move(e => { this.pointerX = designPx(e.local_position.x, zoom); })
      .child(v_virtual_list("herdr-chat-messages", rows.length + 1, [...sizes, TAIL], i => i < rows.length ? rows[i].key : "end-of-chat", range => {
        this.visibleStart = range.start; this.visibleEnd = range.end;
        this.laidOut = Date.now();
        const out = [];
        for (let i = range.start; i < range.end; i++)
          out.push(i < rows.length
            ? h_flex().w_full().justify_center().pl(24).pr(24 + gutter).pt(gapBefore(rows[i])).child(div().w_full().max_w(COLUMN).child(row(rows[i])))
            : div().w_full().h(TAIL));
        return out;
      }).track_scroll(this.scroll).on_item_click(onItemClick).size_full())
      .when(this.above, el => el.child(fade(t.background, false)))
      .child(fade(t.background, true))
      .when(!empty && (this.above || !this.following || this.searching), el => el.child(this.navigator(t, canJump)))
      .when(this.searching, el => el.child(this.searchBar(t)));
    const measure = pending.length === 0 ? null : v_flex().id("herdr-chat-measure").absolute().top(0).left(-20000).w(inner)
      .children(pending.map(m => {
        const k = heightKey(m);
        return div().id(`measure-${k}`).w(inner).flex_none()
          .on_size_change((size, cx) => {
            const height = designHeight(size, inner);
            if (Math.abs((this.heights[k] ?? -1) - height) > 0.5) {
              this.heights[k] = height; this.lastHeight[m.key] = height; this.changedAt[k] = Date.now();
              if (this.following) this.follow();
              cx.notify();
              cx.timer.after(2100, cx => cx.notify());
            }
          })
          .child(row(m));
      }));
    return { body, measure };
  }
}
