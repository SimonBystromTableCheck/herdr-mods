// Pure helpers for git-conflicts (no herdr imports, so `node test_logic.mjs` can load them).

// A marker line: exactly 7 of the char, then a space or the line's end (CRLF too).
const marker = (line, ch) => line.startsWith(ch.repeat(7)) && (line.length === 7 || line[7] === " " || line[7] === "\r");
const label = (line) => line.slice(8).replace(/\r$/, "").trim();

/** A file's text as segments: {kind: "text", start, lines} and
 *  {kind: "conflict", start, end, ours, base, theirs, oursLabel, theirsLabel}
 *  (`start`/`end`: 0-based line indexes in the file; base is null without diff3).
 *  An unterminated conflict stays text. */
export function parse(text) {
  const lines = text.split("\n");
  const segs = [];
  let plain = null;
  const addText = (i) => {
    if (!plain) segs.push((plain = { kind: "text", start: i, lines: [] }));
    plain.lines.push(lines[i]);
  };
  for (let i = 0; i < lines.length; i++) {
    if (!marker(lines[i], "<")) { addText(i); continue; }
    // Find the rest of this conflict; a broken one is left as text.
    let mid = -1, baseAt = -1, end = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (marker(lines[j], "<")) break;
      if (baseAt < 0 && mid < 0 && marker(lines[j], "|")) baseAt = j;
      else if (mid < 0 && marker(lines[j], "=")) mid = j;
      else if (mid >= 0 && marker(lines[j], ">")) { end = j; break; }
    }
    if (end < 0) { addText(i); continue; }
    plain = null;
    segs.push({
      kind: "conflict", start: i, end,
      oursLabel: label(lines[i]), theirsLabel: label(lines[end]),
      ours: lines.slice(i + 1, baseAt >= 0 ? baseAt : mid),
      base: baseAt >= 0 ? lines.slice(baseAt + 1, mid) : null,
      theirs: lines.slice(mid + 1, end),
    });
    i = end;
  }
  return segs;
}

export const conflictsOf = (segs) => segs.filter((s) => s.kind === "conflict");

/** The text with conflict number `n` (0-based) replaced by `choice`: "ours", "theirs" or "both" (ours then theirs). */
export function resolve(text, n, choice) {
  const segs = parse(text);
  const c = conflictsOf(segs)[n];
  if (!c) return text;
  const keep = choice === "ours" ? c.ours : choice === "theirs" ? c.theirs : [...c.ours, ...c.theirs];
  const lines = text.split("\n");
  lines.splice(c.start, c.end - c.start + 1, ...keep);
  return lines.join("\n");
}

/** What a porcelain unmerged XY means, lazygit's way. */
export const KINDS = {
  UU: { short: "UU", label: "both modified", markers: true },
  AA: { short: "AA", label: "both added", markers: true },
  DD: { short: "DD", label: "both deleted", markers: false },
  AU: { short: "AU", label: "added by us", markers: false },
  UA: { short: "UA", label: "added by them", markers: false },
  DU: { short: "DU", label: "deleted by us", markers: false },
  UD: { short: "UD", label: "deleted by them", markers: false },
};

/** `git status --porcelain=v2 -z` → the unmerged files as [{path, xy}]. */
export function unmerged(z) {
  return (z ?? "").split("\0").filter((r) => r.startsWith("u ")).map((r) => {
    const parts = r.split(" ");
    return { xy: parts[1], path: parts.slice(10).join(" ") };
  });
}

/** Rows to draw for a parsed file: context lines around each conflict, the rest folded.
 *  Each row: {kind: "fold"|"ctx"|"head"|"ours"|"base"|"theirs"|"mid"|"end", n?, line?, text?, count?}.
 *  `n`: the conflict number; `line`: 1-based line in the file. */
export function rows(segs, context = 3) {
  const out = [];
  let n = 0;
  segs.forEach((s, si) => {
    if (s.kind === "text") {
      const before = si > 0, after = si < segs.length - 1; // a conflict is before / after it
      const L = s.lines.length;
      const keep = (i) => (before && i < context) || (after && i >= L - context);
      let folded = 0;
      for (let i = 0; i < L; i++) {
        if (keep(i)) {
          if (folded) out.push({ kind: "fold", count: folded }), (folded = 0);
          out.push({ kind: "ctx", line: s.start + i + 1, text: s.lines[i] });
        } else folded++;
      }
      if (folded) out.push({ kind: "fold", count: folded });
      return;
    }
    const k = n++;
    out.push({ kind: "head", n: k });
    s.ours.forEach((text, i) => out.push({ kind: "ours", n: k, line: s.start + i + 2, text }));
    if (s.base) {
      out.push({ kind: "mid", n: k, text: "base" });
      s.base.forEach((text) => out.push({ kind: "base", n: k, text }));
    }
    out.push({ kind: "mid", n: k, text: "theirs" });
    s.theirs.forEach((text) => out.push({ kind: "theirs", n: k, text }));
    out.push({ kind: "end", n: k });
  });
  return out;
}
