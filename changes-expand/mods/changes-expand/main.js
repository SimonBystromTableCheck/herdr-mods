// cmd-g and leader+e: gitview's own tab (`gitview-tab`) for the repo you're in. Draws nothing.
//
// gitview-tab takes its repo from the focused pane's folder, else the space's. Picking a file in
// Changes leaves gitview's diff pane (a mod pane, no folder) focused, so it opened on the space's
// folder ("no changes" when that isn't the repo). This launcher focuses the tab's terminal first.
//
// gitview-tab is itself a launcher window. Opened from another overlay's handler (this one, or the
// leader's popup) it stays open and never starts; opened from outside (a keys.json key, the CLI) it
// works. So this closes itself and asks the app through `herdr-app do`, as gitview does. No timers.

import { View, div } from "gpui-kit";
import { closeOverlay, exec, focused, notify, panes, props, run, shared } from "herdr";

export default class ChangesExpand extends View {
  init() {
    // Only when opened (cmd-g, mod.open): `herdr-app check` runs init too, without an overlay.
    const overlay = props()?.overlay;
    if (!overlay) return;
    const f = focused();
    const own = Object.values(shared("gitview.own") ?? {}).includes(f?.tab);
    const fp = f?.pane && panes().find((p) => p.pane === f.pane);
    const term = !own && fp && !fp.cwd && panes().find((p) => p.tab === f.tab && p.terminal && p.cwd);
    closeOverlay(overlay);
    if (term) run("pane.focus", { pane: term.pane });
    exec("herdr-app", ["do", "mod.open", JSON.stringify({ name: "gitview-tab" })])
      .catch((e) => notify({ title: "Couldn't open gitview's tab", body: String(e?.message ?? e), level: "error" }));
  }

  render() {
    return div();
  }
}
