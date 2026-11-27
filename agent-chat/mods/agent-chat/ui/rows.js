import { div, image } from "gpui-kit";
import { v_flex, h_flex, TextView } from "gpui-base";
import { COLUMN, icon, mono, disclosure, bubble } from "./primitives.js";
import { tokens } from "../model/runs-with.js";
import { SENT_DIR, previewFile } from "../images.js";
import { KINDS, STEP, summary, stepText } from "../model/transcript.js";
import { diagramFor } from "../diagrams.js";

/**
 * A code block in a box titled with its language; with `copied` set (true once copied), a copy icon sits at the top
 * right.
 */
function codeBox(id, lang, source, t, copied) {
  const lines = source.replace(/\n$/, "").split("\n");
  return v_flex().id(id).w_full().rounded(10).border_1().border_color(t.border).bg(t.surface).overflow_hidden()
    .child(h_flex().h(30).px(12).gap(6).items_center().border_b(1).border_color(t.border)
      .child(div().flex_1().text_size(11.5).text_color(t.muted).child(lang || "text"))
      .when(copied === true, el => el.child(div().text_size(11.5).text_color(t.muted).child("Copied")))
      .when(copied !== undefined, el => el.child(icon(copied ? "check" : "copy", 14, t.muted))))
    .child(v_flex().px(12).py(8).font_family(mono()).text_size(12.5).text_color(t.foreground)
      .children(lines.map((l, k) => div().id(`${id}-l${k}`).w_full().min_h(18).child(l.replace(/\t/g, "    ") || " "))));
}

/** A fenced code block of a reply as a row of its own: clicking it copies the code (see onItemClick in main.js). */
function codeRow(m, { t, copied }) {
  return codeBox(`code-${m.key}`, m.lang, m.text, t, copied === m.key);
}

/**
 * A small icon button under the conversation (a diagram's, bordered; a message's copy, bare and smaller): the icon a
 * check once it's done.
 */
function toolButton(t, id, glyph, done, busy, tip, bordered = true, size = 28) {
  return div().id(id).w(size === 28 ? TOOL_BUTTON : size).h(size).flex_none().flex().items_center().justify_center().rounded(size === 28 ? 8 : 6)
    .when(bordered, el => el.border_1().border_color(t.border)).hover(s => s.bg(t.raised)).tooltip(busy ? "Copying…" : done ? "Copied" : tip)
    .child(icon(done ? "check" : glyph, size === 28 ? 14 : 13, done || busy ? t.foreground : t.muted));
}

/**
 * The copy button under an agent's response, at the left, or under one of the person's messages, at the right
 * (`prompt`): clicking the row copies it (see onItemClick in main.js). Always shown: a list row can't react to hovering
 * the message above it (no per-row hover in the list yet), so a hover-only bar would only show over its own strip. A
 * response's turn numbers (m.stats) follow its button, each with its icon: time, output tokens, tokens per second. A
 * caption of its message (24 px, right under it: see gapBefore in chat-list.js), not a row of its own.
 *
 * At a response's left end, after its copy button, "Send to Notes": clicking it saves the response as a note in its
 * space's notes folder (main.js's sendToNotes; the list reports the row, so the button is found by its x). The person's
 * own messages don't get one. The button hugs its icon and label (the chips' 6 px, as the copy button's own padding):
 * its width is fixed rather than measured, since a size observer inside a list row breaks the list's layout.
 */
export const NOTES_BUTTON = 112, NOTES_GAP = 8;

