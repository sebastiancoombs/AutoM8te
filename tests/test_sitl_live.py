#!/usr/bin/env python3
"""
Live SITL connection test — connects MAVSDK to a running ArduPilot SITL instance.
Requires SITL running on tcp://127.0.0.1:5760.

Tests:
1. Connect to SITL
2. Wait for GPS fix
3. Read telemetry (position, battery, flight mode)
4. Arm + takeoff to 5m
5. Hover for 3 seconds
6. Land
"""

import asyncio
import sys
import os

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from mavsdk import System
from mavsdk.offboard import VelocityNedYaw


async def run():
    drone = System()
    
    print("Connecting to SITL on tcpout://127.0.0.1:5760...")
    await drone.connect(system_address="tcpout://127.0.0.1:5760")
    
    print("Waiting for drone to connect...")
    async for state in drone.core.connection_state():
        if state.is_connected:
            print(f"  ✅ Connected!")
            break
    
    print("Waiting for GPS fix...")
    async for health in drone.telemetry.health():
        if health.is_global_position_ok and health.is_home_position_ok:
            print(f"  ✅ GPS fix acquired, home position set")
            break
        else:
            print(f"  ⏳ GPS: global={health.is_global_position_ok}, home={health.is_home_position_ok}")
    
    # Read position
    async for position in drone.telemetry.position():
        print(f"  📍 Position: lat={position.latitude_deg:.6f}, lon={position.longitude_deg:.6f}, alt={position.relative_altitude_m:.1f}m")
        break
    
    # Read battery
    async for battery in drone.telemetry.battery():
        print(f"  🔋 Battery: {battery.remaining_percent:.0%} ({battery.voltage_v:.1f}V)")
        break
    
    # Read flight mode
    async for mode in drone.telemetry.flight_mode():
        print(f"  🎮 Flight mode: {mode}")
        break
    
    # Arm
    print("\nArming...")
    await drone.action.arm()
    print("  ✅ Armed!")
    
    # Takeoff
    print("Taking off to 5m...")
    await drone.action.set_takeoff_altitude(5.0)
    await drone.action.takeoff()
    
    # Wait for altitude
    print("  Waiting to reach altitude...")
    await asyncio.sleep(8)  # Give time to reach altitude
    
    async for position in drone.telemetry.position():
        print(f"  📍 Altitude: {position.relative_altitude_m:.1f}m")
        break
    
    # Hover
    print("  Hovering for 3 seconds...")
    await asyncio.sleep(3)
    
    # Land
    print("Landing...")
    await drone.action.land()
    
    # Wait for landing
    print("  Waiting for landing...")
    await asyncio.sleep(10)
    
    async for position in drone.telemetry.position():
        alt = position.relative_altitude_m
        print(f"  📍 Final altitude: {alt:.1f}m")
        if alt < 0.5:
            print("  ✅ Landed successfully!")
        break
    
    # Disarm
    print("Disarming...")
    try:
        await drone.action.disarm()
        print("  ✅ Disarmed!")
    except Exception as e:
        print(f"  ⚠️  Disarm: {e}")
    
    print("\n🎉 SITL FLIGHT TEST COMPLETE!")


if __name__ == "__main__":
    asyncio.run(run())
