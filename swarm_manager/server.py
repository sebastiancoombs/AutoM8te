"""
Swarm Manager FastAPI Server v0.2.0

Exposes MCP tools to OpenClaw for drone control via pymavlink.
All drone commands are synchronous (pymavlink is sync).
Runs in a thread pool to avoid blocking the event loop.
"""

import asyncio
import logging
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

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
    logger.info("AutoM8te Swarm Manager v0.2.0 starting up...")
    yield
    logger.info("AutoM8te Swarm Manager shutting down...")
    registry.shutdown()
    _executor.shutdown(wait=False)


app = FastAPI(
    title="AutoM8te Swarm Manager",
    description="MCP server for voice-controlled drone swarm (pymavlink backend)",
    version="0.2.0",
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


class BroadcastRequest(BaseModel):
    command: str = Field(..., description="Command to broadcast (takeoff, land, return_home, emergency_stop)")
    altitude_m: Optional[float] = Field(5.0, description="Altitude for takeoff")


# ── Endpoints ───────────────────────────────────────────────

@app.get("/")
async def root():
    return {
        "service": "AutoM8te Swarm Manager",
        "version": "0.2.0",
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


@app.get("/drones")
async def list_drones():
    """List all drones with telemetry."""
    telemetry = registry.get_all_telemetry()
    return {"count": len(telemetry), "drones": telemetry}


# ── Main ────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    logger.info("Starting AutoM8te Swarm Manager on http://localhost:8000")
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
