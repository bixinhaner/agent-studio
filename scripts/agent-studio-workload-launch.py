#!/usr/bin/python3 -I
"""Join a root-controlled job before exec; preserve caller env and JSON-RPC stdio."""
import os
import re
import subprocess
import sys

if len(sys.argv) < 3 or not re.fullmatch(r"[0-9a-f]{32}", sys.argv[1]):
    sys.exit("invalid workload launch request")
result = subprocess.run([
    "/usr/bin/sudo", "-n", "/usr/local/libexec/agent-studio-workload-guard",
    "attach", str(os.getpid()), sys.argv[1],
], stdin=subprocess.DEVNULL, stdout=sys.stderr, close_fds=True)
if result.returncode:
    sys.exit("workload isolation unavailable; refusing unbounded execution")
os.execvpe(sys.argv[2], sys.argv[2:], os.environ)
