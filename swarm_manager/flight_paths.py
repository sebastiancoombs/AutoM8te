"""
Flight Path Engine — Generate waypoint sequences for arbitrary drone movement patterns.

Any movement = a path (list of waypoints) + easing + speed profile.
The LLM can generate custom paths as raw waypoint lists, or use built-in path generators.
"""

import math
import numpy as np
from dataclasses import dataclass
from typing import Optional

# Import GPS helpers from formations
from .formations import GPSPosition, _ned_to_gps, _haversine_m, get_easing

@dataclass
class PathPoint:
    """A single point along a flight path, in local NED relative to path origin."""
    north_m: float
    east_m: float
    alt_m: float

class FlightPath:
    """
    A sequence of waypoints defining a drone flight path.

    Represented as an Mx3 numpy array where M is waypoint count.
    Supports path generation, smoothing, and GPS conversion.
    """

    def __init__(self, waypoints: np.ndarray):
        # waypoints: (M, 3) array [north, east, alt]
        assert waypoints.ndim == 2 and waypoints.shape[1] == 3
        self.waypoints = waypoints.copy()

    @property
    def count(self) -> int: return len(self.waypoints)

    @property
    def total_distance(self) -> float:
        """Total path length in meters."""
        diffs = np.diff(self.waypoints, axis=0)
        return float(np.sum(np.linalg.norm(diffs, axis=1)))

    @classmethod
    def from_points(cls, points: list) -> 'FlightPath':
        """Create from list of (north, east, alt) tuples or [n, e, a] lists."""
        return cls(np.array(points, dtype=float))

    @classmethod
    def straight(cls, start: tuple, end: tuple, num_points: int = 10) -> 'FlightPath':
        """Straight line from start to end."""
        s, e = np.array(start), np.array(end)
        pts = np.array([s + t * (e - s) for t in np.linspace(0, 1, num_points)])
        return cls(pts)

    @classmethod
    def s_curve(cls, start: tuple, end: tuple, amplitude_m: float = 15.0, num_points: int = 30) -> 'FlightPath':
        """
        S-curve path from start to end.
        The drone weaves left then right (or vice versa) on its way to the target.
        """
        s, e = np.array(start), np.array(end)
        direction = e - s
        forward = direction / max(np.linalg.norm(direction), 1e-9)

        # Perpendicular vector (in horizontal plane)
        perp = np.array([-forward[1], forward[0], 0])

        pts = []
        for i in range(num_points):
            t = i / max(1, num_points - 1)
            pos = s + t * direction
            # S-curve: sin wave perpendicular to path
            lateral = amplitude_m * math.sin(2 * math.pi * t)
            pos = pos + lateral * perp
            pts.append(pos)
        return cls(np.array(pts))

    @classmethod
    def zigzag(cls, start: tuple, end: tuple, amplitude_m: float = 10.0, zags: int = 4, num_points: int = 30) -> 'FlightPath':
        """Zigzag path from start to end. Sharp triangular waves."""
        s, e = np.array(start), np.array(end)
        direction = e - s
        forward = direction / max(np.linalg.norm(direction), 1e-9)
        perp = np.array([-forward[1], forward[0], 0])

        pts = []
        for i in range(num_points):
            t = i / max(1, num_points - 1)
            pos = s + t * direction
            # Triangle wave
            phase = (t * zags * 2) % 2
            lateral = amplitude_m * (phase if phase < 1 else 2 - phase) - amplitude_m/2
            lateral *= 2  # full amplitude
            pos = pos + lateral * perp
            pts.append(pos)
        return cls(np.array(pts))

    @classmethod
    def arc(cls, start: tuple, end: tuple, curvature: float = 0.5, num_points: int = 20) -> 'FlightPath':
        """
        Curved arc from start to end.
        curvature: 0 = straight, 0.5 = moderate, 1 = semicircle. Negative = curve other way.
        """
        s, e = np.array(start), np.array(end)
        direction = e - s
        forward = direction / max(np.linalg.norm(direction), 1e-9)
        perp = np.array([-forward[1], forward[0], 0])

        midpoint_dist = np.linalg.norm(direction[:2])
        bulge = curvature * midpoint_dist / 2

        pts = []
        for i in range(num_points):
            t = i / max(1, num_points - 1)
            pos = s + t * direction
            # Parabolic bulge perpendicular to path
            lateral = bulge * 4 * t * (1 - t)  # peaks at midpoint
            pos = pos + lateral * perp
            pts.append(pos)
        return cls(np.array(pts))

    @classmethod
    def spiral_climb(cls, center: tuple, start_radius_m: float, end_radius_m: float,
                     start_alt_m: float, end_alt_m: float, turns: float = 2.0,
                     num_points: int = 40) -> 'FlightPath':
        """Spiral climb or descent around a center point."""
        pts = []
        for i in range(num_points):
            t = i / max(1, num_points - 1)
            angle = 2 * math.pi * turns * t
            radius = start_radius_m + t * (end_radius_m - start_radius_m)
            alt = start_alt_m + t * (end_alt_m - start_alt_m)
            north = center[0] + radius * math.cos(angle)
            east = center[1] + radius * math.sin(angle)
            pts.append([north, east, alt])
        return cls(np.array(pts))

    @classmethod
    def ellipse(cls, center: tuple, radius_north_m: float, radius_east_m: float,
                alt_m: float, num_points: int = 36, start_angle_deg: float = 0.0,
                clockwise: bool = True) -> 'FlightPath':
        """Elliptical orbit (oval). Different radii for N/S vs E/W."""
        direction = -1 if clockwise else 1
        start_rad = math.radians(start_angle_deg)
        pts = []
        for i in range(num_points + 1):  # +1 to close the loop
            angle = start_rad + direction * (2 * math.pi * i / num_points)
            north = center[0] + radius_north_m * math.cos(angle)
            east = center[1] + radius_east_m * math.sin(angle)
            pts.append([north, east, alt_m])
        return cls(np.array(pts))

    @classmethod
    def figure_eight(cls, center: tuple, radius_m: float = 20.0, alt_m: float = 15.0,
                     num_points: int = 60) -> 'FlightPath':
        """Figure-8 / lemniscate pattern."""
        pts = []
        for i in range(num_points + 1):
            t = 2 * math.pi * i / num_points
            # Lemniscate of Bernoulli parametric form
            denom = 1 + math.sin(t)**2
            north = center[0] + radius_m * math.cos(t) / denom
            east = center[1] + radius_m * math.sin(t) * math.cos(t) / denom
            pts.append([north, east, alt_m])
        return cls(np.array(pts))

    @classmethod
    def racetrack(cls, center: tuple, length_m: float = 40.0, width_m: float = 20.0,
                  alt_m: float = 15.0, num_points: int = 40) -> 'FlightPath':
        """Racetrack / stadium / oval with flat sides and semicircle ends."""
        half_len = length_m / 2
        half_wid = width_m / 2
        pts_per_section = num_points // 4
        pts = []

        # Right straight (south to north)
        for i in range(pts_per_section):
            t = i / pts_per_section
            pts.append([center[0] - half_len + t * length_m, center[1] + half_wid, alt_m])
        # Top semicircle
        for i in range(pts_per_section):
            angle = -math.pi/2 + math.pi * i / pts_per_section
            pts.append([center[0] + half_len + half_wid * math.sin(angle),
                       center[1] + half_wid * math.cos(angle), alt_m])
        # Left straight (north to south)
        for i in range(pts_per_section):
            t = i / pts_per_section
            pts.append([center[0] + half_len - t * length_m, center[1] - half_wid, alt_m])
        # Bottom semicircle
        for i in range(pts_per_section):
            angle = math.pi/2 + math.pi * i / pts_per_section
            pts.append([center[0] - half_len + half_wid * math.sin(angle),
                       center[1] - half_wid * math.cos(angle), alt_m])

        return cls(np.array(pts))

    # ── Path transforms ──

    def with_easing(self, easing: str = 'ease_in_out') -> 'FlightPath':
        """
        Redistribute waypoints along the path according to easing curve.
        More points bunched at start/end for ease_in_out, etc.
        """
        ease_fn = get_easing(easing)
        # Calculate cumulative distances
        diffs = np.diff(self.waypoints, axis=0)
        seg_lengths = np.linalg.norm(diffs, axis=1)
        cum_dist = np.concatenate([[0], np.cumsum(seg_lengths)])
        total = cum_dist[-1]
        if total < 1e-9:
            return FlightPath(self.waypoints.copy())

        # Generate new t values through easing
        new_count = len(self.waypoints)
        new_pts = []
        for i in range(new_count):
            raw_t = i / max(1, new_count - 1)
            eased_t = float(ease_fn(raw_t))
            # Find position on original path at this distance fraction
            target_dist = eased_t * total
            # Find which segment we're in
            idx = np.searchsorted(cum_dist, target_dist, side='right') - 1
            idx = max(0, min(idx, len(self.waypoints) - 2))
            seg_start_dist = cum_dist[idx]
            seg_len = seg_lengths[idx] if idx < len(seg_lengths) else 1e-9
            local_t = (target_dist - seg_start_dist) / max(seg_len, 1e-9)
            local_t = np.clip(local_t, 0, 1)
            pt = self.waypoints[idx] + local_t * (self.waypoints[idx + 1] - self.waypoints[idx])
            new_pts.append(pt)
        return FlightPath(np.array(new_pts))

    def smooth(self, window: int = 3) -> 'FlightPath':
        """Apply moving average smoothing to the path. Preserves start and end points."""
        if self.count < window + 2:
            return FlightPath(self.waypoints.copy())
        smoothed = self.waypoints.copy()
        half = window // 2
        for i in range(half, self.count - half):
            smoothed[i] = self.waypoints[i-half:i+half+1].mean(axis=0)
        # Keep endpoints exact
        smoothed[0] = self.waypoints[0]
        smoothed[-1] = self.waypoints[-1]
        return FlightPath(smoothed)

    def resample(self, num_points: int) -> 'FlightPath':
        """Resample path to a different number of evenly-spaced waypoints."""
        diffs = np.diff(self.waypoints, axis=0)
        seg_lengths = np.linalg.norm(diffs, axis=1)
        cum_dist = np.concatenate([[0], np.cumsum(seg_lengths)])
        total = cum_dist[-1]

        new_pts = []
        for i in range(num_points):
            target_dist = total * i / max(1, num_points - 1)
            idx = np.searchsorted(cum_dist, target_dist, side='right') - 1
            idx = max(0, min(idx, len(self.waypoints) - 2))
            seg_start_dist = cum_dist[idx]
            seg_len = seg_lengths[idx] if idx < len(seg_lengths) else 1e-9
            local_t = (target_dist - seg_start_dist) / max(seg_len, 1e-9)
            local_t = np.clip(local_t, 0, 1)
            pt = self.waypoints[idx] + local_t * (self.waypoints[idx + 1] - self.waypoints[idx])
            new_pts.append(pt)
        return FlightPath(np.array(new_pts))

    def to_gps(self, origin_lat: float, origin_lon: float) -> list:
        """Convert path waypoints to GPS positions."""
        return [
            _ned_to_gps(origin_lat, origin_lon, float(row[0]), float(row[1]), float(row[2]))
            for row in self.waypoints
        ]

    def __repr__(self):
        return f'FlightPath({self.count} waypoints, {self.total_distance:.1f}m total)'


# ── Path Registry ───────────────────────────────────────────

PATH_GENERATORS = {
    'straight': FlightPath.straight,
    's_curve': FlightPath.s_curve,
    'zigzag': FlightPath.zigzag,
    'arc': FlightPath.arc,
    'spiral': FlightPath.spiral_climb,
    'ellipse': FlightPath.ellipse,
    'figure_eight': FlightPath.figure_eight,
    'racetrack': FlightPath.racetrack,
}

def get_path_generator(name: str):
    """Get path generator by name. Raises ValueError if not found."""
    if name not in PATH_GENERATORS:
        raise ValueError(f'Unknown path type "{name}". Available: {list(PATH_GENERATORS.keys())}')
    return PATH_GENERATORS[name]
