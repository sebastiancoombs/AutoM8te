#!/usr/bin/env python3
"""
Webots Drone Swarm Bridge

Runs as a Webots supervisor controller.
Receives commands via stdin, sends telemetry via stdout.

This script should be set as the controller for a Robot node with
supervisor=TRUE in your Webots world file.

Usage in Webots world:
  Robot {
    name "supervisor"
    controller "webots_bridge"
    supervisor TRUE
  }
"""

import sys
import json
import math
import argparse

try:
    from controller import Supervisor
except ImportError:
    # Not running inside Webots - provide standalone mode info
    print(json.dumps({
        "error": "Not running inside Webots. Start Webots with the swarm world file.",
        "hint": "webots ~/Documents/Git/AutoM8te/intent-layer/webots/swarm_world.wbt"
    }), flush=True)
    sys.exit(1)


class DroneController:
    """Control a single drone in Webots"""
    
    def __init__(self, supervisor, drone_id, node):
        self.supervisor = supervisor
        self.drone_id = drone_id
        self.node = node
        self.target_position = None
        self.target_altitude = None
        self.speed = 2.0
        self.state = 'idle'  # idle, taking_off, flying, landing, hovering
        self.home_position = self._get_position()
        
        # Get motor devices (Mavic 2 Pro has 4 motors)
        self.motors = []
        self.motor_names = [
            f'{drone_id}_front_left_motor',
            f'{drone_id}_front_right_motor', 
            f'{drone_id}_rear_left_motor',
            f'{drone_id}_rear_right_motor'
        ]
        
        # Try to get propeller motors
        for name in self.motor_names:
            motor = supervisor.getDevice(name)
            if motor:
                motor.setPosition(float('inf'))  # Velocity control
                motor.setVelocity(0)
                self.motors.append(motor)
    
    def _get_position(self):
        """Get current position from node"""
        pos = self.node.getPosition()
        return [pos[0], pos[2], pos[1]]  # Webots: Y is up, we use Z is up
    
    def _get_velocity(self):
        """Get current velocity from node"""
        vel = self.node.getVelocity()
        return [vel[0], vel[2], vel[1]]
    
    def _get_heading(self):
        """Get heading from rotation"""
        rot = self.node.getOrientation()
        # Extract yaw from rotation matrix
        return math.atan2(rot[2], rot[0])
    
    def _set_motor_speeds(self, speeds):
        """Set motor speeds [fl, fr, rl, rr]"""
        for i, motor in enumerate(self.motors):
            if i < len(speeds):
                motor.setVelocity(speeds[i])
    
    def takeoff(self, altitude, speed):
        """Start takeoff to altitude"""
        self.target_altitude = altitude
        self.speed = speed
        self.state = 'taking_off'
        # Base motor speed for lift
        self._set_motor_speeds([100, -100, -100, 100])
    
    def land(self, speed):
        """Start landing"""
        self.target_altitude = 0
        self.speed = speed
        self.state = 'landing'
    
    def goto(self, position, speed):
        """Go to position"""
        self.target_position = position
        self.speed = speed
        self.state = 'flying'
    
    def hover(self):
        """Hold current position"""
        self.target_position = self._get_position()
        self.state = 'hovering'
    
    def rtl(self):
        """Return to launch"""
        self.target_position = self.home_position
        self.state = 'flying'
    
    def emergency(self):
        """Emergency stop"""
        self._set_motor_speeds([0, 0, 0, 0])
        self.state = 'idle'
    
    def update(self, dt):
        """Update drone physics (called each timestep)"""
        pos = self._get_position()
        
        if self.state == 'taking_off':
            if pos[2] < self.target_altitude:
                # Lift
                lift_speed = min(100, 50 + (self.target_altitude - pos[2]) * 10)
                self._set_motor_speeds([lift_speed, -lift_speed, -lift_speed, lift_speed])
            else:
                self.state = 'hovering'
                self.hover()
                
        elif self.state == 'landing':
            if pos[2] > 0.1:
                # Descend
                lift_speed = max(20, 50 - pos[2] * 20)
                self._set_motor_speeds([lift_speed, -lift_speed, -lift_speed, lift_speed])
            else:
                self._set_motor_speeds([0, 0, 0, 0])
                self.state = 'idle'
                
        elif self.state == 'flying' and self.target_position:
            # Simple proportional control to target
            dx = self.target_position[0] - pos[0]
            dy = self.target_position[1] - pos[1]
            dz = self.target_position[2] - pos[2]
            
            distance = math.sqrt(dx*dx + dy*dy + dz*dz)
            
            if distance < 0.5:
                self.state = 'hovering'
                self.hover()
            else:
                # Compute motor differential for direction
                # This is simplified - real drone control is more complex
                base_speed = 60
                lift = base_speed + dz * 20
                pitch = dx * 10  # Forward/back
                roll = dy * 10   # Left/right
                
                fl = lift + pitch - roll
                fr = lift + pitch + roll
                rl = lift - pitch - roll
                rr = lift - pitch + roll
                
                self._set_motor_speeds([fl, -fr, -rl, rr])
                
        elif self.state == 'hovering':
            # Maintain altitude
            pos = self._get_position()
            lift = 60 + (self.target_position[2] - pos[2]) * 20 if self.target_position else 60
            self._set_motor_speeds([lift, -lift, -lift, lift])
    
    def get_telemetry(self):
        """Return telemetry dict"""
        return {
            "type": "telemetry",
            "drone_id": self.drone_id,
            "position": [round(p, 2) for p in self._get_position()],
            "velocity": [round(v, 2) for v in self._get_velocity()],
            "heading": round(self._get_heading(), 3),
            "battery": 100,
            "status": self.state,
        }


