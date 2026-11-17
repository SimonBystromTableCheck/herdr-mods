// The setup screen: Obsidian, a vault (one Obsidian knows, an existing folder, or a new one), ripgrep,
// the editor and notes folder, and the optional TODO helper for agents. Settings go to
// ~/.config/herdr-app/notes.json, never into the mod folder. Each function takes the panel (`v`).
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { appHome, home, exec, pickFolder, notify } from "herdr";
import * as V from "./vault.js";

const HELPER = "~/.local/bin/feature-todo";
const AGENT_NOTE = `When asked to add something to TODO / TODO.md, don't write a TODO.md in the repo: run
\`feature-todo "One-line description (file:line)" ["another item" ...]\` from inside the repo. It adds
the items under ## Todos in this repo and branch's note in the Obsidian vault and prints the note's path.
Fall back to TODO.md only if it exits 2.`;

// What this machine has: the Obsidian app, Homebrew, ripgrep, the editor, the helper; and the vaults.
export function check(v, cx) {
  const s = v.setup;
  s.busy.check = "Checking…"; cx.notify();
  cx.spawn(async cx => {
    const editor = (s.editor.value().trim() || "nvim").split(/\s+/)[0];
    const script = [
      V.macos() ? `{ [ -d /Applications/Obsidian.app ] || [ -d "$HOME/Applications/Obsidian.app" ]; } && echo app=1`
        : `{ command -v obsidian || flatpak info md.obsidian.Obsidian || snap list obsidian; } >/dev/null 2>&1 && echo app=1`,
      `command -v brew >/dev/null 2>&1 && echo brew=1`,
      `command -v rg >/dev/null 2>&1 && echo rg=1`,
      `command -v ${editor.replace(/[^\w.+-]/g, "")} >/dev/null 2>&1 && echo editor=1`,
      `[ -x ${HELPER.replace("~", "$HOME")} ] && echo helper=1`,
      `command -v python3 >/dev/null 2>&1 && echo python=1`,
      `pgrep -xi obsidian >/dev/null 2>&1 && echo running=1`,
      "true",
    ].join("; ");
    const r = await V.sh(script).catch(() => null);
    const has = Object.fromEntries((r?.stdout ?? "").split("\n").filter(l => l.includes("=")).map(l => l.split("=")));
    s.doctor = { app: has.app === "1", brew: has.brew === "1", rg: has.rg === "1", editor: has.editor === "1",
      helper: has.helper === "1", python: has.python === "1", running: has.running === "1" };
    s.vaults = await V.knownVaults();
    if (!s.choice && s.vaults[0]) s.choice = s.vaults[0].path;
    delete s.busy.check;
    cx.notify();
  });
}

export async function openSetup(v, cx) {
  const { own } = await V.readSettings();
  const editor = InputState.new({ value: (own.editor ?? ["nvim"]).join(" "), placeholder: "nvim" });
  const folder = InputState.new({ value: own.folder ?? "Herdr", placeholder: "Herdr" });
  const newName = InputState.new({ value: "", placeholder: "Notes" });
  v.setup = { editor, folder, newName, newParent: `${home()}/Documents`, creating: false,
    choice: own.vault ? V.expand(own.vault) : null, busy: {}, error: null, doctor: null, vaults: [] };
  check(v, cx);
  cx.notify();
}

function run(v, cx, key, label, cmd, then) {
  const s = v.setup;
  s.busy[key] = label; s.error = null; cx.notify();
  cx.spawn(async cx => {
    const r = await V.sh(cmd, 600000).catch(e => ({ code: 1, stderr: String(e) }));
    delete s.busy[key];
    if (r.code) s.error = `${label.replace(/…$/, "")} failed: ${(r.stderr || r.stdout).trim().split("\n").slice(-3).join(" ")}`;
    else then?.();
    check(v, cx);
  });
}

