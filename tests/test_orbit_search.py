"""
Unit tests for Orbit and Search Grid primitives (no SITL required).
"""

import math
import pytest
from swarm_manager.formations import (
    orbit_waypoints, multi_drone_orbit_offsets,
    search_grid_waypoints, SearchBounds,
    _haversine_m, GPSPosition,
)


class TestOrbitWaypoints:

    def test_orbit_point_count(self):
        wps = orbit_waypoints(-35.363, 149.165, radius_m=20.0, alt_m=15.0, num_points=36)
        assert len(wps) == 36

    def test_orbit_radius_correct(self):
        center_lat, center_lon = -35.363, 149.165
        wps = orbit_waypoints(center_lat, center_lon, radius_m=20.0, alt_m=15.0, num_points=36)
        for wp in wps:
            dist = _haversine_m(center_lat, center_lon, wp.lat, wp.lon)
            assert abs(dist - 20.0) < 1.0, f"Expected ~20m, got {dist:.1f}m"

    def test_orbit_altitude_uniform(self):
        wps = orbit_waypoints(-35.363, 149.165, radius_m=20.0, alt_m=15.0)
        for wp in wps:
            assert wp.alt_m == 15.0

    def test_orbit_forms_circle(self):
        """Waypoints should be roughly equally spaced around the circle."""
        wps = orbit_waypoints(-35.363, 149.165, radius_m=50.0, alt_m=10.0, num_points=8)
        assert len(wps) == 8
        # Check consecutive distances are similar
        dists = []
        for i in range(len(wps)):
            j = (i + 1) % len(wps)
            d = _haversine_m(wps[i].lat, wps[i].lon, wps[j].lat, wps[j].lon)
            dists.append(d)
        avg = sum(dists) / len(dists)
        for d in dists:
            assert abs(d - avg) < avg * 0.15, f"Uneven spacing: {d:.1f}m vs avg {avg:.1f}m"

    def test_orbit_clockwise_vs_counterclockwise(self):
        wps_cw = orbit_waypoints(-35.363, 149.165, 20.0, 10.0, num_points=4, clockwise=True)
        wps_ccw = orbit_waypoints(-35.363, 149.165, 20.0, 10.0, num_points=4, clockwise=False)
        # Different order (not identical)
        cw_lons = [w.lon for w in wps_cw]
        ccw_lons = [w.lon for w in wps_ccw]
        assert cw_lons != ccw_lons

    def test_orbit_start_angle(self):
        """Start angle=0 should place first waypoint roughly north of center."""
        center_lat, center_lon = -35.363, 149.165
        wps = orbit_waypoints(center_lat, center_lon, 20.0, 10.0,
                              num_points=36, start_angle_deg=0.0)
        # First waypoint should be ~north (higher lat, same lon)
        assert wps[0].lat > center_lat


class TestMultiDroneOrbitOffsets:

    def test_offset_count(self):
        offsets = multi_drone_orbit_offsets(4, 20.0, 10.0)
        assert len(offsets) == 4

    def test_offsets_evenly_spaced(self):
        offsets = multi_drone_orbit_offsets(4, 20.0, 10.0)
        assert offsets == [0.0, 90.0, 180.0, 270.0]

    def test_single_drone_offset(self):
        offsets = multi_drone_orbit_offsets(1, 20.0, 10.0)
        assert offsets == [0.0]


class TestSearchGridWaypoints:

    def _default_bounds(self):
        # ~100m x ~100m area near Canberra
        return SearchBounds(
            min_lat=-35.364, min_lon=149.164,
            max_lat=-35.363, max_lon=149.165,
        )

    def test_grid_generates_waypoints(self):
        bounds = self._default_bounds()
        wps = search_grid_waypoints(bounds, alt_m=20.0, pattern="grid")
        assert len(wps) > 0

    def test_grid_waypoints_in_bounds(self):
        bounds = self._default_bounds()
        wps = search_grid_waypoints(bounds, alt_m=20.0, pattern="grid")
        for wp in wps:
            assert bounds.min_lat - 0.001 <= wp.lat <= bounds.max_lat + 0.001
            assert bounds.min_lon - 0.001 <= wp.lon <= bounds.max_lon + 0.001

    def test_grid_altitude_uniform(self):
        bounds = self._default_bounds()
        wps = search_grid_waypoints(bounds, alt_m=25.0, pattern="grid")
        for wp in wps:
            assert wp.alt_m == 25.0

    def test_grid_multi_drone_split(self):
        bounds = self._default_bounds()
        wps_0 = search_grid_waypoints(bounds, 20.0, "grid", drone_count=2, drone_index=0)
        wps_1 = search_grid_waypoints(bounds, 20.0, "grid", drone_count=2, drone_index=1)
        # Both should have waypoints
        assert len(wps_0) > 0
        assert len(wps_1) > 0
        # Drone 0 should be in the western half, drone 1 in eastern half
        avg_lon_0 = sum(w.lon for w in wps_0) / len(wps_0)
        avg_lon_1 = sum(w.lon for w in wps_1) / len(wps_1)
        assert avg_lon_0 < avg_lon_1

    def test_spiral_generates_waypoints(self):
        bounds = self._default_bounds()
        wps = search_grid_waypoints(bounds, alt_m=20.0, pattern="spiral")
        assert len(wps) > 0

    def test_spiral_ends_at_center(self):
        bounds = self._default_bounds()
        wps = search_grid_waypoints(bounds, alt_m=20.0, pattern="spiral")
        center_lat = (bounds.min_lat + bounds.max_lat) / 2
        center_lon = (bounds.min_lon + bounds.max_lon) / 2
        last = wps[-1]
        dist = _haversine_m(last.lat, last.lon, center_lat, center_lon)
        assert dist < 5.0, f"Spiral should end at center, but last point is {dist:.1f}m away"

    def test_expanding_generates_waypoints(self):
        bounds = self._default_bounds()
        wps = search_grid_waypoints(bounds, alt_m=20.0, pattern="expanding")
        assert len(wps) > 0

    def test_expanding_starts_at_center(self):
        bounds = self._default_bounds()
        wps = search_grid_waypoints(bounds, alt_m=20.0, pattern="expanding")
        center_lat = (bounds.min_lat + bounds.max_lat) / 2
        center_lon = (bounds.min_lon + bounds.max_lon) / 2
        first = wps[0]
        dist = _haversine_m(first.lat, first.lon, center_lat, center_lon)
        assert dist < 1.0, f"Expanding should start at center, but first point is {dist:.1f}m away"

    def test_unknown_pattern_raises(self):
        bounds = self._default_bounds()
        with pytest.raises(ValueError, match="Unknown search pattern"):
            search_grid_waypoints(bounds, 20.0, pattern="zigzag")

    def test_lawnmower_alternates_direction(self):
        """Grid search should alternate north-south passes (boustrophedon)."""
        bounds = self._default_bounds()
        wps = search_grid_waypoints(bounds, alt_m=20.0, pattern="grid", swath_width_m=50.0)
        # Waypoints come in pairs (start, end of each pass)
        # Even passes: south→north, odd passes: north→south
        if len(wps) >= 4:
            # First pass should go south→north
            assert wps[0].lat < wps[1].lat
            # Second pass should go north→south
            assert wps[2].lat > wps[3].lat
