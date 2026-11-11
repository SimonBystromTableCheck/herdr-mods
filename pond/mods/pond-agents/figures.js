// Figure sets: what each agent state looks like, per space.
//
// A set fills five slots (working, needs you, still waiting, done, idle) with a
// figure. The person's own sets, the default set and which set each space uses
// live in ~/.config/herdr-app/pond-agents.json, outside the mod folder, so
// updating the mod never touches them. The shipped sets below are read-only:
// duplicate one in the editor to change it.
//
// A figure is one of:
//   { "duck": "stab" | "angry" | "scowl" | "happy" | "content", "still"?: true }
//   { "image": "pond-figures/frog.png", "motion"?: "bob" }   path from ~/.config/herdr-app
//   { "text": ["🦆", "🐥"], "ms"?: 400, "motion"?: "hop" }    emoji or text, stepped natively
// GIF and animated WebP play by themselves ("motion": "own" adds nothing on top);
// SVG draws still, so an animated one is converted (animate.js) and keeps its
// original as "source". Any other motion moves the picture natively.

import { div, image } from "gpui-kit";
import { appHome, readTextFile, writeTextFile, shared, setShared, exec, window } from "herdr";
import * as fs from "fs/promises";
import { duckMood, duckWidth, DUCK_CENTER, BLOCKED_SCOWL } from "./duck.js";
import { PLAYS, svgAnimates } from "./animate.js";

export const SLOTS = [
  { id: "working", label: "Working", hint: "Busy on your task" },
  { id: "blocked", label: "Needs you", hint: "Waiting for your answer" },
  { id: "waiting", label: "Still waiting", hint: "Needs you for over a minute" },
  { id: "done", label: "Done", hint: "Finished while you looked away" },
  { id: "idle", label: "Idle", hint: "Nothing going on" },
];

export const MOTIONS = [
  { id: "none", label: "Still" },
  { id: "bob", label: "Bob" },
  { id: "hop", label: "Hop" },
  { id: "wiggle", label: "Wiggle" },
  { id: "shake", label: "Shake" },
  { id: "pulse", label: "Pulse" },
];
// Pictures that move by themselves: keep that and add nothing.
export const OWN_MOTION = { id: "own", label: "Own animation" };

// Shipped sets. New ducks go here (and their art in duck.js or figures/).
export const SHIPPED = {
  classic: {
    name: "Classic duck",
    slots: { working: { duck: "stab" }, blocked: { duck: "angry" }, waiting: { duck: "scowl" }, done: { duck: "happy" }, idle: { duck: "content" } },
  },
  "classic-still": {
    name: "Classic duck (still)",
    slots: {
      working: { duck: "stab", still: true }, blocked: { duck: "angry", still: true }, waiting: { duck: "scowl", still: true },
      done: { duck: "happy", still: true }, idle: { duck: "content", still: true },
    },
  },
  emoji: {
    name: "Emoji pond",
    slots: {
      working: { text: ["🦆", "🐥"], ms: 450, motion: "bob" },
      blocked: { text: ["🙋"], motion: "hop" },
      waiting: { text: ["😤", "😠"], ms: 600, motion: "shake" },
      done: { text: ["🎉", "✨"], ms: 400, motion: "hop" },
      idle: { text: ["💤"], motion: "pulse" },
    },
  },
};

export const DEFAULT_SET = "classic";
export const KEY = "pond-agents.figures";
export const configPath = () => `${appHome()}/pond-agents.json`;
// Where the person's own pictures go; the shipped ones are in the mod's figures/.
export const OWN_DIR = "pond-figures";
export const SHIPPED_DIR = "mods/pond-agents/figures";
export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp)$/i;

const empty = () => ({ default: DEFAULT_SET, spaces: {}, sets: {} });

export function config() {
  const c = shared(KEY);
  return c && typeof c === "object" ? { ...empty(), ...c } : empty();
}

export function allSets(c = config()) {
  return { ...SHIPPED, ...(c.sets ?? {}) };
}

export const isShipped = (id) => Object.hasOwn(SHIPPED, id);

// The set a space uses: its own pick, else the default, else the classic duck.
export function setIdFor(spaceName, c = config()) {
  const sets = allSets(c);
  const own = spaceName != null ? c.spaces?.[spaceName] : null;
  if (own && sets[own]) return own;
  return sets[c.default] ? c.default : DEFAULT_SET;
}

export function slotOf(status, waited = 0) {
  if (status === "working") return "working";
  if (status === "blocked") return waited < BLOCKED_SCOWL ? "blocked" : "waiting";
  if (status === "done") return "done";
  return "idle";
}

// A slot left empty falls back: still waiting looks like needs you, the rest like the classic duck.
export function specFor(set, slot) {
  return set?.slots?.[slot] ?? (slot === "waiting" ? set?.slots?.blocked : null) ?? SHIPPED.classic.slots[slot];
}

// What an agent in this space and state looks like, `height` px tall.
export function figureFor(spaceName, status, height, waited = 0) {
  const c = config();
  const set = allSets(c)[setIdFor(spaceName, c)];
  return figure(specFor(set, slotOf(status, waited)), height);
}

