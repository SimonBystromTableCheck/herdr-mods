#!/usr/bin/env python3
"""Run by sync.sh after copying. Stamps where each published mod and layout came from
(`source` in its mod.json / layout root), drops UPDATE.md into every mod folder, and
writes versions.json: what an agent compares installed versions against."""
import json, os, shutil, sys

REPO = sys.argv[1]
URL = "https://github.com/SimonBystromTableCheck/herdr-mods"
# Mods my own layouts use that aren't published (third-party, with local patches):
# their blocks are cut from the published layouts. Each recipe says how to add them back.
PRIVATE = {"sysstat", "pond-sysstat", "brew"}
# Blocks I removed from my own layout but the published one keeps: {layout: [(stack id, index, block, make active)]}.
# Put back into the published copy (only if missing), so hiding a panel for myself doesn't hide it for everyone.
RESTORE = {layout: [("panel-body", 0, {"id": "files", "type": "block", "content": {"mod": "pond-files"}}, True)] for layout in ("pond", "pond-tree")}
# Nodes my own layout has but the published one shows differently: {layout: {node id: published node}}.
# Pond's work area is agent-chat's Chat/Terminal view for me; the published Pond keeps the plain tab.
REPLACE = {"pond": {"chat-view": {"id": "main", "type": "block", "content": {"tab": "active", "pane": {
    "header": {"content": {"mod": "pane"}, "reveal": "always", "height": 30, "position": "top"},
    "background": "background", "border": {"width": 1, "color": "border"}, "focus": {"width": 1, "color": "accent"},
    "radius": 10, "gap": 8, "lone": True}}}}}
# Herdr's own mods (shipped with the app, so a published layout may use them): installed.json's keys.
HERDR_HOME = os.environ.get("HERDR_APP_HOME") or os.path.expanduser("~/.config/herdr-app")
HERDR_OWN = {k for k in json.load(open(os.path.join(HERDR_HOME, "installed.json"))) if not k.startswith("layout:")}

def find(n, i):
    if isinstance(n, dict):
        if n.get("id") == i: return n
        for c in n.get("children", []) + n.get("floating", []):
            f = find(c, i)
            if f: return f
    return None

def replace(tree, name):
    for i, node in REPLACE.get(name, {}).items():
        def swap(n):
            if isinstance(n, dict):
                for key in ("children", "floating"):
                    if isinstance(n.get(key), list):
                        n[key] = [json.loads(json.dumps(node)) if isinstance(c, dict) and c.get("id") == i else c for c in n[key]]
                for v in n.values(): swap(v)
            elif isinstance(n, list):
                for v in n: swap(v)
        swap(tree)
    return tree

def used_mods(n, acc=None):
    """Every mod a layout tree shows: blocks, pane headers, stack headers, floating blocks."""
    acc = set() if acc is None else acc
    if isinstance(n, dict):
        if isinstance(n.get("mod"), str): acc.add(n["mod"])
        for v in n.values(): used_mods(v, acc)
    elif isinstance(n, list):
        for v in n: used_mods(v, acc)
    return acc

def restore(tree, name):
    for stack, at, block, active in RESTORE.get(name, []):
        node = find(tree, stack)
        if not node or find(tree, block["id"]): continue
        node.setdefault("children", []).insert(at, block)
        if active: node["active"] = block["id"]
    return tree

def strip(node):
    """Drops blocks showing a PRIVATE mod from a layout tree (children and floating)."""
    if isinstance(node, dict):
        for key in ("children", "floating"):
            if isinstance(node.get(key), list):
                node[key] = [c for c in node[key] if not (isinstance(c, dict) and (c.get("content") or {}).get("mod") in PRIVATE)]
        if node.get("type") == "stack" and node.get("active") and node["active"] not in [c.get("id") for c in node.get("children", []) if isinstance(c, dict)]:
            node.pop("active")  # it pointed at a private block that was just cut
        for v in node.values(): strip(v)
    elif isinstance(node, list):
        for v in node: strip(v)
    return node

items = []  # (item, kind, mods, layouts, keys)
for line in open(os.path.join(REPO, "items.conf")):
    w = line.split()
    if not w or w[0].startswith("#"): continue
    mods = [x for x in w[2:] if x != "keys" and not x.startswith("layout:")]
    layouts = [x[7:] for x in w[2:] if x.startswith("layout:")]
    items.append((w[0], w[1], mods, layouts, "keys" in w[2:]))

home = {}  # mod -> the item that publishes it on its own (first listed)
for item, kind, mods, _, _ in items:
    for m in mods: home.setdefault(m, item)

