// Opening a right-hand panel from a click, and giving it the keyboard the way the leader does
// (leader/main.js enterPanel): pane.focus the terminal, then pane.go right past every pane of the
// tab, so the app knows the panel holds the keyboard (pane.go / cmd-alt-left leave it cleanly).
// Same file in pond-tabs and pond-pins (mods can't import each other): edit one, copy it.
import { layout, panes, focused, run } from "herdr";

function pathTo(node, mod, trail = []) {
  if (!node) return null;
  const here = [...trail, node];
  if (node.content?.mod === mod) return here;
  for (const c of [...(node.children ?? []), ...(node.floating ?? [])]) {
    const found = pathTo(c, mod, here);
    if (found) return found;
  }
  return null;
}

const activeOf = stack => stack.active ?? stack.children?.[0]?.id;

function onScreen(mod) {
  const path = pathTo(layout(), mod);
  return !!path && path.every((n, i) => !n.hidden && (n.type !== "stack" || i === path.length - 1 || activeOf(n) === path[i + 1].id));
}

// Shows panel-body child `id` (showing `mod`) and focuses it once it's laid out; `after` runs then
// (a popup closes itself there, so its timer isn't cancelled first).
export function openPanel(cx, id, mod, after) {
  run("layout.select", { stack: "panel-body", child: id });
  run("layout.show", { id: "panel" });
  cx.timer.after(60, () => {
    // Chat mode hides the tab's panes behind the agent chat: pane.go never reaches the panel.
    if (onScreen("agent-chat")) { if (mod) run(`${mod}.focus`); }
    else {
      const f = focused();
      if (f?.pane) run("pane.focus", { pane: f.pane });
      const n = panes().filter(p => p.tab === f?.tab).length;
      for (let i = 0; i <= n; i++) run("pane.go", { direction: "right" });
    }
    after?.();
  });
}
