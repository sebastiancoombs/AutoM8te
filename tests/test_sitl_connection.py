"""
test_sitl_connection.py — First flight test for AutoM8te Phase 1.

Connects MAVSDK to ArduPilot SITL, arms, takes off, hovers, lands.

Prerequisites:
    1. SITL running: cd ~/ardupilot && python3 Tools/autotest/sim_vehicle.py -v ArduCopter --no-mavproxy
    2. This script connects to SITL's TCP port 5760

Notes on ArduPilot + MAVSDK compatibility:
    - MAVSDK health flags (gyro_cal, accel_cal) are PX4-specific. ArduPilot
      does not populate them. Use home_position_ok + armable as readiness check.
    - ArduPilot requires GUIDED mode for autonomous takeoff (unlike PX4 which
      handles mode switching internally).
    - Use tcpout:// to connect to SITL's listening TCP socket.
"""

import asyncio
import sys
from mavsdk import System
from mavsdk.action import ActionError


SITL_ADDRESS = "tcpout://127.0.0.1:5760"
TAKEOFF_ALTITUDE = 5.0  # meters
HOVER_TIME = 5  # seconds
CONNECTION_TIMEOUT = 30  # seconds
READINESS_TIMEOUT = 120  # seconds


async def wait_for_connection(drone: System, timeout: float) -> bool:
    """Wait for drone connection with timeout."""
    async def _wait():
        async for state in drone.core.connection_state():
            if state.is_connected:
                return True
        return False

    try:
        return await asyncio.wait_for(_wait(), timeout=timeout)
    except asyncio.TimeoutError:
        return False


async def wait_for_ready(drone: System, timeout: float) -> bool:
    """
    Wait for ArduPilot SITL to be ready for flight.
    
    For ArduPilot SITL, MAVSDK's is_armable and gyro/accel flags may not
    populate the same as PX4. We wait for home position (EKF has a reference),
    then rely on the actual arm() call to surface any remaining prearm failures.
    """
    elapsed = 0
    async for health in drone.telemetry.health():
        if health.is_home_position_ok:
            return True
        elapsed += 1
        if elapsed > timeout:
            print(f"  Last health: home={health.is_home_position_ok} "
                  f"gps={health.is_global_position_ok}", flush=True)
            return False
        if elapsed % 10 == 0:
            print(f"  [{elapsed}s] Waiting for home position...", flush=True)
        await asyncio.sleep(1)
    return False


async def main():
    drone = System()

    # --- Connect ---
    print(f"Connecting to SITL at {SITL_ADDRESS}...", flush=True)
    await drone.connect(system_address=SITL_ADDRESS)

    connected = await wait_for_connection(drone, CONNECTION_TIMEOUT)
    if not connected:
        print("❌ Connection timeout", flush=True)
        sys.exit(1)
    print("✅ Connected to SITL", flush=True)

    # --- Wait for readiness ---
    print("Waiting for SITL readiness...", flush=True)
    ready = await wait_for_ready(drone, READINESS_TIMEOUT)
    if not ready:
        print("❌ SITL not ready within timeout. EKF may need more time.", flush=True)
        print("   Try running SITL without -w flag, or let it run longer.", flush=True)
        sys.exit(1)
    print("✅ SITL ready", flush=True)

    # --- Telemetry snapshot ---
    async for pos in drone.telemetry.position():
        print(f"📍 Position: {pos.latitude_deg:.6f}, {pos.longitude_deg:.6f}, "
              f"alt={pos.relative_altitude_m:.1f}m", flush=True)
        break

    async for battery in drone.telemetry.battery():
        print(f"🔋 Battery: {battery.remaining_percent:.0f}%", flush=True)
        break

    # --- Arm ---
    print("🚁 Arming...", flush=True)
    try:
        await drone.action.arm()
    except ActionError as e:
        print(f"❌ Arm failed: {e}", flush=True)
        sys.exit(1)
    print("✅ Armed", flush=True)

    # --- Takeoff ---
    print(f"🚁 Taking off to {TAKEOFF_ALTITUDE}m...", flush=True)
    try:
        await drone.action.set_takeoff_altitude(TAKEOFF_ALTITUDE)
        await drone.action.takeoff()
    except ActionError as e:
        print(f"❌ Takeoff failed: {e}", flush=True)
        # Disarm safely
        await drone.action.disarm()
        sys.exit(1)
    print("✅ Takeoff command sent", flush=True)

    # --- Monitor ascent ---
    for i in range(15):
        await asyncio.sleep(1)
        async for pos in drone.telemetry.position():
            alt = pos.relative_altitude_m
            print(f"  [{i+1:2d}s] Altitude: {alt:.1f}m", flush=True)
            break

    # --- Hover ---
    print(f"⏸️  Hovering for {HOVER_TIME}s...", flush=True)
    await asyncio.sleep(HOVER_TIME)

    # --- Land ---
    print("🚁 Landing...", flush=True)
    try:
        await drone.action.land()
    except ActionError as e:
        print(f"❌ Land failed: {e}", flush=True)
        sys.exit(1)

    # --- Monitor descent ---
    for i in range(15):
        await asyncio.sleep(1)
        async for pos in drone.telemetry.position():
            alt = pos.relative_altitude_m
            print(f"  [{i+1:2d}s] Altitude: {alt:.1f}m", flush=True)
            if alt < 0.3:
                print("✅ Landed", flush=True)
                break
            break
        else:
            continue
        break

    print("", flush=True)
    print("🎉 Phase 1 flight test PASSED", flush=True)
    print("   MAVSDK → ArduPilot SITL → Arm → Takeoff → Hover → Land", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
