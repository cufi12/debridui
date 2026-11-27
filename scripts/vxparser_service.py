"""Headless VxParser startup with DebridUI's loopback management bridge."""
import os
import sys
from pathlib import Path

import vxparser

package_dir = os.path.dirname(os.path.abspath(vxparser.__file__))
sys.path.insert(0, package_dir)

# Upstream imports utils.xstream before defining UvicornServer. xstream imports
# services, and services imports UvicornServer from this still-partial api
# module. Publish the class before that import; api.py's original definition
# later replaces it with the same implementation.
api_file = Path(package_dir) / "api.py"
api_source = api_file.read_text(encoding="utf-8")
marker = "import utils.xstream as xstream"
sentinel = "# DEBRIDUI_EARLY_UVICORN_SERVER"
if sentinel not in api_source:
    if marker not in api_source:
        raise RuntimeError("Unsupported VxParser api.py: import-cycle patch marker not found")
    bootstrap = '''# DEBRIDUI_EARLY_UVICORN_SERVER
class UvicornServer(__import__("multiprocessing").Process):
    def __init__(self, config):
        super().__init__()
        self.config = config

    def stop(self):
        self.terminate()

    def run(self, *args, **kwargs):
        from uvicorn import Server
        Server(config=self.config).run()

'''
    api_file.write_text(api_source.replace(marker, bootstrap + marker, 1), encoding="utf-8")
    print("[vxparser] Applied early UvicornServer import-cycle compatibility patch", flush=True)

import utils.common as common

common.check()
common.set_setting("init", "1")
common.set_setting("lang", "1")
common.set_setting("server_host", "127.0.0.1")
common.set_setting("server_port", str(int(os.getenv("VX_PARSER_PORT", "8080"))))
common.set_setting("server_service", "0")
common.set_setting("m3u8_service", "0")
common.set_setting("vod_service", "0")
common.set_setting("epg_service", "0")
common.set_setting("serienstream_username", "")
common.set_setting("serienstream_password", "")

# The upstream playlist builder derives its public host from the container NIC.
# Force loopback: DebridUI rewrites these URLs to its signed public proxy routes.
import utils.video as video
video.server_ip = "127.0.0.1"
video.port = int(common.get_setting("server_port"))

import uvicorn
print(f"[vxparser] Starting FastAPI bridge on 127.0.0.1:{common.get_setting('server_port')}", flush=True)
uvicorn.run("vxparser_bridge:app", host="127.0.0.1", port=int(common.get_setting("server_port")), log_level="info", reload=False)
