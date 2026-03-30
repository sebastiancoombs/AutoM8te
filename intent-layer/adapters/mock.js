/**
 * Mock Backend Adapter
 * 
 * Simulates drone swarm without real simulation.
 * Useful for testing intent layer logic.
 */

import { SwarmBackend } from './interface.js';

export class MockAdapter extends SwarmBackend {
  constructor(droneCount = 4) {
    super();
    this.droneCount = droneCount;
    this.connected = false;
    this.drones = new Map();
    this.formation = 'none';
    this.centroid = [0, 0, 0];
  }

  async connect() {
    // Initialize mock drones in a circle
    const radius = 5;
    for (let i = 0; i < this.droneCount; i++) {
      const angle = (i / this.droneCount) * 2 * Math.PI;
      this.drones.set(`drone${i}`, {
        id: `drone${i}`,
        position: [
          radius * Math.cos(angle),
          radius * Math.sin(angle),
          0,
        ],
        velocity: [0, 0, 0],
        heading: 0,
        armed: false,
        offboard: false,
        battery: 100 - i * 5,
        status: 'idle',
      });
    }
    this.connected = true;
    console.log(`[MockAdapter] Connected with ${this.droneCount} drones`);
  }

  async disconnect() {
    this.connected = false;
    this.drones.clear();
    console.log('[MockAdapter] Disconnected');
  }

  isConnected() {
    return this.connected;
  }

  async getDroneStates() {
    return new Map(this.drones);
  }

  async getDroneState(droneId) {
    const drone = this.drones.get(droneId);
    if (!drone) throw new Error(`Drone not found: ${droneId}`);
    return { ...drone };
  }

  async getSwarmState() {
    const positions = [...this.drones.values()].map(d => d.position);
    const centroid = positions.reduce(
      (acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]],
      [0, 0, 0]
    ).map(v => v / positions.length);

    return {
      drones: new Map(this.drones),
      count: this.drones.size,
      formation: this.formation,
      centroid,
    };
  }

  async getDroneCount() {
    return this.drones.size;
  }

  async arm(droneId) {
    const drone = this.drones.get(droneId);
    if (!drone) throw new Error(`Drone not found: ${droneId}`);
    drone.armed = true;
    console.log(`[MockAdapter] ${droneId} armed`);
  }

  async disarm(droneId) {
    const drone = this.drones.get(droneId);
    if (!drone) throw new Error(`Drone not found: ${droneId}`);
    drone.armed = false;
    drone.offboard = false;
    console.log(`[MockAdapter] ${droneId} disarmed`);
  }

  async takeoff(droneId, altitude = 5, speed = 1) {
    const drone = this.drones.get(droneId);
    if (!drone) throw new Error(`Drone not found: ${droneId}`);
    
    drone.armed = true;
    drone.offboard = true;
    drone.status = 'flying';
    drone.position[2] = altitude;
    
    console.log(`[MockAdapter] ${droneId} takeoff to ${altitude}m`);
  }

  async land(droneId, speed = 0.5) {
    const drone = this.drones.get(droneId);
    if (!drone) throw new Error(`Drone not found: ${droneId}`);
    
    drone.status = 'landing';
    drone.position[2] = 0;
    drone.status = 'idle';
    drone.offboard = false;
    
    console.log(`[MockAdapter] ${droneId} landed`);
  }

  async goTo(droneId, x, y, z, speed = 1.5, frame = 'earth') {
    const drone = this.drones.get(droneId);
    if (!drone) throw new Error(`Drone not found: ${droneId}`);
    
    if (frame === 'base_link') {
      // Relative to drone
      drone.position[0] += x;
      drone.position[1] += y;
      drone.position[2] += z;
    } else {
      // Absolute
      drone.position = [x, y, z];
    }
    
    console.log(`[MockAdapter] ${droneId} goto [${drone.position}] (${frame})`);
  }

  async hover(droneId) {
    const drone = this.drones.get(droneId);
    if (!drone) throw new Error(`Drone not found: ${droneId}`);
    
    drone.velocity = [0, 0, 0];
    drone.status = 'flying';
    
    console.log(`[MockAdapter] ${droneId} hovering`);
  }

  async rtl(droneId, altitude = 10, speed = 1) {
    const drone = this.drones.get(droneId);
    if (!drone) throw new Error(`Drone not found: ${droneId}`);
    
    drone.position = [0, 0, 0];
    drone.status = 'idle';
    drone.offboard = false;
    
    console.log(`[MockAdapter] ${droneId} RTL complete`);
  }

  async emergency(droneId) {
    if (droneId) {
      const drone = this.drones.get(droneId);
      if (drone) {
        drone.position[2] = 0;
        drone.status = 'idle';
        drone.armed = false;
      }
    } else {
      for (const drone of this.drones.values()) {
        drone.position[2] = 0;
        drone.status = 'idle';
        drone.armed = false;
      }
    }
    console.log(`[MockAdapter] EMERGENCY ${droneId || 'ALL'}`);
  }

  async followPath(droneId, waypoints, speed = 1.5) {
    const drone = this.drones.get(droneId);
    if (!drone) throw new Error(`Drone not found: ${droneId}`);
    
    // Mock: just go to last waypoint
    const last = waypoints[waypoints.length - 1];
    drone.position = [...last];
    
    console.log(`[MockAdapter] ${droneId} followed ${waypoints.length} waypoints`);
  }

  async setFormation(offsets) {
    // Apply offsets relative to centroid
    for (const { id, offset } of offsets) {
      const drone = this.drones.get(id);
      if (drone) {
        drone.position = [
          this.centroid[0] + offset[0],
          this.centroid[1] + offset[1],
          this.centroid[2] + offset[2],
        ];
      }
    }
    console.log(`[MockAdapter] Formation set with ${offsets.length} positions`);
  }

  async moveSwarm(x, y, z, frame = 'earth') {
    const delta = frame === 'base_link' 
      ? [x, y, z]
      : [x - this.centroid[0], y - this.centroid[1], z - this.centroid[2]];
    
    for (const drone of this.drones.values()) {
      drone.position[0] += delta[0];
      drone.position[1] += delta[1];
      drone.position[2] += delta[2];
    }
    
    this.centroid = frame === 'base_link'
      ? [this.centroid[0] + x, this.centroid[1] + y, this.centroid[2] + z]
      : [x, y, z];
    
    console.log(`[MockAdapter] Swarm moved to centroid [${this.centroid}]`);
  }

  // Phase 3 stub
  async getObjectPosition(target) {
    // Mock: return fake position for testing
    console.log(`[MockAdapter] Object lookup: ${target} (stubbed)`);
    return null;
  }
}
