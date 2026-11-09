// A tmux-style prefix: ctrl-a opens this popup, the next key runs a binding from bindings.js.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, theme, run, focused, hc, layout, settings, nextCommand, shared, setShared, spaces, notify } from "herdr";
import BINDINGS from "./bindings.js";

const MODIFIERS = new Set(["shift", "control", "alt", "platform", "function", "capslock", "cmd", "ctrl"]);

function keyOf(e) {
  const m = e.modifiers ?? {};
  if (m.control || m.platform || m.alt) return e.keystroke;
  if (["enter", "escape", "tab", "space", "up", "down", "left", "right", "backspace"].includes(e.key)) return e.key;
  return e.key_char ?? e.key;
}

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) { const f = find(child, id); if (f) return f; }
  return null;
}

export default class Leader extends View {
  init(_props, cx) {
    // Read before this popup's own focus makes the panel report it lost the keyboard.
    this.fromPanel = ["git", "skills", "todos", "gitview", "pond-files", "servers"].find(m => shared(`${m}.hasKeys`) === true) ?? null;
    this.fromGitTab = shared("git.tabHasKeys") === true;
    this.fromGitview = shared("gitview.hasKeys") === true;
    this.handle = cx.focus_handle();
    this.handle.focus();
    // The popup takes the keyboard a moment after it opens.
    cx.timer.after(30, () => this.handle.focus());
    cx.timer.after(250, () => this.handle.focus());
    cx.spawn(async cx => { for (;;) { const c = await nextCommand(); if (c.startsWith("key:")) this.press(c.slice(4), cx); } });
  }

  close() { closeOverlay(props().overlay); }

  press(k, cx) {
    if (k === "escape" || k === "q") return this.close();
    if (k === "ctrl-a") {
      const term = focused()?.terminal;
      this.close();
      if (term) hc(["keys", term, "ctrl+a"]);
      return;
    }
    const b = BINDINGS.find(x => x.key === k);
    if (!b) { this.miss = k; cx.notify(); return; }
    if (b.action === "expand") return this.expand(cx);
    this.close();
    if (b.panel) {
      const panel = find(layout(), "panel"), body = find(layout(), "panel-body"), mod = b.mod ?? b.panel;
      // Shown but the keyboard is elsewhere (a terminal): focus it rather than hide it.
      if (b.toggle && panel && !panel.hidden && body?.active === b.panel && (!b.focus || this.fromPanel === mod)) {
        run("layout.hide", { id: "panel" });
        // The panel may have had the keyboard; hand it back to the terminal.
        if (focused()?.pane) run("pane.focus", { pane: focused().pane });
        return;
      }
      run("layout.select", { stack: "panel-body", child: b.panel });
      run("layout.show", { id: "panel" });
      if (b.focus) run(`${mod}.focus`);
      return;
    }
    // pane.go would start from the last focused terminal, not the panel this popup took the keyboard
    // from, so that panel makes the move itself once it has the keyboard back.
    if (b.run === "pane.go" && this.fromPanel) return run(`${this.fromPanel}.go:${b.args.direction}`);
    run(b.run, b.args ?? {});
  }

  // leader + E: an expanded view collapses; a panel with an expanded view expands; a panel
  // without one says so; anywhere else (a terminal) both side areas fold away, and come back.
  // gitview's list says when it has the keyboard only through a local patch (gitview/main.js);
  // after a gitview upgrade drops it, the Changes panel is treated like a terminal here.
  expand(cx) {
    const f = focused(), space = spaces().find(s => s.active);
    // gitview's launcher is an overlay window too: started in the same moment this popup closes
    // (inside gitview's tab) it never runs. Start it first, close this popup a moment later.
    const gitview = () => { run("mod.open", { name: "gitview-tab" }); cx.timer.after(80, () => this.close()); };
    const fromGitTab = this.fromGitTab, ownTab = f?.tab && (shared("gitview.own") ?? {})[space?.id] === f.tab;
    // A list that closed while it had the keys can leave the flag set, so it counts only while Changes shows.
    const changesShown = !find(layout(), "panel")?.hidden && find(layout(), "panel-body")?.active === "changes";
    if (ownTab || (this.fromGitview && changesShown && !fromGitTab && this.fromPanel !== "git")) return gitview();
    this.close();
    if (this.fromGitTab) return run("git.collapse");
    if (this.fromPanel === "git") return run("git.expand");
    if (this.fromPanel) {
      notify({ title: `${this.fromPanel[0].toUpperCase()}${this.fromPanel.slice(1)} has no expanded view`, level: "info", timeout: 2500 });
      return;
    }
    const sidebar = find(layout(), "sidebar"), panel = find(layout(), "panel");
    if (sidebar?.hidden && panel?.hidden) {
      const was = shared("leader.zen") ?? { sidebar: true, panel: true };
      if (was.sidebar) run("layout.show", { id: "sidebar" });
      if (was.panel) run("layout.show", { id: "panel" });
      setShared("leader.zen", null);
      return;
    }
    setShared("leader.zen", { sidebar: !sidebar?.hidden, panel: !panel?.hidden });
    run("layout.hide", { id: "sidebar" });
    run("layout.hide", { id: "panel" });
  }

  render() {
    const t = theme(), mono = settings().font_family ?? "JetBrains Mono";
    const groups = [...new Set(BINDINGS.map(b => b.group))];
    return v_flex().id("leader").size_full().p(14).gap(10).bg(t.popover).text_color(t.foreground).text_size(12.5)
      .track_focus(this.handle)
      .on_key_down((e, cx) => { if (MODIFIERS.has(e.key)) return; cx.stop_propagation(); this.press(keyOf(e), cx); })
      .child(h_flex().gap(8).items_center()
        .child(div().px(6).py(1).rounded(5).bg(t.accent).text_color(t.accent_foreground).font_family(mono).text_size(11.5).child("ctrl-a"))
        .child(div().flex_1().text_color(this.miss ? t.ansi1 : t.dim).child(this.miss ? `Nothing on "${this.miss}"` : "Press a key"))
        .child(div().text_size(11).text_color(t.dim).child("esc cancel · ctrl-a send ctrl-a")))
      .child(h_flex().flex_1().gap(18).items_start().children(groups.map(g => v_flex().flex_1().gap(3)
        .child(div().pb(2).text_size(11).font_semibold().text_color(t.muted).child(g))
        .children(BINDINGS.filter(b => b.group === g && !b.hidden).map(b => h_flex().gap(8).items_center()
          .child(div().w(30).flex_none().font_family(mono).text_color(t.accent).child(b.key === "1" && g === "Tabs" ? "1-9" : b.key))
          .child(div().flex_1().min_w(0).truncate().child(b.label)))))));
  }
}
