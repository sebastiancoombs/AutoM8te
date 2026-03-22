"""
Integration tests — require running SITL instances.

Run SITL first:
    ./scripts/launch_sitl.sh 2

Then:
    pytest tests/test_integration.py -v -s
"""

import time
import pytest
from swarm_manager.drone_registry import DroneRegistry
from swarm_manager.command_router import CommandRouter


# ── Fixtures ────────────────────────────────────────────────

@pytest.fixture
def registry():
    reg = DroneRegistry()
    yield reg
    reg.shutdown()


@pytest.fixture
def router(registry):
    return CommandRouter(registry)


# ── Single Drone Tests ──────────────────────────────────────

class TestSingleDrone:
    """Tests that require one SITL instance on tcp:127.0.0.1:5760"""

    def test_register(self, registry):
        """Register a drone and verify connection."""
        state = registry.register("drone_1", "tcp:127.0.0.1:5760")
        assert state.is_connected
        assert state.gps_fix_type >= 3
        assert "drone_1" in registry.list_drones()

    def test_takeoff_and_land(self, registry, router):
        """Full takeoff → hover → land cycle."""
        registry.register("drone_1", "tcp:127.0.0.1:5760")

        # Takeoff
        result = router.takeoff("drone_1", altitude_m=5.0)
        assert result["status"] == "success"

        # Check altitude
        time.sleep(2)
        telem = registry.get_telemetry("drone_1")
        assert telem["position"]["alt_rel_m"] > 2.0

        # Land
        result = router.land("drone_1")
        assert result["status"] == "success"

    def test_query_telemetry(self, registry):
        """Register and read telemetry."""
        registry.register("drone_1", "tcp:127.0.0.1:5760")
        telem = registry.get_telemetry("drone_1")
        assert telem["drone_id"] == "drone_1"
        assert telem["connected"] is True
        assert telem["gps"]["fix_type"] >= 3


# ── Multi Drone Tests ───────────────────────────────────────

class TestMultiDrone:
    """Tests that require 2+ SITL instances (ports 5760, 5770)."""

    def test_register_two_drones(self, registry):
        """Register two drones on separate SITL instances."""
        s1 = registry.register("drone_1", "tcp:127.0.0.1:5760")
        s2 = registry.register("drone_2", "tcp:127.0.0.1:5770")

        assert s1.is_connected
        assert s2.is_connected
        assert len(registry.list_drones()) == 2

    def test_broadcast_takeoff(self, registry, router):
        """Broadcast takeoff to multiple drones."""
        registry.register("drone_1", "tcp:127.0.0.1:5760")
        registry.register("drone_2", "tcp:127.0.0.1:5770")

        result = router.broadcast("takeoff", altitude_m=5.0)
        assert result["status"] == "success"
        assert len(result["results"]) == 2

        # Verify both are airborne
        time.sleep(3)
        for drone_id in ["drone_1", "drone_2"]:
            telem = registry.get_telemetry(drone_id)
            assert telem["position"]["alt_rel_m"] > 2.0, f"{drone_id} not airborne"

        # Land all
        router.broadcast("land")

    def test_independent_commands(self, registry, router):
        """Command drones independently."""
        registry.register("drone_1", "tcp:127.0.0.1:5760")
        registry.register("drone_2", "tcp:127.0.0.1:5770")

        # Only takeoff drone_1
        result = router.takeoff("drone_1", altitude_m=5.0)
        assert result["status"] == "success"

        time.sleep(3)

        # drone_1 should be airborne, drone_2 should not
        t1 = registry.get_telemetry("drone_1")
        t2 = registry.get_telemetry("drone_2")
        assert t1["position"]["alt_rel_m"] > 2.0
        assert t2["position"]["alt_rel_m"] < 1.0

        router.land("drone_1")
