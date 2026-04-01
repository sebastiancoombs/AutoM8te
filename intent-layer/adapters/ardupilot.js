/**
 * ArduPilot SITL Adapter
 * 
 * Connects to ArduPilot SITL instances via pymavlink.
 * Supports multiple simulation backends via --model flag:
 * 
 *   - Default (no viz):   sim_vehicle.py -v ArduCopter --instance N
 *   - Webots (physics):   sim_vehicle.py -v ArduCopter --model webots-python
 *   - Gazebo:             sim_vehicle.py -v ArduCopter --model gazebo
 * 
 * Webots Integration:
 *   ArduPilot has native Webots support. When backend='webots':
 *   1. Start Webots with iris.wbt from ardupilot/libraries/SITL/examples/Webots_Python/worlds/
 *   2. This adapter launches SITL with --model webots-python
 *   3. ArduPilot handles all communication with Webots
 * 
 * See: https://ardupilot.org/dev/docs/sitl-with-webots-python.html
 */

import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export class ArduPilotAdapter {
  constructor(options = {}) {
    this.droneCount = options.droneCount || 4;
    // SITL TCP ports: 5760 + instance*10
    this.basePort = options.basePort || 5760;
    this.portStep = options.portStep || 10;
    this.backend = options.backend || 'default'; // 'default', 'webots', 'gazebo'
    this.ardupilotPath = options.ardupilotPath || null; // Path to ardupilot repo (required for webots)
    this.process = null;
    this.drones = new Map();
    this.connected = false;
    this.formation = 'none';
    this.formationOffsets = [];
  }

  /**
   * Get sim_vehicle.py arguments for the configured backend
   */
  _getSimVehicleArgs() {
    const args = ['-v', 'ArduCopter', '-w'];
    
    switch (this.backend) {
      case 'webots':
        // Native ArduPilot Webots integration
        args.push('--model', 'webots-python');
        if (this.ardupilotPath) {
          args.push(
            `--add-param-file=${this.ardupilotPath}/libraries/SITL/examples/Webots_Python/params/iris.parm`
          );
        }
        break;
      case 'gazebo':
        args.push('--model', 'gazebo');
        break;
      default:
        // Default SITL (no external viz)
        break;
    }
    
    return args;
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
      if (msg) {
        console.error('[ArduPilot Bridge]', msg);
        // Count connections from bridge stderr
        if (msg.includes('Connected to')) {
          const match = msg.match(/Connected to (drone\d+)/);
          if (match) {
            this.drones.set(match[1], {
              id: match[1], position: [0,0,0], velocity: [0,0,0],
              heading: 0, armed: false, mode: 'UNKNOWN', battery: 100, status: 'connecting'
            });
          }
        }
      }
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
      }, 60000);

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

  async executeChoreography(shape, droneIds, scale = 5) {
    const { planKeyframePaths, planAnimatedPaths, planMotionPath, pathsToWaypoints } = await import('./pathplanner.js');
    const { resolveCurves } = await import('../lookups/shapes.js');

    let paths;
    if (shape.keyframes) {
      paths = planKeyframePaths(shape.keyframes, droneIds.length, {
        duration_s: shape.duration_s, easing: shape.easing || 'inOut', scale,
      });
    } else if (shape.duration_s && shape.curves) {
      paths = planAnimatedPaths(shape.curves, droneIds.length, {
        duration_s: shape.duration_s, scale, easing: shape.easing || 'linear',
      });
    }

    if (shape.motion && shape.curves) {
      const staticOffsets = resolveCurves(shape.curves, droneIds.length, scale);
      paths = planMotionPath(staticOffsets, shape.motion);
    }

    if (!paths) return { dispatched: 0, duration_s: 0 };

    const waypointData = pathsToWaypoints(paths);
    for (const [droneId, { waypoints, speeds }] of waypointData) {
      const avgSpeed = speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 5;
      await this.followPath(droneId, waypoints, Math.min(avgSpeed, 15));
    }

    console.log(`[ArduPilot] Choreography dispatched to ${waypointData.size} drones`);
    return { dispatched: waypointData.size, duration_s: shape.duration_s || 0 };
  }
}
