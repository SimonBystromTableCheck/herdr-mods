#!/usr/bin/env python3
"""Claude Code's past sessions, newest first, as JSON on stdout.

Reads ~/.claude/projects/*/*.jsonl (one file per session). Each file is summed up once and kept in
.cache.json beside this script, keyed by its size and mtime, so later runs only read what changed.
Prints {"ok": true, "sessions": [...]}; each session:
  id, path, cwd, branch, title, first, last, started, updated (ms), prompts, cost, pr, model
"""
import json, os, sys, glob, time
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, ".cache.json")
ROOT = os.path.expanduser("~/.claude/projects")
LIMIT = int(sys.argv[1]) if len(sys.argv) > 1 else 400
VERSION = 3

# Lines worth parsing: everything else (api requests, attachments, snapshots) is skipped unread.
WANT = ('"type":"user"', '"type":"ai-title"', '"type":"last-prompt"', '"type":"cost-state"',
        '"type":"pr-link"', '"type":"assistant"', '"type":"custom-title"', '"type":"summary"')


def ms(ts):
    try:
        return int(datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp() * 1000)
    except Exception:
        return None


def prompt_text(msg):
    """The words a person typed, or None for tool results, commands' plumbing and reminders."""
    c = (msg or {}).get("content")
    if isinstance(c, list):
        parts = [b.get("text", "") for b in c if isinstance(b, dict) and b.get("type") == "text"]
        if not parts or any(isinstance(b, dict) and b.get("type") == "tool_result" for b in c):
            return None
        c = "\n".join(parts)
    if not isinstance(c, str):
        return None
    s = c.strip()
    if not s or s.startswith("<") or s.startswith("Caveat:") or s.startswith("[Request interrupted"):
        # A slash command is kept as its name ("/model opus").
        if s.startswith("<command-name>"):
            name = s.split("<command-name>", 1)[1].split("</command-name>", 1)[0].strip()
            args = s.split("<command-args>", 1)[1].split("</command-args>", 1)[0].strip() if "<command-args>" in s else ""
            return {"command": f"{name} {args}".strip()}
        return None
    if s.startswith("This session is being continued from a previous conversation"):
        return None
    return s


def summarize(path):
    out = {"id": os.path.basename(path)[:-6], "path": path, "cwd": None, "branch": None, "title": None,
           "first": None, "last": None, "started": None, "updated": None, "prompts": 0, "cost": None,
           "pr": None, "model": None}
    with open(path, "r", errors="replace") as f:
        for line in f:
            if not any(w in line for w in WANT):
                continue
            try:
                d = json.loads(line)
            except Exception:
                continue
            t = d.get("type")
            if t == "ai-title" and d.get("aiTitle"):
                out["title"] = out["title"] if out.get("named") else d["aiTitle"]
            elif t == "custom-title" and d.get("customTitle"):
                out["title"] = d["customTitle"]; out["named"] = True
            elif t == "summary" and d.get("summary") and not out["title"]:
                out["title"] = d["summary"]
            elif t == "last-prompt" and d.get("lastPrompt"):
                out["last"] = d["lastPrompt"]
            elif t == "cost-state":
                out["cost"] = d.get("totalCostUSD")
            elif t == "pr-link" and d.get("prUrl"):
                out["pr"] = {"url": d["prUrl"], "number": d.get("prNumber"), "repo": d.get("prRepository")}
            elif t in ("user", "assistant"):
                if d.get("isSidechain"):
                    continue
                ts = ms(d.get("timestamp") or "")
                if ts:
                    out["started"] = out["started"] or ts
                    out["updated"] = ts
                # Where it started: Claude keeps a session under that folder's project, and resumes it only there.
                if d.get("cwd") and not out["cwd"]:
                    out["cwd"] = d["cwd"]
                if d.get("gitBranch") and d["gitBranch"] != "HEAD":
                    out["branch"] = d["gitBranch"]
                if t == "assistant":
                    m = (d.get("message") or {}).get("model")
                    if m and m != "<synthetic>":
                        out["model"] = m
                    continue
                if d.get("isMeta"):
                    continue
                p = prompt_text(d.get("message"))
                if isinstance(p, str):
                    out["prompts"] += 1
                    out["first"] = out["first"] or p[:600]
                    out["last_typed"] = p[:600]
    out["last"] = (out["last"] or out.pop("last_typed", None) or "")[:600] or None
    out.pop("last_typed", None)
    out.pop("named", None)
    return out


def main():
    try:
        cache = json.load(open(CACHE))
        if cache.get("v") != VERSION:
            cache = {}
    except Exception:
        cache = {}
    files = cache.get("files", {})
    seen, sessions = {}, []
    for path in glob.glob(os.path.join(ROOT, "*", "*.jsonl")):
        try:
            st = os.stat(path)
        except OSError:
            continue
        key = f"{st.st_size}:{int(st.st_mtime)}"
        hit = files.get(path)
        if hit and hit.get("key") == key:
            s = hit["s"]
        else:
            try:
                s = summarize(path)
            except Exception as e:  # one bad file never hides the rest
                continue
        seen[path] = {"key": key, "s": s}
        if s["prompts"]:
            if not s["updated"]:
                s["updated"] = int(st.st_mtime * 1000)
            sessions.append(s)
    try:
        tmp = CACHE + ".tmp"
        json.dump({"v": VERSION, "files": seen}, open(tmp, "w"))
        os.replace(tmp, CACHE)
    except Exception:
        pass
    sessions.sort(key=lambda s: s["updated"] or 0, reverse=True)
    json.dump({"ok": True, "sessions": sessions[:LIMIT], "total": len(sessions)}, sys.stdout)


if __name__ == "__main__":
    main()
