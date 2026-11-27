// How people styled their spaces, as the person's own setting: ~/.config/herdr-app/pond-space-icons.json
// ({"spaces": {"<space id>": {"icon": "icons/<file>.svg", "color": "ansi4"}}}), outside every mod folder so
// updates keep it. `color` names a theme color, so it follows the theme. An entry that is just a string is an icon.
// Shared state "pond-space-icons" mirrors it live for every copy. Names live in Herdr (space.rename).
// Identical logic in mods/space-editor/main.js (mods can't import each other).
import { appHome, readTextFile, writeTextFile, shared, setShared } from "herdr";

export const KEY = "pond-space-icons";
export const path = () => `${appHome()}/pond-space-icons.json`;

/** A space's chosen look: { icon, color }, each null when it shows the default. */
export function styleFor(id) {
  const v = shared(KEY)?.[id];
  if (typeof v === "string") return { icon: v, color: null };
  return { icon: v?.icon ?? null, color: v?.color ?? null };
}

/** Reads the file into shared state when it changed. */
export async function load(last) {
  const text = await readTextFile(path()).catch(() => null);
  if (text === last.raw) return;
  last.raw = text;
  if (text === null) return;
  try {
    const map = JSON.parse(text).spaces;
    if (map && typeof map === "object") setShared(KEY, map);
  } catch { /* a bad hand edit: keep the last good styles */ }
}