function moved(el, motion, h, x) {
  switch (motion) {
    case "bob": return el.loop("top", { from: 0, to: h * 0.05, period: 1200, easing: "ease-out" });
    case "hop": return el.loop("top", { from: 0, to: -h * 0.14, period: 340, easing: "ease-in-out" });
    case "wiggle": return el.loop("left", { from: x - h * 0.06, to: x + h * 0.06, period: 500, easing: "ease-in-out" });
    case "shake": return el.loop("left", { from: x - h * 0.04, to: x + h * 0.04, period: 140, easing: "linear" });
    case "pulse": return el.loop("opacity", { from: 0.35, to: 1, period: 1400, easing: "ease-in-out" });
    default: return el;
  }
}

// Every figure takes the duck's box, so rows line up whatever set a space uses.
export function figure(spec, height) {
  const w = duckWidth(height);
  if (spec?.duck) return duckMood(spec.duck, height, { still: Boolean(spec.still) });
  const box = div().relative().flex_none().w(w).h(height);
  const x = Math.round(w * DUCK_CENTER - height / 2);
  if (spec?.image) {
    const pic = image(spec.image).size(height).flex_none();
    return box.child(moved(div().absolute().left(x).top(0).size(height).child(pic), spec.motion, height, x));
  }
  if (spec?.text) {
    const list = (Array.isArray(spec.text) ? spec.text : [String(spec.text)]).filter((s) => s !== "");
    let face = div().absolute().left(x).top(0).size(height).flex().items_center().justify_center()
      .text_size(Math.round(height * 0.72)).child(list[0] ?? "?");
    if (list.length > 1) face = face.frames(list, Math.max(80, spec.ms ?? 400));
    return box.child(moved(face, spec.motion, height, x));
  }
  return box;
}

// ---- The file ---------------------------------------------------------------

function parse(text) {
  if (!text) return empty();
  const json = JSON.parse(text);
  return {
    default: typeof json.default === "string" ? json.default : DEFAULT_SET,
    spaces: json.spaces && typeof json.spaces === "object" ? json.spaces : {},
    sets: json.sets && typeof json.sets === "object" ? json.sets : {},
  };
}

// Reads the file into shared state when it changed (by hand or by another
// window). Returns the error text when it isn't valid JSON, and keeps the last good.
export async function load(last) {
  const text = await readTextFile(configPath()).catch(() => null);
  if (text === last.raw) return last.error ?? null;
  last.raw = text;
  try {
    const c = parse(text);
    if (JSON.stringify(c) !== JSON.stringify(shared(KEY) ?? null)) setShared(KEY, c);
    last.error = null;
  } catch (e) {
    last.error = `pond-agents.json: ${e.message}`;
  }
  return last.error;
}

// Shows the change everywhere at once, then writes the file.
export async function save(c) {
  setShared(KEY, c);
  const text = JSON.stringify(c, null, 2) + "\n";
  const current = await readTextFile(configPath()).catch(() => null);
  await writeTextFile(configPath(), text, current);
}

// Pictures to pick from: the shipped figures/ and the person's pond-figures/,
// one folder deep, as paths from the app home. `animated`: a GIF/WebP (may play)
// or an SVG with animation in it (needs converting to play).
export async function library() {
  const out = [];
  for (const [dir, own] of [[SHIPPED_DIR, false], [OWN_DIR, true]]) {
    const walk = async (rel, depth) => {
      let names = [];
      try { names = await fs.readdir(`${appHome()}/${rel}`); } catch { return; }
      for (const n of names.sort()) {
        if (n.startsWith(".")) continue;
        if (!IMAGE_EXT.test(n)) { if (depth < 1 && !n.includes(".")) await walk(`${rel}/${n}`, depth + 1); continue; }
        const path = `${rel}/${n}`;
        const svg = /\.svg$/i.test(n) ? svgAnimates(await readTextFile(`${appHome()}/${path}`).catch(() => null)) : false;
        out.push({ path, name: n.replace(IMAGE_EXT, ""), own, animated: PLAYS.test(n) || svg, needsConvert: svg });
      }
    };
    await walk(dir, 0);
  }
  return out;
}

// Copies dropped pictures into pond-figures/; returns the new paths.
export async function addPictures(paths) {
  const dir = `${appHome()}/${OWN_DIR}`;
  await exec("mkdir", ["-p", dir]);
  const added = [];
  for (const p of paths.filter((p) => IMAGE_EXT.test(p))) {
    const name = p.split("/").pop();
    const r = await exec("cp", [p, `${dir}/${name}`]).catch(() => null);
    if (r && r.code === 0) added.push(`${OWN_DIR}/${name}`);
  }
  return added;
}

export const openFolder = async () => {
  const dir = `${appHome()}/${OWN_DIR}`;
  await exec("mkdir", ["-p", dir]);
  const platform = window()?.platform;
  await exec(platform === "macos" ? "open" : platform === "windows" ? "explorer" : "xdg-open", [dir]).catch(() => null);
};
