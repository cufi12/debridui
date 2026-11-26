"""Headless VxParser startup with DebridUI's loopback management bridge."""
import os
import sys
import vxparser

package_dir = os.path.dirname(os.path.abspath(vxparser.__file__))
sys.path.insert(0, package_dir)

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

import uvicorn
print(f"[vxparser] Starting FastAPI bridge on 127.0.0.1:{common.get_setting('server_port')}", flush=True)
uvicorn.run("vxparser_bridge:app", host="127.0.0.1", port=int(common.get_setting("server_port")), log_level="info", reload=False)