function copyRow(m, { t, copied, notesSent }) {
  const done = copied === m.key, saved = notesSent === m.key, s = m.stats;
  const stat = (glyph, text, tip) => h_flex().id(`st-${glyph}-${m.key}`).gap(5).items_center().tooltip(tip)
    .child(icon(glyph, 12, t.dim)).child(div().text_size(11.5).text_color(t.dim).child(text));
  const send = h_flex().id(`notes-${m.key}`).w(NOTES_BUTTON).h(24).flex_none().gap(5).items_center().justify_center().rounded(6)
    .cursor_pointer().hover(el => el.bg(t.hover))
    .tooltip(saved ? "Saved in the branch's note in your vault" : "Save this message to the branch's note in your vault")
    .child(icon(saved ? "check" : "notes", 12, saved ? t.foreground : t.muted))
    .child(div().truncate().text_size(11.5).text_color(saved ? t.foreground : t.muted).child(saved ? "Sent" : "Send to Notes"));
  const copy = toolButton(t, `copy-${m.key}`, "copy", done, false, m.prompt ? "Copy your message" : "Copy the response", false, 24);
  if (m.prompt) return h_flex().id(`copy-row-${m.key}`).w_full().h(24).gap(12).items_center().justify_end().child(copy);
  // NOTES_GAP between the copy button and the chip, and the chip and the turn numbers (which keep 12 among themselves).
  return h_flex().id(`copy-row-${m.key}`).w_full().h(24).gap(NOTES_GAP).items_center().justify_start()
    .child(copy)
    .child(send)
    .when(Boolean(s), el => el.child(h_flex().gap(12).items_center()
      .child(div().text_size(11.5).text_color(t.dim).child("•"))
      .when(s?.secs != null, e => e.child(stat("clock", duration(s.secs), "How long the turn took")))
      .when(Boolean(s?.out), e => e.child(stat("coins", `${tokens(s?.out ?? 0)} tokens`, "Tokens the agent wrote this turn (thinking included)")))
      .when(s?.tps != null, e => e.child(stat("circle-gauge", `${Math.round(s.tps)}tk/s`, "Tokens per second while the agent was writing (tool time left out)")))));
}

/** "8s", "42s", "3m 05s", "1h 02m". */
export function duration(secs) {
  const n = Math.round(secs);
  if (n < 60) return `${n}s`;
  if (n < 3600) return `${Math.floor(n / 60)}m ${String(n % 60).padStart(2, "0")}s`;
  return `${Math.floor(n / 3600)}h ${String(Math.floor(n % 3600 / 60)).padStart(2, "0")}m`;
}

/** Markdown with each fenced code block in a titled box of its own, and each table drawn as a clean grid. */
function markdown(id, source, t) {
  const lines = source.split("\n");
  const blocks = [];
  let buf = [];
  const flush = () => {
    const text = buf.join("\n").trim();
    buf = [];
    if (text) blocks.push(TextView.markdown(`${id}-t${blocks.length}`, text).raw_html(false).selectable(true));
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line)) {
      flush();
      const lang = line.slice(3).trim();
      const code = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) code.push(lines[i]);
      blocks.push(codeBox(`${id}-c${blocks.length}`, lang, code.join("\n"), t));
    } else if (isTableStart(lines, i)) {
      flush();
      const rows = [lines[i], lines[i + 1]];
      for (i += 2; i < lines.length && lines[i].includes("|") && lines[i].trim(); i++) rows.push(lines[i]);
      i--;
      blocks.push(tableBox(`${id}-b${blocks.length}`, rows, t));
    } else {
      buf.push(line);
    }
  }
  flush();
  if (blocks.length === 1) return blocks[0];
  return v_flex().w_full().gap(12).children(blocks);
}

// A table's cells on one line, without the outer pipes.
const tableCells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((s) => s.trim());
// "| --- | :-- |" under a header row.
const isTableSep = (line) => line.includes("-") && tableCells(line).every((c) => /^:?-+:?$/.test(c));
const isTableStart = (lines, i) => lines[i].includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1]);

/** A short signature of a cell's text: the cell's TextView is keyed by its id, so a changed cell needs a new id. */
function cellKey(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return `${text.length}-${h}`;
}

/**
 * A Markdown table as a grid of its own: a muted header row on the raised color, then one row per line with a hairline
 * between them, all in a rounded box. A column's share of the width follows its longest cell, and its alignment
 * markers (`:--`, `:-:`, `--:`) carry into its cells.
 */
