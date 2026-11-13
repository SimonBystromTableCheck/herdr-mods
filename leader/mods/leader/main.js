// A tmux-style prefix: ctrl-a opens this popup, the next key runs a binding from bindings.js.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, theme, run, focused, hc, layout, settings, nextCommand, shared, setShared, spaces, panes, notify, exec, readTextFile, appHome } from "herdr";
import * as fs from "fs/promises";
import BINDINGS, { BUILTIN_PANELS } from "./bindings.js";
import { panelOnScreen, revealPanel, hidePanel } from "./panel.js";

// Installed panel mods (mod.json "panel" with a "leader" key), cached for every opening of the popup.
const PANELS = "leader.panels"; // {at, list: [{mod, key, label, expand?}]}

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

// Every mod a layout block shows.
function modsIn(node, out = new Set()) {
  if (node?.content?.mod) out.add(node.content.mod);
  for (const c of [...(node?.children ?? []), ...(node?.floating ?? [])]) modsIn(c, out);
  return out;
}

export default class Leader extends View {
  init(_props, cx) {
    this.panels = shared(PANELS)?.list ?? [];
    if (Date.now() - (shared(PANELS)?.at ?? 0) > 20000) this.scan(cx);
    // Read before this popup's own focus makes the panel report it lost the keyboard.
    const candidates = new Set([...modsIn(layout()), ...this.panels.map(p => p.mod), ...panes().map(p => p.mod).filter(Boolean)]);
    this.fromPanel = [...candidates].find(m => shared(`${m}.hasKeys`) === true) ?? null;
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

  scan(cx) {
    cx.spawn(async cx => {
      const list = [];
      let names = [];
      try { names = await fs.readdir(`${appHome()}/mods`); } catch { return; }
      for (const mod of names.sort()) {
        try {
          const panel = JSON.parse(await readTextFile(`${appHome()}/mods/${mod}/mod.json`)).panel;
          if (panel?.leader) list.push({ mod, key: panel.leader, label: panel.title ?? mod, expand: panel.expand });
        } catch { /* not a mod */ }
      }
      setShared(PANELS, { at: Date.now(), list });
      this.panels = list;
      cx.notify();
    });
  }

  // The key list: this file's bindings, Herdr's own panels where the layout has them, then the
  // installed panel mods. A key already taken keeps its first owner.
  bindings() {
    const root = layout(), taken = new Set(BINDINGS.map(b => b.key)), out = [...BINDINGS];
    const add = b => { if (taken.has(b.key)) return; taken.add(b.key); out.push({ group: "Panels", ...b }); };
    for (const b of BUILTIN_PANELS) { const mod = find(root, b.child)?.content?.mod; if (mod) add({ key: b.key, label: b.label, mod }); }
    for (const p of this.panels) add({ key: p.key, label: p.label, mod: p.mod });
    return out;
  }

  press(k, cx) {
    if (k === "escape" || k === "q") return this.close();
    if (k === "ctrl-a") {
      const term = focused()?.terminal;
      this.close();
      if (term) hc(["keys", term, "ctrl+a"]);
      return;
    }
    const b = this.bindings().find(x => x.key === k);
    if (!b) { this.miss = k; cx.notify(); return; }
    if (b.action === "expand") return this.expand(cx);
    // gitview (Changes): move for it while this popup is still open, then close it. Closed first,
    // the app still has gitview as the keyboard's owner and hands it `focus` again when the popup
    // goes, which starts gitview's takeKeyboard loop and leaves its handle with the keys while
    // the app's focus is on the terminal (nothing looks focused).
    if (b.run === "pane.go" && this.fromPanel === "gitview") {
      const pane = focused()?.pane;
      if (b.args.direction === "left" && pane) run("pane.focus", { pane });
      else run("pane.go", b.args);
      return this.close();
    }
    if (b.mod) return this.panel(b.mod, cx);
    this.close();
    // pane.go would start from the last focused terminal, not the panel this popup took the keyboard
    // from, so that panel makes the move itself once it has the keyboard back.
    if (b.run === "pane.go" && this.fromPanel) return run(`${this.fromPanel}.go:${b.args.direction}`);
    run(b.run, b.args ?? {});
  }

  // A panel: shown and holding the keyboard, hide it; shown with the keyboard elsewhere (a terminal),
  // give it the keyboard; hidden, show it and give it the keyboard. A mod no layout block shows
  // opens as a pane on the right of the tab (or gets focused there if it already is).
  panel(mod, cx) {
    const on = panelOnScreen(mod);
    if (on && this.fromPanel === mod) {
      this.close();
      hidePanel(mod);
      if (focused()?.pane) run("pane.focus", { pane: focused().pane });
      return;
    }
    if (on === null) {
      const pane = panes().find(p => p.mod === mod && p.tab === focused()?.tab);
      this.close();
      if (pane) run("pane.focus", { pane: pane.pane });
      else run("pane.split", { direction: "right", mod });
      return;
    }
    revealPanel(mod);
    this.enterPanel(cx);
  }

  // Enter the right-hand panel the way the app's own navigation does (pane.go), not by
  // sending the mod `focus` itself: only then does the app know the panel holds the keyboard,
  // so pane.go / cmd-alt-left leave it cleanly and it gets `focus` again when this popup closes.
  // From the focused terminal, `right` as many times as the tab has panes always ends in the
  // panel (the rightmost column; pane.go from it to the right does nothing). Waits a moment so
  // the panel shown just now is laid out, then closes this popup.
  enterPanel(cx) {
    cx.timer.after(60, () => {
      const f = focused();
      if (f?.pane) run("pane.focus", { pane: f.pane });
      const n = panes().filter(p => p.tab === f?.tab).length;
      for (let i = 0; i <= n; i++) run("pane.go", { direction: "right" });
      this.close();
    });
  }

  // leader + E: an expanded view collapses; a panel with an expanded view expands; a panel
  // without one says so; anywhere else (a terminal) both side areas fold away, and come back.
  // gitview's list says when it has the keyboard only through a local patch (gitview/main.js);
  // after a gitview upgrade drops it, the Changes panel is treated like a terminal here.
  expand(cx) {
    const f = focused(), space = spaces().find(s => s.active);
    // The `changes-expand` launcher (also cmd-g) focuses the terminal when gitview's diff pane has
    // the focus, then opens gitview's tab. A launcher window opened from this popup's own handler
    // never starts, so close, then ask the app through `herdr-app do`, as a key would. No timers.
    const gitview = () => {
      this.close();
      exec("herdr-app", ["do", "mod.open", JSON.stringify({ name: "changes-expand" })])
        .catch((e) => notify({ title: "Couldn't open gitview's tab", body: String(e?.message ?? e), level: "error" }));
    };
    const fromGitTab = this.fromGitTab, ownTab = f?.tab && (shared("gitview.own") ?? {})[space?.id] === f.tab;
    // A list that closed while it had the keys can leave the flag set, so it counts only while Changes shows.
    const changesMod = find(layout(), "changes")?.content?.mod, changesShown = Boolean(changesMod && panelOnScreen(changesMod));
    if (ownTab || (this.fromGitview && changesShown && !fromGitTab && !this.panels.some(p => p.mod === this.fromPanel && p.expand))) return gitview();
    this.close();
    if (this.fromGitTab) return run("git.collapse");
    const own = this.panels.find(p => p.mod === this.fromPanel);
    if (own?.expand) return run(`${own.mod}.${own.expand}`);
    if (this.fromPanel) {
      notify({ title: `${this.fromPanel[0].toUpperCase()}${this.fromPanel.slice(1)} has no expanded view`, level: "info", timeout: 2500 });
      return;
    }
    const sidebar = find(layout(), "sidebar"), panel = find(layout(), "panel");
    if (sidebar?.hidden && panel?.hidden) {
      const was = shared("leader.zen") ?? { sidebar: true, panel: true };
      if (was.sidebar && sidebar) run("layout.show", { id: "sidebar" });
      if (was.panel && panel) run("layout.show", { id: "panel" });
      setShared("leader.zen", null);
      return;
    }
    setShared("leader.zen", { sidebar: !sidebar?.hidden, panel: !panel?.hidden });
    if (sidebar) run("layout.hide", { id: "sidebar" });
    if (panel) run("layout.hide", { id: "panel" });
  }

  render() {
    const t = theme(), mono = settings().font_family ?? "JetBrains Mono";
    const all = this.bindings(), groups = [...new Set(all.map(b => b.group))];
    return v_flex().id("leader").size_full().p(14).gap(10).bg(t.popover).text_color(t.foreground).text_size(12.5)
      .track_focus(this.handle)
      .on_key_down((e, cx) => { if (MODIFIERS.has(e.key)) return; cx.stop_propagation(); this.press(keyOf(e), cx); })
      .child(h_flex().gap(8).items_center()
        .child(div().px(6).py(1).rounded(5).bg(t.accent).text_color(t.accent_foreground).font_family(mono).text_size(11.5).child("ctrl-a"))
        .child(div().flex_1().text_color(this.miss ? t.ansi1 : t.dim).child(this.miss ? `Nothing on "${this.miss}"` : "Press a key"))
        .child(div().text_size(11).text_color(t.dim).child("esc cancel · ctrl-a send ctrl-a")))
      .child(h_flex().flex_1().gap(18).items_start().children(groups.map(g => v_flex().flex_1().gap(3)
        .child(div().pb(2).text_size(11).font_semibold().text_color(t.muted).child(g))
        .children(all.filter(b => b.group === g && !b.hidden).map(b => h_flex().gap(8).items_center()
          .child(div().w(30).flex_none().font_family(mono).text_color(t.accent).child(b.key === "1" && g === "Tabs" ? "1-9" : b.key))
          .child(div().flex_1().min_w(0).truncate().child(b.label)))))));
  }
}
