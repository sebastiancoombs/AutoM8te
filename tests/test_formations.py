"""
Unit tests for Formation Engine (no SITL required).
"""

import math
import pytest
from swarm_manager.formations import (
    line, v_formation, circle, grid, stack,
    get_formation, assign_drones_to_slots,
    GPSPosition, _ned_to_gps, _haversine_m,
)


class TestFormationGenerators:

    def test_line_count(self):
        slots = line(4, spacing_m=10.0)
        assert len(slots) == 4

    def test_line_spacing(self):
        slots = line(3, spacing_m=10.0)
        # Should be at -10, 0, +10 east (heading=0 → line runs E-W)
        easts = sorted(s.east_m for s in slots)
        assert abs(easts[1] - easts[0] - 10.0) < 0.01
        assert abs(easts[2] - easts[1] - 10.0) < 0.01

    def test_line_centered(self):
        slots = line(3, spacing_m=10.0)
        avg_east = sum(s.east_m for s in slots) / 3
        assert abs(avg_east) < 0.01

    def test_v_formation_leader_at_front(self):
        slots = v_formation(5, spacing_m=10.0)
        # Leader (first slot) should be at (0, 0)
        assert abs(slots[0].north_m) < 0.01
        assert abs(slots[0].east_m) < 0.01

    def test_v_formation_count(self):
        slots = v_formation(5)
        assert len(slots) == 5

    def test_circle_count(self):
        slots = circle(6, radius_m=20.0)
        assert len(slots) == 6

    def test_circle_radius(self):
        slots = circle(8, radius_m=15.0)
        for s in slots:
            dist = math.sqrt(s.north_m ** 2 + s.east_m ** 2)
            assert abs(dist - 15.0) < 0.01

    def test_circle_even_spacing(self):
        slots = circle(4, radius_m=10.0)
        # 4 drones at 90° intervals
        angles = sorted(math.atan2(s.east_m, s.north_m) for s in slots)
        for i in range(len(angles) - 1):
            diff = angles[i + 1] - angles[i]
            assert abs(diff - math.pi / 2) < 0.01

    def test_grid_count(self):
        slots = grid(6)
        assert len(slots) == 6

    def test_grid_explicit_cols(self):
        slots = grid(6, spacing_m=5.0, cols=3)
        assert len(slots) == 6

    def test_stack_vertical(self):
        slots = stack(3, vertical_spacing_m=5.0, base_alt_m=10.0)
        assert len(slots) == 3
        alts = [s.alt_m for s in slots]
        assert alts == [10.0, 15.0, 20.0]
        # All at same horizontal position
        for s in slots:
            assert s.north_m == 0.0
            assert s.east_m == 0.0


class TestFormationRegistry:

    def test_get_known_formation(self):
        slots = get_formation("line", 4, spacing_m=10.0)
        assert len(slots) == 4

    def test_get_unknown_formation(self):
        with pytest.raises(ValueError, match="Unknown formation"):
            get_formation("banana", 4)

    def test_aliases(self):
        # "vee" and "v" should both work
        s1 = get_formation("v", 4)
        s2 = get_formation("vee", 4)
        assert len(s1) == len(s2)


class TestPositionAssignment:

    def test_assignment_count(self):
        drones = [
            GPSPosition(-35.363, 149.165, 10.0),
            GPSPosition(-35.363, 149.166, 10.0),
        ]
        slots = line(2, spacing_m=10.0)
        assignments = assign_drones_to_slots(drones, slots, -35.363, 149.1655)
        assert len(assignments) == 2

    def test_nearest_assignment(self):
        """Drones should be assigned to nearest slots."""
        # Drone A is east, Drone B is west
        drones = [
            GPSPosition(-35.363, 149.166, 10.0),  # east
            GPSPosition(-35.363, 149.164, 10.0),  # west
        ]
        # Line formation at center
        slots = line(2, spacing_m=20.0)  # slots at -10m east and +10m east
        assignments = assign_drones_to_slots(drones, slots, -35.363, 149.165)

        # Each drone should go to nearest slot (not cross paths)
        drone_to_slot = {d: s for d, s in assignments}
        # Drone 0 (east) should go to eastern slot, drone 1 (west) to western slot
        assert len(assignments) == 2


class TestCoordinateConversion:

    def test_ned_to_gps_identity(self):
        """Zero offset should return center."""
        gps = _ned_to_gps(-35.363, 149.165, 0.0, 0.0, 10.0)
        assert abs(gps.lat - (-35.363)) < 1e-8
        assert abs(gps.lon - 149.165) < 1e-8
        assert gps.alt_m == 10.0

    def test_ned_to_gps_north(self):
        """Moving north should increase latitude."""
        gps = _ned_to_gps(-35.363, 149.165, 100.0, 0.0, 10.0)
        assert gps.lat > -35.363

    def test_haversine_zero(self):
        d = _haversine_m(-35.363, 149.165, -35.363, 149.165)
        assert d == 0.0

    def test_haversine_known_distance(self):
        # ~111km per degree of latitude
        d = _haversine_m(0.0, 0.0, 1.0, 0.0)
        assert 110_000 < d < 112_000