function tableBox(id, lines, t) {
  const head = tableCells(lines[0]);
  const align = tableCells(lines[1]).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : "left"));
  const body = lines.slice(2).map(tableCells).filter((cells) => cells.some(Boolean));
  const cols = Math.max(head.length, ...body.map((cells) => cells.length));
  const weight = (c) => {
    let w = 3;
    for (const cells of [head, ...body]) w = Math.max(w, Math.min(40, String(cells[c] ?? "").length));
    return w;
  };
  const weights = Array.from({ length: cols }, (_, c) => weight(c));
  const cell = (text, key, c, header) => {
    const a = align[c] ?? "left";
    return div()
      .id(`${id}-${key}`)
      .flex_basis(0)
      .flex_grow(weights[c])
      .flex_shrink(1)
      .min_w(36)
      .px(10)
      .py(7)
      .when(a === "right", (el) => el.text_right())
      .when(a === "center", (el) => el.text_center())
      .child(
        TextView.markdown(`${id}-${key}-${cellKey(text)}`, text || " ").raw_html(false)
          .selectable(true)
          .text_size(header ? 11.5 : 12.5)
          .text_color(header ? t.muted : t.foreground),
      );
  };
  const row = (cells, r, last) =>
    h_flex()
      .id(`${id}-r${r}`)
      .w_full()
      .items_stretch()
      .when(r % 2 === 1, (el) => el.bg(t.background))
      .when(!last, (el) => el.border_b(1).border_color(t.border))
      .children(Array.from({ length: cols }, (_, c) => cell(cells[c] ?? "", `${r}-${c}`, c, false)));
  return v_flex()
    .id(id)
    .w_full()
    .rounded(10)
    .border_1()
    .border_color(t.border)
    .bg(t.surface)
    .overflow_hidden()
    // The header's top corners follow the box's radius: a raised band squared off at the top shows outside it.
    .child(h_flex().id(`${id}-head`).w_full().items_stretch().rounded_t(10).bg(t.raised).border_b(1).border_color(t.border).children(Array.from({ length: cols }, (_, c) => cell(head[c] ?? "", `h-${c}`, c, true))))
    .children(body.map((cells, r) => row(cells, r, r === body.length - 1)));
}

/** A group's title line; opened, its steps follow as rows of their own (stepRows). */
function toolsRow(m, { t, open }) {
  const kinds = [...new Set(m.calls.map(c => c.k).filter(k => k !== "think"))];
  const glyph = !kinds.length ? "brain" : kinds.length === 1 ? (KINDS[kinds[0]] ?? KINDS.other).icon : "layers";
  // items_start: a v_flex centres its children across its width, which would put the group's title in the middle.
  return v_flex().w_full().items_start().child(disclosure(t, glyph, summary(m.calls), Boolean(open[m.key])));
}

const DIFF_CAP = 200; // lines of an edit a card draws before saying how many are left
const hex2 = n => (n < 16 ? "0" : "") + n.toString(16);
/** A theme color at `a` of its alpha (a color that has one already keeps it, scaled). */
const alpha = (color, a) => (typeof color === "string" && /^#[0-9a-fA-F]{6}/.test(color)
  ? color.slice(0, 7) + hex2(Math.round(Math.max(0, Math.min(1, a)) * 255))
  : color);

const splitLines = s => {
  const v = String(s ?? "").replace(/\r/g, "").replace(/\n$/, "");
  return v === "" ? [] : v.split("\n");
};

/**
 * An edit's text as a diff: each hunk's old lines removed and its new ones added, with their common head and tail (up to
 * three lines each) as context. `added` and `removed` count what changed, for the card's header.
 */
function editDiff(c) {
  const hunks = Array.isArray(c.diff) ? c.diff : typeof c.new === "string" ? [{ a: "", b: c.new }] : [];
  const lines = [];
  for (const h of hunks) {
    const a = splitLines(h?.a), b = splitLines(h?.b);
    if (a.join("\n") === b.join("\n")) continue;
    let head = 0;
    while (head < a.length && head < b.length && a[head] === b[head]) head++;
    let tail = 0;
    while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
    for (const text of a.slice(Math.max(0, head - 3), head)) lines.push({ k: "ctx", text });
    for (const text of a.slice(head, a.length - tail)) lines.push({ k: "del", text });
    for (const text of b.slice(head, b.length - tail)) lines.push({ k: "add", text });
    for (const text of a.slice(a.length - tail, a.length - tail + Math.min(tail, 3))) lines.push({ k: "ctx", text });
  }
  return {
    lines,
    added: lines.reduce((n, l) => n + (l.k === "add" ? 1 : 0), 0),
    removed: lines.reduce((n, l) => n + (l.k === "del" ? 1 : 0), 0),
  };
}

/** An edit's diff: a ± column, additions and removals tinted, context dim, in the card's monospace body. */
function diffBody(t, key, diff) {
  const shown = diff.lines.slice(0, DIFF_CAP), hidden = diff.lines.length - shown.length;
  return v_flex().w_full().py(4).children(shown.map((l, i) => {
    const add = l.k === "add", del = l.k === "del";
    return h_flex().id(`${key}-d${i}`).w_full().min_h(18).font_family(mono()).text_size(12)
      .when(add || del, el => el.bg(alpha(add ? t.ansi2 : t.ansi1, 0.1)))
      .child(div().flex_none().w(20).pl(10).text_color(add ? t.ansi2 : del ? t.ansi1 : t.dim).child(add ? "+" : del ? "−" : " "))
      .child(div().flex_1().min_w(0).pr(10).text_color(del ? t.muted : t.foreground).child(l.text || " "));
  }))
    .when(hidden > 0, el => el.child(div().px(10).py(2).text_size(11).text_color(t.dim).child(`… ${hidden} more lines`)));
}

