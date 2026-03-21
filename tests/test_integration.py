#!/usr/bin/env python3
"""
Integration test: DroneRegistry + CommandRouter → SITL

Requires ArduPilot SITL running on tcp:127.0.0.1:5760:
  cd ~/ardupilot && python3 Tools/autotest/sim_vehicle.py -v ArduCopter --no-mavproxy --speedup 10

Run:
  python3 -m pytest tests/test_integration.py -v -s
"""

import time
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from swarm_manager.drone_registry import DroneRegistry
from swarm_manager.command_router import CommandRouter


def test_register_and_takeoff():
    """End-to-end: register drone, takeoff, check telemetry, land."""
    registry = DroneRegistry()
    router = CommandRouter(registry)

    # Register
    print("\n=== Registering drone_1 ===")
    state = registry.register("drone_1", "tcp:127.0.0.1:5760", wait_gps=True, gps_timeout=120)
    assert state.is_connected
    assert state.gps_fix >= 3, f"GPS fix too low: {state.gps_fix}"
    print(f"  ✅ Registered: GPS fix={state.gps_fix}, sats={state.gps_sats}")

    # Check telemetry
    time.sleep(2)  # Let telemetry thread populate
    telem = registry.get_telemetry("drone_1")
    print(f"  📍 Position: lat={telem['position']['lat']:.6f}, lon={telem['position']['lon']:.6f}")
    print(f"  🔋 Battery: {telem['battery']['percent']}%")
    assert telem["connected"]

    # Takeoff
    print("\n=== Takeoff to 5m ===")
    result = router.takeoff("drone_1", altitude_m=5.0)
    print(f"  Result: {result}")
    assert result["status"] == "success", f"Takeoff failed: {result}"
    print(f"  ✅ {result['message']}")

    # Wait for altitude
    print("  Climbing...")
    for i in range(20):
        time.sleep(1)
        telem = registry.get_telemetry("drone_1")
        alt = telem["position"]["alt_rel_m"]
        print(f"  [{i+1}s] alt={alt:.1f}m mode={telem['flight_mode']}")
        if alt >= 4.0:
            print("  ✅ Reached target altitude!")
            break

    # Land
    print("\n=== Landing ===")
    result = router.land("drone_1")
    assert result["status"] == "success"
    print(f"  ✅ {result['message']}")

    # Wait for landing
    for i in range(25):
        time.sleep(1)
        telem = registry.get_telemetry("drone_1")
        alt = telem["position"]["alt_rel_m"]
        print(f"  [{i+1}s] alt={alt:.1f}m")
        if alt < 0.3:
            print("  ✅ Landed!")
            break

    # Cleanup
    registry.shutdown()
    print("\n🎉 Integration test passed!")


if __name__ == "__main__":
    test_register_and_takeoff()
