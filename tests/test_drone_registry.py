"""
Unit tests for DroneRegistry

Tests drone registration, state management, and telemetry tracking.
"""

import pytest
from swarm_manager.drone_registry import DroneRegistry, DroneState


def test_drone_state_creation():
    """Test DroneState dataclass initialization."""
    state = DroneState(id="drone_1")
    
    assert state.id == "drone_1"
    assert state.position == (0.0, 0.0, 0.0)
    assert state.orientation == (0.0, 0.0, 0.0)
    assert state.is_connected is False
    assert state.current_task == "idle"


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


# Note: Testing actual MAVSDK connections requires SITL running
# Those tests should be in integration tests, not unit tests
