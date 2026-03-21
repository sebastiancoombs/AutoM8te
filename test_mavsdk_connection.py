#!/usr/bin/env python3
"""
Test MAVSDK connection to ArduCopter SITL.
"""

import asyncio
from mavsdk import System


async def test_connection():
    """Test connection to SITL instance."""
    print("Creating MAVSDK system...")
    drone = System()
    
    print("Connecting to SITL at tcpin://127.0.0.1:5760...")
    await drone.connect(system_address="tcpin://127.0.0.1:5760")
    
    print("Waiting for drone to connect...")
    async for state in drone.core.connection_state():
        if state.is_connected:
            print("✅ Connected successfully!")
            break
    
    print("\nFetching telemetry...")
    
    # Get one position update
    async for position in drone.telemetry.position():
        print(f"Position: {position}")
        break
    
    # Get one attitude update
    async for attitude in drone.telemetry.attitude_euler():
        print(f"Attitude: Roll={attitude.roll_deg:.2f}° Pitch={attitude.pitch_deg:.2f}° Yaw={attitude.yaw_deg:.2f}°")
        break
    
    # Get battery status
    async for battery in drone.telemetry.battery():
        print(f"Battery: {battery.remaining_percent:.1f}%")
        break
    
    print("\n✅ MAVSDK connection test passed!")


if __name__ == "__main__":
    asyncio.run(test_connection())
