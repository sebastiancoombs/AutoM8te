/**
 * Webots Simulator Adapter
 * 
 * Connects to Webots via supervisor controller.
 * Webots has built-in Mavic 2 Pro drone model.
 * 
 * Prerequisites:
 *   brew install --cask webots  (or download from cyberbotics.com)
 * 
 * Start Webots world:
 *   webots ~/Documents/Git/AutoM8te/intent-layer/webots/swarm_world.wbt
 */

import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export class WebotsAdapter {
  constructor(options = {}) {
    this.droneCount = options.droneCount || 4;
    this.process = null;
    this.drones = new Map();
    this.connected = false;
    this.formation = 'none';
    this.formationOffsets = [];
  }

  /**
   * Connect to Webots supervisor
   */
  async connect() {
    const scriptPath = join(__dirname, 'webots_bridge.py');
    
    this.process = spawn('python3', [
      scriptPath,
      '--drones', this.droneCount.toString(),
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.stdout.on('data', (data) => {
      this._handleTelemetry(data.toString());
    });

    this.process.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) console.error('[Webots]', msg);
    });

    this.process.on('close', (code) => {
      console.log(`[Webots] Bridge exited with code ${code}`);
      this.connected = false;
    });

    // Wait for connection
    await this._waitForConnection();
    
    this.connected = true;
    console.log(`[Webots] Connected to ${this.droneCount} drones`);
  }

  async _waitForConnection() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Webots connection timeout'));
      }, 30000);

      const checkConnected = () => {
        if (this.drones.size >= this.droneCount) {
          clearTimeout(timeout);
          resolve();
        } else {
          setTimeout(checkConnected, 100);
        }
      };
      checkConnected();
    });
  }

  _handleTelemetry(data) {
    const lines = data.trim().split('\n');
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        if (msg.type === 'telemetry') {
          this.drones.set(msg.drone_id, {
            id: msg.drone_id,
            position: msg.position,
            velocity: msg.velocity,
            heading: msg.heading,
            battery: msg.battery || 100,
            status: msg.status || 'idle',
          });
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
  }

  async disconnect() {
    if (this.process) {
      this._send({ command: 'disconnect' });
      this.process.kill();
      this.process = null;
    }
    this.drones.clear();
    this.connected = false;
    console.log('[Webots] Disconnected');
  }

  isConnected() {
    return this.connected;
  }

  async getDroneStates() {
    return new Map(this.drones);
  }

  async getDroneCount() {
    return this.droneCount;
  }

  async getSwarmState() {
    const drones = await this.getDroneStates();
    const positions = [...drones.values()].map(d => d.position);
    const centroid = positions.length > 0 ? [
      positions.reduce((s, p) => s + p[0], 0) / positions.length,
      positions.reduce((s, p) => s + p[1], 0) / positions.length,
      positions.reduce((s, p) => s + p[2], 0) / positions.length,
    ] : [0, 0, 0];

    return {
      count: drones.size,
      formation: this.formation,
      centroid,
      drones,
    };
  }

  async getSwarmCenter() {
    const state = await this.getSwarmState();
    return state.centroid;
  }

  _send(message) {
    if (this.process && this.process.stdin.writable) {
      this.process.stdin.write(JSON.stringify(message) + '\n');
    }
  }

  async takeoff(droneId, altitude, speed) {
    console.log(`[Webots] ${droneId} takeoff to ${altitude}m`);
    this._send({
      command: 'takeoff',
      drone_id: droneId,
      altitude,
      speed,
    });
  }

  async land(droneId, speed) {
    console.log(`[Webots] ${droneId} landing`);
    this._send({
      command: 'land',
      drone_id: droneId,
      speed,
    });
  }

  async goTo(droneId, x, y, z, speed, frame = 'earth') {
    const drone = this.drones.get(droneId);
    let targetPos;
    
    if (frame === 'body' && drone) {
      const cos = Math.cos(drone.heading);
      const sin = Math.sin(drone.heading);
      targetPos = [
        drone.position[0] + x * cos - y * sin,
        drone.position[1] + x * sin + y * cos,
        drone.position[2] + z,
      ];
    } else if (frame === 'earth' && drone) {
      targetPos = [
        drone.position[0] + x,
        drone.position[1] + y,
        drone.position[2] + z,
      ];
    } else {
      targetPos = [x, y, z];
    }

    console.log(`[Webots] ${droneId} goto [${targetPos.map(v => v.toFixed(1)).join(',')}]`);
    this._send({
      command: 'goto',
      drone_id: droneId,
      position: targetPos,
      speed,
    });
  }

  async hover(droneId) {
    console.log(`[Webots] ${droneId} hover`);
    this._send({
      command: 'hover',
      drone_id: droneId,
    });
  }

  async rtl(droneId) {
    console.log(`[Webots] ${droneId} RTL`);
    this._send({
      command: 'rtl',
      drone_id: droneId,
    });
  }

  async emergency(droneId) {
    console.log(`[Webots] EMERGENCY`);
    this._send({
      command: 'emergency',
      drone_id: droneId,
    });
  }

  async setFormation(offsets, droneIds = null) {
    this.formationOffsets = offsets;
    this.formation = 'custom';
    console.log(`[Webots] Formation set with ${offsets.length} positions`);
    
    const center = await this.getSwarmCenter();
    const ids = droneIds || [...this.drones.keys()];
    
    for (let i = 0; i < Math.min(ids.length, offsets.length); i++) {
      const targetPos = [
        center[0] + offsets[i][0],
        center[1] + offsets[i][1],
        center[2] + offsets[i][2],
      ];
      this._send({
        command: 'goto',
        drone_id: ids[i],
        position: targetPos,
        speed: 3,
      });
    }
  }

  async followPath(droneId, waypoints, speed) {
    console.log(`[Webots] ${droneId} following path with ${waypoints.length} waypoints`);
    this._send({
      command: 'follow_path',
      drone_id: droneId,
      waypoints,
      speed,
    });
  }
}
