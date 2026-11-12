// Local dev servers: saved in servers.json, each run as a labeled herdr-core terminal
// so it outlives the app (and is found again by its label after a restart or crash).
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, hc, home, appHome, readTextFile, writeTextFile, terminals, theme, settings, run, nextCommand, focused, setShared, pickFolder } from "herdr";
import { keybar, keysCard } from "./keybar.js";

const ICON = "mods/servers", CHROME = "mods/workspace-chrome";
const LABEL = "herdr.server";
const configPath = () => `${appHome()}/servers.json`;
const tilde = p => p.startsWith(home()) ? "~" + p.slice(home().length) : p;
const untilde = p => p === "~" || p.startsWith("~/") ? home() + p.slice(1) : p;
const URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::\d+)?[^\s'"\x1b)]*/;

function keyOf(e) {
  const m = e.modifiers ?? {};
  if (m.control || m.platform || m.alt) return e.keystroke;
  if (["enter", "escape", "tab", "space", "up", "down", "left", "right", "backspace"].includes(e.key)) return e.key;
  return e.key_char ?? e.key;
}

const KEYS = {
  list: [
    { caps: ["s"], label: "start / stop" }, { caps: ["R"], label: "restart" }, { caps: ["l"], label: "logs" },
    { caps: ["o"], label: "open url" }, { caps: ["a"], label: "add" }, { caps: ["d"], label: "remove" },
  ],
  moving: [{ caps: ["j", "k"], label: "move" }, { caps: ["<", ">"], label: "first / last" }, { caps: ["r"], label: "refresh" }, { caps: ["q"], label: "close the panel" }],
  folder: [{ caps: ["enter"], label: "next" }, { caps: ["escape"], label: "cancel" }],
  command: [{ caps: ["enter"], label: "add server" }, { caps: ["escape"], label: "back" }],
};

// Without the interactive login shell, version managers (nvm, fnm, mise) aren't on PATH.
async function userShell() {
  const r = await exec("sh", ["-c", 'printf %s "$SHELL"']).catch(() => null);
  return r?.stdout.trim() || "/bin/zsh";
}

async function listDirs(path) {
  const script = 'for p in "$1"/*/; do [ -d "$p" ] || continue; p=${p%/}; n=${p##*/}; [ "$n" = node_modules ] && continue; g=0; k=0; [ -e "$p/.git" ] && g=1; [ -f "$p/package.json" ] && k=1; printf "%s\\0%s\\0%s\\0" "$n" "$g" "$k"; done';
  const r = await exec("sh", ["-c", script, "dirs", path]);
  const f = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 2 < f.length; i += 3) out.push({ name: f[i], git: f[i + 1] === "1", pkg: f[i + 2] === "1" });
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// Lockfiles live at a monorepo's root, so look upward for them.
async function detectCommands(dir) {
  const script = 'cd "$1" || exit 1; for f in Procfile Procfile.dev bin/dev bin/rails docker-compose.yml compose.yaml manage.py Cargo.toml go.mod Makefile; do [ -e "$f" ] && echo "$f"; done; d="$1"; while [ "$d" != / ] && [ "$d" != "$HOME" ]; do for l in pnpm-lock.yaml yarn.lock bun.lockb bun.lock package-lock.json; do [ -e "$d/$l" ] && { echo "lock:$l"; exit 0; }; done; d=$(dirname "$d"); done';
  const found = (await exec("sh", ["-c", script, "detect", dir]).catch(() => null))?.stdout.split("\n").filter(Boolean) ?? [];
  const lock = found.find(f => f.startsWith("lock:"))?.slice(5);
  const pm = lock === "pnpm-lock.yaml" ? "pnpm" : lock === "yarn.lock" ? "yarn" : lock?.startsWith("bun") ? "bun" : "npm";
  const out = [];
  const pkg = await readTextFile(`${dir}/package.json`).catch(() => null);
  if (pkg) {
    try {
      const rank = n => { const i = ["dev", "start", "serve", "preview"].findIndex(k => n === k || n.startsWith(k + ":")); return i < 0 ? 9 : i; };
      Object.entries(JSON.parse(pkg).scripts ?? {}).sort(([a], [b]) => rank(a) - rank(b))
        .forEach(([name, body]) => out.push({ command: pm === "yarn" ? `yarn ${name}` : `${pm} run ${name}`, hint: String(body) }));
    } catch {}
  }
  for (const proc of ["Procfile.dev", "Procfile"].filter(f => found.includes(f))) {
    const text = await readTextFile(`${dir}/${proc}`).catch(() => null);
    for (const line of (text ?? "").split("\n")) {
      const m = line.match(/^([\w-]+):\s*(.+)$/);
      if (m) out.push({ command: m[2].trim(), hint: `${proc}: ${m[1]}` });
    }
  }
  if (found.includes("bin/dev")) out.push({ command: "bin/dev", hint: "bin/dev" });
  if (found.includes("bin/rails")) out.push({ command: "bin/rails server", hint: "Rails" });
  if (found.includes("docker-compose.yml") || found.includes("compose.yaml")) out.push({ command: "docker compose up", hint: "Docker Compose" });
  if (found.includes("manage.py")) out.push({ command: "python manage.py runserver", hint: "Django" });
  if (found.includes("Cargo.toml")) out.push({ command: "cargo run", hint: "Cargo" });
  if (found.includes("go.mod")) out.push({ command: "go run .", hint: "Go" });
  return out;
}

const POLL_LOST_MS = 15000;

export default class Servers extends View {
  init(_props, cx) {
    this.servers = []; this.raw = null; this.loaded = false;
    this.branches = {}; this.urls = {}; this.busy = {}; this.errors = {};
    this.add = null; this.sel = 0;
    // Where "Add server" browses for project folders: servers.json "root" (set with
    // Change… in the add flow), else ~/code when it exists, else home.
    this.rootSetting = null; this.defaultRoot = home();
    this.handle = cx.focus_handle();
    cx.spawn(async cx => {
      const code = `${home()}/code`;
      if ((await exec("test", ["-d", code]).catch(() => null))?.code === 0) this.defaultRoot = code;
      this.shell = await userShell(); await this.load(); this.poll(cx); cx.notify(); });
    cx.timer.every(4000, cx => this.poll(cx));
    // pane.go moved the keyboard here, or `servers.key:<k>` from keys.json.
    cx.spawn(async cx => {
      for (;;) {
        const c = await nextCommand();
        if (c === "focus") {
          // One retry in case the first focus didn't land; focus that landed and then moved
          // (leaving quickly, a click, the leader popup) is the person's choice, so no retry then.
          const token = this.focusToken = (this.focusToken ?? 0) + 1;
          this.handle.focus();
          cx.timer.after(40, () => { if (this.handle.is_focused()) this.focusToken++; });
          cx.timer.after(150, cx => { if (this.focusToken === token && !this.handle.is_focused()) { this.handle.focus(); cx.notify(); } });
        }
        else if (c.startsWith("key:")) this.press(c.slice(4), cx);
        else if (c.startsWith("go:")) this.go(c.slice(3));
        cx.notify();
      }
    });
    // No blur event for a focus handle: poll it, redraw only on change.
    cx.timer.every(300, cx => {
      const k = this.handle.is_focused();
      if (k !== this.sharedKeys) { this.sharedKeys = k; setShared("servers.hasKeys", k); }
      if (k !== this.hadKeys) { this.hadKeys = k; cx.notify(); }
    });
  }

  // ---- Keys -----------------------------------------------------------------

  selected() { return this.servers[Math.min(this.sel, this.servers.length - 1)] ?? null; }

  // Leaving the panel: left goes straight back to the terminal the keyboard came from (pane.focus);
  // pane.go doesn't reliably move the keyboard out of a panel. Other directions are pane.go's.
  go(dir) {
    this.focusToken = (this.focusToken ?? 0) + 1; // cancel a pending focus retry
    const pane = focused()?.pane;
    if (dir === "left" && pane) return run("pane.focus", { pane });
    this.handle.focus();
    run("pane.go", { direction: dir });
  }

  // cmd-alt-arrows (keys.json pane.go) are handled here so leaving never depends on pane.go
  // knowing this panel holds the keyboard.
  navKey(e, cx) {
    const m = e.modifiers ?? {};
    if (!(m.platform && m.alt && !m.control && ["left", "right", "up", "down"].includes(e.key))) return false;
    cx.stop_propagation(); this.go(e.key); return true;
  }

  key(e, cx) { if (this.navKey(e, cx)) return; if (this.press(keyOf(e), cx)) cx.stop_propagation(); }

  press(k, cx) {
    if (this.keysOpen) {
      if (k === "escape" || k === "?" || k === "q") this.keysOpen = false;
      cx.notify(); return true;
    }
    if (k === "?") { this.keysOpen = true; cx.notify(); return true; }
    if (this.add) {
      if (k === "escape") { if (this.add.step === "command") { this.add.step = "folder"; this.add.error = null; } else this.add = null; cx.notify(); return true; }
      if (k === "enter") { this.add.step === "folder" ? this.add.selected && this.toCommand(cx) : this.confirmAdd(cx); return true; }
      return false;
    }
    const s = this.selected(), term = s && this.terminal(s), live = term?.state === "live", busy = s && this.busy[s.id];
    const move = i => { this.sel = Math.max(0, Math.min(this.servers.length - 1, i)); cx.notify(); };
    switch (k) {
      case "j": case "down": move(this.sel + 1); return true;
      case "k": case "up": move(this.sel - 1); return true;
      case "<": move(0); return true;
      case ">": move(this.servers.length - 1); return true;
      case "s": case "enter": case "space": if (s && !busy) live ? this.stop(s, cx) : this.start(s, cx); return true;
      case "R": if (s && !busy && live) this.stop(s, cx, cx => this.start(s, cx)); return true;
      case "l": if (term) run("terminal.peek", { terminal: term.address }); return true;
      case "o": { const url = live ? this.urls[s.id]?.split("|")[1] : null; if (url) exec("open", [url]); return true; }
      case "a": this.openAdd(cx); return true;
      case "d": if (s && !busy && !live) { this.remove(s, cx); this.sel = Math.max(0, this.sel - 1); } return true;
      case "r": this.poll(cx); return true;
      case "q":
        run("layout.hide", { id: "panel" });
        if (focused()?.pane) run("pane.focus", { pane: focused().pane });
        return true;
    }
    return false;
  }

  chips() {
    if (this.add) return this.add.step === "folder" ? KEYS.folder : KEYS.command;
    return [...KEYS.list.slice(0, 3), { caps: ["j", "k"], label: "move" }, ...KEYS.list.slice(3)];
  }

  async load() {
    const text = await readTextFile(configPath()).catch(() => null);
    if (this.loaded && text === this.raw) return false;
    this.raw = text; this.loaded = true;
    try {
      const json = text ? JSON.parse(text) : {};
      this.servers = json.servers ?? [];
      this.rootSetting = typeof json.root === "string" && json.root.trim() ? json.root.trim() : null;
    } catch { this.servers = []; }
    return true;
  }

  async save() {
    const text = JSON.stringify({ ...(this.rootSetting ? { root: this.rootSetting } : {}), servers: this.servers }, null, 2) + "\n";
    try { await writeTextFile(configPath(), text, this.raw); }
    catch { await writeTextFile(configPath(), text, await readTextFile(configPath()).catch(() => null)); }
    this.raw = text;
  }

  // Newest terminal for this server; a live one wins over finished ones.
  terminal(s) {
    const mine = terminals().filter(x => x.labels?.[LABEL] === s.id || x.name === `srv-${s.id}`);
    return mine.find(x => x.state === "live") ?? mine.sort((a, b) => (b.created_ms ?? 0) - (a.created_ms ?? 0))[0] ?? null;
  }

  // One poll at a time, but a poll stuck on a call that never answers (the app can drop a
  // mod's pending exec when a mod pane closes) is given up after POLL_LOST_MS, so the
  // branches keep following; a late reply from the old poll writes nothing.
  poll(cx) {
    if (this.polling && Date.now() - this.polling < POLL_LOST_MS) return;
    const gen = this.pollGen = (this.pollGen ?? 0) + 1;
    this.polling = Date.now();
    cx.spawn(async cx => {
      try {
        await this.load();
        for (const s of this.servers) {
          const r = await exec("git", ["branch", "--show-current"], { cwd: s.cwd, timeout: 5000 }).catch(() => null);
          if (gen !== this.pollGen) return;
          let branch = r?.code === 0 ? r.stdout.trim() : null;
          if (r?.code === 0 && !branch) {
            const h = await exec("git", ["rev-parse", "--short", "HEAD"], { cwd: s.cwd, timeout: 5000 }).catch(() => null);
            if (gen !== this.pollGen) return;
            branch = h?.code === 0 ? `detached @ ${h.stdout.trim()}` : null;
          }
          this.branches[s.id] = branch;
          const term = this.terminal(s);
          if (term?.state === "live" && !this.urls[s.id]?.startsWith(term.address + "|")) {
            const out = await hc(["read", term.address, "--lines", "400"]).catch(() => null);
            if (gen !== this.pollGen) return;
            const m = out?.stdout.match(URL_RE);
            if (m) this.urls[s.id] = `${term.address}|${m[0].replace("0.0.0.0", "localhost").replace(/[.,;]+$/, "")}`;
          }
        }
      } finally { if (gen === this.pollGen) this.polling = 0; cx.notify(); }
    });
  }

  start(s, cx) {
    this.busy[s.id] = "starting"; this.errors[s.id] = null; cx.notify();
    cx.spawn(async cx => {
      try {
        for (const old of terminals().filter(x => x.labels?.[LABEL] === s.id && x.state !== "live")) await hc(["rm", old.address]).catch(() => null);
        const r = await hc(["run", "--bg", "--json", "--no-parent", "--no-notify", "--outlive-parent",
          "--name", `srv-${s.id}`, "--cwd", s.cwd, "--label", `${LABEL}=${s.id}`, "--", this.shell ?? "/bin/zsh", "-lic", s.command]);
        if (r.code !== 0) this.errors[s.id] = (r.stderr || r.stdout).trim() || "Could not start";
        delete this.urls[s.id];
      } catch (e) { this.errors[s.id] = String(e); }
      finally { delete this.busy[s.id]; this.poll(cx); cx.notify(); }
    });
  }

  // A deliberate stop leaves nothing to inspect, so the finished terminal goes too.
  stop(s, cx, then) {
    const term = this.terminal(s);
    if (!term) return then?.(cx);
    this.busy[s.id] = "stopping"; cx.notify();
    cx.spawn(async cx => {
      try {
        if (term.state === "live") await hc(["kill", term.address]);
        await hc(["rm", term.address]).catch(() => null);
        delete this.urls[s.id];
      } catch (e) { this.errors[s.id] = String(e); }
      finally { delete this.busy[s.id]; cx.notify(); then?.(cx); }
    });
  }

  remove(s, cx) {
    this.stop(s, cx, cx => {
      this.servers = this.servers.filter(x => x.id !== s.id);
      cx.spawn(async cx => { await this.save(); cx.notify(); });
    });
  }

  // ---- Add flow -------------------------------------------------------------

  root() { return this.rootSetting ? untilde(this.rootSetting) : this.defaultRoot; }

  changeRoot(cx) {
    cx.spawn(async cx => {
      const dir = await pickFolder({ prompt: "Folder to pick servers from" });
      if (!dir) return;
      this.rootSetting = tilde(dir.replace(/\/+$/, ""));
      await this.save();
      if (this.add) { this.add.entries = new Map(); this.add.open = new Set(); this.add.selected = null; this.add.error = null; this.loadDir("", cx); }
      cx.notify();
    });
  }

  openAdd(cx) {
    this.add = { step: "folder", entries: new Map(), open: new Set(), selected: null, error: null };
    this.loadDir("", cx);
  }

  loadDir(rel, cx) {
    const add = this.add;
    cx.spawn(async cx => {
      try { add.entries.set(rel, await listDirs(rel ? `${this.root()}/${rel}` : this.root())); }
      catch (e) { add.error = String(e); }
      cx.notify();
    });
  }

  toggleDir(rel, cx) {
    const add = this.add;
    add.selected = rel;
    if (add.open.has(rel)) add.open.delete(rel);
    else { add.open.add(rel); if (!add.entries.has(rel)) this.loadDir(rel, cx); }
    cx.notify();
  }

  toCommand(cx) {
    const add = this.add, dir = `${this.root()}/${add.selected}`;
    add.step = "command"; add.dir = dir; add.commands = null; add.choice = 0;
    add.name = InputState.new({ value: add.selected.split("/").pop(), placeholder: "Name" });
    add.custom = InputState.new({ value: "", placeholder: "or type a command, e.g. pnpm start --port 3001" });
    add.custom.on("change", (_e, cx) => { add.choice = add.custom.value().trim() ? "custom" : 0; cx.notify(); });
    add.custom.on("submit", (_e, cx) => this.confirmAdd(cx));
    cx.spawn(async cx => { add.commands = await detectCommands(dir); cx.notify(); });
    cx.notify();
  }

  confirmAdd(cx) {
    const add = this.add;
    const command = add.choice === "custom" ? add.custom.value().trim() : add.commands?.[add.choice]?.command;
    const name = add.name.value().trim() || add.selected.split("/").pop();
    if (!command) { add.error = "Pick or type a command"; cx.notify(); return; }
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 20) || "server";
    const id = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
    this.servers.push({ id, name, cwd: add.dir, command, added: new Date().toISOString() });
    this.add = null;
    cx.spawn(async cx => { await this.save(); this.poll(cx); cx.notify(); });
    cx.notify();
  }

  // ---- Rendering ------------------------------------------------------------

  iconButton(id, icon, title, action, t, color) {
    return div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).cursor_pointer()
      .text_color(color ?? t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_click((e, cx) => { cx.stop_propagation(); action(cx); }).child(svg(icon).size(14));
  }

  button(id, text, primary, action, t, disabled) {
    return h_flex().id(id).h(30).px(12).items_center().rounded(7).text_size(12.5).font_medium()
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground)
      .when(disabled, el => el.opacity(0.45))
      .when(!disabled, el => el.cursor_pointer().hover(s => s.opacity(0.88)).on_click((_e, cx) => action(cx)))
      .child(text);
  }

  serverRow(s, t, mono, on) {
    const term = this.terminal(s), busy = this.busy[s.id];
    const live = term?.state === "live";
    const crashed = !live && term && term.state !== "live";
    const status = busy ?? (live ? "running" : crashed ? `exited${term.exit_code != null ? ` (${term.exit_code})` : ""}` : "stopped");
    const color = busy ? t.working : live ? t.ansi2 : crashed ? t.ansi1 : t.dim;
    const url = live ? this.urls[s.id]?.split("|")[1] : null;
    const branch = this.branches[s.id];
    return v_flex().id(`srv-${s.id}`).flex_none().p(10).gap(5).rounded(9).border_1().border_color(on ? (this.hadKeys ? t.accent : t.input) : t.border).bg(t.surface)
      .on_click((_e, cx) => { this.sel = this.servers.indexOf(s); cx.notify(); })
      .child(h_flex().gap(8).items_center()
        .child(busy ? svg(`${CHROME}/spinner.svg`).size(10).flex_none().text_color(color).spin(900) : div().size(8).flex_none().rounded_full().bg(color))
        .child(div().flex_1().min_w(0).truncate().font_semibold().child(s.name))
        .child(div().text_size(11).text_color(color).child(status))
        .when(!busy && live, el => el
          .child(this.iconButton(`restart-${s.id}`, `${ICON}/restart.svg`, "Restart", cx => this.stop(s, cx, cx => this.start(s, cx)), t))
          .child(this.iconButton(`stop-${s.id}`, `${ICON}/stop.svg`, "Stop", cx => this.stop(s, cx), t, t.ansi1)))
        .when(!busy && !live, el => el.child(this.iconButton(`start-${s.id}`, `${ICON}/play.svg`, "Start", cx => this.start(s, cx), t, t.ansi2)))
        .when(Boolean(term), el => el.child(this.iconButton(`logs-${s.id}`, `${CHROME}/terminal.svg`, "Logs", () => run("terminal.peek", { terminal: term.address }), t)))
        .when(!busy && !live, el => el.child(this.iconButton(`rm-${s.id}`, `${ICON}/trash.svg`, "Remove", cx => this.remove(s, cx), t))))
      .child(h_flex().gap(6).items_center().pl(16).text_size(12).text_color(branch ? t.foreground : t.dim)
        .child(svg(`${CHROME}/git-branch.svg`).size(12).flex_none().text_color(t.accent))
        .child(div().min_w(0).truncate().child(branch ?? "not a git repo"))
        .when(Boolean(url), el => el.child(div().flex_1())
          .child(h_flex().id(`url-${s.id}`).gap(4).items_center().flex_none().cursor_pointer().text_color(t.accent).hover(st => st.opacity(0.8))
            .on_click(() => exec("open", [url])).child(url.replace(/^https?:\/\//, "").replace(/\/$/, "")).child(svg(`${ICON}/external.svg`).size(11)))))
      .child(div().pl(16).text_size(11.5).text_color(t.dim).truncate().font_family(mono).child(`${tilde(s.cwd)} $ ${s.command}`))
      .when(Boolean(this.errors[s.id]), el => el.child(div().pl(16).text_size(11.5).text_color(t.ansi1).child(this.errors[s.id])));
  }

  dirRows(rel, depth, out, t) {
    for (const e of this.add.entries.get(rel) ?? []) {
      const path = rel ? `${rel}/${e.name}` : e.name, open = this.add.open.has(path), selected = this.add.selected === path;
      out.push(h_flex().id(`dir-${path}`).h(28).flex_none().pl(8 + depth * 16).pr(8).gap(7).items_center().rounded(7).cursor_pointer()
        .bg(selected ? t.selected : t.background).hover(s => s.bg(selected ? t.selected : t.hover))
        .on_click((_e, cx) => this.toggleDir(path, cx))
        .child(svg(`mods/files/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim))
        .child(svg(`mods/files/folder.svg`).size(14).flex_none().text_color(e.git || e.pkg ? t.accent : t.muted))
        .child(div().flex_1().min_w(0).truncate().child(e.name))
        .when(e.git, el => el.child(div().text_size(10.5).text_color(t.dim).child("git")))
        .when(e.pkg, el => el.child(div().text_size(10.5).text_color(t.dim).child("pkg"))));
      if (open) this.dirRows(path, depth + 1, out, t);
    }
    return out;
  }

  addView(t, mono) {
    const add = this.add;
    const header = (title, sub) => v_flex().flex_none().px(14).py(10).gap(2).border_b(1).border_color(t.border)
      .child(div().font_semibold().child(title)).child(div().text_size(11.5).text_color(t.dim).truncate().child(sub));
    const footer = (...children) => h_flex().flex_none().p(10).gap(8).justify_end().border_t(1).border_color(t.border).children(children);
    if (add.step === "folder") {
      return v_flex().flex_1().min_h(0)
        .child(h_flex().flex_none().items_center().border_b(1).border_color(t.border)
          .child(div().flex_1().min_w(0).child(header("Add server · 1/2 · Pick a folder", tilde(this.root())).border_b(0)))
          .child(div().flex_none().pr(10).child(this.button("add-root", "Change…", false, cx => this.changeRoot(cx), t))))
        .child(v_flex().id("dir-tree").flex_1().min_h(0).overflow_y_scrollbar().p(6).children(this.dirRows("", 0, [], t))
          .when(!add.entries.has("") || Boolean(add.error), el => el.child(div().p(8).text_size(12).text_color(add.error ? t.ansi1 : t.dim).child(add.error ?? "Loading…"))))
        .child(h_flex().flex_none().px(14).pt(8).text_size(11.5).text_color(t.dim).truncate()
          .child(add.selected ? `Selected: ${tilde(this.root())}/${add.selected}` : "Click a folder to select it (and expand it)"))
        .child(footer(this.button("add-cancel", "Cancel", false, cx => { this.add = null; cx.notify(); }, t),
          this.button("add-next", "Next", true, cx => this.toCommand(cx), t, !add.selected)));
    }
    const input = st => Input.new(st).h(32).px(10).rounded(7).border_1().border_color(t.input).bg(t.background).text_size(12.5).text_color(t.foreground);
    const option = (c, i) => {
      const on = add.choice === i;
      return h_flex().id(`cmd-${i}`).flex_none().px(8).py(6).gap(8).items_center().rounded(7).cursor_pointer()
        .border_1().border_color(on ? t.accent : t.background).bg(on ? t.selected : t.background).hover(s => s.bg(t.hover))
        .on_click((_e, cx) => { add.custom.set_value(""); add.choice = i; cx.notify(); })
        .child(div().size(8).flex_none().rounded_full().bg(on ? t.accent : t.border))
        .child(v_flex().flex_1().min_w(0)
          .child(div().truncate().font_family(mono).text_size(12).child(c.command))
          .child(div().truncate().text_size(11).text_color(t.dim).child(c.hint)));
    };
    return v_flex().flex_1().min_h(0)
      .child(header("Add server · 2/2 · Command", tilde(add.dir)))
      .child(v_flex().id("cmd-list").flex_1().min_h(0).overflow_y_scrollbar().p(10).gap(4)
        .child(div().text_size(11.5).text_color(t.dim).child("Name"))
        .child(input(add.name))
        .child(div().pt(10).text_size(11.5).text_color(t.dim).child("Start command"))
        .children(add.commands === null ? [div().text_size(12).text_color(t.dim).child("Looking for scripts…")]
          : add.commands.length ? add.commands.map(option) : [div().text_size(12).text_color(t.dim).child("No scripts found — type one below")])
        .child(div().pt(6).child(input(add.custom).when(add.choice === "custom", el => el.border_color(t.accent))))
        .when(Boolean(add.error), el => el.child(div().text_size(12).text_color(t.ansi1).child(add.error))))
      .child(footer(this.button("add-back", "Back", false, cx => { add.step = "folder"; add.error = null; cx.notify(); }, t),
        this.button("add-save", "Add server", true, cx => this.confirmAdd(cx), t)));
  }

  render() {
    const t = theme(), mono = settings().font_family ?? "JetBrains Mono";
    const running = this.servers.filter(s => this.terminal(s)?.state === "live").length;
    this.hadKeys = this.handle.is_focused();
    const sel = Math.min(this.sel, this.servers.length - 1);
    return v_flex().id("servers").relative().size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(this.hadKeys ? t.accent : t.border)
      .text_color(t.foreground).text_size(13)
      .track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .on_mouse_down("left", () => this.handle.focus())
      .on_size_change((size, cx) => { this.size = size; cx.notify(); })
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Servers"))
        .child(div().flex_1().text_size(12).text_color(t.dim).child(this.servers.length ? `${running}/${this.servers.length} running` : ""))
        .when(!this.add, el => el.child(h_flex().id("srv-add").h(26).px(8).gap(5).items_center().rounded(6).cursor_pointer()
          .text_size(12).text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => this.openAdd(cx)).child(svg(`${CHROME}/plus.svg`).size(13)).child("Add"))))
      .when(Boolean(this.add), el => el.child(this.addView(t, mono)))
      .when(!this.add, el => el.child(v_flex().id("srv-list").flex_1().min_h(0).overflow_y_scrollbar().p(8).gap(8)
        .children(this.servers.map((s, i) => this.serverRow(s, t, mono, i === sel)))
        .when(this.loaded && !this.servers.length, el => el.child(v_flex().p(16).gap(10).items_center().text_color(t.dim).text_size(12.5)
          .child("No servers yet")
          .child(this.button("srv-add-empty", "Add a server", true, cx => this.openAdd(cx), t))))))
      .child(keybar(t, { id: "servers", chips: this.chips(), width: this.size?.width, onKeys: cx => { this.keysOpen = true; this.handle.focus(); cx.notify(); } }))
      .when(Boolean(this.keysOpen), el => el.child(keysCard(t, { id: "servers", title: "Servers: all keys", onClose: cx => { this.keysOpen = false; cx.notify(); }, groups: [
        { title: "A server", chips: KEYS.list }, { title: "Moving", chips: KEYS.moving },
        { title: "Adding: pick a folder", chips: KEYS.folder }, { title: "Adding: command", chips: KEYS.command }] })));
  }
}
