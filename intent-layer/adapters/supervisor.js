/**
 * Webots Supervisor Adapter
 * 
 * Connects to the Supervisor controller's HTTP API (port 8080).
 * All commands are forwarded as HTTP requests.
 * No SITL, no MAVLink — just REST calls.
 */

const SUPERVISOR_URL = process.env.AUTOM8TE_SUPERVISOR_URL || 'http://localhost:8080';

async function fetchJSON(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  
  const res = await fetch(`${SUPERVISOR_URL}${path}`, opts);
  return res.json();
}

export class SupervisorAdapter {
  constructor(options = {}) {
    this.droneCount = options.droneCount || 4;
    this.connected = false;
    this.drones = new Map();
    this.formation = 'none';
  }

  async connect() {
    // Try to connect — retry for 60s since Webots may still be loading
    console.error(`[Supervisor] Connecting to ${SUPERVISOR_URL}...`);
    for (let i = 0; i < 60; i++) {
      try {
        const status = await fetchJSON('/api/status');
        if (status.drones) {
          this.connected = true;
          this.droneCount = status.count;
          this._updateDrones(status.drones);
          console.error(`[Supervisor] Connected — ${this.droneCount} drones`);
          return;
        }
      } catch (e) {
        if (i % 10 === 0) {
          console.error(`[Supervisor] Waiting for Webots Supervisor on ${SUPERVISOR_URL}... (${i}s)`);
        }
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    throw new Error(
      `Supervisor API not available at ${SUPERVISOR_URL} after 60s. ` +
      `Is Webots running? Launch with: ./launch_supervisor.sh`
    );
  }

  _updateDrones(droneData) {
    for (const [id, state] of Object.entries(droneData)) {
      this.drones.set(id, {
        id,
        position: state.position,
        velocity: state.velocity,
        heading: 0,
        armed: state.armed,
        mode: state.mode,
        battery: 100,
        status: state.mode.toLowerCase(),
      });
    }
  }

  async disconnect() {
    this.connected = false;
    this.drones.clear();
  }

  isConnected() { return this.connected; }

  async getDroneStates() {
    try {
      const status = await fetchJSON('/api/status');
      this._updateDrones(status.drones);
    } catch (e) {
      // Use cached
    }
    return new Map(this.drones);
  }

  async getDroneCount() { return this.droneCount; }

  async getSwarmState() {
    const drones = await this.getDroneStates();
    const positions = [...drones.values()].map(d => d.position);
    const centroid = positions.length > 0 ? [
      positions.reduce((s, p) => s + p[0], 0) / positions.length,
      positions.reduce((s, p) => s + p[1], 0) / positions.length,
      positions.reduce((s, p) => s + p[2], 0) / positions.length,
    ] : [0, 0, 0];
    return { count: drones.size, formation: this.formation, centroid, drones };
  }

  async getSwarmCenter() {
    const state = await this.getSwarmState();
    return state.centroid;
  }

  // --- Commands ---

  _checkConnected() {
    if (!this.connected) {
      throw new Error('Not connected to Webots Supervisor. Run ./launch_supervisor.sh first.');
    }
  }

  async takeoff(droneId, altitude, speed) {
    this._checkConnected();
    return fetchJSON('/api/takeoff', 'POST', { drone_id: droneId, altitude, speed });
  }

  async land(droneId, speed) {
    return fetchJSON('/api/land', 'POST', { drone_id: droneId });
  }

  async goTo(droneId, x, y, z, speed) {
    // Relative move
    return fetchJSON('/api/goto', 'POST', {
      drone_id: droneId, north: x, east: y, altitude: z, speed,
    });
  }

  async hover(droneId) {
    return fetchJSON('/api/hover', 'POST', { drone_id: droneId });
  }

  async rtl(droneId) {
    return fetchJSON('/api/land', 'POST', { drone_id: droneId });
  }

  async emergency(droneId) {
    return fetchJSON('/api/emergency', 'POST', {});
  }

  async setFormation(offsets, droneIds = null) {
    // Convert offsets to absolute positions relative to swarm center
    const center = await this.getSwarmCenter();
    const ids = droneIds || [...this.drones.keys()];
    const positions = {};

    for (let i = 0; i < Math.min(ids.length, offsets.length); i++) {
      positions[ids[i]] = [
        center[0] + offsets[i][0],
        center[1] + offsets[i][1],
        center[2] + offsets[i][2],
      ];
    }

    this.formation = 'custom';
    return fetchJSON('/api/formation', 'POST', { positions, speed: 5 });
  }

  async followPath(droneId, waypoints, speed) {
    return fetchJSON('/api/follow_path', 'POST', {
      paths: { [droneId]: waypoints },
      speed,
    });
  }

  async executeChoreography(shape, droneIds, scale = 5) {
    // Import path planner dynamically
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

    // Convert paths to waypoint arrays and send to supervisor
    const allPaths = {};
    const waypointData = pathsToWaypoints(paths);
    for (const [droneId, { waypoints }] of waypointData) {
      allPaths[droneId] = waypoints;
    }

    await fetchJSON('/api/follow_path', 'POST', {
      paths: allPaths,
      speed: 5,
      loop: !!shape.motion,  // Motion paths loop
    });

    return { dispatched: Object.keys(allPaths).length, duration_s: shape.duration_s || 0 };
  }
}
