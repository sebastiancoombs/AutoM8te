/**
 * ArduPilot SITL Adapter
 * 
 * Connects to ArduPilot SITL instances via pymavlink.
 * Each drone runs on a separate port (14550, 14560, 14570, ...)
 * 
 * Start SITL instances:
 *   sim_vehicle.py -v ArduCopter --instance 0 -I0
 *   sim_vehicle.py -v ArduCopter --instance 1 -I1
 *   ...
 * 
 * Or use start-sitl.sh script for multiple drones.
 */

import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export class ArduPilotAdapter {
  constructor(options = {}) {
    this.droneCount = options.droneCount || 4;
    this.basePort = options.basePort || 14550;
    this.portStep = options.portStep || 10;
    this.process = null;
    this.drones = new Map();
    this.connected = false;
    this.formation = 'none';
    this.formationOffsets = [];
  }

  /**
   * Connect to all SITL instances
   */
  async connect() {
    const ports = [];
    for (let i = 0; i < this.droneCount; i++) {
      ports.push(this.basePort + i * this.portStep);
    }

    const scriptPath = join(__dirname, 'ardupilot_bridge.py');
    
    this.process = spawn('python3', [
      scriptPath,
      '--ports', ports.join(','),
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Handle telemetry updates
    this.process.stdout.on('data', (data) => {
      this._handleTelemetry(data.toString());
    });

    this.process.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) console.error('[ArduPilot]', msg);
    });

    this.process.on('close', (code) => {
      console.log(`[ArduPilot] Bridge exited with code ${code}`);
      this.connected = false;
    });

    // Wait for connection confirmation
    await this._waitForConnection();
    
    this.connected = true;
    console.log(`[ArduPilot] Connected to ${this.droneCount} SITL instances`);
  }

  async _waitForConnection() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
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
            armed: msg.armed,
            mode: msg.mode,
            battery: msg.battery,
            status: this._getStatus(msg),
          });
        } else if (msg.type === 'ack') {
          // Command acknowledgment
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
  }

  _getStatus(msg) {
    if (!msg.armed) return 'disarmed';
    if (msg.mode === 'LAND') return 'landing';
    if (msg.mode === 'RTL') return 'returning';
    if (msg.mode === 'GUIDED') return 'guided';
    if (msg.mode === 'LOITER') return 'hovering';
    return msg.mode.toLowerCase();
  }

  async disconnect() {
    if (this.process) {
      this._send({ command: 'disconnect' });
      this.process.kill();
      this.process = null;
    }
    this.drones.clear();
    this.connected = false;
    console.log('[ArduPilot] Disconnected');
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

  // --- Commands ---

  _send(message) {
    if (this.process && this.process.stdin.writable) {
      this.process.stdin.write(JSON.stringify(message) + '\n');
    }
  }

  async takeoff(droneId, altitude, speed) {
    console.log(`[ArduPilot] ${droneId} takeoff to ${altitude}m`);
    this._send({
      command: 'takeoff',
      drone_id: droneId,
      altitude,
      speed,
    });
  }

  async land(droneId, speed) {
    console.log(`[ArduPilot] ${droneId} landing`);
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
      // Convert body frame to earth frame
      const cos = Math.cos(drone.heading);
      const sin = Math.sin(drone.heading);
      targetPos = [
        drone.position[0] + x * cos - y * sin,
        drone.position[1] + x * sin + y * cos,
        drone.position[2] + z,
      ];
    } else if (frame === 'earth' && drone) {
      // Relative to current position
      targetPos = [
        drone.position[0] + x,
        drone.position[1] + y,
        drone.position[2] + z,
      ];
    } else {
      targetPos = [x, y, z];
    }

    console.log(`[ArduPilot] ${droneId} goto [${targetPos.map(v => v.toFixed(1)).join(',')}]`);
    this._send({
      command: 'goto',
      drone_id: droneId,
      position: targetPos,
      speed,
    });
  }

  async hover(droneId) {
    console.log(`[ArduPilot] ${droneId} hover`);
    this._send({
      command: 'hover',
      drone_id: droneId,
    });
  }

  async rtl(droneId) {
    console.log(`[ArduPilot] ${droneId} RTL`);
    this._send({
      command: 'rtl',
      drone_id: droneId,
    });
  }

  async emergency(droneId) {
    console.log(`[ArduPilot] EMERGENCY`);
    this._send({
      command: 'emergency',
      drone_id: droneId,
    });
  }

  async setFormation(offsets, droneIds = null) {
    this.formationOffsets = offsets;
    this.formation = 'custom';
    console.log(`[ArduPilot] Formation set with ${offsets.length} positions`);
    
    // Move drones to formation positions relative to centroid
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
    console.log(`[ArduPilot] ${droneId} following path with ${waypoints.length} waypoints`);
    this._send({
      command: 'follow_path',
      drone_id: droneId,
      waypoints,
      speed,
    });
  }
}
