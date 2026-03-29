"""
Consolidated LLM-Facing Tools — Clean API for AI agents.

8 tools instead of 33 endpoints. Each tool is a router that dispatches
to the underlying CommandRouter, SwarmMatrix, and FlightPath engines.
"""

import asyncio
import math
import logging
import numpy as np
from typing import Optional
from concurrent.futures import ThreadPoolExecutor
from functools import partial

from .drone_registry import DroneRegistry
from .command_router import CommandRouter
from .formations import (
    SwarmMatrix, get_formation, assign_drones_to_slots, GPSPosition,
    _ned_to_gps, get_easing, EASING_FUNCTIONS, FORMATIONS,
)
from .flight_paths import FlightPath, PATH_GENERATORS, get_path_generator

logger = logging.getLogger(__name__)


class DroneTools:
    """
    Consolidated drone control tools for LLM agents.

    8 tools covering all drone operations:
    1. command - Single drone commands (takeoff, land, hover, etc.)
    2. move - Move a drone along any path with easing
    3. query - Get drone telemetry
    4. swarm - Fan any command to all/subset drones
    5. formation - Any formation with transforms + transitions
    6. search - Search patterns (single or swarm)
    7. stop - Stop any running path/transition/search
    8. status - List drones, capabilities, path types
    """

    # Commands allowed for tool 1 (command) — no position/movement
    COMMANDS = ['takeoff', 'land', 'hover', 'set_yaw', 'change_speed',
                'change_altitude', 'set_home', 'pause', 'resume',
                'return_home', 'emergency_stop']

    def __init__(self, registry: DroneRegistry, router: CommandRouter, executor: ThreadPoolExecutor):
        self.registry = registry
        self.router = router
        self._executor = executor
        self._path_tasks: dict[str, asyncio.Task] = {}
        self._transition_task: Optional[asyncio.Task] = None

    async def _run_sync(self, fn, *args, **kwargs):
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(self._executor, partial(fn, *args, **kwargs))

    # ── Tool 1: command ──────────────────────────────────────

    async def command(self, drone_id: str, action: str, **params) -> dict:
        """
        Execute a single-drone command.

        Actions: takeoff, land, hover, set_yaw, change_speed, change_altitude,
                 set_home, pause, resume, return_home, emergency_stop

        Params depend on action:
          takeoff: altitude_m (default 5)
          set_yaw: heading_deg, relative=False, speed_degs=30
          change_speed: speed_ms, speed_type='ground'
          change_altitude: alt_m
          set_home: lat=None, lon=None, alt=None (None=use current)
          Others: no extra params
        """
        if action not in self.COMMANDS:
            return {'status': 'error', 'message': f'Unknown action "{action}". Available: {self.COMMANDS}'}

        method = getattr(self.router, action)

        # Build kwargs based on action
        kwargs = {'drone_id': drone_id}
        if action == 'takeoff':
            kwargs['altitude_m'] = params.get('altitude_m', 5.0)
        elif action == 'set_yaw':
            kwargs['heading_deg'] = params.get('heading_deg', 0)
            kwargs['relative'] = params.get('relative', False)
            kwargs['speed_degs'] = params.get('speed_degs', 30.0)
        elif action == 'change_speed':
            kwargs['speed_ms'] = params.get('speed_ms', 5.0)
            kwargs['speed_type'] = params.get('speed_type', 'ground')
        elif action == 'change_altitude':
            kwargs['alt_m'] = params.get('alt_m', 10.0)
        elif action == 'set_home':
            kwargs['lat'] = params.get('lat')
            kwargs['lon'] = params.get('lon')
            kwargs['alt'] = params.get('alt')

        return await self._run_sync(method, **kwargs)

    # ── Tool 2: move ─────────────────────────────────────────

    async def move(self, drone_id: str, target: dict = None, path: str = None,
                   path_params: dict = None, waypoints: list = None,
                   easing: str = 'ease_in_out', duration_s: float = 10.0,
                   loop: bool = False) -> dict:
        """
        Move a drone. Three modes:

        1. Simple goto: target={'lat': x, 'lon': y, 'alt_m': z}
           Sends a single goto command (instant, no path).

        2. Named path: path='s_curve', path_params={'start': [0,0,10], 'end': [100,0,10]}
           Uses built-in path generator + easing.

        3. Custom waypoints: waypoints=[[n,e,a], [n,e,a], ...]
           Arbitrary path in local NED coords relative to drone's current position.

        easing: ease_in_out, elastic, spring, linear, etc.
        duration_s: total flight time for path modes
        loop: repeat path continuously (path/waypoints mode only)
        """
        # Mode 1: Simple goto
        if target and not path and not waypoints:
            # Support both GPS {lat, lon} and NED {north_m, east_m, alt_m}
            if 'lat' in target and 'lon' in target:
                # GPS mode — direct goto
                result = await self._run_sync(
                    self.router.goto, drone_id,
                    target['lat'], target['lon'], target.get('alt_m', 10.0),
                    target.get('heading_deg', 0.0)
                )
                return result
            elif 'north_m' in target or 'east_m' in target:
                # NED mode — convert relative offsets to GPS
                state = self.registry.get_drone(drone_id)
                origin_lat = state.lat
                origin_lon = state.lon
                north = target.get('north_m', 0.0)
                east = target.get('east_m', 0.0)
                alt = target.get('alt_m', state.relative_alt_mm / 1000.0)
                gps = _ned_to_gps(origin_lat, origin_lon, north, east, alt)
                result = await self._run_sync(
                    self.router.goto, drone_id,
                    gps.lat, gps.lon, gps.alt_m,
                    target.get('heading_deg', 0.0)
                )
                return result
            else:
                return {'status': 'error', 'message': 'target must have {lat, lon} or {north_m, east_m, alt_m}'}

        # Get drone's current position for GPS conversion
        state = self.registry.get_drone(drone_id)
        origin_lat = state.lat
        origin_lon = state.lon

        # Mode 2: Named path
        if path:
            try:
                generator = get_path_generator(path)
            except ValueError as e:
                return {'status': 'error', 'message': str(e)}
            flight_path = generator(**(path_params or {}))
        # Mode 3: Custom waypoints
        elif waypoints:
            flight_path = FlightPath.from_points(waypoints)
        else:
            return {'status': 'error', 'message': 'Provide target, path, or waypoints'}

        # Apply easing
        flight_path = flight_path.with_easing(easing)
        gps_waypoints = flight_path.to_gps(origin_lat, origin_lon)

        # Cancel existing path for this drone
        if drone_id in self._path_tasks:
            self._path_tasks[drone_id].cancel()

        # Spawn background path executor
        async def execute():
            interval = duration_s / max(1, len(gps_waypoints) - 1)
            while True:
                for wp in gps_waypoints:
                    await self._run_sync(self.router.goto, drone_id, wp.lat, wp.lon, wp.alt_m)
                    await asyncio.sleep(interval)
                if not loop:
                    break
            if drone_id in self._path_tasks:
                del self._path_tasks[drone_id]

        self._path_tasks[drone_id] = asyncio.create_task(execute())

        return {
            'status': 'success',
            'message': f'{drone_id} following {path or "custom"} path ({len(gps_waypoints)} waypoints, {duration_s}s)',
            'drone_id': drone_id,
            'path_type': path or 'custom',
            'waypoints': len(gps_waypoints),
            'duration_s': duration_s,
            'easing': easing,
            'loop': loop,
        }

    # ── Tool 3: query ────────────────────────────────────────

    async def query(self, drone_id: str = None) -> dict:
        """
        Get drone telemetry.

        drone_id: specific drone, or None for all drones.
        """
        if drone_id:
            try:
                telemetry = self.registry.get_telemetry(drone_id)
                return {'status': 'success', 'telemetry': telemetry}
            except KeyError as e:
                return {'status': 'error', 'message': str(e)}
        else:
            telemetry = self.registry.get_all_telemetry()
            return {'status': 'success', 'count': len(telemetry), 'drones': telemetry}

    # ── Tool 4: swarm ────────────────────────────────────────

    async def swarm(self, action: str, params: dict = None,
                    drone_ids: list = None, reference_drone: str = None) -> dict:
        """
        Fan any single-drone command to all or a subset of drones.

        action: any single-drone command name (takeoff, land, hover, set_yaw, etc.)
        params: command parameters (drone_id auto-filled per drone)
        drone_ids: target subset (None = all)
        reference_drone: resolve this drone's position as target
          - with goto: all drones fly to reference drone
          - with set_yaw: each drone faces the reference drone
          - with change_altitude: match reference drone's altitude
        """
        return await self._run_sync(
            self.router.swarm_command, action, params, drone_ids, reference_drone
        )

    # ── Tool 5: formation ────────────────────────────────────

    async def formation(self, name: str = None, coordinates: list = None,
                        spacing_m: float = 10.0, alt_m: float = 10.0,
                        heading_deg: float = 0.0, center_lat: float = None,
                        center_lon: float = None, transforms: list = None,
                        transition_to: str = None, transition_coords: list = None,
                        easing: str = 'ease_in_out', duration_s: float = 5.0,
                        stagger: float = 0.0) -> dict:
        """
        Set a formation. Three modes:

        1. Named: name='circle', spacing_m=15
        2. Custom: coordinates=[[n,e,a], [n,e,a], ...]
        3. Transition: name='line' + transition_to='circle' (animated morph)

        Optional transforms applied in order:
          [{'rotate_z': 45}, {'scale': 1.5}, {'translate': {'north_m': 10}}]

        Available formations: line, v, circle, grid, stack
        Available easings: linear, ease_in_out, elastic, spring, etc.
        stagger: 0-0.5 for wave effect during transitions
        """
        drone_ids = self.registry.list_drones()
        if len(drone_ids) < 2:
            return {'status': 'error', 'message': 'Formation requires 2+ drones'}

        n = len(drone_ids)

        # Get current positions
        current_positions = []
        for did in drone_ids:
            state = self.registry.get_drone(did)
            current_positions.append(GPSPosition(
                lat=state.lat, lon=state.lon,
                alt_m=state.relative_alt_mm / 1000.0,
            ))

        if center_lat is None or center_lon is None:
            center_lat = sum(p.lat for p in current_positions) / n
            center_lon = sum(p.lon for p in current_positions) / n

        # ── Transition mode ──
        if transition_to or transition_coords:
            # Build 'from' matrix from current positions or named formation
            if name:
                try:
                    name_l = name.lower()
                    if name_l in ('circle', 'ring'):
                        from_kw = {'radius_m': spacing_m, 'alt_m': alt_m}
                    elif name_l in ('stack', 'column'):
                        from_kw = {'vertical_spacing_m': spacing_m, 'base_alt_m': alt_m}
                    else:
                        from_kw = {'spacing_m': spacing_m, 'alt_m': alt_m}
                    from_matrix = SwarmMatrix.from_formation(name, n, **from_kw)
                except Exception:
                    from_matrix = SwarmMatrix(np.array([[p.lat, p.lon, p.alt_m] for p in current_positions]))
            else:
                # Use current positions as NED offsets from center
                from_slots = []
                for p in current_positions:
                    north = (p.lat - center_lat) * 111320
                    east = (p.lon - center_lon) * 111320 * math.cos(math.radians(center_lat))
                    from_slots.append([north, east, p.alt_m])
                from_matrix = SwarmMatrix(np.array(from_slots))

            # Build 'to' matrix
            if transition_to:
                to_lower = transition_to.lower()
                if to_lower in ('circle', 'ring'):
                    to_kwargs = {'radius_m': spacing_m, 'alt_m': alt_m}
                elif to_lower in ('stack', 'column'):
                    to_kwargs = {'vertical_spacing_m': spacing_m, 'base_alt_m': alt_m}
                else:
                    to_kwargs = {'spacing_m': spacing_m, 'alt_m': alt_m}
                if to_lower in ('line', 'v', 'vee'):
                    to_kwargs['heading_deg'] = heading_deg
                to_matrix = SwarmMatrix.from_formation(transition_to, n, **to_kwargs)
            elif transition_coords:
                to_matrix = SwarmMatrix.from_coordinates(transition_coords)

            # Apply transforms to target
            if transforms:
                for t in transforms:
                    for op, val in t.items():
                        if op == 'rotate_z': to_matrix = to_matrix.rotate_z(val)
                        elif op == 'rotate_x': to_matrix = to_matrix.rotate_x(val)
                        elif op == 'rotate_y': to_matrix = to_matrix.rotate_y(val)
                        elif op == 'scale': to_matrix = to_matrix.scale(val)
                        elif op == 'mirror_north': to_matrix = to_matrix.mirror_north()
                        elif op == 'mirror_east': to_matrix = to_matrix.mirror_east()
                        elif op == 'translate':
                            to_matrix = to_matrix.translate(**val if isinstance(val, dict) else {})
                        elif op == 'set_altitude': to_matrix = to_matrix.set_altitude(val)

            # Generate transition frames
            frames = from_matrix.transition_steps(to_matrix, num_steps=max(5, int(duration_s * 4)), easing=easing, stagger=stagger)

            # Cancel existing transition
            if self._transition_task and not self._transition_task.done():
                self._transition_task.cancel()

            # Execute transition in background
            async def run_transition():
                interval = duration_s / max(1, len(frames) - 1)
                for frame in frames:
                    gps_positions = frame.to_gps(center_lat, center_lon)
                    slots = frame.to_slots()
                    assignments = assign_drones_to_slots(current_positions, slots, center_lat, center_lon)
                    # Parallel dispatch — all drones move simultaneously
                    await asyncio.gather(*[
                        self._run_sync(self.router.goto, drone_ids[di], gps_positions[si].lat, gps_positions[si].lon, gps_positions[si].alt_m)
                        for di, si in assignments
                    ])
                    await asyncio.sleep(interval)

            self._transition_task = asyncio.create_task(run_transition())

            return {
                'status': 'success',
                'message': f'Transitioning {n} drones from {name or "current"} to {transition_to or "custom"} ({duration_s}s, {easing})',
                'drone_count': n,
                'easing': easing,
                'stagger': stagger,
                'frames': len(frames),
                'duration_s': duration_s,
            }

        # ── Static formation mode ──
        if coordinates:
            matrix = SwarmMatrix.from_coordinates(coordinates)
        elif name:
            # Map generic params to formation-specific kwargs
            name_lower = name.lower()
            if name_lower in ('circle', 'ring'):
                form_kwargs = {'radius_m': spacing_m, 'alt_m': alt_m}
            elif name_lower in ('stack', 'column'):
                form_kwargs = {'vertical_spacing_m': spacing_m, 'base_alt_m': alt_m}
            else:
                form_kwargs = {'spacing_m': spacing_m, 'alt_m': alt_m}
            if name_lower in ('line', 'v', 'vee'):
                form_kwargs['heading_deg'] = heading_deg
            matrix = SwarmMatrix.from_formation(name, n, **form_kwargs)
        else:
            return {'status': 'error', 'message': 'Provide name or coordinates'}

        # Apply transforms
        if transforms:
            for t in transforms:
                for op, val in t.items():
                    if op == 'rotate_z': matrix = matrix.rotate_z(val)
                    elif op == 'rotate_x': matrix = matrix.rotate_x(val)
                    elif op == 'rotate_y': matrix = matrix.rotate_y(val)
                    elif op == 'scale': matrix = matrix.scale(val)
                    elif op == 'mirror_north': matrix = matrix.mirror_north()
                    elif op == 'mirror_east': matrix = matrix.mirror_east()
                    elif op == 'translate':
                        matrix = matrix.translate(**val if isinstance(val, dict) else {})
                    elif op == 'set_altitude': matrix = matrix.set_altitude(val)

        # Check separation
        ok, min_dist = matrix.check_separation(3.0)
        warning = None if ok else f'Warning: minimum separation {min_dist:.1f}m is under 3m'

        # Assign and send
        slots = matrix.to_slots()
        gps_positions = matrix.to_gps(center_lat, center_lon)
        assignments = assign_drones_to_slots(current_positions, slots, center_lat, center_lon)

        # Parallel dispatch — all drones move simultaneously
        results = await asyncio.gather(*[
            self._run_sync(
                self.router.goto, drone_ids[di], gps_positions[si].lat, gps_positions[si].lon, gps_positions[si].alt_m, heading_deg
            )
            for di, si in assignments
        ])

        response = {
            'status': 'success',
            'message': f'Formation "{name or "custom"}" set for {n} drones',
            'formation': name or 'custom',
            'drone_count': n,
            'bounding_box': matrix.bounding_box(),
            'min_separation': min_dist if not ok else matrix.min_separation(),
        }
        if warning:
            response['warning'] = warning
        return response

    # ── Tool 6: search ───────────────────────────────────────

    async def search(self, area: dict, drone_id: str = None,
                     pattern: str = 'grid', alt_m: float = 20.0,
                     swath_width_m: float = 30.0) -> dict:
        """
        Search an area.

        area: {min_lat, min_lon, max_lat, max_lon}
        drone_id: specific drone, or None for all drones (swarm search)
        pattern: grid, spiral, expanding
        """
        if drone_id:
            return await self._run_sync(
                self.router.search, drone_id,
                area['min_lat'], area['min_lon'], area['max_lat'], area['max_lon'],
                alt_m, pattern, swath_width_m
            )
        else:
            return await self._run_sync(
                self.router.search_swarm,
                area['min_lat'], area['min_lon'], area['max_lat'], area['max_lon'],
                alt_m, pattern, swath_width_m
            )

    # ── Tool 7: stop ─────────────────────────────────────────

    async def stop(self, drone_id: str = None, what: str = 'all') -> dict:
        """
        Stop drone activity.

        drone_id: specific drone, or None for all
        what: 'path' (stop path only), 'transition' (stop formation transition), 'all' (everything + hover)
        """
        results = []

        if what in ('path', 'all'):
            if drone_id:
                if drone_id in self._path_tasks:
                    self._path_tasks[drone_id].cancel()
                    del self._path_tasks[drone_id]
                    results.append(f'{drone_id} path cancelled')
            else:
                for did in list(self._path_tasks.keys()):
                    self._path_tasks[did].cancel()
                del_keys = list(self._path_tasks.keys())
                self._path_tasks.clear()
                results.append(f'All paths cancelled ({len(del_keys)} drones)')

        if what in ('transition', 'all'):
            if self._transition_task and not self._transition_task.done():
                self._transition_task.cancel()
                self._transition_task = None
                results.append('Transition cancelled')

        if what in ('all',):
            if drone_id:
                await self._run_sync(self.router.hover, drone_id)
                results.append(f'{drone_id} hovering')
            else:
                # Parallel hover — all drones stop simultaneously
                all_drones = self.registry.list_drones()
                await asyncio.gather(*[
                    self._run_sync(self.router.hover, did)
                    for did in all_drones
                ])
                results.append(f'All {len(all_drones)} drones hovering')

        return {
            'status': 'success',
            'message': '; '.join(results) if results else 'Nothing to stop',
            'actions': results,
        }

    # ── Tool 8: status ───────────────────────────────────────

    async def status(self) -> dict:
        """
        Get system status: registered drones, capabilities, running tasks.
        """
        drone_ids = self.registry.list_drones()
        telemetry = self.registry.get_all_telemetry()

        return {
            'status': 'success',
            'drone_count': len(drone_ids),
            'drones': telemetry,
            'running_paths': list(self._path_tasks.keys()),
            'transition_active': bool(self._transition_task and not self._transition_task.done()),
            'capabilities': {
                'commands': self.COMMANDS,
                'path_types': list(PATH_GENERATORS.keys()),
                'formations': list(FORMATIONS.keys()),
                'easings': list(EASING_FUNCTIONS.keys()),
            },
        }
