// Which live terminal runs which Claude session: the claude.session label pond-profiles' status line hook keeps,
// else the chat view's own mapping (shared "herdr-chat.paths", for terminals it has shown). Copied in pond-chrome.
import { terminals, shared } from "herdr";

/** Map of session id → terminal address, for live terminals on this computer. */
export function liveSessions() {
  const out = new Map();
  const live = terminals().filter((x) => x.state === "live" && !String(x.address).includes("/"));
  const ids = new Set(live.map((x) => x.address));
  for (const [key, v] of Object.entries(shared("herdr-chat.paths") ?? {})) {
    const address = key.split(":")[0];
    if (v?.path && ids.has(address)) out.set(v.path.split("/").pop().replace(/\.jsonl$/, ""), address);
  }
  // The label is newer than the chat's guess (a /clear or /resume inside the terminal changes it).
  for (const x of live) {
    const id = x.labels?.["claude.session"];
    if (id) {
      for (const [k, a] of out) if (a === x.address) out.delete(k);
      out.set(id, x.address);
    }
  }
  return out;
}
