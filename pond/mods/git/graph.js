// Commit graph drawn as lines, lazygit-style: lanes are laid out from parents (no ASCII
// from `git log --graph`), and a freed lane is reused instead of shifting the others, so
// every line stays vertical except where a branch forks or merges.
import { div } from "gpui-kit";

// commits: [{ sha, parents }] in display order (newest first). Adds `lane` to each.
export function layoutGraph(commits) {
  const lanes = [];
  let colors = 0;
  for (const c of commits) {
    const before = lanes.slice();
    let col = lanes.findIndex(l => l?.sha === c.sha);
    const incoming = col >= 0;
    if (!incoming) { col = lanes.findIndex(l => !l); if (col < 0) col = lanes.length; lanes[col] = { sha: c.sha, color: colors++ }; }
    const color = lanes[col].color, freed = new Set();
    const mergeIn = [];
    lanes.forEach((l, k) => { if (k !== col && l?.sha === c.sha) { mergeIn.push({ from: k, color: l.color }); lanes[k] = null; freed.add(k); } });
    const [first, ...rest] = c.parents;
    lanes[col] = first ? { sha: first, color } : null;
    const branchOut = [], fresh = new Set();
    for (const p of rest) {
      let k = lanes.findIndex(l => l?.sha === p);
      if (k < 0) {
        k = lanes.findIndex((l, i) => !l && i !== col && !freed.has(i));
        if (k < 0) k = lanes.length;
        lanes[k] = { sha: p, color: colors++ };
        fresh.add(k);
      }
      branchOut.push({ to: k, color: lanes[k].color });
    }
    while (lanes.length && !lanes[lanes.length - 1]) lanes.pop();
    const width = Math.max(before.length, lanes.length, col + 1);
    const top = [], bottom = [];
    for (let k = 0; k < width; k++) {
      if (before[k] && !freed.has(k) && (k !== col || incoming)) top.push({ k, color: before[k].color });
      if (lanes[k] && !fresh.has(k) && (k !== col || first)) bottom.push({ k, color: lanes[k].color });
    }
    c.lane = { col, color, width, top, bottom, mergeIn, branchOut, merge: c.parents.length > 1 };
  }
  return commits;
}

// One row of the graph: `h` tall, W px per lane, lines `lw` thick.
export function graphCell(lane, h, palette, bg, { W = 14, lw = 1.6, highlight } = {}) {
  const mid = h / 2, x = k => k * W + W / 2, r = Math.min(W / 2, mid) - 1;
  const col = i => palette[i % palette.length];
  const parts = [];
  for (const s of lane.top) parts.push(div().absolute().left(x(s.k) - lw / 2).top(0).w(lw).h(mid).bg(col(s.color)));
  for (const s of lane.bottom) parts.push(div().absolute().left(x(s.k) - lw / 2).top(mid).w(lw).h(h - mid).bg(col(s.color)));
  const xc = x(lane.col);
  for (const m of lane.mergeIn) {
    const right = m.from > lane.col, xk = x(m.from);
    parts.push(div().absolute().top(0).h(mid + lw / 2).border_color(col(m.color)).border_b(lw)
      .when(right, e => e.left(xc).w(xk - xc + lw / 2).border_r(lw).rounded_br(r))
      .when(!right, e => e.left(xk - lw / 2).w(xc - xk + lw / 2).border_l(lw).rounded_bl(r)));
  }
  for (const b of lane.branchOut) {
    const right = b.to > lane.col, xk = x(b.to);
    parts.push(div().absolute().top(mid - lw / 2).h(h - mid + lw / 2).border_color(col(b.color)).border_t(lw)
      .when(right, e => e.left(xc).w(xk - xc + lw / 2).border_r(lw).rounded_tr(r))
      .when(!right, e => e.left(xk - lw / 2).w(xc - xk + lw / 2).border_l(lw).rounded_tl(r)));
  }
  const d = lane.merge || highlight ? 10 : 8, c = col(lane.color);
  parts.push(div().absolute().left(xc - d / 2).top(mid - d / 2).size(d).rounded_full()
    .when(lane.merge, e => e.bg(bg).border(2).border_color(c))
    .when(!lane.merge, e => e.bg(c).when(Boolean(highlight), n => n.border(2).border_color(highlight))));
  return div().relative().flex_none().w(lane.width * W + 2).h(h).children(parts);
}
