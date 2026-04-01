#!/usr/bin/env python3
"""
ArduPilot SITL Bridge

Connects to multiple ArduPilot SITL instances via pymavlink.
Receives commands via stdin (JSON), sends telemetry via stdout (JSON).

Usage:
  python3 ardupilot_bridge.py --ports 14550,14560,14570,14580
"""

import sys
import json
import time
import argparse
import threading
from queue import Queue

try:
    from pymavlink import mavutil
except ImportError:
    print(json.dumps({"error": "pymavlink not installed. Run: pip install pymavlink"}), flush=True)
    sys.exit(1)


class DroneConnection:
    def __init__(self, drone_id, port):
        self.drone_id = drone_id
        self.port = port
        self.connection = None
        self.position = [0, 0, 0]
        self.velocity = [0, 0, 0]
        self.heading = 0
        self.armed = False
        self.mode = "UNKNOWN"
        self.battery = 100
        self.home = None
        
    def connect(self):
        """Connect to SITL instance"""
        try:
            self.connection = mavutil.mavlink_connection(f'tcp:127.0.0.1:{self.port}')
            self.connection.wait_heartbeat(timeout=30)
            print(f"Connected to {self.drone_id} on port {self.port}", file=sys.stderr)
            return True
        except Exception as e:
            print(f"Failed to connect to port {self.port}: {e}", file=sys.stderr)
            return False
    
    def arm_and_takeoff(self, altitude, speed=2):
        """Arm and takeoff to altitude"""
        conn = self.connection
        
        # Set mode to GUIDED
        conn.mav.set_mode_send(
            conn.target_system,
            mavutil.mavlink.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
            4  # GUIDED mode
        )
        time.sleep(0.5)
        
        # Arm
        conn.mav.command_long_send(
            conn.target_system, conn.target_component,
            mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
            0, 1, 0, 0, 0, 0, 0, 0
        )
        time.sleep(1)
        
        # Takeoff
        conn.mav.command_long_send(
            conn.target_system, conn.target_component,
            mavutil.mavlink.MAV_CMD_NAV_TAKEOFF,
            0, 0, 0, 0, 0, 0, 0, altitude
        )
    
    def goto(self, x, y, z, speed=5):
        """Go to position (NED frame from home)"""
        conn = self.connection
        
        # Use SET_POSITION_TARGET_LOCAL_NED
        conn.mav.set_position_target_local_ned_send(
            0,  # time_boot_ms
            conn.target_system, conn.target_component,
            mavutil.mavlink.MAV_FRAME_LOCAL_NED,
            0b0000111111111000,  # position only
            x, y, -z,  # NED: z is down
            0, 0, 0,  # velocity
            0, 0, 0,  # acceleration
            0, 0  # yaw, yaw_rate
        )
    
    def land(self, speed=1):
        """Land at current position"""
        conn = self.connection
        conn.mav.set_mode_send(
            conn.target_system,
            mavutil.mavlink.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
            9  # LAND mode
        )
    
    def hover(self):
        """Hold current position"""
        conn = self.connection
        # In GUIDED mode, not sending new targets = hover
        conn.mav.set_mode_send(
            conn.target_system,
            mavutil.mavlink.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
            5  # LOITER mode
        )
    
    def rtl(self):
        """Return to launch"""
        conn = self.connection
        conn.mav.set_mode_send(
            conn.target_system,
            mavutil.mavlink.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
            6  # RTL mode
        )
    
    def emergency(self):
        """Emergency disarm"""
        conn = self.connection
        conn.mav.command_long_send(
            conn.target_system, conn.target_component,
            mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
            0, 0, 21196, 0, 0, 0, 0, 0  # Force disarm
        )
    
    def update_telemetry(self):
        """Read and update telemetry from connection"""
        conn = self.connection
        if not conn:
            return
            
        while True:
            msg = conn.recv_match(blocking=False)
            if msg is None:
                break
                
            msg_type = msg.get_type()
            
            if msg_type == 'LOCAL_POSITION_NED':
                self.position = [msg.x, msg.y, -msg.z]  # Convert NED to our frame
                self.velocity = [msg.vx, msg.vy, -msg.vz]
                
            elif msg_type == 'ATTITUDE':
                self.heading = msg.yaw
                
            elif msg_type == 'HEARTBEAT':
                self.armed = (msg.base_mode & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED) != 0
                # Decode mode
                mode_mapping = {
                    0: 'STABILIZE', 3: 'AUTO', 4: 'GUIDED',
                    5: 'LOITER', 6: 'RTL', 9: 'LAND'
                }
                self.mode = mode_mapping.get(msg.custom_mode, f'MODE_{msg.custom_mode}')
                
            elif msg_type == 'SYS_STATUS':
                if msg.voltage_battery > 0:
                    # Estimate percentage (rough: 3.7V nominal, 4.2V full, 3.3V empty)
                    voltage = msg.voltage_battery / 1000.0
                    self.battery = max(0, min(100, int((voltage - 3.3 * 4) / (4.2 * 4 - 3.3 * 4) * 100)))
                    
            elif msg_type == 'HOME_POSITION':
                self.home = [msg.latitude / 1e7, msg.longitude / 1e7, msg.altitude / 1000.0]
    
    def get_telemetry(self):
        """Return telemetry dict"""
        return {
            "type": "telemetry",
            "drone_id": self.drone_id,
            "position": [round(p, 2) for p in self.position],
            "velocity": [round(v, 2) for v in self.velocity],
            "heading": round(self.heading, 3),
            "armed": self.armed,
            "mode": self.mode,
            "battery": self.battery,
        }


