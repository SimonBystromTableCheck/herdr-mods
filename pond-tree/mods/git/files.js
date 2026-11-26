// The Files section's diff: one file's unstaged and staged changes as rows, and the
// partial patches that stage, unstage or discard a hunk or chosen lines (lazygit's way:
// `git apply --cached --recount`, reversed to unstage or discard). Plain git only.
import { exec } from "herdr";
import { git } from "./git.js";

const MAX_LINES = 4000;
const DIFF = ["diff", "--no-color", "--no-ext-diff", "--src-prefix=a/", "--dst-prefix=b/"];

// Rows of one `git diff` for a single file. A hunk keeps the file header lines above it
// (a patch needs them) and its own rows; every row in it points back at it (`hunk`).
// `files`: several files (a folder's diff): a row naming each file before its hunks.
function parse(text, side, rows, hunks, files = false) {
  let header = [], hunk = null, oldN = 0, newN = 0, file = null;
  for (const raw of text.replace(/\n$/, "").split("\n")) {
    if (raw.startsWith("diff --git ")) { header = [raw]; hunk = null; file = null; continue; }
    if (!hunk && (raw.startsWith("+++ ") || raw.startsWith("--- "))) {
      const p = raw.slice(4).replace(/^[ab]\//, "");
      if (p !== "/dev/null" && (raw.startsWith("+++ ") || !file)) file = p;
      if (raw.startsWith("+++ ") && files) rows.push({ kind: "file", text: file, side, file });
    }
    if (rows.length > MAX_LINES) { rows.push({ kind: "meta", text: "… (truncated)", side }); break; }
    const text = raw.replace(/\t/g, "    ");
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(raw);
    if (m) {
      hunk = { side, header: [...header], head: raw, rows: [], oldStart: +m[1], newStart: +m[2], file };
      hunks.push(hunk);
      oldN = +m[1]; newN = +m[2];
      rows.push({ kind: "hunk", text, side, hunk, file });
      continue;
    }
    if (!hunk) {
      if (raw.startsWith("Binary files")) rows.push({ kind: "meta", text: "Binary file", side, file });
      else header.push(raw);
      continue;
    }
    const c = raw[0];
    const row = c === "+" ? { kind: "add", new: newN++ } : c === "-" ? { kind: "del", old: oldN++ }
      : c === "\\" ? { kind: "meta" } : { kind: "ctx", old: oldN++, new: newN++ };
    Object.assign(row, { text: text.slice(1), raw, side, hunk, file });
    hunk.rows.push(row);
    rows.push(row);
  }
}

// The diff rows for a status file: {rows, hunks}. `side`: "unstaged", "staged" or
// "conflict" (a merge's combined diff: shown, never staged by hunk).
export async function loadFileDiff(ctx, f) {
  const rows = [], hunks = [];
  const run = async (args, side, title) => {
    const r = await git(ctx, args).catch(e => ({ code: -1, stdout: "", stderr: String(e) }));
    // `diff --no-index` exits 1 when the files differ.
    if (r.code !== 0 && !(r.code === 1 && r.stdout)) { rows.push({ kind: "meta", text: (r.stderr || "git diff failed").trim(), side }); return; }
    if (!r.stdout.trim()) return;
    rows.push({ kind: "section", text: title, side });
    parse(r.stdout, side, rows, hunks);
  };
  if (f.conflict) await run([...DIFF, "--", f.path], "conflict", "Conflicted");
  else if (f.untracked) await run([...DIFF, "--no-index", "--", "/dev/null", f.path], "unstaged", "Untracked");
  else {
    if (f.unstaged) await run([...DIFF, "--", f.path], "unstaged", "Unstaged changes");
    if (f.staged) await run([...DIFF, "--cached", "--", f.path], "staged", "Staged changes");
  }
  if (!rows.length) rows.push({ kind: "meta", text: "No changes", side: null });
  return { rows, hunks };
}

// A patch for the chosen rows of some hunks (all one side), or null when nothing changes.
// `reverse`: the patch will be applied with --reverse (unstaging a staged hunk, discarding
// an unstaged one), so lines that stay are the "+" ones (they become context) and unchosen
// "-" lines go; applied forwards (staging), unchosen "+" lines go and "-" become context.
// `pick`: a Set of rows, or null for whole hunks.
export function patchFor(hunks, pick, reverse) {
  const out = [];
  for (const h of hunks) {
    const lines = [];
    let oldC = 0, newC = 0, changed = false, kept = false;
    for (const r of h.rows) {
      if (r.kind === "meta") { if (kept) lines.push(r.raw); continue; }
      const chosen = !pick || pick.has(r);
      let c = r.kind === "ctx" ? " " : r.kind === "add" ? "+" : "-";
      if (!chosen && c !== " ") {
        const stays = reverse ? c === "+" : c === "-";
        if (!stays) { kept = false; continue; }
        c = " ";
      }
      if (c !== " ") changed = true;
      if (c !== "+") oldC++;
      if (c !== "-") newC++;
      lines.push(c + r.raw.slice(1));
      kept = true;
    }
    if (!changed) continue;
    if (!out.length) out.push(...h.header);
    out.push(`@@ -${h.oldStart},${oldC} +${h.newStart},${newC} @@`, ...lines);
  }
  return out.length ? `${out.join("\n")}\n` : null;
}

// The rows a note is about, as text for the agent (at most 12 lines).
export function snippetOf(rows) {
  const lines = rows.filter(r => r.kind === "add" || r.kind === "del" || r.kind === "ctx").map(r => (r.kind === "add" ? "+" : r.kind === "del" ? "-" : " ") + r.text);
  return lines.length > 12 ? [...lines.slice(0, 12), `… (${lines.length - 12} more)`].join("\n") : lines.join("\n");
}

// The line a row is at in its file (new side, else old side).
export const lineOf = r => r.new ?? r.old ?? null;

// ---- Merges, rebases, cherry-picks: which side is which ----------------------------

// What git's "ours" and "theirs" are in the operation running now. During a rebase "ours"
// is the upstream being rebased onto and "theirs" your commit being replayed.
export function sidesOf(op, head) {
  if (!op) return null;
  if (op.kind === "rebase") return { ours: `upstream · ${op.other ?? "onto"}`, theirs: `your commit · ${op.branch ?? "HEAD"}`, oursShort: op.other ?? "upstream", theirsShort: op.branch ?? "your commit" };
  const verb = { merge: "incoming", "cherry-pick": "picked", revert: "reverting" }[op.kind] ?? "incoming";
  return { ours: `current · ${head ?? "HEAD"}`, theirs: `${verb} · ${op.other ?? "theirs"}`, oursShort: head ?? "HEAD", theirsShort: op.other ?? "theirs" };
}

// The paths the incoming side changed (the merged branch since the merge base, the commit
// being picked or replayed). Files staged during the operation that are in it came from there.
export async function incomingPaths(ctx, op) {
  const ref = { merge: "MERGE_HEAD", rebase: "REBASE_HEAD", "cherry-pick": "CHERRY_PICK_HEAD", revert: "REVERT_HEAD" }[op?.kind];
  if (!ref) return new Set();
  let from = `${ref}^`;
  if (op.kind === "merge") {
    const b = await git(ctx, ["merge-base", "HEAD", ref]).catch(() => null);
    if (b?.code !== 0) return new Set();
    from = b.stdout.trim();
  }
  const r = await git(ctx, ["diff", "--name-only", "--no-renames", from, ref]).catch(() => null);
  return new Set(r?.code === 0 ? r.stdout.split("\n").filter(Boolean) : []);
}

// A conflicted file as it is in the working tree: plain lines, and each conflict as a block
// (marker rows, then "ours", optional "base" and "theirs" lines). `blocks[i]`: {start, end}
// line indexes of its markers, so a pick can rewrite the file.
export async function loadConflict(ctx, f, sides) {
  const r = await git(ctx, ["cat-file", "-p", `:2:${f.path}`]).catch(() => null);
  const read = await exec("cat", ["--", f.path], { cwd: ctx.root, on: ctx.on }).catch(e => ({ code: -1, stdout: "", stderr: String(e) }));
  if (read.code !== 0) {
    const gone = r?.code === 0 ? sides?.theirs ?? "the incoming side" : sides?.ours ?? "the current side";
    return { rows: [{ kind: "meta", text: `This file was deleted on one side (${gone} still has it). Open the resolver to keep or delete it.`, side: "conflict" }], hunks: [], blocks: [], text: null };
  }
  const text = read.stdout, lines = text.split("\n"), rows = [], blocks = [];
  let block = null, part = null, n = 0;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (i === lines.length - 1 && raw === "") break; // the final newline
    const line = raw.replace(/\t/g, "    ");
    n++;
    if (raw.startsWith("<<<<<<<")) {
      block = { index: blocks.length, start: i, base: null, sep: null, end: null, label: raw.slice(8).trim() };
      blocks.push(block); part = "ours";
      rows.push({ kind: "mark", part: "ours", block, side: "conflict" });
      continue;
    }
    if (block && raw.startsWith("|||||||")) { block.base = i; part = "base"; rows.push({ kind: "mark", part: "base", block, side: "conflict" }); continue; }
    if (block && raw.startsWith("=======")) { block.sep = i; part = "theirs"; rows.push({ kind: "mark", part: "theirs", block, side: "conflict", theirsLabel: null }); continue; }
    if (block && raw.startsWith(">>>>>>>")) { block.end = i; block.theirsLabel = raw.slice(8).trim(); block = null; part = null; continue; }
    rows.push({ kind: part ?? "ctx", new: n, text: line, raw: ` ${raw}`, side: "conflict", block });
  }
  if (!blocks.length) rows.unshift({ kind: "meta", text: "No conflict markers left: stage the file (space) to mark it resolved.", side: "conflict" });
  return { rows, hunks: [], blocks: blocks.filter(b => b.end != null), text };
}

