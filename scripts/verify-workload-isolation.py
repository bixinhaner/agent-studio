#!/usr/bin/python3
"""Run as agentstudio: bounded real 8 GiB OOM with a healthy sibling and API probes.

This deliberately kills ONLY two verification processes in their own cgroup.
It never sends chat messages or modifies user conversations.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.request
import uuid

LAUNCH = "/usr/local/libexec/agent-studio-workload-launch"
BROKER = "/usr/local/libexec/agent-studio-workload-guard"
ROOT = Path("/sys/fs/cgroup/system.slice/agent-studio-workloads.service")

def probe(url):
    start = time.monotonic()
    with urllib.request.urlopen(url, timeout=5) as response:
        assert response.status == 200
    return round(time.monotonic() - start, 3)


def dead(pid):
    try:
        state = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[0]
        return state == "Z"
    except FileNotFoundError:
        return True


def wait_line(process):
    # Child prints before allocation; a process launch failure yields EOF.
    line = process.stdout.readline()
    if not line:
        raise RuntimeError("verification workload failed to start")
    return json.loads(line)


def main():
    assert os.geteuid() != 0, "run this probe as agentstudio"
    assert int((ROOT / "memory.current").read_text()) < 6 * 1024 ** 3, "existing workloads too large for safe OOM verification"
    available = next(int(line.split()[1]) * 1024 for line in Path("/proc/meminfo").read_text().splitlines() if line.startswith("MemAvailable:"))
    assert available > 12 * 1024 ** 3, "insufficient free host memory for OOM verification"
    good_id, bad_id = uuid.uuid4().hex, uuid.uuid4().hex
    processes = []
    urls = ["http://127.0.0.1:8787/healthz", "https://aiagent.indonesiacentral.cloudapp.azure.com/healthz"]
    slot = Path("/usr/local/agent-studio/releases/state/chat.slot").read_text().strip()
    urls.append(f"http://127.0.0.1:{8791 if slot == 'a' else 8792}/internal/ready")
    try:
        good = subprocess.Popen([LAUNCH, good_id, "/usr/bin/python3", "-c", "import json,os,time; print(json.dumps({'pid':os.getpid()}),flush=True); time.sleep(120)"], stdout=subprocess.PIPE, text=True)
        processes.append(good)
        good_info = wait_line(good)
        allocator = "import time; time.sleep(2); chunks=[]\nfor i in range(140): chunks.append(bytearray(64*1024*1024))\ntime.sleep(30)"
        parent = "import subprocess,json,os,time; p=subprocess.Popen(['/usr/bin/python3','-c'," + repr(allocator) + "],start_new_session=True); print(json.dumps({'pid':os.getpid(),'child':p.pid}),flush=True); time.sleep(120)"
        bad = subprocess.Popen([LAUNCH, bad_id, "/usr/bin/python3", "-c", parent], stdout=subprocess.PIPE, text=True)
        processes.append(bad)
        bad_info = wait_line(bad)
        group = ROOT / ("job-" + bad_id)
        assert (group / "memory.max").read_text().strip() == str(8 * 1024 ** 3)
        assert (group / "memory.swap.max").read_text().strip() == "0"
        for pid in (bad_info["pid"], bad_info["child"]):
            assert "job-" + bad_id in Path(f"/proc/{pid}/cgroup").read_text()
        timings = []
        deadline = time.monotonic() + 90
        oom_seen = False
        while bad.poll() is None and time.monotonic() < deadline:
            timings.append([probe(url) for url in urls])
            assert good.poll() is None, "healthy sibling was terminated"
            try:
                events = dict(line.split() for line in (group / "memory.events").read_text().splitlines())
                oom_seen |= int(events.get("oom_kill", 0)) > 0
            except FileNotFoundError:
                pass
            time.sleep(0.1)
        assert bad.poll() == -9, f"expected isolated OOM kill, exit={bad.poll()}"
        assert dead(bad_info["child"]), "detached child survived group OOM"
        assert good.poll() is None and not dead(good_info["pid"])
        timings.append([probe(url) for url in urls])
        print(json.dumps({"passed": True, "limit_GiB": 8, "bad_exit": bad.returncode,
                          "oom_counter_observed": oom_seen, "detached_child_dead": True,
                          "sibling_alive": True, "probe_rounds": len(timings),
                          "max_api_seconds": max(max(row) for row in timings)}))
    finally:
        for token in (bad_id, good_id):
            subprocess.run(["/usr/bin/sudo", "-n", BROKER, "release", token], check=False)
        for process in processes:
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()

if __name__ == "__main__":
    main()
