"""
Swarm Manager FastAPI Server v0.5.0

Exposes MCP tools to OpenClaw for drone control via pymavlink.
All drone commands are synchronous (pymavlink is sync).
Runs in a thread pool to avoid blocking the event loop.
"""

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from typing import Optional

from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

STATIC_DIR = Path(__file__).parent / "static"

from .drone_registry import DroneRegistry
from .command_router import CommandRouter

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# Global registry and router
registry = DroneRegistry()
router = CommandRouter(registry)

# Thread pool for blocking pymavlink calls
_executor = ThreadPoolExecutor(max_workers=8, thread_name_prefix="drone-cmd")


def _run_sync(fn, *args, **kwargs):
    """Run a synchronous function in the thread pool."""
    return asyncio.get_event_loop().run_in_executor(_executor, partial(fn, *args, **kwargs))


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown logic."""
    logger.info("AutoM8te Swarm Manager v0.5.0 starting up...")
    yield
    logger.info("AutoM8te Swarm Manager shutting down...")
    registry.shutdown()
    _executor.shutdown(wait=False)


app = FastAPI(
    title="AutoM8te Swarm Manager",
    description="MCP server for voice-controlled drone swarm (pymavlink backend)",
    version="0.5.0",
    lifespan=lifespan,
)


# ── Request Models ──────────────────────────────────────────

class RegisterRequest(BaseModel):
    drone_id: str = Field(..., description="Unique drone ID (e.g., drone_1)")
    connection_string: str = Field(..., description="pymavlink connection (e.g., tcp:127.0.0.1:5760)")


class TakeoffRequest(BaseModel):
    drone_id: str = Field(..., description="Target drone ID")
    altitude_m: float = Field(5.0, description="Target altitude in meters", ge=1.0, le=120.0)


class DroneIdRequest(BaseModel):
    drone_id: str = Field(..., description="Target drone ID")


class GotoRequest(BaseModel):
    drone_id: str = Field(..., description="Target drone ID")
    lat: float = Field(..., description="Latitude in degrees")
    lon: float = Field(..., description="Longitude in degrees")
    alt_m: float = Field(..., description="Altitude MSL in meters")
    heading_deg: float = Field(0.0, description="Target heading (0=N, 90=E)")


class VelocityRequest(BaseModel):
    drone_id: str = Field(..., description="Target drone ID")
    vx_ms: float = Field(..., description="North velocity m/s")
    vy_ms: float = Field(..., description="East velocity m/s")
    vz_ms: float = Field(..., description="Down velocity m/s (negative=climb)")
    yaw_rate_degs: float = Field(0.0, description="Yaw rate deg/s")


class FormationRequest(BaseModel):
    formation: str = Field(..., description="Formation name (line, v, circle, grid, stack)")
    spacing_m: float = Field(10.0, description="Spacing between drones in meters")
    alt_m: float = Field(10.0, description="Formation altitude in meters")
    center_lat: Optional[float] = Field(None, description="Center latitude (default: drone centroid)")
    center_lon: Optional[float] = Field(None, description="Center longitude (default: drone centroid)")
    heading_deg: float = Field(0.0, description="Formation heading (for line/v)")


class SetYawRequest(BaseModel):
    drone_id: str = Field(..., description="Target drone ID")
    heading_deg: float = Field(..., description="Target heading in degrees (0=N, 90=E)")
    relative: bool = Field(False, description="If true, heading is relative to current")
    speed_degs: float = Field(30.0, description="Rotation speed in degrees/second", ge=1.0, le=180.0)


class ChangeSpeedRequest(BaseModel):
    drone_id: str = Field(..., description="Target drone ID")
    speed_ms: float = Field(..., description="Speed in meters/second", ge=0.0, le=100.0)
    speed_type: str = Field("ground", description="Speed type: 'ground' or 'air'")


class ChangeAltitudeRequest(BaseModel):
    drone_id: str = Field(..., description="Target drone ID")
    alt_m: float = Field(..., description="New altitude in meters (relative)", ge=1.0, le=120.0)


class SetHomeRequest(BaseModel):
    drone_id: str = Field(..., description="Target drone ID")
    lat: Optional[float] = Field(None, description="Home latitude (omit to use current location)")
    lon: Optional[float] = Field(None, description="Home longitude (omit to use current location)")
    alt: Optional[float] = Field(None, description="Home altitude (omit to use current location)")


class BroadcastRequest(BaseModel):
    command: str = Field(..., description="Command to broadcast (takeoff, land, return_home, emergency_stop, hover, pause)")
    altitude_m: Optional[float] = Field(5.0, description="Altitude for takeoff")


class SwarmCommandRequest(BaseModel):
    command: str = Field(..., description="Single-drone command name (e.g. hover, goto, set_yaw)")
    params: Optional[dict] = Field(None, description="Command parameters (drone_id auto-filled)")
    drone_ids: Optional[list[str]] = Field(None, description="Target drones (null=all)")
    reference_drone: Optional[str] = Field(None, description="Resolve this drone position as target")


class OrbitRequest(BaseModel):
    drone_id: str = Field(..., description="Target drone ID")
    center_lat: float = Field(..., description="Center latitude")
    center_lon: float = Field(..., description="Center longitude")
    radius_m: float = Field(20.0, description="Orbit radius in meters", ge=5.0, le=500.0)
    alt_m: float = Field(15.0, description="Orbit altitude in meters", ge=2.0, le=120.0)
    speed_ms: float = Field(3.0, description="Cruise speed m/s")
    clockwise: bool = Field(True, description="Orbit direction")
    laps: int = Field(0, description="Number of laps (0=continuous)", ge=0)


class OrbitSwarmRequest(BaseModel):
    center_lat: float = Field(..., description="Center latitude")
    center_lon: float = Field(..., description="Center longitude")
    radius_m: float = Field(20.0, description="Orbit radius in meters")
    alt_m: float = Field(15.0, description="Orbit altitude in meters")
    clockwise: bool = Field(True, description="Orbit direction")


class SearchRequest(BaseModel):
    drone_id: str = Field(..., description="Target drone ID")
    min_lat: float = Field(..., description="South boundary latitude")
    min_lon: float = Field(..., description="West boundary longitude")
    max_lat: float = Field(..., description="North boundary latitude")
    max_lon: float = Field(..., description="East boundary longitude")
    alt_m: float = Field(20.0, description="Search altitude in meters")
    pattern: str = Field("grid", description="Search pattern: grid, spiral, expanding")
    swath_width_m: float = Field(30.0, description="Swath width in meters")


class SearchSwarmRequest(BaseModel):
    min_lat: float = Field(..., description="South boundary latitude")
    min_lon: float = Field(..., description="West boundary longitude")
    max_lat: float = Field(..., description="North boundary latitude")
    max_lon: float = Field(..., description="East boundary longitude")
    alt_m: float = Field(20.0, description="Search altitude in meters")
    pattern: str = Field("grid", description="Search pattern: grid, spiral, expanding")
    swath_width_m: float = Field(30.0, description="Swath width in meters")


# ── Endpoints ───────────────────────────────────────────────

@app.get("/")
async def root():
    return {
        "service": "AutoM8te Swarm Manager",
        "version": "0.5.0",
        "backend": "pymavlink",
        "registered_drones": registry.list_drones(),
    }


@app.post("/tools/drone_register")
async def drone_register(req: RegisterRequest):
    """Register a drone (establishes pymavlink connection, waits for GPS fix)."""
    try:
        await _run_sync(registry.register, req.drone_id, req.connection_string)
        return {"status": "success", "message": f"{req.drone_id} registered", "drone_id": req.drone_id}
    except Exception as e:
        logger.error(f"Registration failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/tools/drone_takeoff")
async def drone_takeoff(req: TakeoffRequest):
    """Take off to specified altitude."""
    result = await _run_sync(router.takeoff, req.drone_id, req.altitude_m)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["message"])
    return result


@app.post("/tools/drone_land")
async def drone_land(req: DroneIdRequest):
    """Land at current position."""
    result = await _run_sync(router.land, req.drone_id)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["message"])
    return result


@app.post("/tools/drone_goto")
async def drone_goto(req: GotoRequest):
    """Fly to GPS coordinates."""
    result = await _run_sync(router.goto, req.drone_id, req.lat, req.lon, req.alt_m, req.heading_deg)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["message"])
    return result


@app.post("/tools/drone_velocity")
async def drone_velocity(req: VelocityRequest):
    """Set velocity vector (NED frame)."""
    result = await _run_sync(router.set_velocity, req.drone_id, req.vx_ms, req.vy_ms, req.vz_ms, req.yaw_rate_degs)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["message"])
    return result


@app.post("/tools/drone_return_home")
async def drone_return_home(req: DroneIdRequest):
    """Return to launch and land (RTL)."""
    result = await _run_sync(router.return_home, req.drone_id)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["message"])
    return result


@app.post("/tools/drone_emergency_stop")
async def drone_emergency_stop(req: DroneIdRequest):
    """Emergency stop — force disarm. SITL ONLY."""
    result = await _run_sync(router.emergency_stop, req.drone_id)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["message"])
    return result


@app.post("/tools/drone_hover")
async def drone_hover(req: DroneIdRequest):
    """Stop and hold current position."""
    result = await _run_sync(router.hover, req.drone_id)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["message"])
    return result


@app.post("/tools/drone_set_yaw")
async def drone_set_yaw(req: SetYawRequest):
    """Set drone heading without moving."""
    result = await _run_sync(router.set_yaw, req.drone_id, req.heading_deg, req.relative, req.speed_degs)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["message"])
    return result


@app.post("/tools/drone_change_speed")
async def drone_change_speed(req: ChangeSpeedRequest):
    """Change speed mid-flight."""
    result = await _run_sync(router.change_speed, req.drone_id, req.speed_ms, req.speed_type)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["message"])
    return result


@app.post("/tools/drone_change_altitude")
async def drone_change_altitude(req: ChangeAltitudeRequest):
    """Change altitude only, keep current lat/lon."""
    result = await _run_sync(router.change_altitude, req.drone_id, req.alt_m)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["message"])
    return result


@app.post("/tools/drone_set_home")
async def drone_set_home(req: SetHomeRequest):
    """Set home position (current location or specified GPS)."""
    result = await _run_sync(router.set_home, req.drone_id, req.lat, req.lon, req.alt)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["message"])
    return result


@app.post("/tools/drone_pause")
async def drone_pause(req: DroneIdRequest):
    """Pause current task (switch to LOITER)."""
    result = await _run_sync(router.pause, req.drone_id)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["message"])
    return result


@app.post("/tools/drone_resume")
async def drone_resume(req: DroneIdRequest):
    """Resume from pause (restore previous task)."""
    result = await _run_sync(router.resume, req.drone_id)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["message"])
    return result


@app.post("/tools/drone_query")
async def drone_query(req: DroneIdRequest):
    """Get drone telemetry snapshot."""
    try:
        telemetry = registry.get_telemetry(req.drone_id)
        return {"status": "success", "telemetry": telemetry}
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.post("/tools/drone_formation")
async def drone_formation(req: FormationRequest):
    """Command all drones into a formation (Tier 1 primitive)."""
    result = await _run_sync(
        router.formation, req.formation, req.spacing_m, req.alt_m,
        req.center_lat, req.center_lon, req.heading_deg,
    )
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result["message"])
    return result


@app.post("/tools/drone_broadcast")
async def drone_broadcast(req: BroadcastRequest):
    """Send command to all registered drones."""
    kwargs = {}
    if req.command == "takeoff":
        kwargs["altitude_m"] = req.altitude_m
    result = await _run_sync(router.broadcast, req.command, **kwargs)
    return result


@app.post("/tools/drone_swarm_command")
async def drone_swarm_command(req: SwarmCommandRequest):
    """Send any single-drone command to multiple drones (generic swarm broadcast)."""
    result = await _run_sync(router.swarm_command, req.command, req.params, req.drone_ids, req.reference_drone)
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result["message"])
    return result


@app.post("/tools/drone_orbit")
async def drone_orbit(req: OrbitRequest):
    """Orbit a GPS point (Tier 1 primitive)."""
    result = await _run_sync(
        router.orbit, req.drone_id, req.center_lat, req.center_lon,
        req.radius_m, req.alt_m, req.speed_ms, req.clockwise, req.laps,
    )
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["message"])
    return result


@app.post("/tools/drone_orbit_swarm")
async def drone_orbit_swarm(req: OrbitSwarmRequest):
    """All drones orbit the same point, evenly phase-offset."""
    result = await _run_sync(
        router.orbit_swarm, req.center_lat, req.center_lon,
        req.radius_m, req.alt_m, req.clockwise,
    )
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result["message"])
    return result


@app.post("/tools/drone_search")
async def drone_search(req: SearchRequest):
    """Search an area with a single drone (Tier 1 primitive)."""
    result = await _run_sync(
        router.search, req.drone_id, req.min_lat, req.min_lon,
        req.max_lat, req.max_lon, req.alt_m, req.pattern, req.swath_width_m,
    )
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["message"])
    return result


@app.post("/tools/drone_search_swarm")
async def drone_search_swarm(req: SearchSwarmRequest):
    """Distribute search across all drones (area split by strips)."""
    result = await _run_sync(
        router.search_swarm, req.min_lat, req.min_lon,
        req.max_lat, req.max_lon, req.alt_m, req.pattern, req.swath_width_m,
    )
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result["message"])
    return result


# ── WebSocket Telemetry Stream ──────────────────────────────

class TelemetryBroadcaster:
    """Manages WebSocket connections and broadcasts telemetry updates."""

    def __init__(self):
        self.connections: list[WebSocket] = []
        self._task: Optional[asyncio.Task] = None

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.connections.append(ws)
        logger.info(f"Telemetry WebSocket connected ({len(self.connections)} clients)")

    def disconnect(self, ws: WebSocket):
        if ws in self.connections:
            self.connections.remove(ws)
        logger.info(f"Telemetry WebSocket disconnected ({len(self.connections)} clients)")

    async def broadcast(self, data: dict):
        dead = []
        for ws in self.connections:
            try:
                await ws.send_json(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

    async def start_streaming(self, hz: float = 2.0):
        """Background task that broadcasts telemetry at configured rate."""
        interval = 1.0 / hz
        while True:
            try:
                if self.connections:
                    telemetry = registry.get_all_telemetry()

                    # Add formation/orbit/search status
                    for t in telemetry:
                        drone_id = t["drone_id"]
                        try:
                            state = registry.get_drone(drone_id)
                            t["task"] = state.current_task

                            # Orbit progress
                            if state.current_task == "orbiting":
                                wps = getattr(state, '_orbit_waypoints', [])
                                idx = getattr(state, '_orbit_index', 0)
                                laps = getattr(state, '_orbit_laps_done', 0)
                                t["orbit_progress"] = {
                                    "waypoint": idx,
                                    "total_waypoints": len(wps),
                                    "laps_completed": laps,
                                }

                            # Search progress
                            if state.current_task == "searching":
                                wps = getattr(state, '_search_waypoints', [])
                                idx = getattr(state, '_search_index', 0)
                                t["search_progress"] = {
                                    "waypoint": idx,
                                    "total_waypoints": len(wps),
                                    "pct_complete": round(100 * idx / max(1, len(wps)), 1),
                                }
                        except KeyError:
                            pass

                    await self.broadcast({
                        "type": "telemetry",
                        "drone_count": len(telemetry),
                        "drones": telemetry,
                    })

                    # Advance orbits and searches for all drones
                    drone_ids = registry.list_drones()
                    for did in drone_ids:
                        await _run_sync(router.advance_orbit, did)
                        await _run_sync(router.advance_search, did)

                await asyncio.sleep(interval)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Telemetry broadcast error: {e}")
                await asyncio.sleep(1.0)


_telemetry_broadcaster = TelemetryBroadcaster()


@app.on_event("startup")
async def start_telemetry_stream():
    _telemetry_broadcaster._task = asyncio.create_task(
        _telemetry_broadcaster.start_streaming(hz=2.0)
    )


@app.on_event("shutdown")
async def stop_telemetry_stream():
    if _telemetry_broadcaster._task:
        _telemetry_broadcaster._task.cancel()


@app.websocket("/ws/telemetry")
async def telemetry_websocket(ws: WebSocket):
    """
    Real-time telemetry stream for all drones.

    Streams JSON at 2Hz with position, velocity, attitude, battery, and task status.
    Also advances orbit/search waypoint tracking automatically.
    """
    await _telemetry_broadcaster.connect(ws)
    try:
        while True:
            # Keep connection alive, listen for config messages
            data = await ws.receive_text()
            try:
                msg = json.loads(data)
                # Client can request rate change
                if "hz" in msg:
                    logger.info(f"Telemetry rate change requested: {msg['hz']}Hz")
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        _telemetry_broadcaster.disconnect(ws)


@app.get("/drones")
async def list_drones():
    """List all drones with telemetry."""
    telemetry = registry.get_all_telemetry()
    return {"count": len(telemetry), "drones": telemetry}


# ── Tracker UI ──────────────────────────────────────────────


@app.get("/tracker")
async def tracker():
    return FileResponse(str(STATIC_DIR / "tracker.html"))


@app.get("/tracker3d")
async def tracker3d():
    return FileResponse(str(STATIC_DIR / "tracker3d.html"))


# ── Main ────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    logger.info("Starting AutoM8te Swarm Manager on http://localhost:8000")
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
