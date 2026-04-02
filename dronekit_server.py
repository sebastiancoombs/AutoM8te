#!/usr/bin/env python3
"""
AutoM8te DroneKit Server

Minimal HTTP API for controlling ArduPilot SITL drones via DroneKit.
DroneKit handles all MAVLink plumbing: connections, retries, heartbeats,
arming, takeoff, waypoints, mode changes.

Usage:
    python3 dronekit_server.py                    # 4 drones, ports 5762-5792
    python3 dronekit_server.py --count 8          # 8 drones
    python3 dronekit_server.py --base-port 5760   # Use SERIAL0 instead
"""

import argparse
import json
import math
import time
import threading
from flask import Flask, jsonify, request

from dronekit import connect, VehicleMode, LocationGlobalRelative

# Optional: pymavswarm for swarm-level operations
try:
    from pymavswarm import MavSwarm
    HAS_PYMAVSWARM = True
except ImportError:
    HAS_PYMAVSWARM = False

app = Flask(__name__)

# Global state
vehicles = {}  # drone_id -> Vehicle
swarm = None   # MavSwarm instance (if available)
vehicle_lock = threading.Lock()


def connect_drones(count, base_port, port_step):
    """Connect to SITL instances via DroneKit"""
    for i in range(count):
        drone_id = f"drone_{i}"
        port = base_port + i * port_step
        print(f"Connecting to {drone_id} on tcp:127.0.0.1:{port}...")
        # Retry loop — SITL may still be initializing
        for attempt in range(6):
            try:
                v = connect(f'tcp:127.0.0.1:{port}', wait_ready=True, timeout=30)
                vehicles[drone_id] = v
                print(f"  ✓ {drone_id} connected (mode: {v.mode.name}, armed: {v.armed})")
                break
            except Exception as e:
                if attempt < 5:
                    print(f"  Attempt {attempt+1} failed: {e} — retrying in 5s...")
                    time.sleep(5)
                else:
                    print(f"  ✗ {drone_id} failed after 6 attempts: {e}")


def get_drone_state(drone_id, v):
    """Get state dict for a vehicle"""
    loc = v.location.local_frame
    pos = [
        round(loc.north or 0, 2),
        round(loc.east or 0, 2),
        round(-(loc.down or 0), 2),  # Convert down to up
    ]
    vel = v.velocity or [0, 0, 0]
    return {
        "id": drone_id,
        "position": pos,
        "velocity": [round(x, 2) for x in vel],
        "heading": round(v.heading or 0, 1),
        "armed": v.armed,
        "mode": v.mode.name,
        "battery": v.battery.level if v.battery and v.battery.level else 100,
        "gps": v.gps_0.fix_type if v.gps_0 else 0,
        "ekf_ok": v.ekf_ok,
    }


# ─── Routes ──────────────────────────────────────────────────────────

@app.route('/api/status', methods=['GET'])
def status():
    states = {}
    for drone_id, v in vehicles.items():
        states[drone_id] = get_drone_state(drone_id, v)
    return jsonify({
        "drones": states,
        "count": len(vehicles),
        "backend": "dronekit",
    })


@app.route('/api/takeoff', methods=['POST'])
def takeoff():
    data = request.json or {}
    altitude = data.get('altitude', 5)
    drone_id = data.get('drone_id')  # None = all
    targets = [drone_id] if drone_id else list(vehicles.keys())
    results = {}

    for did in targets:
        v = vehicles.get(did)
        if not v:
            results[did] = "not found"
            continue
        try:
            v.mode = VehicleMode("GUIDED")
            # Wait for mode change
            for _ in range(10):
                if v.mode.name == "GUIDED":
                    break
                time.sleep(0.5)
            v.armed = True
            # Wait for arming
            for _ in range(10):
                if v.armed:
                    break
                time.sleep(0.5)
            v.simple_takeoff(altitude)
            results[did] = f"taking off to {altitude}m"
        except Exception as e:
            results[did] = f"error: {e}"

    return jsonify({"results": results})


@app.route('/api/land', methods=['POST'])
def land():
    data = request.json or {}
    drone_id = data.get('drone_id')
    targets = [drone_id] if drone_id else list(vehicles.keys())
    results = {}

    for did in targets:
        v = vehicles.get(did)
        if not v:
            results[did] = "not found"
            continue
        v.mode = VehicleMode("LAND")
        results[did] = "landing"

    return jsonify({"results": results})


