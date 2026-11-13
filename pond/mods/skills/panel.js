// Where a panel mod is shown, and showing or closing it there. The same file is in every panel mod
// from herdr-mods (tools/stamp.py refuses copies that differ): edit one, copy it to the others.
//
// A panel can be a block in the layout (usually a child of the right-hand `panel-body` stack, opened
// from the tab bar), a pane in a tab (`pane.split {mod}`) or an overlay (`mod.open`). Nothing here
// assumes the pond layout or its ids.
import { layout, panes, focused, run, closeOverlay, props } from "herdr";

// The chain of nodes from the layout root down to the block showing `mod`, or null.
export function pathTo(node, mod, trail = []) {
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

// Whether the layout block showing `mod` is on screen: nothing hidden on the way, each stack on it.
// null when no layout block shows it (a pane, an overlay).
export function panelOnScreen(mod) {
  const path = pathTo(layout(), mod);
  if (!path) return null;
  return path.every((n, i) => !n.hidden && (n.type !== "stack" || i === path.length - 1 || activeOf(n) === path[i + 1].id));
}

// Shows the layout block for `mod`: picks it in every stack on the way and shows hidden nodes.
// False when no layout block shows it.
export function revealPanel(mod) {
  const path = pathTo(layout(), mod);
  if (!path) return false;
  path.forEach((n, i) => { if (n.type === "stack" && i < path.length - 1 && activeOf(n) !== path[i + 1].id) run("layout.select", { stack: n.id, child: path[i + 1].id }); });
  for (const n of path) if (n.hidden && n.id) run("layout.show", { id: n.id });
  return true;
}

// Hides the layout block for `mod`. In a stack (the right-hand panel) that's the stack's container,
// the whole panel column, as the tab bar's buttons do; otherwise the block itself.
export function hidePanel(mod) {
  const path = pathTo(layout(), mod);
  if (!path) return false;
  let id = path[path.length - 1].id;
  for (let i = path.length - 2; i >= 0; i--) {
    if (path[i].type === "stack") { id = i > 0 && path[i - 1].id && i - 1 > 0 ? path[i - 1].id : path[i].id; break; }
  }
  if (id) run("layout.hide", { id });
  return Boolean(id);
}

// Close this panel wherever it is, and give the keyboard back to the focused terminal.
export function closePanel(mod) {
  const overlay = props()?.overlay;
  if (overlay) return closeOverlay(overlay);
  const pane = panes().find(p => p.mod === mod && p.focused);
  if (pane) return run("pane.close", { pane: pane.pane });
  hidePanel(mod);
  if (focused()?.pane) run("pane.focus", { pane: focused().pane });
}
