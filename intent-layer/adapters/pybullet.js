/**
 * PyBullet Backend Adapter (gym-pybullet-drones)
 * 
 * Interfaces with gym-pybullet-drones Python environment.
 * Spawns a Python process that runs the simulation.
 * Communicates via JSON over stdin/stdout.
 */

import { SwarmBackend } from './interface.js';
import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export class PyBulletAdapter extends SwarmBackend {
  constructor(options = {}) {
    super();
    this.droneCount = options.droneCount || 4;
    this.gui = options.gui ?? false;
    this.freq = options.freq || 240;
    this.pythonPath = options.pythonPath || 'python3';
    this.process = null;
    this.connected = false;
    this.pendingRequests = new Map();
    this.requestId = 0;
    this.drones = new Map();
  }

  /**
   * Send command to Python process and wait for response
   */
  async sendCommand(cmd, args = {}) {
    if (!this.process) {
      throw new Error('PyBullet not connected');
    }

    const id = ++this.requestId;
    const message = JSON.stringify({ id, cmd, ...args }) + '\n';

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Command timeout: ${cmd}`));
      }, 30000);

      this.pendingRequests.set(id, { resolve, reject, timeout });
      this.process.stdin.write(message);
    });
  }

  async connect() {
    const scriptPath = join(__dirname, 'pybullet_bridge.py');
    
    this.process = spawn(this.pythonPath, [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
      },
    });

    // Handle stdout (JSON responses)
    let buffer = '';
    this.process.stdout.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete line

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const response = JSON.parse(line);
          const pending = this.pendingRequests.get(response.id);
          if (pending) {
            clearTimeout(pending.timeout);
            this.pendingRequests.delete(response.id);
            if (response.error) {
              pending.reject(new Error(response.error));
            } else {
              pending.resolve(response.result);
            }
          }
        } catch (e) {
          console.error('[PyBullet] Parse error:', line);
        }
      }
    });

    this.process.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg && !msg.includes('pybullet build time')) {
        console.error('[PyBullet]', msg);
      }
    });

    this.process.on('close', (code) => {
      console.log(`[PyBullet] Process exited with code ${code}`);
      this.connected = false;
    });

    // Initialize environment
    const result = await this.sendCommand('init', {
      num_drones: this.droneCount,
      gui: this.gui,
      freq: this.freq,
    });

    this.connected = true;
    console.log(`[PyBullet] Connected with ${this.droneCount} drones`);
    return result;
  }

  async disconnect() {
    if (this.process) {
      await this.sendCommand('shutdown');
      this.process.kill();
      this.process = null;
    }
    this.connected = false;
  }

  isConnected() {
    return this.connected;
  }

  async getDroneStates() {
    const result = await this.sendCommand('get_states');
    const states = new Map();
    for (const drone of result.drones) {
      states.set(drone.id, drone);
    }
    return states;
  }

  async getDroneState(droneId) {
    const result = await this.sendCommand('get_state', { drone_id: droneId });
    return result;
  }

  async getSwarmState() {
    const result = await this.sendCommand('get_swarm_state');
    return {
      drones: new Map(Object.entries(result.drones)),
      count: result.count,
      formation: result.formation || 'none',
      centroid: result.centroid,
    };
  }

  async getDroneCount() {
    return this.droneCount;
  }

  async arm(droneId) {
    // PyBullet doesn't have arm/disarm - drones are always ready
    console.log(`[PyBullet] ${droneId} armed (no-op)`);
  }

  async disarm(droneId) {
    console.log(`[PyBullet] ${droneId} disarmed (no-op)`);
  }

  async takeoff(droneId, altitude = 1, speed = 1) {
    await this.sendCommand('takeoff', { drone_id: droneId, altitude, speed });
  }

  async land(droneId, speed = 0.5) {
    await this.sendCommand('land', { drone_id: droneId, speed });
  }

  async goTo(droneId, x, y, z, speed = 1.5, frame = 'earth') {
    await this.sendCommand('goto', { 
      drone_id: droneId, 
      x, y, z, 
      speed, 
      frame 
    });
  }

  async hover(droneId) {
    await this.sendCommand('hover', { drone_id: droneId });
  }

  async rtl(droneId, altitude = 1, speed = 1) {
    await this.sendCommand('rtl', { drone_id: droneId, altitude, speed });
  }

  async emergency(droneId) {
    await this.sendCommand('emergency', { drone_id: droneId });
  }

  async followPath(droneId, waypoints, speed = 1.5) {
    await this.sendCommand('follow_path', { 
      drone_id: droneId, 
      waypoints, 
      speed 
    });
  }

  async setFormation(offsets) {
    await this.sendCommand('set_formation', { offsets });
  }

  async moveSwarm(x, y, z, frame = 'earth') {
    await this.sendCommand('move_swarm', { x, y, z, frame });
  }

  // Simulation control
  async step(actions) {
    return await this.sendCommand('step', { actions });
  }

  async reset() {
    return await this.sendCommand('reset');
  }

  async getObservations() {
    return await this.sendCommand('get_observations');
  }

  async getCameraImage(droneId, cameraType = 'rgb') {
    return await this.sendCommand('get_camera', { 
      drone_id: droneId, 
      camera_type: cameraType 
    });
  }
}