// The file's text with one conflict resolved: "ours", "theirs" or "both" (ours, then theirs).
export function resolveBlock(text, b, choice) {
  const lines = text.split("\n");
  const ours = lines.slice(b.start + 1, b.base ?? b.sep), theirs = lines.slice(b.sep + 1, b.end);
  const keep = choice === "ours" ? ours : choice === "theirs" ? theirs : [...ours, ...theirs];
  return [...lines.slice(0, b.start), ...keep, ...lines.slice(b.end + 1)].join("\n");
}

// A folder's diff (a tree row; "" is the root "/"): its tracked files' unstaged and staged
// changes, then its untracked files (at most 30), each file named before its hunks.
export async function loadFolderDiff(ctx, folder, files) {
  const rows = [], hunks = [], spec = folder || ".";
  const under = files.filter(f => !folder || f.path.startsWith(`${folder}/`));
  const run = async (args, side) => {
    const r = await git(ctx, args).catch(() => null);
    if ((r?.code === 0 || (r?.code === 1 && r.stdout)) && r.stdout.trim()) parse(r.stdout, side, rows, hunks, true);
  };
  const conflicts = under.filter(f => f.conflict);
  if (conflicts.length) rows.push({ kind: "meta", text: `${conflicts.length} conflicted file${conflicts.length === 1 ? "" : "s"} here: open each one to keep a side.`, side: "conflict" });
  if (under.some(f => f.unstaged && !f.conflict)) {
    rows.push({ kind: "section", text: "Unstaged changes", side: "unstaged" });
    await run([...DIFF, "--", spec], "unstaged");
    for (const f of under.filter(f => f.untracked).slice(0, 30)) await run([...DIFF, "--no-index", "--", "/dev/null", f.path], "unstaged");
  }
  if (under.some(f => f.staged)) {
    rows.push({ kind: "section", text: "Staged changes", side: "staged" });
    await run([...DIFF, "--cached", "--", spec], "staged");
  }
  if (!rows.length) rows.push({ kind: "meta", text: "No changes", side: null });
  return { rows, hunks, folder: true };
}

