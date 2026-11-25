"""Headless VxParser startup for the DebridUI integration test.

VxParser's supported CLI entry point imports cli/services before api. That
import order is important: api and services import each other, so loading
"api:app" as the first import causes a circular-import failure.
"""
import os
import signal
import sys
import time

import vxparser

# VxParser uses legacy absolute imports (utils.*, helper.*, api, ...).
package_dir = os.path.dirname(os.path.abspath(vxparser.__file__))
sys.path[:0] = [
    package_dir,
    os.path.join(package_dir, "helper", "resolveurl", "lib"),
    os.path.join(package_dir, "helper", "sites"),
    os.path.join(package_dir, "helper"),
    os.path.join(package_dir, "utils"),
]

import utils.common as common

common.check()
common.set_setting("init", "1")
common.set_setting("lang", "1")
common.set_setting("server_host", "127.0.0.1")
common.set_setting("server_port", str(int(os.getenv("VX_PARSER_PORT", "8080"))))
common.set_setting("m3u8_service", "0")
common.set_setting("vod_service", "0")
common.set_setting("epg_service", "0")
common.set_setting("serienstream_username", "")
common.set_setting("serienstream_password", "")

# Match vxparser.main's import order without entering its interactive menu.
# Importing cli first loads services, which in turn imports api in the
# upstream-supported order and defines UvicornServer before the API is served.
import cli  # noqa: F401
import services

stopping = False


def stop(_signum, _frame):
    global stopping
    stopping = True


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)

print(
    f"[vxparser] Starting services on 127.0.0.1:{common.get_setting('server_port')}",
    flush=True,
)
services.handler("init")

try:
    while not stopping:
        time.sleep(1)
finally:
    print("[vxparser] Stopping services", flush=True)
    services.handler("kill")