async function chooseFolder(v, cx) {
  const s = v.setup;
  const path = await pickFolder({ prompt: "Choose your vault folder" });
  if (!path) return;
  const isVault = await exec("test", ["-d", `${path}/.obsidian`]).then(r => r.code === 0).catch(() => false);
  if (!isVault) await V.makeVault(path).catch(e => { s.error = String(e.message ?? e); });
  s.choice = path; s.creating = false;
  cx.notify();
}

async function createVault(v, cx) {
  const s = v.setup, name = s.newName.value().trim().replace(/[\\/:]/g, "-");
  if (!name) { s.error = "Give the new vault a name"; return cx.notify(); }
  const path = `${s.newParent.replace(/\/+$/, "")}/${name}`;
  if (await exec("test", ["-e", path]).then(r => r.code === 0).catch(() => false)) { s.error = `${V.tilde(path)} already exists: choose it with "Use an existing folder" instead`; return cx.notify(); }
  try { await V.makeVault(path); } catch (e) { s.error = String(e.message ?? e); return cx.notify(); }
  s.choice = path; s.creating = false; s.made = path;
  cx.notify();
}

async function installHelper(v, cx) {
  const s = v.setup;
  s.busy.helper = "Installing…"; cx.notify();
  const src = `${appHome()}/mods/notes/feature-todo`, dst = HELPER.replace("~", home());
  const r = await exec("sh", ["-c", 'mkdir -p "$(dirname "$2")" && cp "$1" "$2" && chmod +x "$2"', "install", src, dst]).catch(e => ({ code: 1, stderr: String(e) }));
  delete s.busy.helper;
  if (r.code) s.error = `Couldn't install the helper: ${r.stderr.trim()}`;
  check(v, cx);
}

export async function finish(v, cx) {
  const s = v.setup;
  if (!s.choice) { s.error = "Choose a vault first"; return cx.notify(); }
  const folder = s.folder.value().trim().replace(/^\/+|\/+$/g, "") || "Herdr";
  const editor = (s.editor.value().trim() || "nvim").split(/\s+/);
  try { await V.saveSettings({ vault: V.tilde(s.choice), folder, editor, setupDone: true }); }
  catch (e) { s.error = `Couldn't save ${V.SETTINGS()}: ${e.message ?? e}`; return cx.notify(); }
  v.setup = null;
  cx.spawn(async cx => v.start(cx)); // runs on: it watches the vault
  v.handle.focus();
  cx.notify();
  notify({ title: "Notes is ready", body: `Vault: ${V.tilde(s.choice)}`, level: "success", timeout: 3000 });
}

// ---- Drawing ----------------------------------------------------------------------------

export function button(id, text, kind, action, t, { disabled, busy } = {}) {
  const primary = kind === "primary";
  return h_flex().id(id).h(26).px(10).gap(5).flex_none().items_center().rounded(6).text_size(12).font_medium()
    .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
    .text_color(primary ? t.solid_foreground : t.foreground)
    .when(Boolean(disabled || busy), el => el.opacity(0.5))
    .when(!disabled && !busy, el => el.cursor_pointer().hover(s => s.opacity(0.88)).on_click((_e, cx) => { cx.stop_propagation(); action(cx); }))
    .child(busy || text);
}

const field = (t, label, input, hint) => v_flex().gap(3).flex_1().min_w(0)
  .child(div().text_size(11.5).text_color(t.dim).child(label))
  .child(div().on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .child(Input.new(input).h(28).px(8).rounded(6).border_1().border_color(t.input).bg(t.background).text_size(12)))
  .when(Boolean(hint), el => el.child(div().text_size(10.5).text_color(t.dim).child(hint)));