// The Files section's rows as a tree: "/" first, then folders before files, a folder with only
// one folder inside drawn as one row ("src/app"). `folded`: folder paths ("" for "/") shown closed.
export function treeRows(files, folded) {
  const root = { name: "/", path: "", dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = f.path.split("/");
    let node = root;
    for (const part of parts.slice(0, -1)) {
      if (!node.dirs.has(part)) node.dirs.set(part, { name: part, path: node.path ? `${node.path}/${part}` : part, dirs: new Map(), files: [] });
      node = node.dirs.get(part);
    }
    node.files.push(f);
  }
  const count = n => n.files.length + [...n.dirs.values()].reduce((a, d) => a + count(d), 0);
  const hasConflict = n => n.files.some(f => f.conflict) || [...n.dirs.values()].some(hasConflict);
  const rows = [];
  const walk = (n, depth) => {
    const open = !folded.has(n.path);
    rows.push({ kind: "dir", path: n.path, name: n.name, depth, open, count: count(n), root: n === root,
      conflict: hasConflict(n) });
    if (!open) return;
    for (const d of [...n.dirs.values()].sort((a, b) => a.name.localeCompare(b.name))) {
      let c = d;
      while (!c.files.length && c.dirs.size === 1) { const only = [...c.dirs.values()][0]; c = { ...only, name: `${c.name}/${only.name}` }; }
      walk(c, depth + 1);
    }
    for (const f of [...n.files].sort((a, b) => a.path.localeCompare(b.path))) rows.push({ kind: "file", path: f.path, file: f, depth: depth + 1 });
  };
  walk(root, 0);
  return rows;
}
