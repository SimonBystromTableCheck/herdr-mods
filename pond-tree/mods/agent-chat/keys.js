import { appHome, shared, run, commands } from "herdr";
import { readFile } from "fs/promises";
import { onWindows } from "./platform.js";

const CONTEXT = "HerdrChatReply > Input";
const LAYOUT_KEYS = { "alt-shift-up": "herdr_chat::PassAltShiftUp", "alt-shift-down": "herdr_chat::PassAltShiftDown" };
const OWN_KEYS = [
  { keystroke: "up", action: "herdr_chat::LineUp" },
  { keystroke: "down", action: "herdr_chat::LineDown" },
  { keystroke: "escape", action: "herdr_chat::Stop" },
];

let keymap = {}, keymapText = null, keymapChanged = false;

/** The action a passed chord is delivered as: "ctrl-a" → "herdr_chat::Pass_ctrl_a". */
export const passAction = keystroke => LAYOUT_KEYS[keystroke] ?? `herdr_chat::Pass_${keystroke.replace(/[^a-z0-9]/gi, "_")}`;

/**
 * Chords the reply box would take for its own editing but keys.json gives the app: alt-shift-up/down, and every
 * ctrl+letter bound in global or a layout section (the leader, ctrl-a here, is one). A text input reads ctrl+letters as
 * line editing, so without this they never reach the app while typing in the chat.
 */
export function passKeys() {
  const sections = Object.entries(keymap).filter(([name]) => name === "global" || name.startsWith("layout:")).map(([, keys]) => keys ?? {});
  const ctrl = new Set();
  for (const keys of sections)
    for (const [keystroke, action] of Object.entries(keys))
      if (/^ctrl-[a-z]$/.test(keystroke) && action && action !== "terminal" && !String(action).startsWith("send:")) ctrl.add(keystroke);
  return [...Object.keys(LAYOUT_KEYS), ...[...ctrl].sort()];
}

const composerKeys = () => [...OWN_KEYS, ...passKeys().map(keystroke => ({ keystroke, action: passAction(keystroke) }))]
  .map(key => ({ ...key, context: CONTEXT }));

/** Reads keys.json into the keymap, noting when its text changed since the last read. */
async function readKeymap() {
  let text;
  try { text = await readFile(onWindows() ? `${appHome()}\\keys.json` : `${appHome()}/keys.json`, "utf8"); }
  catch { text = ""; }
  if (keymapText !== null && text !== keymapText) keymapChanged = true;
  keymapText = text;
  try { keymap = JSON.parse(text) ?? {}; } catch { keymap = {}; }
}
readKeymap();

/**
 * Binds the composer's keys, and binds them again each time keys.json changes, as Herdr then installs its keymap anew.
 */
export function bindComposerKeys(cx) {
  // Bound again whenever the set changes, not once per app run: globalThis outlives a reload of this mod, so a flag there
  // kept a new build's chords (a newly bound ctrl+letter) from ever being installed.
  const bind = cx => {
    const keys = composerKeys(), sig = JSON.stringify(keys);
    if (globalThis.herdrChatComposerKeys === sig && !keymapChanged) return;
    keymapChanged = false;
    globalThis.herdrChatComposerKeys = sig;
    cx.bind_keys(keys);
  };
  bind(cx);
  // One watcher per build (module state starts over with each build; the old build's timer has stopped).
  if (keysWatched) return;
  keysWatched = true;
  cx.timer.every(1000, cx => { readKeymap(); bind(cx); });
}
let keysWatched = false;

/** What keys.json binds this chord to for the shown layout, else globally. */
function bound(keystroke) {
  return keymap[`layout:${shared("layout")}`]?.[keystroke] ?? keymap.global?.[keystroke];
}

/** Runs keys.json's binding for a layout key the composer's text input would otherwise take; true when it ran one. */
export function passKey(keystroke) {
  if (!passKeys().includes(keystroke)) return false;
  const action = bound(keystroke);
  if (action && typeof action === "object" && action.command) { run(action.command, action.args ?? {}); return true; }
  if (typeof action !== "string" || action === "terminal" || action.startsWith("send:")) return false;
  // "name:value" fills the command's first argument, as keys.json's shorthand does ("mod.open:leader").
  const at = action.indexOf(":");
  if (at < 0) { run(action); return true; }
  const name = action.slice(0, at), first = commands().find(c => c.name === name)?.args?.[0]?.name;
  if (!first) return false;
  run(name, { [first]: action.slice(at + 1) });
  return true;
}
