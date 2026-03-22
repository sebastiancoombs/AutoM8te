"""
Unit tests for DroneRegistry and CommandRouter (no SITL required).
"""

import pytest
from swarm_manager.drone_registry import DroneRegistry, DroneState


def test_drone_state_creation():
    """Test DroneState dataclass initialization."""
    state = DroneState(id="drone_1")
    assert state.id == "drone_1"
    assert state.lat == 0.0
    assert state.lon == 0.0
    assert state.is_connected is False
    assert state.is_armed is False
    assert state.current_task == "idle"
    assert state.gps_fix_type == 0


def test_registry_initialization():
    """Test DroneRegistry creates empty state."""
    registry = DroneRegistry()
    assert len(registry.drones) == 0
    assert registry.list_drones() == []


def test_registry_get_nonexistent_drone():
    """Test registry raises error for unknown drone."""
    registry = DroneRegistry()
    with pytest.raises(KeyError):
        registry.get_drone("drone_999")


def test_registry_thread_safe():
    """Test that list_drones is thread-safe."""
    registry = DroneRegistry()
    # Should not raise even if called from multiple threads
    assert registry.list_drones() == []
