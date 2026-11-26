// The "Pond figures" dialog: build figure sets and choose one per space.
// Opened from the duck button in the Agents header, or by right-clicking a figure.
// Everything it changes is saved to ~/.config/herdr-app/pond-agents.json at once.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { theme, spaces, closeOverlay, props, knownAgents, run, appHome } from "herdr";
import { MOODS } from "./duck.js";
import {
  SLOTS, MOTIONS, OWN_MOTION, SHIPPED, DEFAULT_SET, OWN_DIR, configPath, config, allSets, isShipped, setIdFor, specFor, figure,
  save, library, addPictures, openFolder,
} from "./figures.js";
import { PLAYS, svgToWebp } from "./animate.js";

const ICON = (n) => (n.includes("/") ? n : `mods/workspace-chrome/${n}.svg`);
const SPEEDS = [{ ms: 800, label: "Slow" }, { ms: 400, label: "Normal" }, { ms: 180, label: "Fast" }];
const EMOJI = ["🦆", "🐥", "🦢", "🐸", "🐢", "🦫", "🐟", "🪿", "🔪", "🙋", "😤", "😠", "🎉", "✨", "💤", "🌙", "☕", "🔥", "⏳", "✅"];
const kindOf = (spec) => (spec?.image ? "image" : spec?.text ? "text" : "duck");
const words = (s) => s.split(/\s+/).filter(Boolean);
const clone = (x) => JSON.parse(JSON.stringify(x));

export class Editor {
  constructor(cx) {
    const p = props() ?? {};
    const c = config();
    this.tab = p.space ? "spaces" : "sets";
    this.setId = setIdFor(p.space ?? null, c);
    this.slot = "working";
    this.openRow = p.space ?? null;
    this.pictures = null;
    this.error = null;
    this.nameInput = InputState.new({ placeholder: "Set name" });
    this.nameInput.on("change", (_e, cx) => this.rename(cx));
    this.textInput = InputState.new({ placeholder: "Emoji or text, space between frames: 🦆 🐥" });
    this.textInput.on("change", (_e, cx) => this.retext(cx));
    this.syncInputs();
    this.scan(cx);
    // The agent "Tweak with AI" starts: the installed one people pick most.
    cx.spawn(async (cx) => {
      this.agent = (await knownAgents().catch(() => [])).find((a) => a.installed) ?? null;
      cx.notify();
    });
  }

