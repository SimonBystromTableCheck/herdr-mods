#!/usr/bin/env python3
"""Keeps sync.sh from overwriting work that reached the repo some other way (a merged pull
request, an edit made in the repo). sync.sh copies the live config over the repo, so a change
that only exists in the repo would be lost on the next publish.

  guard.py check  <repo> <home>   before copying: exit 1 listing the files that changed in the
                                  repo since the last sync and differ from the live config
  guard.py record <repo> <home>   after copying: remember what the sync wrote

The record is .git/herdr-sync-manifest.json (local, never committed): each synced file's hash.
A file counts as changed in the repo when it no longer matches the record (edited, added or
deleted). It only blocks the sync if the live copy differs too, compared without what the sync
adds itself ("source" stamps, UPDATE.md, private layout blocks): once a change is installed
into the live config, the sync goes ahead.
"""
import hashlib, json, os, sys

MANIFEST = ".git/herdr-sync-manifest.json"
GENERATED = {"UPDATE.md"}  # written into every mod folder by stamp.py


def items(repo):
    for line in open(os.path.join(repo, "items.conf")):
        w = line.split()
        if not w or w[0].startswith("#"):
            continue
        yield w[0], [x for x in w[2:] if x != "keys" and not x.startswith("layout:")], [x[7:] for x in w[2:] if x.startswith("layout:")]


def pairs(repo, home):
    """{repo-relative path: live path} for every file the sync writes (and would write)."""
    out = {}
    for item, mods, layouts in items(repo):
        for m in mods:
            for base, live_base in ((os.path.join(repo, item, "mods", m), os.path.join(home, "mods", m)),):
                for root in {base, live_base}:
                    if not os.path.isdir(root):
                        continue
                    for d, _, files in os.walk(root):
                        for f in files:
                            rel = os.path.relpath(os.path.join(d, f), root)
                            if f in GENERATED or f in ("gpui-kit.d.ts", "jsconfig.json", ".DS_Store") or f.endswith(".error") \
                                    or "node_modules" in rel.split(os.sep) or "__pycache__" in rel.split(os.sep) or f.startswith(".handoff-"):
                                continue
                            out[os.path.join(item, "mods", m, rel)] = os.path.join(live_base, rel)
        for n in layouts:
            out[os.path.join(item, "layouts", f"{n}.json")] = os.path.join(home, "layouts", f"{n}.json")
    for f in ("keys.json", "settings.json", "programs.json"):
        out[os.path.join("machine", f)] = os.path.join(home, f)
    return out


def digest(path):
    try:
        return hashlib.sha256(open(path, "rb").read()).hexdigest()
    except FileNotFoundError:
        return None


def private():
    """stamp.py's PRIVATE set (read from its source: importing it would run it)."""
    import ast, re
    m = re.search(r"^PRIVATE\s*=\s*(\{.*?\})", open(os.path.join(os.path.dirname(__file__), "stamp.py")).read(), re.M)
    return ast.literal_eval(m.group(1)) if m else set()


def strip(node, hidden):
    """Drops blocks showing a private mod (as stamp.py does for the published layouts)."""
    if isinstance(node, dict):
        for key in ("children", "floating"):
            if isinstance(node.get(key), list):
                node[key] = [c for c in node[key] if not (isinstance(c, dict) and (c.get("content") or {}).get("mod") in hidden)]
        for v in node.values():
            strip(v, hidden)
    elif isinstance(node, list):
        for v in node:
            strip(v, hidden)
    return node


def normal(path):
    """The file's content without what the sync adds itself (JSON: "source", private blocks)."""
    try:
        raw = open(path, "rb").read()
    except FileNotFoundError:
        return None
    if path.endswith(".json"):
        try:
            d = json.loads(raw)
            if isinstance(d, dict):
                d.pop("source", None)
            return json.dumps(strip(d, private()), sort_keys=True)
        except Exception:
            return raw
    return raw


def main():
    cmd, repo, home = sys.argv[1], sys.argv[2], sys.argv[3]
    mpath = os.path.join(repo, MANIFEST)
    files = pairs(repo, home)
    if cmd == "record":
        json.dump({p: digest(os.path.join(repo, p)) for p in files if os.path.exists(os.path.join(repo, p))}, open(mpath, "w"), indent=0, sort_keys=True)
        return
    if not os.path.exists(mpath):
        print("guard: no record of an earlier sync yet; this one starts it", file=sys.stderr)
        return
    seen = json.load(open(mpath))
    blocked = []
    for p in sorted(set(files) | set(seen)):
        now = digest(os.path.join(repo, p))
        if now == seen.get(p):
            continue  # untouched since the last sync
        live = files.get(p)
        if live and normal(os.path.join(repo, p)) == normal(live):
            continue  # already in the live config
        what = "added in the repo" if p not in seen else "deleted in the repo" if now is None else "changed in the repo"
        here = live if live and os.path.exists(live) else "not in your live config"
        blocked.append(f"  {p}  ({what}; live: {here})")
    if blocked:
        print("sync.sh stopped: these files changed in the repo since the last sync (a merged pull request?)\n"
              "and differ from your live config, so syncing would undo them:\n" + "\n".join(blocked) +
              "\n\nInstall those changes into ~/.config/herdr-app first (then sync again), or run\n"
              "  ./sync.sh --overwrite\nto replace them with your live files on purpose.", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
