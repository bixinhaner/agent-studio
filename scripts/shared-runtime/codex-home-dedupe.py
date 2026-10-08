#!/usr/bin/env python3
"""Daily de-duplication of per-conversation Codex homes (installed as
/usr/local/lib/agent-studio/codex-home-dedupe.py, run by agent-studio-codex-home-dedupe.timer
as the app user).

Codex installs remote plugins into every home separately (plugins/cache/<marketplace>/<plugin>/
<version>/...), so hundreds of homes hold byte-identical copies. Files inside a version directory
are release artifacts that Codex never edits in place: an upgrade writes a new version directory
and removes the old one. Identical files are therefore replaced by hard links to one copy, which
Codex cannot tell apart from the original. Install markers next to the version directories and
anything changed in the last hour (an install may be in progress) are left alone.

cache/remote_plugin_catalog/*.json are catalog snapshots Codex re-downloads when missing; files
not refreshed for CATALOG_DAYS belong to homes that are no longer used and are removed.

Usage: codex-home-dedupe.py --codex-homes DIR [--base-home DIR] [--state-dir DIR]
                            [--catalog-days 7] [--settle-seconds 3600] [--dry-run]
"""
import argparse
import hashlib
import json
import os
import sys
import tempfile
import time
from collections import defaultdict

# Files whose data or metadata changed recently may belong to an install in progress; ctime is
# checked as well because extracted archives can carry old modification times.
SETTLE_SECONDS = 3600
# Directories inside a home that never contain plugin caches; skipping them keeps the walk cheap.
SKIP_IN_HOME = {"sessions", "archived_sessions", "memories", "skills", "shell_snapshots", "log", "tmp", ".tmp"}


def is_home(path):
    return os.path.isdir(os.path.join(path, "plugins")) or os.path.lexists(os.path.join(path, "config.toml"))


def find_homes(root):
    homes = []
    for directory, dirs, _files in os.walk(root, followlinks=False):
        if is_home(directory):
            homes.append(directory)
            dirs[:] = []
            continue
        dirs[:] = [d for d in dirs if d not in SKIP_IN_HOME and not d.startswith(".")]
    return homes


def plugin_files(home, cutoff):
    """Yields (relative key, path, stat) for files inside plugin version directories."""
    cache = os.path.join(home, "plugins", "cache")
    try:
        marketplaces = os.listdir(cache)
    except OSError:
        return
    for marketplace in marketplaces:
        market_dir = os.path.join(cache, marketplace)
        if os.path.islink(market_dir) or not os.path.isdir(market_dir):
            continue
        for plugin in os.listdir(market_dir):
            plugin_dir = os.path.join(market_dir, plugin)
            if os.path.islink(plugin_dir) or not os.path.isdir(plugin_dir):
                continue
            for version in os.listdir(plugin_dir):
                version_dir = os.path.join(plugin_dir, version)
                if version.startswith(".") or os.path.islink(version_dir) or not os.path.isdir(version_dir):
                    continue
                for directory, dirs, files in os.walk(version_dir, followlinks=False):
                    dirs[:] = [d for d in dirs if not os.path.islink(os.path.join(directory, d))]
                    for name in files:
                        path = os.path.join(directory, name)
                        try:
                            st = os.lstat(path)
                        except OSError:
                            continue
                        if not os.path.isfile(path) or os.path.islink(path) or st.st_size == 0:
                            continue
                        if st.st_mtime > cutoff or st.st_ctime > cutoff:
                            continue
                        yield os.path.relpath(path, cache), path, st


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def link_over(source, target):
    """Atomically replaces target with a hard link to source."""
    directory = os.path.dirname(target)
    fd, temp = tempfile.mkstemp(prefix=".dedupe-", dir=directory)
    os.close(fd)
    os.unlink(temp)
    os.link(source, temp)
    try:
        os.replace(temp, target)
    except OSError:
        os.unlink(temp)
        raise


