"""
Formation Engine — Tier 1 Core Primitive

Generates drone position assignments for standard formations.
Uses the Hungarian algorithm for optimal drone-to-slot assignment
(minimizes total travel distance, prevents path crossings).

Formations are defined in local NED coordinates relative to a center point,
then converted to GPS coordinates for execution.
"""

import math
import logging
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)

# Earth radius for coordinate math
EARTH_RADIUS_M = 6371000.0


@dataclass
class FormationSlot:
    """A single position slot in a formation."""
    north_m: float  # meters north of center
    east_m: float   # meters east of center
    alt_m: float    # altitude above ground


@dataclass
class GPSPosition:
    """GPS coordinate."""
    lat: float
    lon: float
    alt_m: float


def _ned_to_gps(center_lat: float, center_lon: float, north_m: float, east_m: float, alt_m: float) -> GPSPosition:
    """Convert NED offset from center to GPS coordinates."""
    lat = center_lat + (north_m / EARTH_RADIUS_M) * (180 / math.pi)
    lon = center_lon + (east_m / (EARTH_RADIUS_M * math.cos(math.radians(center_lat)))) * (180 / math.pi)
    return GPSPosition(lat=lat, lon=lon, alt_m=alt_m)


# ── Formation Generators ────────────────────────────────────
# Each returns a list of FormationSlot (local NED coords).
# The list length = number of slots. If drone_count > slots, extras hover at center.
# If drone_count < slots, only first N slots are used.

def line(drone_count: int, spacing_m: float = 10.0, heading_deg: float = 0.0, alt_m: float = 10.0) -> list[FormationSlot]:
    """
    Line formation perpendicular to heading.

    Drones evenly spaced in a line. heading_deg determines which way the line faces.
    0° = line runs east-west (facing north), 90° = line runs north-south (facing east).
    """
    slots = []
    heading_rad = math.radians(heading_deg)
    total_width = spacing_m * (drone_count - 1)
    start_offset = -total_width / 2

    for i in range(drone_count):
        # Offset perpendicular to heading
        perp_offset = start_offset + i * spacing_m
        north = -perp_offset * math.sin(heading_rad)
        east = perp_offset * math.cos(heading_rad)
        slots.append(FormationSlot(north_m=north, east_m=east, alt_m=alt_m))

    return slots


def v_formation(drone_count: int, spacing_m: float = 10.0, angle_deg: float = 45.0, heading_deg: float = 0.0, alt_m: float = 10.0) -> list[FormationSlot]:
    """
    V-formation (like geese).

    Leader at front, wingmen trail back at angle_deg from centerline.
    """
    slots = [FormationSlot(north_m=0.0, east_m=0.0, alt_m=alt_m)]  # leader
    heading_rad = math.radians(heading_deg)
    angle_rad = math.radians(angle_deg)

    for i in range(1, drone_count):
        side = 1 if i % 2 == 1 else -1  # alternate left/right
        rank = (i + 1) // 2  # how far back

        # Trail behind leader
        trail = rank * spacing_m * math.cos(angle_rad)
        lateral = side * rank * spacing_m * math.sin(angle_rad)

        # Rotate by heading
        north = -trail * math.cos(heading_rad) - lateral * math.sin(heading_rad)
        east = -trail * math.sin(heading_rad) + lateral * math.cos(heading_rad)

        slots.append(FormationSlot(north_m=north, east_m=east, alt_m=alt_m))

    return slots


def circle(drone_count: int, radius_m: float = 15.0, alt_m: float = 10.0) -> list[FormationSlot]:
    """Circle formation — drones evenly spaced around a circle."""
    slots = []
    for i in range(drone_count):
        angle = 2 * math.pi * i / drone_count
        north = radius_m * math.cos(angle)
        east = radius_m * math.sin(angle)
        slots.append(FormationSlot(north_m=north, east_m=east, alt_m=alt_m))
    return slots


def grid(drone_count: int, spacing_m: float = 10.0, cols: Optional[int] = None, alt_m: float = 10.0) -> list[FormationSlot]:
    """
    Grid formation (rows × columns).

    If cols not specified, makes a roughly square grid.
    """
    if cols is None:
        cols = math.ceil(math.sqrt(drone_count))
    rows = math.ceil(drone_count / cols)

    slots = []
    for i in range(drone_count):
        row = i // cols
        col = i % cols
        north = (row - (rows - 1) / 2) * spacing_m
        east = (col - (cols - 1) / 2) * spacing_m
        slots.append(FormationSlot(north_m=north, east_m=east, alt_m=alt_m))
    return slots