/**
 * One step of an opened group: a thought in markdown, or a tool call as a card of its own (its icon, what it did, and
 * what it changed: an edit's diff with +/− counts, a command's output, a read's text), as herdr-chat's tool cards.
 */
function stepRow(m, { t, open: opened, width }) {
  const i = m.key, c = m.call, open = Boolean(opened[i]), shown = stepText(c, open);
  // The chat's column, as main.js computes it: a card takes its width from here, so it can't be sized by its content
  // (a v_flex centres a child whose width is not set, and a diff card's header is narrow).
  const col = Math.min(COLUMN, Math.max(280, Math.floor((width ?? COLUMN)) - 50));
  const diff = c.k === "edit" ? editDiff(c) : null, hasDiff = Boolean(diff?.lines.length);
  const toggle = open || shown.more || hasDiff;
  const body = c.k === "think"
    ? (shown.text ? div().w_full().pb(4).child(TextView.markdown(`think-${i}`, shown.text).raw_html(false).selectable(true).text_size(13).text_color(t.muted)) : null)
    : hasDiff ? (open ? diffBody(t, i, diff) : null)
    : shown.text ? v_flex().w_full().px(10).py(7).font_family(mono()).text_size(12).text_color(t.muted)
      .children(shown.text.split("\n").map((l, k) => div().id(`o-${i}-${k}`).w_full().min_h(18).child(l || " ")))
    : null;
  const head = h_flex().h(30).px(10).gap(8).items_center().min_w(0)
    .child(icon(c.k === "think" ? "brain" : (KINDS[c.k] ?? KINDS.other).icon, 13, t.muted))
    .child(div().flex_none().text_size(12.5).font_semibold().text_color(t.foreground).child(STEP[c.k] ?? c.k))
    .child(div().flex_1().min_w(0).truncate().text_size(12.5).font_family(mono()).text_color(t.muted)
      .tooltip(c.p || c.d || "").child(c.d || ""))
    .when(hasDiff, el => el.child(h_flex().flex_none().gap(6).font_family(mono()).text_size(11.5)
      .child(div().text_color(t.ansi2).child(`+${diff.added}`))
      .child(div().text_color(t.ansi1).child(`−${diff.removed}`))))
    .when(toggle, el => el.child(h_flex().flex_none().gap(4).items_center().text_size(12).text_color(t.dim)
      .child(open ? (hasDiff ? "Hide diff" : "Show less") : hasDiff ? "Show diff" : shown.hidden ? `${shown.hidden} more lines` : "Show all")
      .child(icon(open ? "chevron-down" : "chevron-right", 12, t.dim))));
  // A v_flex centres its children across its width (as an h_flex does down it): without items_stretch the card and its
  // body shrink to their content, wrapping every diff line.
  const box = c.k === "think" ? v_flex().w_full().items_stretch().child(head).when(Boolean(body), el => el.child(body))
    : v_flex().w(col - 22).items_stretch().rounded(8).border_1().border_color(t.border).bg(t.surface).overflow_hidden().child(head)
      .when(Boolean(body), el => el.child(div().w_full().border_t_1().border_color(t.border).child(body)));
  return v_flex().w(col).items_stretch().ml(6).pl(16).border_l(1).border_color(t.border).pb(m.last ? 6 : 4).child(box);
}

/** An image in the person's message: its preview in sent/, else a chip with its name (a document is always the chip). */
function sentImage(t, id, path, sent, machine) {
  const name = path.split(/[\\/]/).pop(), preview = previewFile(sent, path, machine);
  if (preview) return div().id(id).size(120).flex_none().rounded(12).overflow_hidden().border_1().border_color(t.border).bg(t.raised)
    .tooltip(name).child(image(`${SENT_DIR}/${preview}`).size_full());
  return h_flex().id(id).h(32).px(10).gap(6).flex_none().items_center().rounded(8).bg(t.raised).text_size(12.5).text_color(t.muted)
    .child(icon(/\.(png|jpe?g|gif|webp)$/i.test(path) ? "image" : "file-text", 14, t.muted)).child(name || "Pasted image");
}