  // Starts an agent in a new tab with everything about this set, to fix its
  // pictures the way the person asks: backgrounds, animated SVGs, sizes.
  // `convert`: an animated SVG to turn into a picture Herdr plays, for `slot`.
  tweakWithAI(cx, convert = null) {
    if (!this.agent) return;
    const c = config();
    const set = allSets(c)[this.setId];
    const home = appHome();
    const lines = SLOTS.map((s) => {
      const spec = specFor(set, s.id);
      const where = spec?.image ? ` -> ${home}/${spec.image}` : "";
      return `- ${s.id} (${s.label}: ${s.hint.toLowerCase()}): ${JSON.stringify(spec)}${where}`;
    });
    const usedBy = Object.entries(c.spaces).filter(([, v]) => v === this.setId).map(([k]) => k);
    const own = (this.pictures ?? []).filter((p) => p.own).map((p) => `- ${home}/${p.path}`);
    const job = convert ? [
      `The main job: ${home}/${convert.path} is an animated SVG for the "${convert.slot}" slot. Herdr can't play SVG animations, so make an animated WebP (or GIF) that keeps its animation exactly: same timing, looping, transparent background, about 128 px tall. Every frame must be a whole frame (e.g. img2webp -kmin 0 -kmax 1); Herdr glitches on WebP frames that only carry what changed. Then set that slot to { "image": "<new file>", "motion": "own", "source": "${convert.path}" }. Tell me your plan and which tools you'd use first.${convert.error ? ` The editor's own conversion failed with: ${convert.error}` : ""}`,
      ``,
    ] : [];
    const task = [
      ...job,
      `I want to tweak the pictures of my Herdr "pond-agents" figure set "${set.name}" (id "${this.setId}"). Before changing anything, look at the pictures below, tell me briefly what you see (backgrounds, animations, sizes, how they'd look at 27-45 px on a dark sidebar), then ask me what I want done. Don't edit until I answer.`,
      ``,
      `The set, one figure per agent state:`,
      ...lines,
      ``,
      `Used by spaces: ${usedBy.length ? usedBy.join(", ") : "none (or the default, see below)"}. Default set: ${c.default}.`,
      ``,
      `Other pictures in my folder ${home}/${OWN_DIR}/:`,
      ...(own.length ? own : ["- (none)"]),
      ``,
      `How it works:`,
      `- Settings file: ${configPath()}, JSON { "default": setId, "spaces": { spaceName: setId }, "sets": { setId: { "name", "slots": { working, blocked, waiting, done, idle } } } }. The app reloads it within seconds; keep it valid JSON and keep my other sets.`,
      `- A figure is { "image": "<path relative to ${home}>", "motion": "own"|"none"|"bob"|"hop"|"wiggle"|"shake"|"pulse", "source"?: "<original it was made from>" }, or { "text": ["frame", ...], "ms": 180-800, "motion": ... } for emoji/text, or { "duck": "stab"|"angry"|"scowl"|"happy"|"content", "still"?: true } for the built-in duck.`,
      `- Herdr plays GIF and animated WebP by themselves ("motion": "own" adds nothing on top). Their frames must be whole frames: WebPs whose frames only carry what changed lose parts of the picture. SVG draws still: CSS keyframes and SMIL don't run, only the first pose shows. To keep an SVG's animation, render it to an animated WebP/GIF; or split it into still per-state poses, each with a "motion".`,
      `- Pictures render square, 27-45 px tall, on a dark background, so transparent backgrounds and tightly cropped, square-ish art work best. PNG, JPEG, GIF, WebP and SVG load.`,
      `- Write new files into ${home}/${OWN_DIR}/${this.setId}/ and never overwrite my originals. Then point this set's slots at them in the settings file. Use whatever tools are on this machine (e.g. python, ImageMagick, rsvg-convert, ffmpeg); ask before installing anything.`,
    ].join("\n");
    run("tab.new", { name: `Tweak ${set.name}`, folder: home, argv: this.agent.run, task });
    const overlay = props()?.overlay;
    if (overlay) closeOverlay(overlay);
  }

  scan(cx) {
    cx.spawn(async (cx) => {
      this.pictures = await library().catch(() => []);
      cx.notify();
    });
  }

  // ---- Changes --------------------------------------------------------------

  commit(cx, change) {
    const c = clone(config());
    change(c);
    const saving = save(c);
    cx.spawn(async (cx) => {
      try { await saving; this.error = null; } catch (e) { this.error = `Couldn't save: ${e.message ?? e}`; }
      cx.notify();
    });
  }

  ownSet(c) {
    return isShipped(this.setId) ? null : c.sets[this.setId];
  }

  setSpec(cx, spec) {
    this.commit(cx, (c) => { const s = this.ownSet(c); if (s) s.slots = { ...s.slots, [this.slot]: spec }; });
  }

  patchSpec(cx, patch) {
    const set = allSets()[this.setId];
    this.setSpec(cx, { ...specFor(set, this.slot), ...patch });
  }

  rename(cx) {
    const name = this.nameInput.value();
    if (isShipped(this.setId) || allSets()[this.setId]?.name === name) return;
    this.renameTask?.cancel();
    this.renameTask = cx.timer.after(350, (cx) => this.commit(cx, (c) => { const s = this.ownSet(c); if (s) s.name = name.trim() || "Untitled set"; }));
  }

  retext(cx) {
    const list = words(this.textInput.value());
    const spec = specFor(allSets()[this.setId], this.slot);
    if (!list.length || kindOf(spec) !== "text" || JSON.stringify(list) === JSON.stringify(spec.text)) return;
    this.textTask?.cancel();
    this.textTask = cx.timer.after(250, (cx) => this.patchSpec(cx, { text: list }));
  }

  // Inputs follow the selection; never set them while their own change is pending.
  syncInputs() {
    const set = allSets()[this.setId];
    this.nameInput.set_value(set?.name ?? "");
    const spec = specFor(set, this.slot);
    this.textInput.set_value(kindOf(spec) === "text" ? spec.text.join(" ") : "");
  }

