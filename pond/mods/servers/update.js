// Self-update for mods and layouts published from herdr-mods. The same file is in every mod from
// there (tools/stamp.py refuses to publish copies that differ): edit one, copy it to the others.
//
// The mod's mod.json (or the layout's root) says where it came from ("source", stamped by
// herdr-mods); the repo's versions.json says what's published. All mods share one fetch through
// shared state. When a newer version is published, the pill offers it; confirming starts Claude in
// a new tab, which follows UPDATE.md (shipped in every mod folder) for that one mod or layout.
import { h_flex } from "gpui-base";
import { appHome, readTextFile, openOverlay, notify, shared, setShared } from "herdr";

const EVERY = 6 * 3600 * 1000;
const KEY = "herdr-mods.versions"; // {repo, at, mods: {name: version}, layouts: {name: version}}

const newer = (a, b) => { // a > b, semver-ish
  const p = v => String(v).split(/[.\-+]/).map(x => Number.parseInt(x, 10) || 0);
  const x = p(a), y = p(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
};

export class SelfUpdate {
  // A mod: folder under mods/ (this mod's own), title as people call it ("Todos panel").
  // { layout: true }: the layout shown now (shared("layout")) instead, folder = this mod's (for UPDATE.md).
  // short: the compact pill's prefix ("Pond" → "Pond ↑ 1.6.0").
  constructor(folder, title, { layout = false, short = "" } = {}) {
    this.folder = folder; this.title = title; this.isLayout = layout; this.short = short;
    this.name = layout ? null : folder; this.meta = null; this.busy = false;
  }

  // Call from init: reads mod.json (or the layout file), then checks GitHub if the shared result is old.
  // A layout's mods keep running when the layout file changes (an update, a switch), so it's re-read.
  start(cx) {
    this.load(cx, true);
    if (this.isLayout) cx.timer.every(30000, cx => this.load(cx));
  }

  load(cx, first = false) {
    cx.spawn(async cx => {
      const name = this.isLayout ? shared("layout") : this.folder;
      if (!name) return;
      let meta;
      try { meta = JSON.parse(await readTextFile(`${appHome()}/${this.isLayout ? `layouts/${name}.json` : `mods/${name}/mod.json`}`)); } catch { meta = null; }
      const changed = name !== this.name || meta?.version !== this.meta?.version || meta?.source?.repo !== this.meta?.source?.repo;
      this.name = name; this.meta = meta;
      if (!meta) { if (changed) cx.notify(); return; }
      const c = shared(KEY);
      if (first && (c?.repo !== meta.source?.repo || !c.layouts || Date.now() - (c.at ?? 0) > EVERY)) this.check(cx);
      if (changed) cx.notify();
    });
  }

  // The published name: source.mod or source.layout.
  get published() { return this.meta?.source?.[this.isLayout ? "layout" : "mod"]; }

  // True for a copy installed from herdr-mods (it has a "source").
  get shown() { return Boolean(this.meta?.source?.repo && this.published); }

  // {have, latest} when the published version is newer than this one, else null.
  available() {
    const c = shared(KEY), have = this.meta?.version ?? "0.0.0";
    const latest = this.shown && c?.repo === this.meta.source.repo ? c[this.isLayout ? "layouts" : "mods"]?.[this.published] : null;
    return latest && newer(latest, have) ? { have, latest } : null;
  }

  check(cx, manual = false) {
    const m = /^https:\/\/github\.com\/([^/]+\/[^/]+?)(\.git)?\/?$/.exec(this.meta?.source?.repo ?? "");
    if (!m || this.busy) return;
    this.busy = true; cx.notify();
    cx.spawn(async cx => {
      try {
        const r = await fetch(`https://raw.githubusercontent.com/${m[1]}/main/versions.json`);
        if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
        const index = await r.json();
        const versions = o => Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k, v.version]));
        const next = { repo: this.meta.source.repo, at: Date.now(), mods: versions(index.mods), layouts: versions(index.layouts) };
        const latest = next[this.isLayout ? "layouts" : "mods"][this.published];
        if (!latest) throw new Error(`${this.published} isn't in versions.json`);
        setShared(KEY, next);
        if (manual) {
          if (this.available()) this.update();
          else notify({ title: `${this.title} is up to date`, body: `Installed ${this.meta.version}, published ${latest}.`, level: "success", timeout: 4000 });
        }
      } catch (e) {
        if (manual) notify({ title: `Couldn't check for ${this.title} updates`, body: String(e?.message ?? e), level: "error" });
      }
      this.busy = false;
      cx.notify();
    });
  }

  // Asks, then starts Claude in the Herdr home to update this one mod or layout.
  update() {
    const u = this.available();
    if (!u) return;
    const src = this.meta.source;
    const what = this.isLayout ? `layout installed at layouts/${this.name}.json` : `mod installed at mods/${this.name}`;
    const task = [
      `Update the Herdr ${what} (published as "${this.published}" in ${src.repo}) from ${u.have} to ${u.latest}.`,
      `Follow mods/${this.folder}/UPDATE.md, but only for this one ${this.isLayout ? "layout and the mods it lists" : "mod"}: skip finding other installed mods and layouts.`,
      `I already confirmed this update, so don't ask again whether to update it${this.isLayout ? " (ask about its mods as UPDATE.md says)" : ""}; show me the new "## Changes" entries,`,
      `and still stop and ask before replacing any of my own edits or keys.`,
    ].join(" ");
    openOverlay({ mod: "confirm", kind: "dialog", width: 420, props: {
      title: `Update the ${this.title} to ${u.latest}?`,
      detail: `Installed: ${u.have}. A new Claude tab will follow UPDATE.md: back up what it replaces, check for your own edits, install ${u.latest} and check it.`,
      command: { name: "tab.new", args: { name: `Update ${this.title}`, folder: appHome(), argv: ["claude"], task } },
    } });
  }

  // Header pill "Update available" (compact: "Tabs ↑ x.y.z") when a newer version is published;
  // null otherwise, so nothing shows while up to date. Checks run on start and every 6 hours.
  pill(t, { compact = false } = {}) {
    const u = this.available();
    if (!u) return null;
    const text = compact ? `${this.short ? `${this.short} ` : ""}↑ ${u.latest}` : "Update available";
    return h_flex().id(`self-update-${this.isLayout ? "layout" : this.folder}`).h(compact ? 20 : 24).px(compact ? 7 : 9).flex_none().items_center().rounded(compact ? 4 : 6)
      .cursor_pointer().text_size(compact ? 11 : 11.5)
      .bg(t.accent).text_color(t.accent_foreground).hover(s => s.opacity(0.88))
      .tooltip(`${this.title} ${u.have} → ${u.latest}`)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); this.update(); })
      .child(text);
  }
}
