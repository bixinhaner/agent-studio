#!/usr/bin/python3 -I
"""Root-owned cgroup broker. Never executes user commands as root."""
import json
import os
from pathlib import Path
import pwd
import re
import sys
import time
import uuid

APP_USER = "agentstudio"
ROOT = Path("/sys/fs/cgroup/system.slice/agent-studio-workloads.service")
STATE = Path("/run/agent-studio-workloads")
GIB = 1024 ** 3


def write(path, value):
    path.write_text(str(value))


def identity(pid):
    path = Path(f"/proc/{pid}")
    stat = (path / "stat").read_text().rsplit(")", 1)[1].split()
    return {"pid": pid, "start": stat[19], "ppid": int(stat[1]), "state": stat[0], "uid": path.stat().st_uid}


def alive(record):
    try:
        current = identity(record["pid"])
        return current["start"] == record["start"] and current["state"] not in ("Z", "X")
    except (FileNotFoundError, ProcessLookupError):
        return False


def group_path(token):
    if not re.fullmatch(r"[0-9a-f]{32}", token):
        raise ValueError("invalid workload id")
    return ROOT / ("job-" + token)


def prepare(token):
    group = group_path(token)
    if not (STATE / "ready").exists():
        raise RuntimeError("workload isolation is not ready")
    group.mkdir()  # No reuse or mutation of an existing job.
    try:
        write(group / "memory.max", 8 * GIB)
        write(group / "memory.high", "max")
        write(group / "memory.swap.max", 0)
        write(group / "memory.oom.group", 1)
        write(group / "pids.max", 512)
        write(group / "cpu.max", "200000 100000")
    except Exception:
        group.rmdir()
        raise
    return group


def attach(pid, token, legacy=False):
    leader = identity(pid)
    if leader["uid"] != pwd.getpwnam(APP_USER).pw_uid:
        raise PermissionError("workload must belong to application user")
    if not legacy:
        args = Path(f"/proc/{pid}/cmdline").read_bytes().split(b"\0")
        if b"/usr/local/libexec/agent-studio-workload-launch" not in args[:4]:
            raise PermissionError("only the workload launcher may attach")
    owner = identity(leader["ppid"]) if leader["ppid"] > 1 else None
    group = prepare(token)
    # Publish the record before moving the process so the supervisor can clean
    # up after a caller crash, including detached/setsid descendants.
    record = {"leader": leader, "owner": owner, "legacy": legacy}
    state = STATE / (token + ".json")
    state.write_text(json.dumps(record))
    try:
        if not alive(leader):
            raise ProcessLookupError("launcher exited")
        write(group / "cgroup.procs", pid)
    except Exception:
        release(token)
        raise
    return group


def release(token):
    group = group_path(token)
    if group.exists():
        write(group / "cgroup.kill", 1)
        try:
            group.rmdir()
        except OSError:
            return  # The supervisor retries after exiting tasks are reaped.
    (STATE / (token + ".json")).unlink(missing_ok=True)


def serve():
    STATE.mkdir(mode=0o755, exist_ok=True)
    (STATE / "ready").unlink(missing_ok=True)
    supervisor = ROOT / "supervisor"
    supervisor.mkdir(exist_ok=True)
    write(supervisor / "cgroup.procs", os.getpid())
    write(ROOT / "cgroup.subtree_control", "+memory +pids +cpu")
    write(supervisor / "memory.min", 16 * 1024 ** 2)
    (STATE / "ready").touch()
    while True:
        for state in STATE.glob("*.json"):
            try:
                record = json.loads(state.read_text())
                if not alive(record["leader"]) or (record["owner"] and not alive(record["owner"])):
                    release(state.stem)
            except FileNotFoundError:
                pass
            except Exception as error:
                print(f"workload cleanup failed: {type(error).__name__}", file=sys.stderr, flush=True)
        time.sleep(1)


def snapshot():
    result = {}
    uid = pwd.getpwnam(APP_USER).pw_uid
    for path in Path("/proc").iterdir():
        if not path.name.isdigit():
            continue
        try:
            item = identity(int(path.name))
            if item["uid"] == uid:
                item["args"] = (path / "cmdline").read_bytes().split(b"\0")
                item["group"] = (path / "cgroup").read_text()
                result[item["pid"]] = item
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            pass
    return result


def adopt():
    """Fence pre-upgrade app servers and orphaned Codex sandbox process trees."""
    processes = snapshot()
    roots = []
    for pid, item in processes.items():
        args = item["args"]
        if "pm2-agentstudio.service" not in item["group"] or not args:
            continue
        codex = any(b"codex" in a for a in args[:2])
        try:
            cwd = os.readlink(f"/proc/{pid}/cwd")
        except (FileNotFoundError, ProcessLookupError):
            continue
        orphan_task = item["ppid"] == 1 and (
            cwd.startswith("/var/lib/agent-studio/sessions/") or
            cwd.startswith("/usr/local/agent-studio/sessions/")
        )
        if (codex and (b"app-server" in args or item["ppid"] == 1)) or orphan_task:
            roots.append(pid)
    # Choose the outermost Codex CLI, not both its Node wrapper and Rust child.
    selected = []
    for pid in roots:
        parent = processes[pid]["ppid"]
        while parent in processes and parent not in roots:
            parent = processes[parent]["ppid"]
        if parent not in roots:
            selected.append(pid)
    for pid in selected:
        if not alive(processes[pid]):
            continue
        token = uuid.uuid4().hex
        try:
            group = attach(pid, token, legacy=True)
            # Move the root first: subsequently created children inherit the
            # limit. Then catch descendants already present in the old cgroup.
            descendants = {pid}
            for _ in range(3):
                current = snapshot()
                changed = True
                while changed:
                    changed = False
                    for child, item in current.items():
                        if item["ppid"] in descendants and child not in descendants:
                            descendants.add(child)
                            changed = True
                for child in descendants - {pid}:
                    try:
                        if child in current and alive(current[child]):
                            write(group / "cgroup.procs", child)
                    except (FileNotFoundError, ProcessLookupError):
                        pass
            print(json.dumps({"adopted_pid": pid, "group": group.name, "processes": len(descendants)}))
        except (FileNotFoundError, ProcessLookupError):
            pass


def main():
    if os.geteuid() != 0:
        raise PermissionError("root broker required")
    action, *args = sys.argv[1:]
    if action == "attach" and len(args) == 2:
        attach(int(args[0]), args[1])
    elif action == "release" and len(args) == 1:
        release(args[0])
    elif action == "serve" and not args:
        serve()
    elif action == "adopt" and not args:
        adopt()
    else:
        raise ValueError("invalid broker request")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"workload isolation failed: {type(error).__name__}: {error}", file=sys.stderr)
        sys.exit(1)