def stamp(path, src):
    raw = open(path).read()
    d = json.loads(raw)
    out, done = {}, False
    for k, v in d.items():
        if k == "source": continue
        out[k] = v
        if k == "version": out["source"] = src; done = True
    if not done: out["source"] = src
    s = json.dumps(out, indent=2) if "\n" in raw.strip() else "{ " + json.dumps(out)[1:-1] + " }"
    open(path, "w").write(s + "\n")
    return d.get("version")

# update.js (the self-update pill) and panel.js (where a panel is, closing it) are each one file
# copied into every mod that uses it: copies must not drift.
for shared_file in ("update.js", "panel.js"):
    copies = {}
    for item, kind, mods, _, _ in items:
        for m in mods:
            f = os.path.join(REPO, item, "mods", m, shared_file)
            if os.path.isfile(f): copies.setdefault(open(f).read(), []).append(m)
    if len(copies) > 1:
        sys.exit(f"{shared_file} differs between mods: " + " / ".join(", ".join(sorted(set(v))) for v in copies.values()) + ". Copy one to the others.")

index = {"repo": URL, "update": "tools/UPDATE.md", "mods": {}, "layouts": {}, "items": {}}
for item, kind, mods, layouts, keys in items:
    entry = {"kind": kind, "recipe": f"{item}/RECIPE.md", "mods": mods}
    if keys: entry["keys"] = f"{item}/keys.json"
    for m in mods:
        folder = os.path.join(REPO, item, "mods", m)
        v = stamp(os.path.join(folder, "mod.json"), {"repo": URL, "item": home[m], "mod": m})
        shutil.copy(os.path.join(REPO, "tools", "UPDATE.md"), os.path.join(folder, "UPDATE.md"))
        if home[m] == item:
            if not v: sys.exit(f"{m}: no \"version\" in mod.json")
            index["mods"][m] = {"version": v, "item": item, "path": f"{item}/mods/{m}"}
    for l in layouts:
        lp = os.path.join(REPO, item, "layouts", f"{l}.json")
        tree = restore(replace(strip(json.load(open(lp))), l), l)
        if any(f'"mod": "{m}"' in json.dumps(tree) for m in PRIVATE): sys.exit(f"layout {l}: a private mod is still referenced")
        open(lp, "w").write(json.dumps(tree, indent=2) + "\n")
        v = stamp(os.path.join(REPO, item, "layouts", f"{l}.json"), {"repo": URL, "item": item, "layout": l})
        if not v: sys.exit(f"layout {l}: no \"version\"")
        index["layouts"][l] = {"version": v, "item": item, "path": f"{item}/layouts/{l}.json", "mods": mods}
        entry["layouts"] = layouts
    index["items"][item] = entry

# A published layout may only show mods people can get: published here or shipped with Herdr.
for l, entry in index["layouts"].items():
    missing = used_mods(json.load(open(os.path.join(REPO, entry["path"])))) - set(index["mods"]) - HERDR_OWN
    if missing: sys.exit(f"layout {l} shows unpublished mods: {', '.join(sorted(missing))} (publish them, or add to PRIVATE / REPLACE)")

# A change people should get needs a new version: an update is only offered when the version moves.
# Compared with the last commit; new items (not committed yet) are skipped.
import subprocess
def git(*a):
    return subprocess.run(["git", "-C", REPO, *a], capture_output=True, text=True)
def committed_version(path):
    r = git("show", f"HEAD:{path}")
    if r.returncode: return None
    try: return json.loads(r.stdout).get("version")
    except ValueError: return None
stale = []
for kind, table in (("mod", index["mods"]), ("layout", index["layouts"])):
    for name, e in table.items():
        meta = e["path"] + ("/mod.json" if kind == "mod" else "")
        before = committed_version(meta)
        if before is None or before != e["version"]: continue
        # Mods: whatever changed in the folder; UPDATE.md and mod.json's "source" are stamped here.
        changed = git("status", "--porcelain", "--", e["path"]).stdout.split("\n")
        changed = [c for c in changed if c.strip() and not c.endswith("/UPDATE.md")]
        if changed: stale.append(f"{kind} {name} {e['version']}")
if stale: sys.exit("changed without a new version: " + "; ".join(stale) + ". Bump \"version\" (and add a Changes entry).")

json.dump(index, open(os.path.join(REPO, "versions.json"), "w"), indent=2)
open(os.path.join(REPO, "versions.json"), "a").write("\n")