  select(cx, setId, slot = this.slot) {
    this.renameTask?.cancel();
    this.textTask?.cancel();
    this.pickKind = null;
    this.setId = setId;
    this.slot = slot;
    this.syncInputs();
    cx.notify();
  }

  // A new set starts as a copy of the one shown.
  duplicate(cx) {
    const from = allSets()[this.setId] ?? SHIPPED[DEFAULT_SET];
    const id = `set-${Date.now().toString(36)}`;
    const names = new Set(Object.values(allSets()).map((s) => s.name));
    let name = isShipped(this.setId) ? `My ${from.name.replace(/^My /, "")}` : `${from.name} copy`;
    for (let n = 2; names.has(name); n++) name = `${name.replace(/ \d+$/, "")} ${n}`;
    this.commit(cx, (c) => { c.sets[id] = { name, slots: clone(from.slots) }; });
    this.setId = id;
    this.nameInput.set_value(name);
    cx.notify();
  }

  remove(cx) {
    const id = this.setId;
    if (isShipped(id)) return;
    const c = config();
    this.select(cx, c.default === id || !allSets(c)[c.default] ? DEFAULT_SET : c.default);
    this.commit(cx, (c) => {
      delete c.sets[id];
      if (c.default === id) c.default = DEFAULT_SET;
      for (const [k, v] of Object.entries(c.spaces)) if (v === id) delete c.spaces[k];
    });
  }

  assign(cx, space, setId) {
    this.commit(cx, (c) => {
      if (space == null) c.default = setId;
      else if (setId == null) delete c.spaces[space];
      else c.spaces[space] = setId;
    });
  }

