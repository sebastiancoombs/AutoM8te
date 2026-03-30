/**
 * Aerostack2 Backend Adapter
 * 
 * Calls Aerostack2 Python API via docker exec.
 * Requires Aerostack2 container running with our scripts mounted.
 */

import { SwarmBackend } from './interface.js';
import { execSync, exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class Aerostack2Adapter extends SwarmBackend {
  constructor(options = {}) {
    super();
    this.container = options.container || process.env.AUTOM8TE_CONTAINER || 'aerostack2';
    this.scriptsPath = options.scriptsPath || '/scripts';
    this.connected = false;
    this.droneCount = options.droneCount || 4;
  }

  /**
   * Execute Python script in Aerostack2 container
   */
  async execScript(script, args = []) {
    const argsStr = args.map(a => typeof a === 'string' ? `"${a}"` : a).join(' ');
    const cmd = `docker exec ${this.container} bash -c "source /opt/ros/humble/setup.bash && source /root/aerostack2_ws/install/setup.bash && python3 ${this.scriptsPath}/${script} ${argsStr}"`;
    
    try {
      const { stdout, stderr } = await execAsync(cmd, { timeout: 30000 });
      if (stderr && !stderr.includes('Warning')) {
        console.error(`[Aerostack2] stderr: ${stderr}`);
      }
      return JSON.parse(stdout.trim());
    } catch (error) {
      console.error(`[Aerostack2] Error executing ${script}:`, error.message);
      throw error;
    }
  }

  async connect() {
    try {
      // Check container is running
      execSync(`docker inspect ${this.container}`, { stdio: 'pipe' });
      
      // Query drone count
      const result = await this.execScript('cmd_query.py', ['--count']);
      this.droneCount = result.count || this.droneCount;
      this.connected = true;
      
      console.log(`[Aerostack2] Connected to ${this.container} with ${this.droneCount} drones`);
    } catch (error) {
      throw new Error(`Failed to connect to Aerostack2 container: ${error.message}`);
    }
  }

  async disconnect() {
    this.connected = false;
    console.log('[Aerostack2] Disconnected');
  }

  isConnected() {
    return this.connected;
  }

  async getDroneStates() {
    const result = await this.execScript('cmd_query.py', ['--all']);
    const states = new Map();
    for (const drone of result.drones || []) {
      states.set(drone.id, drone);
    }
    return states;
  }

  async getDroneState(droneId) {
    const result = await this.execScript('cmd_query.py', [droneId]);
    return result;
  }

  async getSwarmState() {
    const result = await this.execScript('cmd_query.py', ['--swarm']);
    return {
      drones: new Map(Object.entries(result.drones || {})),
      count: result.count,
      formation: result.formation || 'none',
      centroid: result.centroid || [0, 0, 0],
    };
  }

  async getDroneCount() {
    const result = await this.execScript('cmd_query.py', ['--count']);
    return result.count;
  }

  async arm(droneId) {
    await this.execScript('cmd_arm.py', [droneId]);
  }

  async disarm(droneId) {
    await this.execScript('cmd_disarm.py', [droneId]);
  }

  async takeoff(droneId, altitude = 5, speed = 1) {
    await this.execScript('cmd_takeoff.py', [droneId, altitude, speed]);
  }

  async land(droneId, speed = 0.5) {
    await this.execScript('cmd_land.py', [droneId, speed]);
  }

  async goTo(droneId, x, y, z, speed = 1.5, frame = 'earth') {
    await this.execScript('cmd_goto.py', [droneId, x, y, z, speed, frame]);
  }

  async hover(droneId) {
    await this.execScript('cmd_hover.py', [droneId]);
  }

  async rtl(droneId, altitude = 10, speed = 1) {
    await this.execScript('cmd_rtl.py', [droneId, altitude, speed]);
  }

  async emergency(droneId) {
    const args = droneId ? [droneId] : ['--all'];
    await this.execScript('cmd_emergency.py', args);
  }

  async followPath(droneId, waypoints, speed = 1.5) {
    const waypointsJson = JSON.stringify(waypoints);
    await this.execScript('cmd_follow_path.py', [droneId, `'${waypointsJson}'`, speed]);
  }

  async setFormation(offsets) {
    const offsetsJson = JSON.stringify(offsets);
    await this.execScript('cmd_formation.py', [`'${offsetsJson}'`]);
  }

  async moveSwarm(x, y, z, frame = 'earth') {
    await this.execScript('cmd_swarm_move.py', [x, y, z, frame]);
  }

  async getObjectPosition(target) {
    // Phase 3: would call perception node
    try {
      const result = await this.execScript('cmd_perception.py', ['--locate', target]);
      return result.position ? { position: result.position, confidence: result.confidence } : null;
    } catch {
      return null;
    }
  }

  async followObject(droneId, target) {
    await this.execScript('cmd_follow_target.py', [droneId, target]);
  }
}