def dedupe_plugins(homes, dry_run, settle_seconds=SETTLE_SECONDS):
    cutoff = time.time() - settle_seconds
    error_samples = []

    def record_error(path, error):
        if len(error_samples) < 10:
            # Plugin-relative path only; a file vanishing here usually means Codex was upgrading that plugin.
            error_samples.append(f"{path.split('/plugins/cache/')[-1]}: {type(error).__name__} {error.strerror or error}")

    groups = defaultdict(list)
    for home in homes:
        for key, path, st in plugin_files(home, cutoff):
            groups[(key, st.st_size, st.st_mode, st.st_uid, st.st_gid, st.st_dev)].append((path, st))

    linked = reclaimed = errors = 0
    total_bytes = unique_bytes = 0
    for (_key, size, *_rest), members in groups.items():
        by_inode = {}
        for path, st in members:
            if st.st_ino not in by_inode:
                by_inode[st.st_ino] = (path, st)
                total_bytes += st.st_blocks * 512
        if len(by_inode) == 1:
            unique_bytes += next(iter(by_inode.values()))[1].st_blocks * 512
            continue
        by_hash = defaultdict(list)
        for ino, (path, st) in by_inode.items():
            try:
                by_hash[sha256(path)].append((path, st))
            except OSError as error:
                errors += 1
                record_error(path, error)
        for _digest, copies in by_hash.items():
            # Keep the inode that already has the most links so repeated runs converge.
            copies.sort(key=lambda item: -item[1].st_nlink)
            keep_path, keep_st = copies[0]
            unique_bytes += keep_st.st_blocks * 512
            keep_ino = keep_st.st_ino
            for path, st in copies[1:]:
                # Every path of this inode must move, otherwise the duplicate data stays allocated.
                paths = [p for p, s in members if s.st_ino == st.st_ino]
                moved = 0
                for target in paths:
                    if dry_run:
                        moved += 1
                        continue
                    try:
                        current = os.lstat(target)
                        if current.st_ino != st.st_ino or current.st_mtime != st.st_mtime:
                            continue
                        if os.lstat(keep_path).st_ino != keep_ino:
                            break
                        link_over(keep_path, target)
                        moved += 1
                    except OSError as error:
                        errors += 1
                        record_error(target, error)
                linked += moved
                if moved == len(paths) and st.st_nlink == len(paths):
                    reclaimed += st.st_blocks * 512
    return {
        "filesLinked": linked,
        "reclaimedBytes": reclaimed,
        "pluginBytesBefore": total_bytes,
        "pluginUniqueBytes": unique_bytes,
        "errors": errors,
        "errorSamples": error_samples,
    }


def prune_catalog(homes, days, dry_run):
    cutoff = time.time() - days * 86400
    removed = freed = 0
    for home in homes:
        catalog = os.path.join(home, "cache", "remote_plugin_catalog")
        if os.path.islink(catalog) or not os.path.isdir(catalog):
            continue
        for name in os.listdir(catalog):
            path = os.path.join(catalog, name)
            try:
                st = os.lstat(path)
            except OSError:
                continue
            if not os.path.isfile(path) or os.path.islink(path) or st.st_mtime > cutoff:
                continue
            if not dry_run:
                try:
                    os.unlink(path)
                except OSError:
                    continue
            removed += 1
            freed += st.st_blocks * 512
    return {"catalogFilesRemoved": removed, "catalogFreedBytes": freed}


def write_state(state_dir, payload):
    if not state_dir or not os.path.isdir(state_dir):
        return
    fd, temp = tempfile.mkstemp(prefix=".codex-home-dedupe.", dir=state_dir)
    with os.fdopen(fd, "w") as handle:
        json.dump(payload, handle, indent=2)
        handle.write("\n")
    os.chmod(temp, 0o644)
    os.replace(temp, os.path.join(state_dir, "codex-home-dedupe-last-run.json"))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--codex-homes", required=True)
    parser.add_argument("--base-home")
    parser.add_argument("--state-dir")
    parser.add_argument("--catalog-days", type=int, default=7)
    parser.add_argument("--settle-seconds", type=int, default=SETTLE_SECONDS)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    started = time.time()
    homes = []
    # The base home goes first so its copies are preferred when link counts tie.
    if args.base_home and os.path.isdir(args.base_home):
        homes.append(args.base_home)
    homes.extend(find_homes(args.codex_homes))
    plugins = dedupe_plugins(homes, args.dry_run, max(0, args.settle_seconds))
    catalog = prune_catalog(homes, max(1, args.catalog_days), args.dry_run)
    result = {
        "finishedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "dryRun": args.dry_run,
        "homes": len(homes),
        "catalogRetentionDays": max(1, args.catalog_days),
        **plugins,
        **catalog,
        "durationSeconds": round(time.time() - started, 1),
    }
    print(json.dumps(result))
    if not args.dry_run:
        write_state(args.state_dir, result)
    return 0


if __name__ == "__main__":
    sys.exit(main())