  // Turns an animated SVG into a moving picture and puts it in the shown slot.
  convert(cx, path) {
    const setId = this.setId, slot = this.slot;
    this.converting = { setId, slot, path };
    this.convertError = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const out = await svgToWebp(path, OWN_DIR);
        this.commit(cx, (c) => { const s = c.sets[setId]; if (s) s.slots = { ...s.slots, [slot]: { image: out, motion: "own", source: path } }; });
        this.pictures = await library().catch(() => this.pictures);
      } catch (e) {
        this.convertError = { setId, slot, path, message: String(e?.message ?? e) };
      }
      this.converting = null;
      cx.notify();
    });
  }

  // A picture that moves by itself: GIF/WebP play; an animated SVG gets converted.
  keepOwn(cx, path) {
    if (PLAYS.test(path)) this.patchSpec(cx, { motion: "own" });
    else this.convert(cx, path);
  }

  drop(cx, paths) {
    cx.spawn(async (cx) => {
      const added = await addPictures(paths).catch(() => []);
      if (!added.length) { this.error = "Drop PNG, JPEG, GIF, WebP or SVG pictures."; cx.notify(); return; }
      this.pictures = await library().catch(() => this.pictures);
      this.pickKind = null;
      if (isShipped(this.setId)) return cx.notify();
      const pic = this.pictures?.find((p) => p.path === added[0]);
      this.setSpec(cx, { image: added[0], motion: pic?.animated && !pic.needsConvert ? "own" : "bob" });
      if (pic?.needsConvert) this.convert(cx, added[0]);
      cx.notify();
    });
  }

  // ---- Pieces ---------------------------------------------------------------

  button(t, id, label, action, { icon, primary, danger, disabled } = {}) {
    return h_flex().id(id).h(28).px(10).gap(6).flex_none().items_center().rounded(7).text_size(12)
      .border(1).border_color(primary ? t.solid : t.border)
      .bg(primary ? t.solid : t.surface)
      .text_color(disabled ? t.dim : primary ? t.solid_foreground : danger ? t.blocked : t.foreground)
      .when(!disabled, (el) => el.cursor_pointer().hover((s) => s.bg(primary ? t.solid : t.hover)).on_click((_e, cx) => action(cx)))
      .when(Boolean(icon), (el) => el.child(svg(ICON(icon)).size(13)))
      .child(label);
  }

  chip(t, id, label, on, action) {
    return div().id(id).h(26).px(10).flex_none().flex().items_center().rounded(13).text_size(12)
      .border(1).border_color(on ? t.accent : t.border).bg(on ? t.accent + "22" : t.surface)
      .text_color(on ? t.foreground : t.muted).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => action(cx)).child(label);
  }

  // A small tile with a figure in it; `on` outlines it.
  tile(t, id, fig, label, on, action, w = 92) {
    return v_flex().id(id).w(w).flex_none().p(6).gap(4).items_center().rounded(9)
      .border(1.5).border_color(on ? t.accent : t.border).bg(on ? t.accent + "14" : t.background)
      .cursor_pointer().hover((s) => s.border_color(on ? t.accent : t.input))
      .on_click((_e, cx) => action(cx))
      .child(h_flex().h(46).items_center().justify_center().overflow_hidden().child(fig))
      .child(div().w_full().text_center().truncate().text_size(11).text_color(on ? t.foreground : t.muted).child(label));
  }

  strip(t, set, h, key) {
    return h_flex().gap(2).items_center().children(SLOTS.map((s) =>
      div().id(`${key}-${s.id}`).tooltip(s.label).child(figure(specFor(set, s.id), h))));
  }

  // ---- Sets tab -------------------------------------------------------------

  setList(t, c) {
    const sets = allSets(c);
    const uses = (id) => Object.values(c.spaces).filter((v) => v === id).length;
    const row = (id) => {
      const s = sets[id];
      const on = id === this.setId;
      const n = uses(id);
      const tags = [isShipped(id) ? "Built-in" : null, c.default === id ? "Default" : null, n ? `${n} space${n > 1 ? "s" : ""}` : null].filter(Boolean);
      return h_flex().id(`set-${id}`).px(8).py(6).gap(8).rounded(8).items_center().cursor_pointer()
        .when(on, (el) => el.bg(t.selected)).hover((s) => s.bg(on ? t.selected : t.hover))
        .on_click((_e, cx) => this.select(cx, id))
        .child(div().flex_none().child(figure(specFor(s, "working"), 26)))
        .child(v_flex().flex_1().min_w(0)
          .child(div().truncate().text_color(on ? t.foreground : t.muted).child(s.name || id))
          .when(tags.length > 0, (el) => el.child(div().truncate().text_size(10.5).text_color(t.dim).child(tags.join(" · ")))));
    };
    const own = Object.keys(c.sets);
    return v_flex().w(220).h_full().flex_none().border_r(1).border_color(t.border).bg(t.chrome)
      .child(v_flex().id("set-list").flex_1().min_h(0).p(8).gap(2).overflow_y_scrollbar()
        .child(div().px(8).pt(2).pb(4).text_size(11).text_color(t.dim).child("Built-in"))
        .children(Object.keys(SHIPPED).map(row))
        .child(div().px(8).pt(10).pb(4).text_size(11).text_color(t.dim).child("Yours"))
        .when(own.length === 0, (el) => el.child(div().px(8).text_size(11.5).text_color(t.dim).child("None yet. Duplicate a set to make one.")))
        .children(own.map(row)))
      .child(div().p(8).border_t(1).border_color(t.border).child(this.button(t, "new-set", "New set from this one", (cx) => this.duplicate(cx), { icon: "plus" })));
  }

  slotCards(t, set) {
    return h_flex().gap(8).children(SLOTS.map((s) =>
      this.tile(t, `slot-${s.id}`, figure(specFor(set, s.id), 40), s.label, s.id === this.slot, (cx) => this.select(cx, this.setId, s.id), 104)
        .tooltip(s.hint)));
  }

  motionRow(t, spec) {
    const pic = spec.image ? this.pictures?.find((p) => p.path === spec.image) : null;
    // Own animation: pictures that move by themselves, or were made from one that did.
    const ownable = Boolean(spec.image) && (PLAYS.test(spec.image) || pic?.needsConvert || spec.source);
    const busy = this.converting?.setId === this.setId && this.converting.slot === this.slot;
    const failed = this.convertError?.setId === this.setId && this.convertError.slot === this.slot ? this.convertError : null;
    return v_flex().gap(8)
      .child(h_flex().gap(6).flex_wrap().items_center()
        .child(div().w(70).text_size(12).text_color(t.muted).child("Motion"))
        .when(ownable, (el) => el.child(this.chip(t, "motion-own", busy ? "Converting…" : OWN_MOTION.label, spec.motion === "own",
          (cx) => (busy ? null : spec.source && spec.motion !== "own" ? this.patchSpec(cx, { motion: "own" }) : this.keepOwn(cx, spec.image)))
          .tooltip(pic?.needsConvert ? "Keep this SVG's own animation: turns it into a moving picture Herdr can play" : "Play the picture's own animation, nothing added")))
        .children(MOTIONS.map((m) => this.chip(t, `motion-${m.id}`, m.label, (spec.motion ?? "none") === m.id, (cx) => this.patchSpec(cx, { motion: m.id })))))
      .when(Boolean(pic?.needsConvert) && !busy && !failed && spec.motion !== "own", (el) => el.child(div().pl(78).text_size(11.5).text_color(t.dim)
        .child("This SVG moves by itself, but Herdr shows SVGs still. Own animation keeps the movement.")))
      .when(busy, (el) => el.child(div().pl(78).text_size(11.5).text_color(t.muted)
        .child("Turning the SVG's animation into a moving picture… a few seconds.")))
      .when(Boolean(failed), (el) => el.child(h_flex().pl(78).gap(8).items_center().flex_wrap()
        .child(div().text_size(11.5).text_color(t.blocked).child(failed.message))
        .when(Boolean(this.agent), (el) => el.child(this.button(t, "convert-ai", `Convert with ${this.agent.name}`,
          (cx) => this.tweakWithAI(cx, { path: failed.path, slot: failed.slot, error: failed.message }), { icon: "mods/pond-agents/sparkles.svg" })))));
  }

  picker(t, set) {
    const spec = specFor(set, this.slot);
    const kind = this.pickKind ?? kindOf(spec);
    const kinds = [
      { id: "duck", label: "Duck", spec: { duck: "stab" } },
      { id: "image", label: "Picture", spec: { image: this.pictures?.[0]?.path, motion: "bob" } },
      { id: "text", label: "Emoji", spec: { text: ["🦆"], ms: 400, motion: "bob" } },
    ];
    const head = h_flex().gap(6).items_center()
      .child(div().w(70).text_size(12).text_color(t.muted).child("Figure"))
      .children(kinds.map((k) => this.chip(t, `kind-${k.id}`, k.label, kind === k.id, (cx) => {
        if (kind === k.id) return;
        this.pickKind = null;
        if (k.id === kindOf(spec)) cx.notify();
        else if (k.id === "image" && !k.spec.image) { this.pickKind = "image"; cx.notify(); }
        else { this.setSpec(cx, k.spec); if (k.id === "text") this.textInput.set_value(k.spec.text.join(" ")); }
      })));

    let body;
    if (kind === "duck") {
      body = v_flex().gap(10)
        .child(h_flex().gap(8).flex_wrap().children(MOODS.map((m) =>
          this.tile(t, `mood-${m.id}`, figure({ duck: m.id, still: spec.still }, 40), m.label, spec.duck === m.id, (cx) => this.patchSpec(cx, { duck: m.id })))))
        .child(h_flex().gap(6).items_center()
          .child(div().w(70).text_size(12).text_color(t.muted).child("Motion"))
          .child(this.chip(t, "duck-anim", "Animated", !spec.still, (cx) => this.patchSpec(cx, { still: undefined })))
          .child(this.chip(t, "duck-still", "Still", Boolean(spec.still), (cx) => this.patchSpec(cx, { still: true }))));
    } else if (kind === "image") {
      const pics = this.pictures ?? [];
      body = v_flex().gap(10)
        .child(div().id("drop").on_drop((e, cx) => this.drop(cx, e.paths))
          .child(pics.length
            ? h_flex().gap(8).flex_wrap().children(pics.map((p, i) =>
              this.tile(t, `pic-${i}`, figure({ image: p.path }, 40), p.animated ? `▶ ${p.name}` : p.name, spec.image === p.path,
                (cx) => {
                  this.pickKind = null;
                  const motion = p.animated && !p.needsConvert ? "own" : spec.motion === "own" ? "bob" : spec.motion ?? "bob";
                  this.setSpec(cx, { image: p.path, motion });
                }).tooltip(p.needsConvert ? "Animated SVG: pick it, then Own animation to keep its movement" : p.animated ? "Moves by itself" : p.name)))
            : div().p(16).rounded(9).border(1).border_dashed().border_color(t.input).text_size(12).text_color(t.dim)
              .child(this.pictures ? "No pictures yet. Drop PNG, GIF, WebP or SVG files here." : "Looking for pictures…")))
        .child(h_flex().gap(8).items_center()
          .child(this.button(t, "open-folder", `Open ${OWN_DIR}/`, () => openFolder(), { icon: "folder" }))
          .child(this.button(t, "rescan", "Refresh", (cx) => this.scan(cx)))
          .child(div().text_size(11.5).text_color(t.dim).child("or drop pictures on this list. ▶ moves by itself.")))
        .when(kindOf(spec) === "image", (el) => el.child(this.motionRow(t, spec)));
    } else {
      body = v_flex().gap(10)
        .child(h_flex().gap(8).items_center()
          .child(div().w(70).text_size(12).text_color(t.muted).child("Frames"))
          .child(Input.new(this.textInput).flex_1().h(32).px(10).rounded(7).border(1).border_color(t.input).bg(t.background).text_size(14).text_color(t.foreground)))
        .child(h_flex().gap(4).flex_wrap().pl(78).children(EMOJI.map((e, i) =>
          div().id(`emoji-${i}`).size(30).flex().items_center().justify_center().rounded(6).text_size(18).cursor_pointer()
            .hover((s) => s.bg(t.hover)).tooltip("Add as a frame")
            .on_click((_e, cx) => {
              const list = [...words(this.textInput.value()), e];
              this.textInput.set_value(list.join(" "));
              this.patchSpec(cx, { text: list });
            }).child(e))))
        .child(h_flex().gap(6).items_center()
          .child(div().w(70).text_size(12).text_color(t.muted).child("Speed"))
          .children(SPEEDS.map((s) => this.chip(t, `speed-${s.ms}`, s.label, (spec.ms ?? 400) === s.ms, (cx) => this.patchSpec(cx, { ms: s.ms }))))
          .child(div().text_size(11.5).text_color(t.dim).child("between frames")))
        .child(this.motionRow(t, spec));
    }
    return v_flex().gap(12).p(14).rounded(10).border(1).border_color(t.border).bg(t.surface).child(head).child(body);
  }

  setsTab(t, c) {
    const set = allSets(c)[this.setId] ?? SHIPPED[DEFAULT_SET];
    const shipped = isShipped(this.setId);
    const slot = SLOTS.find((s) => s.id === this.slot);
    return h_flex().flex_1().min_h(0)
      .child(this.setList(t, c))
      .child(v_flex().id("set-body").flex_1().min_w(0).h_full().p(16).gap(14).overflow_y_scrollbar()
        .child(h_flex().gap(8).items_center()
          .child(shipped
            ? div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child(set.name)
            : Input.new(this.nameInput).flex_1().h(32).px(10).rounded(7).border(1).border_color(t.input).bg(t.background).text_size(14).text_color(t.foreground))
          .child(this.button(t, "make-default", c.default === this.setId ? "Default" : "Use everywhere", (cx) => this.assign(cx, null, this.setId),
            { disabled: c.default === this.setId, icon: c.default === this.setId ? "check" : null }))
          .when(!shipped, (el) => el.child(this.button(t, "ai", "Tweak with AI", (cx) => this.tweakWithAI(cx),
            { icon: "mods/pond-agents/sparkles.svg", disabled: !this.agent })
            .tooltip(this.agent ? `Ask ${this.agent.name} to fix this set's pictures: backgrounds, animated SVGs, sizes` : "No agent installed (programs.json run entries)")))
          .child(this.button(t, "dup", "Duplicate", (cx) => this.duplicate(cx), { primary: shipped }))
          .when(!shipped, (el) => el.child(this.button(t, "delete", "Delete", (cx) => this.remove(cx), { danger: true }))))
        .when(shipped, (el) => el.child(div().text_size(12).text_color(t.dim)
          .child("Built-in sets can't be changed. Duplicate this one to pick your own figures.")))
        .child(this.slotCards(t, set))
        .child(div().text_size(12).text_color(t.muted).child(`${slot.label}: ${slot.hint.toLowerCase()}.`))
        .when(!shipped, (el) => el.child(this.picker(t, set))));
  }

  // ---- Spaces tab -----------------------------------------------------------

  spacesTab(t, c) {
    const sets = allSets(c);
    const open = [...new Set(spaces().map((s) => s.name))];
    const gone = Object.keys(c.spaces).filter((n) => !open.includes(n));
    const row = (name, key, faded) => {
      const own = name == null ? c.default : c.spaces[name];
      const shownId = name == null ? setIdFor(null, c) : setIdFor(name, c);
      const expanded = this.openRow === key;
      const choices = [...(name == null ? [] : [{ id: null, label: `Default (${sets[setIdFor(null, c)]?.name})` }]),
        ...Object.entries(sets).map(([id, s]) => ({ id, label: s.name || id }))];
      return v_flex().rounded(9).border(1).border_color(expanded ? t.input : t.border).bg(t.surface)
        .child(h_flex().id(`sp-${key}`).px(12).py(8).gap(12).items_center().cursor_pointer().rounded(9).hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => { this.openRow = expanded ? null : key; cx.notify(); })
          .child(v_flex().w(190).flex_none().min_w(0)
            .child(div().truncate().text_color(faded ? t.dim : t.foreground).font_medium().child(name ?? "Every other space"))
            .child(div().truncate().text_size(11).text_color(t.dim)
              .child(name == null ? "Spaces without their own pick" : faded ? "Not open right now" : own ? sets[own]?.name : "Uses the default")))
          .child(div().flex_1().min_w(0).overflow_hidden().child(this.strip(t, sets[shownId], 26, `strip-${key}`)))
          .child(div().text_size(12).text_color(t.muted).child(sets[shownId]?.name ?? ""))
          .child(svg(ICON(expanded ? "chevron-down" : "chevron-right")).size(12).flex_none().text_color(t.dim)))
        .when(expanded, (el) => el.child(h_flex().px(12).pb(10).gap(6).flex_wrap()
          .children(choices.map((ch) => this.chip(t, `pick-${key}-${ch.id}`, ch.label, (own ?? null) === ch.id || (name == null && ch.id === shownId),
            (cx) => { this.assign(cx, name, ch.id); this.openRow = null; })))
          .when(faded, (el) => el.child(this.chip(t, `forget-${key}`, "Forget this space", false, (cx) => this.assign(cx, name, null))))));
    };
    return v_flex().id("spaces-body").flex_1().min_h(0).p(16).gap(8).overflow_y_scrollbar()
      .child(div().text_size(12).text_color(t.muted).pb(4)
        .child("Each space can have its own figures. Pick by space name: a space named after its repo keeps its pick when reopened."))
      .child(row(null, "default", false))
      .children(open.map((n, i) => row(n, `s${i}`, false)))
      .children(gone.map((n, i) => row(n, `g${i}`, true)));
  }

  render(cx) {
    const t = theme();
    const c = config();
    if (!allSets(c)[this.setId]) this.setId = setIdFor(null, c);
    const tab = (id, label) => div().id(`tab-${id}`).h(30).px(12).flex().items_center().rounded(7).text_size(12.5).cursor_pointer()
      .bg(this.tab === id ? t.selected : t.popover).text_color(this.tab === id ? t.foreground : t.muted)
      .hover((s) => s.bg(t.hover)).on_click((_e, cx) => { this.tab = id; cx.notify(); }).child(label);
    return v_flex().size_full().bg(t.popover).text_size(13).text_color(t.foreground)
      .child(h_flex().h(52).px(16).gap(10).flex_none().items_center().border_b(1).border_color(t.border)
        .child(v_flex().child(div().text_size(14).font_semibold().child("Pond figures"))
          .child(div().text_size(11).text_color(t.dim).child("How each agent state looks, per space")))
        .child(div().flex_1())
        .child(tab("sets", "Sets"))
        .child(tab("spaces", "Spaces"))
        .child(div().id("close").ml(8).size(28).flex().items_center().justify_center().rounded(7).cursor_pointer()
          .text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => closeOverlay(props().overlay)).child(svg(ICON("x")).size(14))))
      .child(this.tab === "sets" ? this.setsTab(t, c) : this.spacesTab(t, c))
      .child(h_flex().h(30).px(16).flex_none().items_center().border_t(1).border_color(t.border).text_size(11).text_color(this.error ? t.blocked : t.dim)
        .child(this.error ?? "Saved as you go to ~/.config/herdr-app/pond-agents.json"));
  }
}
