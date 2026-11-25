#!/usr/bin/env python3
"""Run DebridUI and its local VxParser sidecar in one container."""
import os
import signal
import subprocess
import sys
import time

children = []

def stop_children(_signum=None, _frame=None):
    for child in children:
        if child.poll() is None:
            child.terminate()
    for child in children:
        if child.poll() is None:
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill()

signal.signal(signal.SIGTERM, stop_children)
signal.signal(signal.SIGINT, stop_children)

if os.getenv("VX_PARSER_ENABLED", "true").lower() == "true":
    parser = subprocess.Popen(
        ["/opt/vxparser-venv/bin/python", "scripts/vxparser_service.py"],
        env=os.environ.copy(),
    )
    children.append(parser)
    print(f"[supervisor] VxParser started (pid={parser.pid})", flush=True)

app = subprocess.Popen(["bun", "./server.js"], env=os.environ.copy())
children.append(app)
print(f"[supervisor] DebridUI started (pid={app.pid})", flush=True)

try:
    while app.poll() is None:
        if children and children[0] is not app and children[0].poll() is not None:
            print("[supervisor] VxParser exited unexpectedly; stopping DebridUI", flush=True)
            app.terminate()
            break
        time.sleep(1)
    exit_code = app.wait()
finally:
    stop_children()

sys.exit(exit_code if "exit_code" in locals() else 1)