def stack(drone_count: int, vertical_spacing_m: float = 3.0, base_alt_m: float = 10.0) -> list[FormationSlot]:
    """Vertical stack — drones directly above each other."""
    return [
        FormationSlot(north_m=0.0, east_m=0.0, alt_m=base_alt_m + i * vertical_spacing_m)
        for i in range(drone_count)
    ]


# ── Formation Registry ──────────────────────────────────────

FORMATIONS = {
    "line": line,
    "v": v_formation,
    "vee": v_formation,
    "circle": circle,
    "ring": circle,
    "grid": grid,
    "square": grid,
    "stack": stack,
    "column": stack,
}


def get_formation(name: str, drone_count: int, **kwargs) -> list[FormationSlot]:
    """
    Get formation slots by name.

    Args:
        name: Formation name (line, v, circle, grid, stack)
        drone_count: Number of drones
        **kwargs: Formation-specific params (spacing_m, radius_m, etc.)

    Returns:
        List of FormationSlot positions

    Raises:
        ValueError: If formation name unknown
    """
    name_lower = name.lower().strip()
    if name_lower not in FORMATIONS:
        raise ValueError(f"Unknown formation '{name}'. Available: {list(FORMATIONS.keys())}")

    return FORMATIONS[name_lower](drone_count, **kwargs)


# ── Position Assignment (Hungarian Algorithm) ───────────────

def assign_drones_to_slots(
    drone_positions: list[GPSPosition],
    target_slots: list[FormationSlot],
    center_lat: float,
    center_lon: float,
) -> list[tuple[int, int]]:
    """
    Optimally assign drones to formation slots using the Hungarian algorithm.

    Minimizes total travel distance. Prevents path crossings.

    Args:
        drone_positions: Current GPS positions of each drone
        target_slots: Formation slots (local NED)
        center_lat, center_lon: Center point for the formation

    Returns:
        List of (drone_index, slot_index) pairs
    """
    try:
        from scipy.optimize import linear_sum_assignment
        import numpy as np
    except ImportError:
        logger.warning("scipy not installed, falling back to greedy assignment")
        return _greedy_assign(drone_positions, target_slots, center_lat, center_lon)

    n_drones = len(drone_positions)
    n_slots = len(target_slots)

    # Convert slots to GPS for distance calculation
    slot_gps = [
        _ned_to_gps(center_lat, center_lon, s.north_m, s.east_m, s.alt_m)
        for s in target_slots
    ]

    # Build cost matrix (distance in meters)
    size = max(n_drones, n_slots)
    cost = np.full((size, size), 1e9)  # pad with high cost

    for i in range(n_drones):
        for j in range(n_slots):
            cost[i][j] = _haversine_m(
                drone_positions[i].lat, drone_positions[i].lon,
                slot_gps[j].lat, slot_gps[j].lon,
            )

    row_ind, col_ind = linear_sum_assignment(cost)

    # Filter to valid assignments
    assignments = []
    for r, c in zip(row_ind, col_ind):
        if r < n_drones and c < n_slots:
            assignments.append((r, c))

    return assignments


def _greedy_assign(drone_positions, target_slots, center_lat, center_lon):
    """Fallback greedy assignment (no scipy)."""
    slot_gps = [
        _ned_to_gps(center_lat, center_lon, s.north_m, s.east_m, s.alt_m)
        for s in target_slots
    ]

    used_slots = set()
    assignments = []

    for i, dp in enumerate(drone_positions):
        best_j = -1
        best_dist = float("inf")
        for j, sg in enumerate(slot_gps):
            if j in used_slots:
                continue
            d = _haversine_m(dp.lat, dp.lon, sg.lat, sg.lon)
            if d < best_dist:
                best_dist = d
                best_j = j
        if best_j >= 0:
            assignments.append((i, best_j))
            used_slots.add(best_j)

    return assignments


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Haversine distance in meters between two GPS points."""
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))