export function setupView(v, t) {
  const s = v.setup, d = s.doctor;
  const vaultBody = v_flex().gap(4)
    .children(s.vaults.map((x, i) => {
      const on = s.choice === x.path;
      return h_flex().id(`vault-${i}`).gap(8).px(8).py(5).items_center().rounded(6).cursor_pointer()
        .border_1().border_color(on ? t.accent : t.border).when(on, e => e.bg(t.raised)).hover(st => st.bg(t.hover))
        .on_click((_e, cx) => { s.choice = x.path; s.creating = false; cx.notify(); })
        .child(div().size(10).rounded_full().border_1().border_color(on ? t.accent : t.input).when(on, e => e.bg(t.accent)))
        .child(div().flex_1().min_w(0).truncate().text_size(12).child(V.tilde(x.path)))
        .when(Boolean(x.open), e => e.child(div().text_size(10.5).text_color(t.dim).child("open in Obsidian")));
    }))
    .when(Boolean(s.choice) && !s.vaults.some(x => x.path === s.choice), el => el.child(
      h_flex().gap(8).px(8).py(5).items_center().rounded(6).border_1().border_color(t.accent).bg(t.raised)
        .child(div().size(10).rounded_full().bg(t.accent))
        .child(div().flex_1().min_w(0).truncate().text_size(12).child(V.tilde(s.choice)))
        .when(s.made === s.choice, e => e.child(div().text_size(10.5).text_color(t.dim).child("new")))))
    .child(h_flex().gap(8).pt(4).flex_wrap()
      .child(button("vault-pick", "Use an existing folder…", null, cx => cx.spawn(async cx => chooseFolder(v, cx)), t))
      .child(button("vault-new", "Create a new vault", null, cx => { s.creating = !s.creating; if (s.creating) s.newName.focus(); cx.notify(); }, t)))
    .when(s.creating, el => el.child(v_flex().gap(6).p(8).mt(4).rounded(8).border_1().border_color(t.accent).bg(t.surface)
      .child(h_flex().gap(8).items_end()
        .child(field(t, "Name", s.newName))
        .child(button("vault-create", "Create", "primary", cx => cx.spawn(async cx => createVault(v, cx)), t)))
      .child(h_flex().gap(6).items_center().text_size(11).text_color(t.dim)
        .child(div().flex_1().min_w(0).truncate().child(`In ${V.tilde(s.newParent)}`))
        .child(div().id("vault-parent").cursor_pointer().text_color(t.accent).hover(st => st.text_color(t.foreground))
          .on_click((_e, cx) => cx.spawn(async cx => { const p = await pickFolder({ prompt: "Where should the new vault go?" }); if (p) { s.newParent = p; cx.notify(); } }))
          .child("Change…")))))
    .when(Boolean(s.made && s.made === s.choice), el => el.child(div().pt(2).text_size(11).text_color(t.ansi3)
      .child("To see it in Obsidian too: Open another vault → Open folder as vault → choose this folder.")));

  const steps = [
    { id: "app", title: "Obsidian (recommended)", done: d?.app,
      text: d?.app ? "Installed. Notes opens notes in it with o; the graph, plugins and mobile sync stay in Obsidian."
        : "The panel works on the vault's files alone. Obsidian adds the graph view, plugins and sync to your phone.",
      actions: !d || d.app ? [] : d.brew
        ? [button("app-brew", "Install with Homebrew", "primary", cx => run(v, cx, "app", "Installing…", "brew install --cask obsidian"), t, { busy: s.busy.app })]
        : [button("app-dl", "Download Obsidian", "primary", () => V.openUrl("https://obsidian.md/download"), t)] },
    { id: "vault", title: "Your vault", done: Boolean(s.choice), required: true,
      text: s.vaults.length ? "Pick the vault for your notes, or use another folder." : "Obsidian doesn't know any vault yet: use a folder you have, or create a new one.",
      body: vaultBody },
    { id: "rg", title: "ripgrep", done: d?.rg,
      text: d?.rg ? "Installed: text search (/) and \"linked from\" work." : "Needed for text search (/) and the \"linked from\" list. Without it notes still list, open and edit.",
      actions: !d || d.rg ? [] : d.brew
        ? [button("rg-brew", "Install with Homebrew", "primary", cx => run(v, cx, "rg", "Installing…", "brew install ripgrep"), t, { busy: s.busy.rg })]
        : [button("rg-dl", "How to install", null, () => V.openUrl("https://github.com/BurntSushi/ripgrep#installation"), t)] },
    { id: "prefs", title: "Editor and folder", done: d?.editor,
      text: "e opens a note in this editor in a split beside your terminal. Feature notes go in the folder below, one subfolder per repo.",
      warn: d && !d.editor ? `${s.editor.value().trim() || "nvim"} wasn't found on your PATH.` : null,
      body: h_flex().gap(8).items_start().child(field(t, "Editor command", s.editor)).child(field(t, "Feature notes folder", s.folder, "<vault>/<folder>/<repo>/<branch>.md")) },
    { id: "helper", title: "TODOs from agents (optional)", done: d?.helper,
      text: `Installs feature-todo to ${HELPER}: agents run it to add TODOs to the note for the repo and branch they're in. Needs python3.`,
      warn: d && !d.python ? "python3 wasn't found." : null,
      actions: !d ? [] : d.helper
        ? [button("helper-copy", "Copy instructions for your agents", null, cx => { cx.write_to_clipboard(AGENT_NOTE); v.flash("Copied: paste it into CLAUDE.md or AGENTS.md"); }, t),
           button("helper-reinstall", "Reinstall", null, cx => cx.spawn(async cx => installHelper(v, cx)), t, { busy: s.busy.helper })]
        : [button("helper-install", "Install", "primary", cx => cx.spawn(async cx => installHelper(v, cx)), t, { busy: s.busy.helper, disabled: !d.python })] },
  ];

  const row = (st, i) => {
    const icon = st.done ? div().size(18).flex_none().flex().items_center().justify_center().rounded_full().bg(t.ansi2).text_color(t.background).text_size(11).child("✓")
      : div().size(18).flex_none().flex().items_center().justify_center().rounded_full().border_1().border_color(st.required ? t.accent : t.border).text_size(10.5).text_color(t.muted).child(String(i + 1));
    return v_flex().id(`step-${st.id}`).gap(6).p(10).rounded(8).border_1().border_color(t.border).bg(t.background)
      .child(h_flex().gap(8).items_center().child(icon).child(div().flex_1().font_semibold().text_color(st.done && !st.body ? t.muted : t.foreground).child(st.title)))
      .child(div().pl(26).text_size(11.5).text_color(t.dim).child(st.text))
      .when(Boolean(st.warn), el => el.child(div().pl(26).text_size(11.5).text_color(t.ansi3).child(st.warn)))
      .when(Boolean(st.body), el => el.child(div().pl(26).child(st.body)))
      .when(Boolean(st.actions?.length), el => el.child(h_flex().pl(26).gap(8).flex_wrap().children(st.actions)));
  };

  return v_flex().id("setup-scroll").flex_1().min_h(0).overflow_y_scrollbar().p(10).gap(8)
    .child(v_flex().gap(3).p(4)
      .child(div().text_size(15).font_semibold().child("Set up Notes"))
      .child(div().text_size(11.5).text_color(t.dim).child("Notes shows an Obsidian vault beside your terminals: a note for each repo and branch with its todos, search, links, and editing in your editor. It reads and writes only the vault's files.")))
    .children(steps.map(row))
    .when(Boolean(s.error), el => el.child(div().px(4).text_size(11.5).text_color(t.ansi1).child(s.error)))
    .child(h_flex().gap(8).pt(4).items_center()
      .child(div().flex_1().text_size(11.5).text_color(t.dim).child(!d ? "Checking this machine…" : s.choice ? "Settings are saved to ~/.config/herdr-app/notes.json." : "Choose a vault to finish."))
      .child(button("setup-recheck", "Check again", null, cx => check(v, cx), t, { busy: s.busy.check }))
      .child(button("setup-finish", "Finish", "primary", cx => cx.spawn(async cx => finish(v, cx)), t, { disabled: !s.choice })));
}
