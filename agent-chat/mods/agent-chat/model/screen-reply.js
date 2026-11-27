/**
 * The reply a question is waiting on, read back off the agent's screen. Claude Code writes a reply to its log only once
 * every tool call in it has finished, and a question finishes when it's answered: until then the text above the
 * question (often a table of findings) is only on the screen. This turns that screen text back into Markdown.
 */

const RULE = /^\s*[─━═]{8,}\s*$/;
const MARK = /^[⏺●] /;
// A tool call's line as Claude Code draws it: `⏺ Bash(…)`, `⏺ Read 3 files`, `⏺ Update(…)`.
const TOOL = /^[⏺●] (?:[A-Za-z_][\w.:-]*\(|(?:Ran|Read|Searched|Edited|Wrote|Updated|Listed|Fetched|Called|Used|Searching|Reading)\b)/;
const LIST = /^(?:[-*•]|\d+[.)])\s/;

/** Letters and digits only: screen text and the logged Markdown compare without the formatting either has. */
const plain = s => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** The screen's lines that belong to the conversation: above the prompt, without hc's notes. */
function aboveQuestion(screen) {
  const lines = screen.replace(/ /g, " ").split("\n").filter(l => !l.startsWith("[hc]")).map(l => l.replace(/\s+$/, ""));
  let marks = [];
  lines.forEach((l, y) => { if (MARK.test(l)) marks.push(y); });
  const after = marks.length ? marks[marks.length - 1] : 0;
  const rule = lines.findIndex((l, y) => y > after && RULE.test(l));
  return { lines: rule < 0 ? [] : lines.slice(0, rule), width: rule < 0 ? 0 : lines[rule].length };
}

/** The screen's text blocks: each `⏺` line and the indented lines under it; `cut` when the screen starts mid-block. */
function blocksOf(lines) {
  const blocks = [];
  let cur = null;
  for (const line of lines) {
    if (MARK.test(line)) { cur = { tool: TOOL.test(line), lines: [line.slice(2)] }; blocks.push(cur); continue; }
    if (!cur) { cur = { tool: false, cut: true, lines: [] }; blocks.push(cur); }
    if (/^\s*⎿/.test(line)) cur.tool = true;
    cur.lines.push(line.replace(/^ {2}/, ""));
  }
  for (const b of blocks) {
    while (b.lines.length && !b.lines[0].trim()) b.lines.shift();
    while (b.lines.length && !b.lines.at(-1).trim()) b.lines.pop();
  }
  return blocks.filter(b => b.lines.length);
}

/** A box-drawn table (┌ … └) as a Markdown table: each row's wrapped lines joined back into its cells. */
function tableMarkdown(rows) {
  const cells = l => l.trim().replace(/^│/, "").replace(/│$/, "").split("│");
  const groups = [];
  let cur = null;
  for (const l of rows) {
    if (/^\s*[┌├└]/.test(l)) { if (cur) groups.push(cur); cur = null; continue; }
    if (!/^\s*│/.test(l)) continue;
    const parts = cells(l);
    if (!cur) cur = parts.map(() => []);
    parts.forEach((p, i) => { if (p.trim()) (cur[i] ??= []).push(p.trim()); });
  }
  if (cur) groups.push(cur);
  if (!groups.length) return null;
  const text = g => g.map(c => (c ?? []).join(" ").replace(/\|/g, "\\|"));
  const head = text(groups[0]);
  const out = [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`];
  for (const g of groups.slice(1)) out.push(`| ${text(g).join(" | ")} |`);
  return out.join("\n");
}

/**
 * A block's lines as Markdown: tables rebuilt, and lines the terminal wrapped joined again. A line was wrapped when the
 * next line's first word wouldn't have fit after it, at `width` columns.
 */
function blockMarkdown(lines, width) {
  const out = [];
  let prev = null;   // the screen line the last output line ended with, to judge wrapping
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*┌/.test(line)) {
      const rows = [line];
      for (i++; i < lines.length && /^\s*[│├└]/.test(lines[i]); i++) { rows.push(lines[i]); if (/^\s*└/.test(lines[i])) break; }
      const table = tableMarkdown(rows);
      if (table) out.push("", table, "");
      prev = null;
      continue;
    }
    if (!line.trim()) { out.push(""); prev = null; continue; }
    const body = line.trim();
    const word = body.split(/\s/)[0];
    const wrapped = prev != null && !LIST.test(body) && prev.length + 1 + word.length > width - 6;
    if (wrapped) out[out.length - 1] += " " + body;
    // A nested list item keeps its indent; any other indent goes, so Markdown doesn't read it as a code block.
    else out.push(LIST.test(body) ? line : body);
    prev = line;
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * The reply on screen that the log doesn't have yet, as Markdown, or null. `logged`: the newest assistant messages the
 * log has, newest last. Text blocks are taken from the question up, stopping at one the log already has; tool calls
 * between them are left out (the log adds them once answered). `partial` when the screen starts in the middle of it.
 */
export function replyFromScreen(screen, logged = []) {
  if (!screen) return null;
  const { lines, width } = aboveQuestion(screen);
  if (!lines.length) return null;
  const known = logged.slice(-6).map(plain).filter(Boolean);
  const has = b => {
    const p = plain(b.lines.join(" ")).slice(0, 80);
    return p.length > 0 && known.some(k => k.includes(p) || (b.cut && p.length >= 24 && k.includes(p.slice(-40))));
  };
  const blocks = blocksOf(lines);
  const taken = [];
  let partial = false;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.tool) { if (taken.length) break; continue; }
    if (has(b)) break;
    taken.unshift(b);
    if (b.cut) partial = true;
  }
  const text = taken.map(b => blockMarkdown(b.lines, width)).filter(Boolean).join("\n\n");
  return text ? { text, partial } : null;
}