/** A message: the person's in a bubble (its images above it), the agent's as plain markdown across the column. */
function messageRow(m, { t, width, sent, machine, sendQueued }) {
  if (m.role === "user") {
    const room = Math.min(620, Math.round(Math.min(COLUMN, (width ?? COLUMN) - 48) * 0.85));
    const text = m.text ? bubble(t, room, markdown(`body-${m.key}`, m.text, t)) : null;
    // Queued in the agent, not yet delivered: dimmed, with a caption, until the log has it as a message. Where the
    // agent has a chord for it (Claude Code: ctrl+x ctrl+s), "Send now" presses it.
    if (m.phase === "queued") return v_flex().w_full().gap(2)
      .child(h_flex().w_full().justify_end().opacity(0.6).child(text))
      .child(h_flex().w_full().justify_end().gap(6).items_center().text_size(11).text_color(t.dim)
        .child(div().opacity(0.6).child("Queued · sends when the agent gets to it"))
        .when(Boolean(sendQueued), el => el.child(h_flex().id(`send-now-${m.key}`).gap(5).items_center().px(6).h(20).rounded(5)
          .cursor_pointer().text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
          .tooltip("Send queued messages now (⌃X ⌃S)")
          .on_click((_e, cx) => sendQueued(cx))
          .child("Send now").child(div().text_color(t.dim).child("⌃X ⌃S")))));
    if (!m.images?.length) return text;
    return v_flex().w_full().gap(8)
      .child(h_flex().w_full().justify_end().flex_wrap().gap(8).children(m.images.map((p, i) => sentImage(t, `img-${m.key}-${i}`, p, sent, machine))))
      .when(Boolean(text), el => el.child(text));
  }
  const body = div().w_full().text_size(15).text_color(t.foreground).child(markdown(`body-${m.key}`, m.text, t));
  // Read off the screen while a question waits (Claude Code logs the reply once it's answered): said under it.
  if (m.phase === "screen") return v_flex().w_full().gap(6)
    .when(Boolean(m.partial), el => el.child(div().text_size(11.5).text_color(t.dim).child("… the start is above the terminal's screen")))
    .child(body)
    .child(div().text_size(11.5).text_color(t.dim).child("From the terminal · the full reply arrives once you answer"));
  return body;
}

/**
 * A ```mermaid block from a reply, as its own row: the picture alone, in the reply's column; a click opens it larger
 * (openDiagram).
 */
function diagramRow(m, { t, width }) {
  const d = diagramFor(m.text, t);
  if (d.state === "queued") return div().w_full().h(24).flex().items_center().text_size(12.5).text_color(t.dim).child("Drawing diagram…");
  if (d.state === "failed") return v_flex().w_full().gap(6)
    .child(markdown(`diagram-src-${m.key}`, "```mermaid\n" + m.text + "\n```", t))
    .child(div().text_size(12).text_color(t.dim).child(`Couldn't draw this diagram: ${d.error}`));
  const room = Math.min(COLUMN, Math.max(280, Math.floor(width) - 50));
  const w = Math.min(d.width, room), h = Math.round(d.height * w / d.width);
  return div().id(`diagram-${m.key}`).w_full().cursor_pointer().tooltip("Click to open it larger").child(image(d.rel).w(w).h(h));
}

export const TOOL_BUTTON = 30, TOOL_GAP = 6;

function diagramToolsRow(m, { t, copied }) {
  const button = (which, glyph, tip) => toolButton(t, `dt-${which}-${m.key}`, glyph, copied === `${m.key}:${which}`, copied === `${m.key}:${which}:busy`, tip);
  return h_flex().w_full().h(32).gap(TOOL_GAP).items_center().justify_start()
    .child(button("image", "image", "Copy the diagram as a picture"))
    .child(button("code", "copy", "Copy the diagram's mermaid code"));
}

/**
 * One conversation row, drawn from the row alone and `ctx` ({ t, open, width, sent, machine }), with the gap that
 * starts a turn.
 */
export function row(m, ctx) {
  const body = m.kind === "tools" ? toolsRow(m, ctx)
    : m.kind === "step" ? stepRow(m, ctx)
    : m.kind === "note" ? div().w_full().text_size(12.5).text_color(ctx.t.dim).child(m.text)
    : m.kind === "diagram" ? diagramRow(m, ctx)
    : m.kind === "diagram-tools" ? diagramToolsRow(m, ctx)
    : m.kind === "code" ? codeRow(m, ctx)
    : m.kind === "copy" ? copyRow(m, ctx)
    : messageRow(m, ctx);
  return body;
}
