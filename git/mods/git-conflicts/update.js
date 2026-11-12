// Self-update for mods published from herdr-mods. The same file is in every mod from there
// (tools/stamp.py refuses to publish copies that differ): edit one, copy it to the others.
//
// The mod's mod.json says where it came from ("source", stamped by herdr-mods); the repo's
// versions.json says what's published. All mods share one fetch through shared state. When a
// newer version is published, the pill offers it; confirming starts Claude in a new tab, which
// follows the mod's UPDATE.md for that one mod.
import { h_flex } from "gpui-base";
import { appHome, readTextFile, openOverlay, notify, shared, setShared } from "herdr";

const EVERY = 6 * 3600 * 1000;
const KEY = "herdr-mods.versions"; // {repo, at, mods: {name: version}}

const newer = (a, b) => { // a > b, semver-ish
  const p = v => String(v).split(/[.\-+]/).map(x => Number.parseInt(x, 10) || 0);
  const x = p(a), y = p(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
};

export class SelfUpdate {
  // folder: the mod's folder under mods/; title: what people call it ("Todos panel").
  constructor(folder, title) {
    this.folder = folder; this.title = title; this.mod = null; this.busy = false;
  }

  // Call from init: reads mod.json, then checks GitHub if the shared result is old.
  start(cx) {
    cx.spawn(async cx => {
      try { this.mod = JSON.parse(await readTextFile(`${appHome()}/mods/${this.folder}/mod.json`)); } catch { return; }
      const c = shared(KEY);
      if (c?.repo !== this.mod.source?.repo || Date.now() - (c?.at ?? 0) > EVERY) this.check(cx);
      cx.notify();
    });
  }

  // True for a copy installed from herdr-mods (it has a "source").
  get shown() { return Boolean(this.mod?.source?.repo && this.mod.source.mod); }

  // {have, latest} when the published version is newer than this one, else null.
  available() {
    const c = shared(KEY), have = this.mod?.version ?? "0.0.0";
    const latest = this.shown && c?.repo === this.mod.source.repo ? c.mods?.[this.mod.source.mod] : null;
    return latest && newer(latest, have) ? { have, latest } : null;
  }

  check(cx, manual = false) {
    const m = /^https:\/\/github\.com\/([^/]+\/[^/]+?)(\.git)?\/?$/.exec(this.mod?.source?.repo ?? "");
    if (!m || this.busy) return;
    this.busy = true; cx.notify();
    cx.spawn(async cx => {
      try {
        const r = await fetch(`https://raw.githubusercontent.com/${m[1]}/main/versions.json`);
        if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
        const index = await r.json();
        const mods = Object.fromEntries(Object.entries(index.mods ?? {}).map(([k, v]) => [k, v.version]));
        if (!mods[this.mod.source.mod]) throw new Error(`${this.mod.source.mod} isn't in versions.json`);
        setShared(KEY, { repo: this.mod.source.repo, at: Date.now(), mods });
        if (manual) {
          if (this.available()) this.update();
          else notify({ title: `${this.title} is up to date`, body: `Installed ${this.mod.version}, published ${mods[this.mod.source.mod]}.`, level: "success", timeout: 4000 });
        }
      } catch (e) {
        if (manual) notify({ title: `Couldn't check for ${this.title} updates`, body: String(e?.message ?? e), level: "error" });
      }
      this.busy = false;
      cx.notify();
    });
  }

  // Asks, then starts Claude in the Herdr home to update this one mod.
  update() {
    const u = this.available();
    if (!u) return;
    const src = this.mod.source;
    const task = [
      `Update the Herdr mod installed at mods/${this.folder} (published as "${src.mod}" in ${src.repo}) from ${u.have} to ${u.latest}.`,
      `Follow mods/${this.folder}/UPDATE.md, but only for this one mod: skip finding other installed mods and layouts.`,
      `I already confirmed this update, so don't ask again whether to update it; show me the new "## Changes" entries,`,
      `and still stop and ask before replacing any of my own edits or keys.`,
    ].join(" ");
    openOverlay({ mod: "confirm", kind: "dialog", width: 420, props: {
      title: `Update the ${this.title} to ${u.latest}?`,
      detail: `Installed: ${u.have}. A new Claude tab will follow the mod's UPDATE.md: back up its folder, check for your own edits, install ${u.latest} and check it.`,
      command: { name: "tab.new", args: { name: `Update ${this.title}`, folder: appHome(), argv: ["claude"], task } },
    } });
  }

  // Header pill: "Check for updates" (outlined), or "Update to x.y.z" (accent) when there's one.
  // quiet: only the "Update to" pill (for bars and lists). null when there's nothing to show.
  pill(t, { quiet = false, compact = false } = {}) {
    const u = this.available();
    if (!this.shown || (quiet && !u)) return null;
    const text = this.busy ? "Checking…" : u ? (compact ? `↑ ${u.latest}` : `Update to ${u.latest}`) : "Check for updates";
    return h_flex().id(`self-update-${this.folder}`).h(compact ? 20 : 24).px(compact ? 7 : 9).flex_none().items_center().rounded(12)
      .cursor_pointer().text_size(compact ? 11 : 11.5)
      .when(Boolean(u), el => el.bg(t.accent).text_color(t.accent_foreground).hover(s => s.opacity(0.88)))
      .when(!u, el => el.border_1().border_color(t.border).text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground)))
      .tooltip(u ? `${this.title} ${u.have} → ${u.latest}` : `${this.title} ${this.mod?.version ?? ""}: check GitHub for a newer one`)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); if (this.busy) return; if (u) this.update(); else this.check(cx, true); })
      .child(text);
  }
}
