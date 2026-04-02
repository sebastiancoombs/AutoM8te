#!/usr/bin/env python3
"""
DroneKit Bridge — HTTP API backed by real ArduPilot SITL instances.

Provides the same /api/status, /api/takeoff, /api/goto, /api/land, etc.
endpoints as the supervisor controller, but sends MAVLink commands to
ArduPilot SITL via DroneKit. Real autopilot, real physics.

Usage: python3 dronekit_bridge.py [--drones 4] [--base-port 5760]
"""

import argparse
import json
import threading
import time
from http.server import HTTPServer, BaseHTTPRequestHandler

from dronekit import connect, VehicleMode, LocationGlobalRelative

# ─── Globals ─────────────────────────────────────────────────────────
vehicles = {}  # {drone_id: Vehicle}
lock = threading.Lock()


def connect_drones(count, base_port):
    """Connect to N SITL instances via UDP (MAVProxy --out ports)."""
    for i in range(count):
        port = base_port + i * 10
        drone_id = f"drone_{i}"
        addr = f"udp:127.0.0.1:{port}"
        print(f"[Bridge] Connecting {drone_id} → {addr}...")
        try:
            vehicle = connect(addr, wait_ready=True, timeout=60)
            vehicles[drone_id] = vehicle
            print(f"[Bridge] ✓ {drone_id} connected (mode={vehicle.mode.name}, armed={vehicle.armed})")
        except Exception as e:
            print(f"[Bridge] ✗ {drone_id} failed: {e}")


def arm_and_takeoff(vehicle, alt):
    """Arms vehicle and flies to target altitude."""
    vehicle.mode = VehicleMode("GUIDED")
    vehicle.armed = True

    # Wait for arming
    for _ in range(30):
        if vehicle.armed:
            break
        time.sleep(1)

    if not vehicle.armed:
        return False

    vehicle.simple_takeoff(alt)
    return True


# ─── HTTP API ────────────────────────────────────────────────────────

class APIHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Silence request logs

    def _json(self, code, data):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def _body(self):
        length = int(self.headers.get('Content-Length', 0))
        return json.loads(self.rfile.read(length)) if length else {}

    def do_GET(self):
        if self.path == '/api/status':
            states = {}
            with lock:
                for did, v in vehicles.items():
                    loc = v.location.global_relative_frame
                    vel = v.velocity or [0, 0, 0]
                    states[did] = {
                        "id": did,
                        "position": [loc.lat, loc.lon, loc.alt or 0],
                        "velocity": vel,
                        "armed": v.armed,
                        "mode": v.mode.name,
                        "battery": v.battery.voltage if v.battery else None,
                        "gps": v.gps_0.fix_type if v.gps_0 else 0,
                    }
            self._json(200, {
                "drones": states,
                "count": len(states),
                "backend": "dronekit-sitl",
            })
        elif self.path == '/health':
            self._json(200, {"status": "ok", "drones": len(vehicles)})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        data = self._body()

        if self.path == '/api/takeoff':
            alt = data.get('altitude', 5)
            drone_id = data.get('drone_id')
            targets = [drone_id] if drone_id else list(vehicles.keys())
            results = {}
            for did in targets:
                v = vehicles.get(did)
                if v:
                    ok = arm_and_takeoff(v, alt)
                    results[did] = f"taking off to {alt}m" if ok else "failed to arm"
                else:
                    results[did] = "not found"
            self._json(200, {"results": results})

        elif self.path == '/api/land':
            drone_id = data.get('drone_id')
            targets = [drone_id] if drone_id else list(vehicles.keys())
            results = {}
            for did in targets:
                v = vehicles.get(did)
                if v:
                    v.mode = VehicleMode("LAND")
                    results[did] = "landing"
                else:
                    results[did] = "not found"
            self._json(200, {"results": results})

        elif self.path == '/api/goto':
            drone_id = data.get('drone_id')
            lat = data.get('lat')
            lon = data.get('lon')
            alt = data.get('altitude', 10)
            # Relative move (meters north/east)
            north = data.get('north', 0)
            east = data.get('east', 0)
            targets = [drone_id] if drone_id else list(vehicles.keys())
            results = {}
            for did in targets:
                v = vehicles.get(did)
                if not v:
                    results[did] = "not found"
                    continue
                if not v.armed:
                    v.mode = VehicleMode("GUIDED")
                    v.armed = True
                    for _ in range(10):
                        if v.armed:
                            break
                        time.sleep(0.5)
                    if not v.armed:
                        results[did] = "failed to arm"
                        continue
                if lat and lon:
                    # Absolute position
                    v.simple_goto(LocationGlobalRelative(lat, lon, alt))
                    results[did] = f"going to ({lat}, {lon}, {alt})"
                else:
                    # Relative offset — convert meters to lat/lon delta
                    loc = v.location.global_relative_frame
                    new_lat = loc.lat + (north / 111111.0)
                    new_lon = loc.lon + (east / (111111.0 * abs(
                        __import__('math').cos(__import__('math').radians(loc.lat)))))
                    v.simple_goto(LocationGlobalRelative(new_lat, new_lon, alt))
                    results[did] = f"going N={north}m E={east}m alt={alt}m"
            self._json(200, {"results": results})

        elif self.path == '/api/goto_abs':
            # Same as goto with lat/lon
            return self.do_POST.__func__(self)

        elif self.path == '/api/hover':
            drone_id = data.get('drone_id')
            targets = [drone_id] if drone_id else list(vehicles.keys())
            results = {}
            for did in targets:
                v = vehicles.get(did)
                if v:
                    v.mode = VehicleMode("GUIDED")
                    # Send current position as goto to hold
                    loc = v.location.global_relative_frame
                    v.simple_goto(LocationGlobalRelative(loc.lat, loc.lon, loc.alt))
                    results[did] = "hovering"
                else:
                    results[did] = "not found"
            self._json(200, {"results": results})

        elif self.path == '/api/formation':
            # Formation expects absolute positions — but SITL uses lat/lon
            # The intent layer should convert offsets to lat/lon before calling
            positions = data.get('positions', {})
            results = {}
            for did, pos in positions.items():
                v = vehicles.get(did)
                if not v:
                    results[did] = "not found"
                    continue
                if not v.armed:
                    v.mode = VehicleMode("GUIDED")
                    v.armed = True
                    for _ in range(10):
                        if v.armed:
                            break
                        time.sleep(0.5)
                if len(pos) == 3:
                    # Treat as relative meters from home
                    home = v.home_location
                    if home:
                        lat = home.lat + (pos[0] / 111111.0)
                        lon = home.lon + (pos[1] / 111111.0)
                    else:
                        loc = v.location.global_relative_frame
                        lat = loc.lat + (pos[0] / 111111.0)
                        lon = loc.lon + (pos[1] / 111111.0)
                    alt = pos[2]
                    v.simple_goto(LocationGlobalRelative(lat, lon, alt))
                    results[did] = f"moving to offset ({pos[0]}, {pos[1]}, {pos[2]})"
            self._json(200, {"results": results})

        elif self.path == '/api/emergency':
            for v in vehicles.values():
                v.armed = False
            self._json(200, {"status": "all drones disarmed"})

        else:
            self._json(404, {"error": "not found"})


def main():
    parser = argparse.ArgumentParser(description='DroneKit Bridge')
    parser.add_argument('--drones', type=int, default=4)
    parser.add_argument('--base-port', type=int, default=14550)
    parser.add_argument('--http-port', type=int, default=8080)
    args = parser.parse_args()

    print(f"[Bridge] Connecting to {args.drones} SITL instances (base port {args.base_port})...")
    connect_drones(args.drones, args.base_port)

    if not vehicles:
        print("[Bridge] No drones connected! Are SITL instances running?")
        return

    server = HTTPServer(('0.0.0.0', args.http_port), APIHandler)
    print(f"[Bridge] HTTP API on http://localhost:{args.http_port}")
    print(f"[Bridge] {len(vehicles)} drones ready")
    server.serve_forever()


if __name__ == "__main__":
    main()