@app.route('/api/goto', methods=['POST'])
def goto():
    """Move drone to relative position (north, east, altitude)"""
    data = request.json or {}
    drone_id = data.get('drone_id')
    north = data.get('north', 0)
    east = data.get('east', 0)
    alt = data.get('altitude', 10)
    targets = [drone_id] if drone_id else list(vehicles.keys())
    results = {}

    for did in targets:
        v = vehicles.get(did)
        if not v:
            results[did] = "not found"
            continue
        if not v.armed:
            results[did] = "not armed"
            continue
        # Use global relative location
        loc = v.location.global_relative_frame
        if loc and loc.lat and loc.lon:
            # Rough conversion: 1 degree lat ≈ 111111m
            new_lat = loc.lat + (north / 111111.0)
            new_lon = loc.lon + (east / (111111.0 * math.cos(math.radians(loc.lat))))
            target = LocationGlobalRelative(new_lat, new_lon, alt)
            v.simple_goto(target)
            results[did] = f"going to north={north}, east={east}, alt={alt}"
        else:
            results[did] = "no GPS fix"

    return jsonify({"results": results})


@app.route('/api/hover', methods=['POST'])
def hover():
    data = request.json or {}
    drone_id = data.get('drone_id')
    targets = [drone_id] if drone_id else list(vehicles.keys())
    results = {}

    for did in targets:
        v = vehicles.get(did)
        if not v:
            results[did] = "not found"
            continue
        v.mode = VehicleMode("LOITER")
        results[did] = "hovering"

    return jsonify({"results": results})


@app.route('/api/rtl', methods=['POST'])
def rtl():
    data = request.json or {}
    drone_id = data.get('drone_id')
    targets = [drone_id] if drone_id else list(vehicles.keys())
    results = {}

    for did in targets:
        v = vehicles.get(did)
        if not v:
            results[did] = "not found"
            continue
        v.mode = VehicleMode("RTL")
        results[did] = "returning to launch"

    return jsonify({"results": results})


@app.route('/api/emergency', methods=['POST'])
def emergency():
    """Emergency disarm all drones"""
    for did, v in vehicles.items():
        try:
            v.armed = False
        except:
            pass
    return jsonify({"status": "emergency disarm sent to all"})


# ─── Intercept Mission ───────────────────────────────────────────────

interceptor_coordinator = None

try:
    from interceptor.mission import InterceptCoordinator
    HAS_INTERCEPTOR = True
except ImportError:
    HAS_INTERCEPTOR = False


@app.route('/api/intercept', methods=['POST'])
def intercept():
    """
    Start intercept mission.
    
    Body: {
        "targets": {
            "enemy_0": {"position": [x,y,z], "velocity": [vx,vy,vz]},
            ...
        }
    }
    """
    if not HAS_INTERCEPTOR:
        return jsonify({"error": "interceptor module not available"}), 500

    global interceptor_coordinator
    data = request.json or {}
    targets = data.get("targets", {})

    if not targets:
        return jsonify({"error": "no targets provided"}), 400

    # Create coordinator if needed
    if interceptor_coordinator is None:
        interceptor_coordinator = InterceptCoordinator()
        for did in vehicles:
            interceptor_coordinator.add_interceptor(did, vehicles[did])

    # Update targets and assign
    interceptor_coordinator.update_targets(targets)
    assignments = interceptor_coordinator.execute_assignment()

    return jsonify({
        "status": "intercept mission started",
        "assignments": [(a, b) for a, b in assignments],
        "targets": len(targets),
        "interceptors": len(vehicles),
    })


@app.route('/api/intercept/status', methods=['GET'])
def intercept_status():
    """Get intercept mission status."""
    if interceptor_coordinator is None:
        return jsonify({"error": "no intercept mission active"}), 404
    return jsonify(interceptor_coordinator.get_status())


# ─── Main ────────────────────────────────────────────────────────────

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='AutoM8te DroneKit Server')
    parser.add_argument('--count', type=int, default=4, help='Number of drones')
    parser.add_argument('--base-port', type=int, default=5762, help='First SITL TCP port')
    parser.add_argument('--port-step', type=int, default=10, help='Port increment per drone')
    parser.add_argument('--http-port', type=int, default=8080, help='HTTP server port')
    args = parser.parse_args()

    print(f"AutoM8te DroneKit Server")
    print(f"  Drones: {args.count}")
    print(f"  Ports: {args.base_port} to {args.base_port + (args.count-1) * args.port_step}")
    print(f"  HTTP: :{args.http_port}")
    print(f"  pymavswarm: {'✓ available' if HAS_PYMAVSWARM else '✗ not installed'}")
    print()

    connect_drones(args.count, args.base_port, args.port_step)

    if not vehicles:
        print("No drones connected. Exiting.")
        exit(1)

    print(f"\n✓ {len(vehicles)} drones connected. Starting HTTP server...\n")
    app.run(host='0.0.0.0', port=args.http_port, debug=False)
