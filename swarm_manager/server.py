"""
Swarm Manager FastAPI Server

Exposes MCP tools to OpenClaw for drone control.
"""

import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import Optional

from .drone_registry import DroneRegistry
from .command_router import CommandRouter

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Global registry and router (initialized on startup)
registry = DroneRegistry()
router = CommandRouter(registry)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown logic for FastAPI app."""
    logger.info("AutoM8te Swarm Manager starting up...")
    
    # TODO: Auto-register drones from config file
    # For now, drones must be registered via API
    
    yield
    
    logger.info("AutoM8te Swarm Manager shutting down...")
    await registry.shutdown()


app = FastAPI(
    title="AutoM8te Swarm Manager",
    description="MCP server for voice-controlled drone swarm",
    version="0.1.0",
    lifespan=lifespan
)


# ==================== Request Models ====================

class TakeoffRequest(BaseModel):
    drone_id: str = Field(..., description="Target drone ID (e.g., drone_1)")
    altitude_m: float = Field(5.0, description="Target altitude in meters", ge=1.0, le=50.0)


class LandRequest(BaseModel):
    drone_id: str = Field(..., description="Target drone ID")


class MoveNEDRequest(BaseModel):
    drone_id: str = Field(..., description="Target drone ID")
    north_m: float = Field(..., description="Meters north of home")
    east_m: float = Field(..., description="Meters east of home")
    down_m: float = Field(..., description="Meters down from home (negative = up)")
    yaw_deg: float = Field(0.0, description="Target yaw in degrees (0-360)")


class VelocityRequest(BaseModel):
    drone_id: str = Field(..., description="Target drone ID")
    vx_ms: float = Field(..., description="North velocity in m/s")
    vy_ms: float = Field(..., description="East velocity in m/s")
    vz_ms: float = Field(..., description="Down velocity in m/s (negative = climb)")
    yaw_rate_degs: float = Field(0.0, description="Yaw rate in degrees/second")


class ReturnHomeRequest(BaseModel):
    drone_id: str = Field(..., description="Target drone ID")


class BroadcastRequest(BaseModel):
    command: str = Field(..., description="Command to broadcast (takeoff, land, return_home)")
    altitude_m: Optional[float] = Field(5.0, description="Altitude for takeoff command")


class RegisterDroneRequest(BaseModel):
    drone_id: str = Field(..., description="Unique drone ID (e.g., drone_1)")
    connection_string: str = Field(..., description="MAVSDK connection string (e.g., udp://:14550)")


class QueryRequest(BaseModel):
    drone_id: str = Field(..., description="Target drone ID")


# ==================== MCP Tool Endpoints ====================

@app.get("/")
async def root():
    """Health check endpoint."""
    return {
        "service": "AutoM8te Swarm Manager",
        "version": "0.1.0",
        "status": "running",
        "registered_drones": registry.list_drones()
    }


@app.post("/tools/drone_register")
async def drone_register(request: RegisterDroneRequest):
    """
    Register a new drone with the swarm manager.
    
    Establishes MAVSDK connection and starts telemetry monitoring.
    """
    try:
        await registry.register(request.drone_id, request.connection_string)
        return {
            "status": "success",
            "message": f"{request.drone_id} registered successfully",
            "drone_id": request.drone_id,
            "connection_string": request.connection_string
        }
    except Exception as e:
        logger.error(f"Registration failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/tools/drone_takeoff")
async def drone_takeoff(request: TakeoffRequest):
    """
    Command drone to take off to specified altitude.
    
    MCP Tool: drone_takeoff
    """
    result = await router.takeoff(request.drone_id, request.altitude_m)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["message"])
    return result


@app.post("/tools/drone_land")
async def drone_land(request: LandRequest):
    """
    Command drone to land at current position.
    
    MCP Tool: drone_land
    """
    result = await router.land(request.drone_id)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["message"])
    return result


@app.post("/tools/drone_move")
async def drone_move(request: MoveNEDRequest):
    """
    Move drone to NED coordinates (North-East-Down).
    
    MCP Tool: drone_move
    """
    result = await router.move_ned(
        request.drone_id,
        request.north_m,
        request.east_m,
        request.down_m,
        request.yaw_deg
    )
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["message"])
    return result


@app.post("/tools/drone_velocity")
async def drone_velocity(request: VelocityRequest):
    """
    Set drone velocity vector (NED frame).
    
    MCP Tool: drone_velocity
    """
    result = await router.set_velocity(
        request.drone_id,
        request.vx_ms,
        request.vy_ms,
        request.vz_ms,
        request.yaw_rate_degs
    )
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["message"])
    return result


@app.post("/tools/drone_return_home")
async def drone_return_home(request: ReturnHomeRequest):
    """
    Command drone to return to launch position and land.
    
    MCP Tool: drone_return_home
    """
    result = await router.return_home(request.drone_id)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["message"])
    return result


@app.post("/tools/drone_query")
async def drone_query(request: QueryRequest):
    """
    Get drone telemetry (position, orientation, battery, etc.).
    
    MCP Tool: drone_query
    """
    try:
        telemetry = registry.get_telemetry(request.drone_id)
        return {
            "status": "success",
            "telemetry": telemetry
        }
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Query failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/tools/drone_broadcast")
async def drone_broadcast(request: BroadcastRequest):
    """
    Send command to all drones.
    
    MCP Tool: drone_broadcast
    """
    kwargs = {}
    if request.command == "takeoff":
        kwargs["altitude_m"] = request.altitude_m
    
    result = await router.broadcast(request.command, **kwargs)
    return result


@app.get("/drones")
async def list_drones():
    """List all registered drones."""
    drone_ids = registry.list_drones()
    drones = []
    
    for drone_id in drone_ids:
        try:
            telemetry = registry.get_telemetry(drone_id)
            drones.append(telemetry)
        except Exception as e:
            logger.error(f"Failed to get telemetry for {drone_id}: {e}")
    
    return {
        "count": len(drones),
        "drones": drones
    }


# ==================== Main ====================

if __name__ == "__main__":
    import uvicorn
    
    logger.info("Starting AutoM8te Swarm Manager on http://localhost:8000")
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
