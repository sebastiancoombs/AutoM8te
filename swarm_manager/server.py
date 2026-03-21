"""
Swarm Manager FastAPI Server

Exposes MCP tools to OpenClaw for drone control.
Uses pymavlink backend (switched from MAVSDK 2026-03-21).
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import Optional

from .drone_registry import DroneRegistry
from .command_router import CommandRouter

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

registry = DroneRegistry()
router = CommandRouter(registry)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("AutoM8te Swarm Manager starting up...")
    yield
    logger.info("AutoM8te Swarm Manager shutting down...")
    registry.shutdown()


app = FastAPI(
    title="AutoM8te Swarm Manager",
    description="MCP server for voice-controlled drone swarm (pymavlink backend)",
    version="0.2.0",
    lifespan=lifespan,
)


# ==================== Request Models ====================


class RegisterDroneRequest(BaseModel):
    drone_id: str = Field(..., description="Unique drone ID (e.g., drone_1)")
    connection_string: str = Field(..., description="pymavlink connection (e.g., tcp:127.0.0.1:5760)")


class TakeoffRequest(BaseModel):
    drone_id: str
    altitude_m: float = Field(5.0, ge=1.0, le=50.0)


class LandRequest(BaseModel):
    drone_id: str


class GotoRequest(BaseModel):
    drone_id: str
    lat: float = Field(..., description="Target latitude")
    lon: float = Field(..., description="Target longitude")
    alt_m: float = Field(..., description="Target altitude (meters, relative to home)")


class VelocityRequest(BaseModel):
    drone_id: str
    vx: float = Field(..., description="North velocity m/s")
    vy: float = Field(..., description="East velocity m/s")
    vz: float = Field(..., description="Down velocity m/s (negative = climb)")
    yaw_rate: float = Field(0.0, description="Yaw rate deg/s")


class ReturnHomeRequest(BaseModel):
    drone_id: str


class BroadcastRequest(BaseModel):
    command: str = Field(..., description="Command: takeoff, land, return_home")
    altitude_m: Optional[float] = 5.0


class QueryRequest(BaseModel):
    drone_id: str


# ==================== Endpoints ====================


@app.get("/")
async def root():
    return {
        "service": "AutoM8te Swarm Manager",
        "version": "0.2.0",
        "backend": "pymavlink",
        "status": "running",
        "registered_drones": registry.list_drones(),
    }


@app.post("/tools/drone_register")
async def drone_register(request: RegisterDroneRequest):
    try:
        registry.register(request.drone_id, request.connection_string)
        return {
            "status": "success",
            "message": f"{request.drone_id} registered",
            "drone_id": request.drone_id,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/tools/drone_takeoff")
async def drone_takeoff(request: TakeoffRequest):
    result = router.takeoff(request.drone_id, request.altitude_m)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["message"])
    return result


@app.post("/tools/drone_land")
async def drone_land(request: LandRequest):
    result = router.land(request.drone_id)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["message"])
    return result


@app.post("/tools/drone_goto")
async def drone_goto(request: GotoRequest):
    result = router.goto(request.drone_id, request.lat, request.lon, request.alt_m)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["message"])
    return result


@app.post("/tools/drone_velocity")
async def drone_velocity(request: VelocityRequest):
    result = router.set_velocity(request.drone_id, request.vx, request.vy, request.vz, request.yaw_rate)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["message"])
    return result


@app.post("/tools/drone_return_home")
async def drone_return_home(request: ReturnHomeRequest):
    result = router.return_home(request.drone_id)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["message"])
    return result


@app.post("/tools/drone_query")
async def drone_query(request: QueryRequest):
    try:
        telemetry = registry.get_telemetry(request.drone_id)
        return {"status": "success", "telemetry": telemetry}
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.post("/tools/drone_broadcast")
async def drone_broadcast(request: BroadcastRequest):
    kwargs = {}
    if request.command == "takeoff":
        kwargs["altitude_m"] = request.altitude_m
    return router.broadcast(request.command, **kwargs)


@app.get("/drones")
async def list_drones():
    drone_ids = registry.list_drones()
    drones = [registry.get_telemetry(d) for d in drone_ids]
    return {"count": len(drones), "drones": drones}


if __name__ == "__main__":
    import uvicorn

    logger.info("Starting AutoM8te Swarm Manager on http://localhost:8000")
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
