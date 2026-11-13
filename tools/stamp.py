#!/usr/bin/env python3
"""Run by sync.sh after copying. Stamps where each published mod and layout came from
(`source` in its mod.json / layout root), drops UPDATE.md into every mod folder, and
writes versions.json: what an agent compares installed versions against."""
import json, os, shutil, sys

REPO = sys.argv[1]
URL = "https://github.com/SimonBystromTableCheck/herdr-mods"
# Mods my own layouts use that aren't published (third-party, with local patches):
# their blocks are cut from the published layouts. Each recipe says how to add them back.
PRIVATE = {"sysstat"}

def strip(node):
    """Drops blocks showing a PRIVATE mod from a layout tree (children and floating)."""
    if isinstance(node, dict):
        for key in ("children", "floating"):
            if isinstance(node.get(key), list):
                node[key] = [c for c in node[key] if not (isinstance(c, dict) and (c.get("content") or {}).get("mod") in PRIVATE)]
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
        tree = strip(json.load(open(lp)))
        if any(f'"mod": "{m}"' in json.dumps(tree) for m in PRIVATE): sys.exit(f"layout {l}: a private mod is still referenced")
        open(lp, "w").write(json.dumps(tree, indent=2) + "\n")
        v = stamp(os.path.join(REPO, item, "layouts", f"{l}.json"), {"repo": URL, "item": item, "layout": l})
        if not v: sys.exit(f"layout {l}: no \"version\"")
        index["layouts"][l] = {"version": v, "item": item, "path": f"{item}/layouts/{l}.json", "mods": mods}
        entry["layouts"] = layouts
    index["items"][item] = entry
json.dump(index, open(os.path.join(REPO, "versions.json"), "w"), indent=2)
open(os.path.join(REPO, "versions.json"), "a").write("\n")
