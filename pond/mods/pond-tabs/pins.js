// The pinned panels, as the person's own setting: ~/.config/herdr-app/pond-pins.json
// ({"pins": [panel ids]}), outside every mod folder so updates and reinstalls keep it, and hand edits
// show within seconds. Shared state "pond-pins" mirrors it live for every copy.
// Identical copies live in mods/pond-pins and mods/pond-tabs (mods can't import each other).
import { appHome, readTextFile, writeTextFile, shared, setShared } from "herdr";

export const KEY = "pond-pins";
export const path = () => `${appHome()}/pond-pins.json`;

/** The pinned panel ids, in order. */
export const pins = () => (Array.isArray(shared(KEY)) ? shared(KEY) : []);

/** Reads the file into shared state when it changed. Without a file, writes the current pins to start it. */
export async function load(last) {
  const text = await readTextFile(path()).catch(() => null);
  if (text === last.raw) return;
  last.raw = text;
  if (text === null) { if (pins().length) await save(pins()); return; }
  try {
    const list = JSON.parse(text).pins;
    if (Array.isArray(list) && JSON.stringify(list) !== JSON.stringify(pins())) setShared(KEY, list.filter(x => typeof x === "string"));
  } catch { /* a bad hand edit: keep the last good pins */ }
}

/** Shows the change everywhere at once, then writes the file. */
export async function save(list) {
  setShared(KEY, list);
  const current = await readTextFile(path()).catch(() => null);
  let rest = {};
  try { rest = JSON.parse(current ?? "{}") ?? {}; } catch {}
  await writeTextFile(path(), JSON.stringify({ ...rest, pins: list }, null, 2) + "\n", current).catch(() => {});
}
