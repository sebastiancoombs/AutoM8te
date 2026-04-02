#!/usr/bin/env python3
"""
AutoM8te Supervisor Controller

One process controls ALL drones via Webots Supervisor API.
No SITL needed. Webots handles physics.

Exposes HTTP API on port 8080 for external control.
Runs inside Webots as a controller.
"""

import os
import sys
import math
import json
import threading
import time
from http.server import HTTPServer, BaseHTTPRequestHandler

# Webots controller path
WEBOTS_HOME = os.environ.get("WEBOTS_HOME", "/Applications/Webots.app")
sys.path.append(f"{WEBOTS_HOME}/lib/controller/python")

from controller import Supervisor

# ─── Drone State ─────────────────────────────────────────────────────

class DroneState:
    def __init__(self, drone_id, node, trans_field, rot_field):
        self.id = drone_id
        self.node = node
        self.trans_field = trans_field
        self.rot_field = rot_field
        self.target = None          # Target position [x, y, z]
        self.velocity = [0, 0, 0]
        self.speed = 5.0            # m/s
        self.armed = False
        self.mode = "IDLE"          # IDLE, GUIDED, LANDING, HOVER

    @property
    def position(self):
        return list(self.trans_field.getSFVec3f())

    @position.setter
    def position(self, pos):
        self.trans_field.setSFVec3f(pos)

    def move_toward_target(self, dt):
        """Move drone toward target position at configured speed."""
        if self.target is None or not self.armed:
            self.velocity = [0, 0, 0]
            return

        pos = self.position
        dx = self.target[0] - pos[0]
        dy = self.target[1] - pos[1]
        dz = self.target[2] - pos[2]
        dist = math.sqrt(dx*dx + dy*dy + dz*dz)

        if dist < 0.3:
            # Arrived
            self.velocity = [0, 0, 0]
            self.mode = "HOVER"
            return

        # Normalize and scale by speed
        scale = min(self.speed, dist / dt) / max(dist, 0.001)
        vx = dx * scale
        vy = dy * scale
        vz = dz * scale

        self.velocity = [vx, vy, vz]

        # Update position
        new_pos = [
            pos[0] + vx * dt,
            pos[1] + vy * dt,
            pos[2] + vz * dt,
        ]
        self.position = new_pos

    def to_dict(self):
        pos = self.position
        return {
            "id": self.id,
            "position": [round(p, 2) for p in pos],
            "velocity": [round(v, 2) for v in self.velocity],
            "armed": self.armed,
            "mode": self.mode,
            "target": self.target,
        }


# ─── Global State ────────────────────────────────────────────────────

drones = {}       # drone_id -> DroneState
supervisor = None
lock = threading.Lock()


# ─── HTTP API ────────────────────────────────────────────────────────

class APIHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Suppress default logging

    def _json(self, code, data):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def _read_body(self):
        length = int(self.headers.get('Content-Length', 0))
        if length:
            return json.loads(self.rfile.read(length))
        return {}

    def do_GET(self):
        if self.path == '/api/status':
            with lock:
                states = {did: d.to_dict() for did, d in drones.items()}
            self._json(200, {"drones": states, "count": len(states), "backend": "webots-supervisor"})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        data = self._read_body()

        if self.path == '/api/takeoff':
            alt = data.get('altitude', 5)
            drone_id = data.get('drone_id')
            targets = [drone_id] if drone_id else list(drones.keys())
            results = {}
            with lock:
                for did in targets:
                    d = drones.get(did)
                    if d:
                        pos = d.position
                        d.armed = True
                        d.mode = "GUIDED"
                        d.target = [pos[0], pos[1], alt]
                        results[did] = f"taking off to {alt}m"
                    else:
                        results[did] = "not found"
            self._json(200, {"results": results})

        elif self.path == '/api/land':
            drone_id = data.get('drone_id')
            targets = [drone_id] if drone_id else list(drones.keys())
            results = {}
            with lock:
                for did in targets:
                    d = drones.get(did)
                    if d:
                        pos = d.position
                        d.mode = "LANDING"
                        d.target = [pos[0], pos[1], 0.4]  # Ground level
                        results[did] = "landing"
                    else:
                        results[did] = "not found"
            self._json(200, {"results": results})

        elif self.path == '/api/goto':
            drone_id = data.get('drone_id')
            north = data.get('north', 0)
            east = data.get('east', 0)
            alt = data.get('altitude', 10)
            speed = data.get('speed', 5)
            targets = [drone_id] if drone_id else list(drones.keys())
            results = {}
            with lock:
                for did in targets:
                    d = drones.get(did)
                    if d:
                        if not d.armed:
                            results[did] = "not armed"
                            continue
                        pos = d.position
                        d.target = [pos[0] + north, pos[1] + east, alt]
                        d.speed = speed
                        d.mode = "GUIDED"
                        results[did] = f"going to N={north} E={east} alt={alt}"
                    else:
                        results[did] = "not found"
            self._json(200, {"results": results})

        elif self.path == '/api/goto_abs':
            drone_id = data.get('drone_id')
            x = data.get('x', 0)
            y = data.get('y', 0)
            z = data.get('z', 10)
            speed = data.get('speed', 5)
            targets = [drone_id] if drone_id else list(drones.keys())
            results = {}
            with lock:
                for did in targets:
                    d = drones.get(did)
                    if d:
                        if not d.armed:
                            results[did] = "not armed"
                            continue
                        d.target = [x, y, z]
                        d.speed = speed
                        d.mode = "GUIDED"
                        results[did] = f"going to ({x}, {y}, {z})"
                    else:
                        results[did] = "not found"
            self._json(200, {"results": results})

        elif self.path == '/api/hover':
            drone_id = data.get('drone_id')
            targets = [drone_id] if drone_id else list(drones.keys())
            results = {}
            with lock:
                for did in targets:
                    d = drones.get(did)
                    if d:
                        d.target = None
                        d.mode = "HOVER"
                        results[did] = "hovering"
                    else:
                        results[did] = "not found"
            self._json(200, {"results": results})

        elif self.path == '/api/formation':
            # Direct formation: provide absolute positions per drone
            positions = data.get('positions', {})  # {drone_id: [x, y, z]}
            speed = data.get('speed', 5)
            results = {}
            with lock:
                for did, pos in positions.items():
                    d = drones.get(did)
                    if d and d.armed:
                        d.target = pos
                        d.speed = speed
                        d.mode = "GUIDED"
                        results[did] = f"moving to ({pos[0]:.1f}, {pos[1]:.1f}, {pos[2]:.1f})"
                    elif d:
                        results[did] = "not armed"
                    else:
                        results[did] = "not found"
            self._json(200, {"results": results})

        elif self.path == '/api/emergency':
            with lock:
                for d in drones.values():
                    d.armed = False
                    d.target = None
                    d.mode = "IDLE"
            self._json(200, {"status": "all drones disarmed"})

        else:
            self._json(404, {"error": "not found"})


def start_http(port=8080):
    server = HTTPServer(('0.0.0.0', port), APIHandler)
    print(f"[AutoM8te] HTTP API on http://localhost:{port}")
    server.serve_forever()


# ─── Main ────────────────────────────────────────────────────────────

def main():
    global supervisor

    supervisor = Supervisor()
    timestep = int(supervisor.getBasicTimeStep())
    dt = timestep / 1000.0  # Convert ms to seconds

    # Find all DRONE_N nodes
    i = 0
    while True:
        def_name = f"DRONE_{i}"
        node = supervisor.getFromDef(def_name)
        if node is None:
            break
        trans = node.getField("translation")
        rot = node.getField("rotation")
        drone = DroneState(f"drone_{i}", node, trans, rot)
        drones[f"drone_{i}"] = drone
        print(f"[AutoM8te] Found {def_name} at {drone.position}")
        i += 1

    if not drones:
        print("[AutoM8te] No drones found! Check DEF names in world file.")
        return

    print(f"[AutoM8te] {len(drones)} drones registered")

    # Start HTTP server in background thread
    http_thread = threading.Thread(target=start_http, daemon=True)
    http_thread.start()

    print(f"[AutoM8te] Supervisor running (dt={dt}s)")
    print(f"[AutoM8te] Ready — test with: curl http://localhost:8080/api/status")

    # Main physics loop
    while supervisor.step(timestep) != -1:
        with lock:
            for drone in drones.values():
                drone.move_toward_target(dt)


if __name__ == "__main__":
    main()
