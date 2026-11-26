"""Small loopback management extension for upstream VxParser."""
from fastapi import Body, HTTPException
from api import app
import utils.common as common

PROTECTED_SETTINGS = {"init", "VERSION", "server_host", "server_port"}

@app.get("/debridui/health")
async def debridui_health():
    return {"ok": True, "service": "vxparser"}

@app.get("/debridui/config")
async def debridui_get_config():
    cur = common.con0.cursor()
    cur.execute('SELECT name, grp, value, info, "default", type, "values" FROM settings ORDER BY grp, name')
    rows = cur.fetchall()
    return {"settings": [{
        "name": row["name"], "group": row["grp"], "value": row["value"],
        "info": row["info"], "default": row["default"], "type": row["type"],
        "values": row["values"],
        "sensitive": any(word in row["name"].lower() for word in ("password", "token", "apikey", "api_key", "secret")),
        "readOnly": row["name"] in PROTECTED_SETTINGS,
    } for row in rows]}

@app.put("/debridui/config")
async def debridui_update_config(payload: dict = Body(...)):
    updates = payload.get("settings")
    if not isinstance(updates, dict) or len(updates) > 200:
        raise HTTPException(status_code=400, detail="Ungültige Einstellungen.")
    cur = common.con0.cursor()
    cur.execute('SELECT name FROM settings')
    allowed = {row["name"] for row in cur.fetchall()} - PROTECTED_SETTINGS
    for name, value in updates.items():
        if name not in allowed or not isinstance(value, (str, int, float, bool)):
            raise HTTPException(status_code=400, detail="Unbekannte oder ungültige Einstellung: " + str(name))
        if len(str(value)) > 4096:
            raise HTTPException(status_code=400, detail="Einstellungswert ist zu lang.")
    for name, value in updates.items():
        common.set_setting(name, str(value))
    return {"success": True, "updated": len(updates)}
