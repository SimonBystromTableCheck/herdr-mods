// Which Claude accounts' usage shows in the sidebar, as the person's own setting:
// ~/.config/herdr-app/pond-usage.json ({"pinned": [cvm profile names]}), outside every mod folder so
// updates and reinstalls keep it, and hand edits show within seconds. Shared state mirrors it live.
// Identical copies live in mods/pond-usage (the sidebar cards) and mods/pond-profiles (the pins).
import { appHome, readTextFile, writeTextFile, shared, setShared } from "herdr";

export const KEY = "pond-usage.pinned";
export const path = () => `${appHome()}/pond-usage.json`;

/** The pinned profile names in order, or null before the file has been read. */
export const pinnedUsage = () => (Array.isArray(shared(KEY)) ? shared(KEY) : null);

/** Reads the file into shared state when it changed. Without a file, `start` (if any) starts it. */
export async function loadUsagePins(last, start = null) {
  const text = await readTextFile(path()).catch(() => null);
  if (text === last.raw) return;
  last.raw = text;
  if (text === null) { if (start) await saveUsagePins(pinnedUsage() ?? start); return; }
  try {
    const list = JSON.parse(text).pinned;
    if (Array.isArray(list) && JSON.stringify(list) !== JSON.stringify(pinnedUsage())) setShared(KEY, list.filter(x => typeof x === "string"));
  } catch { /* a bad hand edit: keep the last good list */ }
}

/** Shows the change everywhere at once, then writes the file. */
export async function saveUsagePins(list) {
  setShared(KEY, list);
  const current = await readTextFile(path()).catch(() => null);
  let rest = {};
  try { rest = JSON.parse(current ?? "{}") ?? {}; } catch {}
  await writeTextFile(path(), JSON.stringify({ ...rest, pinned: list }, null, 2) + "\n", current).catch(() => {});
}

/** Pins or unpins one profile. */
export const toggleUsagePin = name => {
  const list = pinnedUsage() ?? [];
  return saveUsagePins(list.includes(name) ? list.filter(x => x !== name) : [...list, name]);
};