class ArduPilotBridge:
    def __init__(self, ports):
        self.drones = {}
        self.running = True
        self.command_queue = Queue()
        
        for i, port in enumerate(ports):
            drone_id = f"drone{i}"
            self.drones[drone_id] = DroneConnection(drone_id, port)
    
    def connect_all(self):
        """Connect to all drones"""
        for drone in self.drones.values():
            if not drone.connect():
                print(f"Warning: Could not connect to {drone.drone_id}", file=sys.stderr)
    
    def telemetry_loop(self):
        """Send telemetry updates"""
        while self.running:
            for drone in self.drones.values():
                if drone.connection:
                    drone.update_telemetry()
                    print(json.dumps(drone.get_telemetry()), flush=True)
            time.sleep(0.1)  # 10 Hz
    
    def command_loop(self):
        """Process commands from stdin"""
        for line in sys.stdin:
            if not self.running:
                break
                
            line = line.strip()
            if not line:
                continue
                
            try:
                cmd = json.loads(line)
                self.handle_command(cmd)
            except json.JSONDecodeError:
                pass
    
    def handle_command(self, cmd):
        """Handle a command"""
        command = cmd.get('command')
        drone_id = cmd.get('drone_id')
        
        if command == 'disconnect':
            self.running = False
            return
        
        # Handle all-drone commands
        if drone_id is None:
            for d in self.drones.values():
                self._execute_command(d, cmd)
        else:
            drone = self.drones.get(drone_id)
            if drone:
                self._execute_command(drone, cmd)
    
    def _execute_command(self, drone, cmd):
        """Execute command on a drone"""
        command = cmd.get('command')
        
        if command == 'takeoff':
            drone.arm_and_takeoff(
                cmd.get('altitude', 5),
                cmd.get('speed', 2)
            )
        elif command == 'land':
            drone.land(cmd.get('speed', 1))
        elif command == 'goto':
            pos = cmd.get('position', [0, 0, 10])
            drone.goto(pos[0], pos[1], pos[2], cmd.get('speed', 5))
        elif command == 'hover':
            drone.hover()
        elif command == 'rtl':
            drone.rtl()
        elif command == 'emergency':
            drone.emergency()
        elif command == 'follow_path':
            # Execute waypoints sequentially
            waypoints = cmd.get('waypoints', [])
            speed = cmd.get('speed', 5)
            for wp in waypoints:
                drone.goto(wp[0], wp[1], wp[2], speed)
                time.sleep(0.5)  # Simple delay between waypoints
        
        # Send ack
        print(json.dumps({
            "type": "ack",
            "drone_id": drone.drone_id,
            "command": command
        }), flush=True)
    
    def run(self):
        """Start the bridge"""
        self.connect_all()
        
        # Start telemetry thread
        telemetry_thread = threading.Thread(target=self.telemetry_loop, daemon=True)
        telemetry_thread.start()
        
        # Run command loop in main thread
        self.command_loop()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--ports', required=True, help='Comma-separated list of SITL ports')
    args = parser.parse_args()
    
    ports = [int(p.strip()) for p in args.ports.split(',')]
    
    bridge = ArduPilotBridge(ports)
    bridge.run()


if __name__ == '__main__':
    main()
