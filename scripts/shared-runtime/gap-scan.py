#!/usr/bin/env python3
"""Daily read-only report of what agents were missing or (re)installed (installed as
/usr/local/lib/agent-studio/runtime-gap-scan.py, run by agent-studio-runtime-gap-scan.timer).

Scans Codex rollouts of the last WINDOW_DAYS for "No module named X" / "X: command not found"
and for install commands, plus per-thread tool caches that duplicate the shared caches.
Only aggregated tool names and counts are written, never conversation content.

Usage: gap-scan.py --codex-homes DIR --sessions DIR --output FILE [--days 30]
"""
import argparse
import json
import os
import re
import sys
import tempfile
import time
from collections import Counter, defaultdict

INSTALLS = [
    ("pip install", re.compile(r"\b(?:pip3?|python3?\s+-m\s+pip)\s+install\b")),
    ("uv", re.compile(r"\buv\s+(?:pip\s+install|add|tool\s+install|venv)\b|\buvx\s")),
    ("新建虚拟环境", re.compile(r"\b(?:python3?\s+-m\s+venv|virtualenv)\b")),
    ("npm / npx", re.compile(r"\b(?:npm\s+(?:install|i|add|ci)\b|npx\s+(?:-y\s+|--yes\s+)?[@\w]|pnpm\s+(?:add|install|dlx)|yarn\s+add)")),
    ("playwright install", re.compile(r"playwright\s+install")),
    ("系统包（apt）", re.compile(r"\b(?:apt-get|apt|dnf|yum)\s+install\b")),
    ("模型下载", re.compile(r"hf_hub_download|snapshot_download|huggingface-cli|nltk\.download|spacy\s+download|whisper\.load_model|easyocr\.Reader|argostranslate\.package\.install")),
]
MISSING_MODULE = re.compile(r"No module named '([A-Za-z_][\w]*)")
MISSING_COMMAND = re.compile(r"(?:^|[\s:/])([A-Za-z][\w.+-]{1,40}): (?:command )?not found")
NAME_OK = re.compile(r"^[A-Za-z][\w.+-]{1,40}$")
# Per-thread directories that duplicate a shared cache when present.
DUPLICATE_CACHES = [
    "cache/ms-playwright", "cache/pip", "cache/uv", "cache/huggingface", "cache/torch",
    "cache/tesseract", "cache/argos-translate", "home/.npm", "home/.cache/ms-playwright",
    "home/.cache/pip", "home/.cache/uv", "home/.cache/huggingface", "home/.local/lib",
]


def texts(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for item in value:
            yield from texts(item)
    elif isinstance(value, dict):
        for item in value.values():
            yield from texts(item)


def scan_rollouts(root, cutoff):
    module_hits, command_hits = Counter(), Counter()
    module_threads, command_threads = defaultdict(set), defaultdict(set)
    install_calls, install_threads = Counter(), defaultdict(set)
    scanned = with_gaps = 0
    for directory, _dirs, files in os.walk(root):
        for name in files:
            if not (name.startswith("rollout-") and name.endswith(".jsonl")):
                continue
            path = os.path.join(directory, name)
            try:
                if os.path.getmtime(path) < cutoff:
                    continue
                handle = open(path, errors="replace")
            except OSError:
                continue
            scanned += 1
            had_gap = False
            with handle:
                for line in handle:
                    if '"function_call' not in line and '"custom_tool_call' not in line:
                        continue
                    try:
                        payload = json.loads(line).get("payload") or {}
                    except ValueError:
                        continue
                    kind = payload.get("type", "")
                    if kind in ("function_call", "custom_tool_call"):
                        command = " ".join(texts({k: v for k, v in payload.items() if k in ("arguments", "input")}))
                        for label, pattern in INSTALLS:
                            if pattern.search(command):
                                install_calls[label] += 1
                                install_threads[label].add(name)
                    elif kind.endswith("_output"):
                        output = " ".join(texts(payload.get("output")))[:200000]
                        for module in set(MISSING_MODULE.findall(output)):
                            module_hits[module] += 1
                            module_threads[module].add(name)
                            had_gap = True
                        for command in set(MISSING_COMMAND.findall(output)):
                            if NAME_OK.match(command) and not command.isdigit():
                                command_hits[command] += 1
                                command_threads[command].add(name)
                                had_gap = True
            with_gaps += had_gap
    items = [
        {"kind": "python", "name": name, "threads": len(module_threads[name]), "occurrences": count}
        for name, count in module_hits.items()
    ] + [
        {"kind": "command", "name": name, "threads": len(command_threads[name]), "occurrences": count}
        for name, count in command_hits.items()
    ]
    # One-off names are usually the user's own scripts or typos rather than missing tools.
    items = sorted((item for item in items if item["threads"] >= 2), key=lambda item: (-item["threads"], item["name"]))[:40]
    installs = sorted(
        ({"tool": label, "calls": calls, "threads": len(install_threads[label])} for label, calls in install_calls.items()),
        key=lambda item: -item["calls"],
    )
    return scanned, with_gaps, items, installs


def tree_bytes(path):
    total = 0
    for directory, _dirs, files in os.walk(path, followlinks=False):
        for name in files:
            try:
                total += os.lstat(os.path.join(directory, name)).st_blocks * 512
            except OSError:
                pass
    return total


def scan_duplicate_caches(sessions_root):
    threads, sizes = Counter(), Counter()
    for directory, dirs, _files in os.walk(sessions_root, followlinks=False):
        for name in [d for d in dirs if d.startswith("thread-")]:
            tmp = os.path.join(directory, name, ".agent-studio", "tmp")
            if not os.path.isdir(tmp):
                continue
            for relative in DUPLICATE_CACHES:
                path = os.path.join(tmp, relative)
                if os.path.isdir(path) and not os.path.islink(path):
                    size = tree_bytes(path)
                    if size > 1024 * 1024:
                        threads[relative] += 1
                        sizes[relative] += size
        dirs[:] = [d for d in dirs if not d.startswith("thread-") and not d.startswith(".")]
    return sorted(
        ({"name": name, "threads": threads[name], "bytes": sizes[name]} for name in threads),
        key=lambda item: -item["bytes"],
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--codex-homes", required=True)
    parser.add_argument("--sessions", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--days", type=int, default=30)
    args = parser.parse_args()

    started = time.time()
    scanned, with_gaps, items, installs = scan_rollouts(args.codex_homes, started - args.days * 86400)
    report = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "windowDays": args.days,
        "rolloutsScanned": scanned,
        "rolloutsWithGaps": with_gaps,
        "items": items,
        "installs": installs,
        "duplicateCaches": scan_duplicate_caches(args.sessions),
        "durationSeconds": round(time.time() - started, 1),
    }
    directory = os.path.dirname(os.path.abspath(args.output))
    os.makedirs(directory, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix=".runtime-gaps.", dir=directory)
    with os.fdopen(fd, "w") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=1)
    os.chmod(temp, 0o644)
    os.replace(temp, args.output)
    print(f"runtime gaps: scanned={scanned} with_gaps={with_gaps} items={len(items)} in {report['durationSeconds']}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
