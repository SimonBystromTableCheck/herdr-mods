// Pond history: remembers the name a Claude session's tab or pane was given (tab.rename, pane.rename), by session id,
// in shared "pond.history.names", so the History window shows it after the terminal is gone. pond-chrome's header
// keeps it current (it is always in the layout); pond-history reads it.
import { shared, setShared, panes, spaces } from "herdr";
import { liveSessions } from "./live.js";

export const NAMES_KEY = "pond.history.names";

export function recordSessionNames() {
  const tabs = new Map(spaces().flatMap((s) => s.tabs.map((t) => [t.id, t])));
  const was = shared(NAMES_KEY) ?? {};
  const next = { ...was };
  for (const [id, address] of liveSessions()) {
    const pane = panes().find((p) => p.terminal === address);
    if (!pane) continue;
    const tab = tabs.get(pane.tab);
    const name = pane.name || (tab?.named ? tab.name : null);
    if (name) next[id] = name;
    else delete next[id];
  }
  if (JSON.stringify(next) !== JSON.stringify(was)) setShared(NAMES_KEY, next);
}