class SwarmSupervisor:
    """Webots supervisor controlling multiple drones"""
    
    def __init__(self, drone_count):
        self.supervisor = Supervisor()
        self.timestep = int(self.supervisor.getBasicTimeStep())
        self.drone_count = drone_count
        self.drones = {}
        self.running = True
        
        # Find drone nodes
        for i in range(drone_count):
            drone_id = f"drone{i}"
            node = self.supervisor.getFromDef(drone_id.upper())
            if node:
                self.drones[drone_id] = DroneController(self.supervisor, drone_id, node)
                print(f"Found drone: {drone_id}", file=sys.stderr)
            else:
                print(f"Warning: Drone node {drone_id.upper()} not found", file=sys.stderr)
    
    def handle_command(self, cmd):
        """Handle a command"""
        command = cmd.get('command')
        drone_id = cmd.get('drone_id')
        
        if command == 'disconnect':
            self.running = False
            return
        
        # Get target drones
        if drone_id:
            targets = [self.drones.get(drone_id)] if drone_id in self.drones else []
        else:
            targets = list(self.drones.values())
        
        for drone in targets:
            if not drone:
                continue
                
            if command == 'takeoff':
                drone.takeoff(cmd.get('altitude', 5), cmd.get('speed', 2))
            elif command == 'land':
                drone.land(cmd.get('speed', 1))
            elif command == 'goto':
                drone.goto(cmd.get('position', [0, 0, 5]), cmd.get('speed', 3))
            elif command == 'hover':
                drone.hover()
            elif command == 'rtl':
                drone.rtl()
            elif command == 'emergency':
                drone.emergency()
            elif command == 'follow_path':
                # Queue waypoints (simplified: just go to first)
                waypoints = cmd.get('waypoints', [])
                if waypoints:
                    drone.goto(waypoints[0], cmd.get('speed', 3))
    
    def run(self):
        """Main loop"""
        import select
        
        telemetry_counter = 0
        
        while self.supervisor.step(self.timestep) != -1 and self.running:
            dt = self.timestep / 1000.0
            
            # Check for commands (non-blocking)
            if select.select([sys.stdin], [], [], 0)[0]:
                line = sys.stdin.readline().strip()
                if line:
                    try:
                        cmd = json.loads(line)
                        self.handle_command(cmd)
                    except json.JSONDecodeError:
                        pass
            
            # Update drones
            for drone in self.drones.values():
                drone.update(dt)
            
            # Send telemetry at ~10Hz
            telemetry_counter += 1
            if telemetry_counter >= 10:
                telemetry_counter = 0
                for drone in self.drones.values():
                    print(json.dumps(drone.get_telemetry()), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--drones', type=int, default=4, help='Number of drones')
    args = parser.parse_args()
    
    supervisor = SwarmSupervisor(args.drones)
    supervisor.run()


if __name__ == '__main__':
    main()
