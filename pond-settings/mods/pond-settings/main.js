// Pond settings: every pond mod and layout in one place, with the installed and the latest published
// version, and an Update button where a newer one is out. Opened from the duck in pond-chrome's footer.
//
// It reads what the mods' own update pills read (each mod.json's "source" and "version", the repo's
// versions.json, cached in shared "herdr-mods.versions") and updates the same way: a confirm, then
// Claude in a new tab following UPDATE.md. It doesn't change any mod's own update logic.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { appHome, readTextFile, openOverlay, closeOverlay, props, shared, setShared, theme, checking } from "herdr";
import * as fs from "fs/promises";

const REPO = "https://github.com/SimonBystromTableCheck/herdr-mods";
const KEY = "herdr-mods.versions"; // the update pills' cache: {repo, at, mods: {name: version}, layouts: {name: version}}
const FRESH = 5 * 60 * 1000;
const ICONS = "mods/pond-settings/icons";
const CATALOG = "pond-settings.layouts"; // published layouts: {at, layouts: {name: {version, item, mods}}}

const newer = (a, b) => { // a > b, semver-ish (as update.js)
  const p = v => String(v).split(/[.\-+]/).map(x => Number.parseInt(x, 10) || 0);
  const x = p(a), y = p(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
};
const raw = path => `https://raw.githubusercontent.com/${REPO.replace("https://github.com/", "")}/main/${path}`;

export default class PondSettings extends View {
  init(_props, cx) {
    this.mods = []; this.layouts = []; this.herdr = new Set();
    this.checking = false; this.error = null;
    this.scan(cx);
    const c = shared(KEY);
    if (!checking() && (c?.repo !== REPO || !c.layouts || !shared(CATALOG) || Date.now() - (c.at ?? 0) > FRESH)) this.check(cx);
  }

  // What's installed: every mod folder and layout file, minus Herdr's own (installed.json lists those).
  scan(cx) {
    cx.spawn(async cx => {
      const home = appHome();
      try { this.herdr = new Set(Object.keys(JSON.parse(await readTextFile(`${home}/installed.json`) ?? "{}"))); } catch {}
      const read = async p => { try { return JSON.parse(await readTextFile(p)); } catch { return null; } };
      const mods = [];
      for (const name of (await fs.readdir(`${home}/mods`).catch(() => [])).sort()) {
        if (this.herdr.has(name) || name.startsWith(".")) continue;
        const m = await read(`${home}/mods/${name}/mod.json`);
        if (!m) continue;
        const own = await readTextFile(`${home}/mods/${name}/UPDATE.md`).then(t => t !== null).catch(() => false);
        mods.push({ name, title: m.title ?? m.panel?.title ?? null, version: m.version ?? null, source: m.source ?? null, cloned: m.cloned_from?.name ?? null, own });
      }
      const layouts = [];
      for (const f of (await fs.readdir(`${home}/layouts`).catch(() => [])).sort()) {
        if (!f.endsWith(".json")) continue;
        const name = f.slice(0, -5);
        if (this.herdr.has(`layout:${name}`)) continue;
        const l = await read(`${home}/layouts/${f}`);
        if (l) layouts.push({ name, version: l.version ?? null, source: l.source ?? null, cloned: l.cloned_from?.name ?? null });
      }
      this.mods = mods; this.layouts = layouts;
      cx.notify();
    });
  }

  // The published versions: the same fetch and cache as the mods' update pills.
  check(cx) {
    if (this.checking) return;
    this.checking = true; this.error = null; cx.notify();
    cx.spawn(async cx => {
      try {
        const r = await fetch(raw("versions.json"));
        if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
        const index = await r.json();
        const versions = o => Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k, v.version]));
        setShared(KEY, { repo: REPO, at: Date.now(), mods: versions(index.mods), layouts: versions(index.layouts) });
        // Its own key, so the pills' cache keeps its shape: what each layout needs, for Available layouts.
        setShared(CATALOG, { at: Date.now(), layouts: Object.fromEntries(Object.entries(index.layouts ?? {})
          .map(([k, v]) => [k, { version: v.version, item: v.item, mods: v.mods ?? [] }])) });
      } catch (e) { this.error = String(e?.message ?? e); }
      this.checking = false;
      this.scan(cx);
    });
  }

  // One row's state. kind: "repo" (installed from herdr-mods), "unlinked" (a published name, installed
  // without a source: UPDATE.md leaves those alone), "clone" (a person's own copy), "local".
  status(item, isLayout) {
    const c = shared(KEY), pub = c?.repo === REPO ? c[isLayout ? "layouts" : "mods"] ?? {} : {};
    const published = item.source?.repo === REPO ? item.source[isLayout ? "layout" : "mod"] : null;
    if (published) {
      const latest = pub[published] ?? null, have = item.version ?? "0.0.0";
      const ownClone = item.cloned && pub[item.cloned] !== undefined;
      if (ownClone) return { kind: "clone", latest };
      return { kind: "repo", published, latest, outdated: Boolean(latest && newer(latest, have)) };
    }
    if (pub[item.name] !== undefined) return { kind: "unlinked", latest: pub[item.name] };
    return { kind: "local", latest: null };
  }

  // Asks, then starts Claude in the Herdr home to update these (as the update pills do, for several).
  update(list) {
    if (!list.length) return;
    const one = list.length === 1 ? list[0] : null;
    const what = list.map(x => `the ${x.isLayout ? `layout at layouts/${x.name}.json` : `mod at mods/${x.name}`} (published as "${x.st.published}") from ${x.version ?? "0.0.0"} to ${x.st.latest}`).join("; ");
    const guide = one && !one.isLayout && one.own ? `mods/${one.name}/UPDATE.md` : raw("tools/UPDATE.md");
    const task = [
      `Update these Herdr items from ${REPO}: ${what}.`,
      `Follow ${guide}, but only for ${one ? "this one" : "these"}${list.some(x => x.isLayout) ? " (and the mods a layout lists, asking about them as UPDATE.md says)" : ""}: skip finding other installed mods and layouts.`,
      `I already confirmed this update, so don't ask again whether to update; show me the new "## Changes" entries,`,
      `and still stop and ask before replacing any of my own edits or keys.`,
    ].join(" ");
    const title = one ? `Update ${one.name} to ${one.st.latest}?` : `Update ${list.length} pond items?`;
    openOverlay({ mod: "confirm", kind: "dialog", width: 440, props: {
      title,
      detail: `${list.map(x => `${x.name} ${x.version ?? "0.0.0"} → ${x.st.latest}`).join(", ")}. A new Claude tab will follow UPDATE.md: back up what it replaces, check for your own edits, install and check.`,
      command: { name: "tab.new", args: { name: one ? `Update ${one.name}` : "Update pond", folder: appHome(), argv: ["claude"], task } },
    } });
  }

  // Published layouts not installed here: none of mine has that name or comes from it.
  available() {
    const all = shared(CATALOG)?.layouts ?? {};
    const have = new Set(this.layouts.flatMap(l => [l.name, l.source?.repo === REPO ? l.source.layout : null]).filter(Boolean));
    const mods = new Set(this.mods.map(m => m.name));
    return Object.entries(all).filter(([name]) => !have.has(name))
      .map(([name, v]) => ({ name, ...v, adds: v.mods.filter(m => !mods.has(m) && !this.herdr.has(m)) }));
  }

  // Asks, then starts Claude in the Herdr home to add the layout and the mods it needs. Never switches to it.
  install(l) {
    const task = [
      `Install the "${l.name}" layout from ${REPO} (item "${l.item}": its layout is ${l.item}/layouts/${l.name}.json, its brief ${l.item}/RECIPE.md;`,
      `versions.json lists the mods it uses: ${l.mods.join(", ")}).`,
      `Follow AGENTS.md's "Layouts and mods other people made" steps: read the recipe and every file first and tell me what reaches`,
      `outside its folder; copy the layout and each mod I don't have yet (${l.adds.length ? l.adds.join(", ") : "none"}), keeping their "source" stamps so updates find them;`,
      `never overwrite anything of mine (a taken name: tell me rather than renaming); a mod I already have from that repo but older:`,
      `offer to update it as ${raw("tools/UPDATE.md")} says. Run herdr-app check on each mod. Don't switch layouts: my current one stays;`,
      `tell me it's in Settings → Look or ctrl-shift-L. I already confirmed the install, so don't ask again whether to install.`,
    ].join(" ");
    openOverlay({ mod: "confirm", kind: "dialog", width: 440, props: {
      title: `Install the ${l.name} layout?`,
      detail: `${l.adds.length ? `It adds ${l.adds.length} mod${l.adds.length > 1 ? "s" : ""} (${l.adds.join(", ")}). ` : ""}Your current layout stays as it is and stays shown; switch whenever you like (Settings → Look or ctrl-shift-L). A new Claude tab will install it and check it.`,
      command: { name: "tab.new", args: { name: `Install ${l.name}`, folder: appHome(), argv: ["claude"], task } },
    } });
  }

  availableRow(l, t) {
    return h_flex().id(`row-a-${l.name}`).h(36).px(10).gap(10).items_center().rounded(6).hover(s => s.bg(t.hover))
      .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(t.foreground).child(l.name))
      .when(l.adds.length > 0, el => el.child(div().flex_none().text_size(11.5).text_color(t.dim).child(`adds ${l.adds.length} mod${l.adds.length > 1 ? "s" : ""}`)))
      .child(div().w(64).flex_none().text_right().text_size(12).font_family("JetBrains Mono").text_color(t.dim).child("—"))
      .child(div().w(18).flex_none())
      .child(div().w(64).flex_none().text_size(12).font_family("JetBrains Mono").text_color(t.muted).child(l.version ?? ""))
      .child(h_flex().w(130).flex_none().justify_end().child(this.button(`install-${l.name}`, "Install", false, () => this.install(l), t)));
  }

  button(id, text, primary, action, t) {
    return h_flex().id(id).h(26).px(10).gap(5).flex_none().items_center().rounded(6).text_size(12).font_medium()
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground)
      .cursor_pointer().hover(s => s.opacity(0.88))
      .on_click((_e, cx) => { cx.stop_propagation(); action(cx); })
      .child(text);
  }

  row(item, isLayout, t) {
    const st = item.st;
    const tag = text => div().flex_none().px(5).h(16).flex().items_center().rounded(3).text_size(10).bg(t.raised).text_color(t.dim).child(text);
    const right = st.kind === "repo"
      ? (st.outdated ? this.button(`update-${item.name}`, `Update to ${st.latest}`, true, () => this.update([{ ...item, isLayout }]), t)
        : st.latest ? h_flex().gap(5).items_center().text_size(11.5).text_color(t.dim).child(svg(`${ICONS}/check.svg`).size(12)).child("Up to date")
        : div().text_size(11.5).text_color(t.dim).child(this.checking ? "Checking…" : "Not published"))
      : st.kind === "unlinked" ? div().id(`hint-${item.name}`).text_size(11.5).text_color(t.dim).tooltip("Installed without a source, so updates leave it alone. Reinstall it from herdr-mods to link it.").child("Not linked")
      : st.kind === "clone" ? div().id(`hint-${item.name}`).text_size(11.5).text_color(t.dim).tooltip(`Your own copy of ${item.cloned}: never updated.`).child("Your copy")
      : div().text_size(11.5).text_color(t.dim).child("Local");
    return h_flex().id(`row-${isLayout ? "l" : "m"}-${item.name}`).h(36).px(10).gap(10).items_center().rounded(6).hover(s => s.bg(t.hover))
      .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(t.foreground).child(item.name))
      .when(Boolean(item.title) && item.title !== item.name, el => el.child(div().flex_none().max_w(140).truncate().text_size(11.5).text_color(t.dim).child(item.title)))
      .when(st.kind === "repo" && item.source?.[isLayout ? "layout" : "mod"] !== item.name, el => el.child(tag(`as ${st.published}`)))
      .child(div().w(64).flex_none().text_right().text_size(12).font_family("JetBrains Mono").text_color(t.muted).child(item.version ?? "—"))
      .child(div().w(18).flex_none().text_center().text_size(11).text_color(t.dim).child(st.latest ? "→" : ""))
      .child(div().w(64).flex_none().text_size(12).font_family("JetBrains Mono").text_color(st.outdated ? t.foreground : t.dim).child(st.latest ?? ""))
      .child(h_flex().w(130).flex_none().justify_end().child(right));
  }

  section(id, title, note, rows, t) {
    if (!rows.length) return null;
    return v_flex().id(id).gap(2)
      .child(h_flex().px(10).pt(10).pb(4).gap(8).items_baseline()
        .child(div().text_size(11.5).font_semibold().text_color(t.muted).child(title))
        .when(Boolean(note), el => el.child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(note))))
      .children(rows);
  }

  render() {
    const t = theme(), { overlay } = props() ?? {};
    const tag = (list, isLayout) => list.map(x => ({ ...x, st: this.status(x, isLayout) }));
    const layouts = tag(this.layouts, true), mods = tag(this.mods, false);
    const repo = [...layouts.filter(x => x.st.kind === "repo").map(x => ({ ...x, isLayout: true })), ...mods.filter(x => x.st.kind === "repo")];
    const outdated = repo.filter(x => x.st.outdated);
    const at = shared(KEY)?.at;
    const checked = this.error ? `Couldn't check: ${this.error}` : this.checking ? "Checking GitHub…"
      : at ? `Checked ${Math.max(0, Math.round((Date.now() - at) / 60000))} min ago` : "Not checked yet";
    return v_flex().size_full().bg(t.popover ?? t.background).text_color(t.foreground)
      .child(h_flex().px(16).pt(14).pb(10).gap(10).items_center().border_b_1().border_color(t.border)
        .child(v_flex().flex_1().min_w(0)
          .child(div().text_size(15).font_semibold().child("Pond settings"))
          .child(div().text_size(11.5).text_color(this.error ? t.blocked : t.dim).truncate().child(
            `${outdated.length ? `${outdated.length} update${outdated.length > 1 ? "s" : ""} available` : "Everything from herdr-mods is up to date"} · ${checked}`)))
        .when(outdated.length > 1, el => el.child(this.button("update-all", `Update all (${outdated.length})`, true, () => this.update(outdated), t)))
        .child(this.button("check", this.checking ? "Checking…" : "Check now", false, cx => this.check(cx), t))
        .child(div().id("close").size(26).flex_none().flex().items_center().justify_center().rounded(6).cursor_pointer()
          .text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => closeOverlay(overlay)).child(svg(`${ICONS}/x.svg`).size(14))))
      .child(h_flex().px(26).pt(8).gap(10).text_size(10.5).text_color(t.dim)
        .child(div().flex_1().child("NAME")).child(div().w(64).text_right().child("INSTALLED")).child(div().w(18))
        .child(div().w(64).child("LATEST")).child(div().w(130)))
      .child(v_flex().id("list").flex_1().min_h(0).overflow_y_scrollbar().px(6).pb(12)
        .children([
          this.section("layouts", "Layouts", null, layouts.map(x => this.row(x, true, t)), t),
          this.section("available", "Available layouts", "try one: yours stays as it is", this.available().map(l => this.availableRow(l, t)), t),
          this.section("repo", "Mods from herdr-mods", null, mods.filter(x => x.st.kind === "repo" || x.st.kind === "unlinked").map(x => this.row(x, false, t)), t),
          this.section("local", "Your other mods", "not published, so no updates", mods.filter(x => x.st.kind === "local" || x.st.kind === "clone").map(x => this.row(x, false, t)), t),
        ].filter(Boolean)));
  }
}
