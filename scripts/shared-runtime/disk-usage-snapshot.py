#!/usr/bin/env python3
"""Daily read-only disk usage snapshot for the admin console (installed as
/usr/local/lib/agent-studio/disk-usage-snapshot.py, run by agent-studio-disk-usage-snapshot.timer).

Records filesystem usage plus the size of the areas agent-studio grows into, keeping one entry per
UTC day so the admin console can show the trend and which area is growing. Area sizes come from
`du -sxk` at idle IO priority (about 30s on production). Only sizes are written, never file names.

Usage: disk-usage-snapshot.py --output FILE --area key=label=path [--area ...] [--keep-days 180]
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
import time


def du_bytes(path):
    if not os.path.exists(path):
        return None
    try:
        out = subprocess.run(
            ["du", "-sxk", path], capture_output=True, text=True, timeout=1800, check=False
        ).stdout.split()
        return int(out[0]) * 1024 if out else None
    except (subprocess.TimeoutExpired, ValueError, OSError):
        return None


def load(path):
    try:
        with open(path) as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--area", action="append", default=[], help="key=label=path")
    parser.add_argument("--filesystem", default="/")
    parser.add_argument("--keep-days", type=int, default=180)
    args = parser.parse_args()

    stat = os.statvfs(args.filesystem)
    total = stat.f_blocks * stat.f_frsize
    free = stat.f_bavail * stat.f_frsize
    used = (stat.f_blocks - stat.f_bfree) * stat.f_frsize

    areas = []
    for spec in args.area:
        key, label, path = spec.split("=", 2)
        areas.append({"key": key, "label": label, "bytes": du_bytes(path)})
    known = sum(area["bytes"] or 0 for area in areas)
    areas.append({"key": "other", "label": "系统与其它", "bytes": max(0, used - known)})

    now = time.gmtime()
    entry = {
        "date": time.strftime("%Y-%m-%d", now),
        "recordedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", now),
        "usedBytes": used,
        "totalBytes": total,
        "areas": {area["key"]: area["bytes"] for area in areas if area["bytes"] is not None},
    }
    previous = load(args.output)
    history = [item for item in previous.get("history", []) if isinstance(item, dict) and item.get("date") != entry["date"]]
    history.append(entry)
    history = sorted(history, key=lambda item: str(item.get("date")))[-max(7, args.keep_days):]
    payload = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", now),
        "filesystem": {"totalBytes": total, "usedBytes": used, "availableBytes": free},
        "areas": areas,
        "history": history,
    }

    directory = os.path.dirname(os.path.abspath(args.output))
    # Write through a fresh temp file and rename, so a link planted in the app-owned state
    # directory is replaced instead of followed.
    fd, temp = tempfile.mkstemp(prefix=".disk-usage.", dir=directory)
    with os.fdopen(fd, "w") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=1)
        handle.write("\n")
    os.chmod(temp, 0o644)
    os.replace(temp, args.output)
    print(json.dumps({"date": entry["date"], "usedBytes": used, "areas": len(areas)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
