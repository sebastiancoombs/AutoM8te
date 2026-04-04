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
    // Just try once — real connection happens lazily on first command
    await this._tryConnect();
  }

  async _tryConnect() {
    try {
      const status = await fetchJSON('/api/status');
      if (status.drones) {
        if (!this.connected) {
          console.error(`[Supervisor] Connected — ${status.count} drones`);
        }
        this.connected = true;
        this.droneCount = status.count;
        this._updateDrones(status.drones);
        return true;
      }
    } catch {
      this.connected = false;
    }
    return false;
  }

  async _ensureConnected() {
    // Always try — Webots might have just started or restarted
    await this._tryConnect();
    if (!this.connected) {
      return { error: `Webots Supervisor not running on ${SUPERVISOR_URL}. Run ./launch_supervisor.sh` };
    }
    return null;
  }

  _updateDrones(droneData) {
    for (const [id, state] of Object.entries(droneData)) {
      this.drones.set(id, {
        id,
        position: state.position,
        velocity: state.velocity || [0, 0, 0],
        target: state.target || null,
        heading: 0,
        armed: state.armed,
        mode: state.mode,
        battery: 100,
        status: state.mode.toLowerCase(),
        path_progress: state.path_progress || null,
        mission: state.mission || null,
      });
    }
  }

  async disconnect() {
    this.connected = false;
    this.drones.clear();
  }

  isConnected() { return this.connected; }

  async getDroneStates() {
    await this._tryConnect();  // Reconnect if needed, update state
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

  async takeoff(droneId, altitude, speed) {
    const err = await this._ensureConnected();
    if (err) return err;
    return fetchJSON('/api/takeoff', 'POST', { drone_id: droneId, altitude, speed });
  }

  async land(droneId, speed) {
    const err = await this._ensureConnected();
    if (err) return err;
    return fetchJSON('/api/land', 'POST', { drone_id: droneId });
  }

  async goTo(droneId, x, y, z, speed, frame) {
    const err = await this._ensureConnected();
    if (err) return err;
    if (frame === 'absolute') {
      // Absolute world position
      return fetchJSON('/api/goto_abs', 'POST', {
        drone_id: droneId, x, y, z, speed,
      });
    }
    // Relative offset — x maps to Webots X, y maps to Webots Y
    // If altitude component is 0 (horizontal move), preserve current altitude
    let altitude = z;
    if (altitude === 0) {
      const drone = this.drones.get(droneId);
      if (drone) {
        altitude = drone.position[2]; // Keep current altitude
      }
    }
    return fetchJSON('/api/goto', 'POST', {
      drone_id: droneId, north: y, east: x, altitude, speed,
    });
  }

  async goToAbs(droneId, x, y, z, speed) {
    const err = await this._ensureConnected();
    if (err) return err;
    return fetchJSON('/api/goto_abs', 'POST', {
      drone_id: droneId, x, y, z, speed,
    });
  }

  async hover(droneId) {
    const err = await this._ensureConnected();
    if (err) return err;
    return fetchJSON('/api/hover', 'POST', { drone_id: droneId });
  }

  async rtl(droneId) {
    const err = await this._ensureConnected();
    if (err) return err;
    return fetchJSON('/api/land', 'POST', { drone_id: droneId });
  }

  async emergency(droneId) {
    const err = await this._ensureConnected();
    if (err) return err;
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

  // --- Missions ---

  async startMission(type, targetClass, droneIds = null) {
    const err = await this._ensureConnected();
    if (err) return err;
    const body = { type, target_class: targetClass };
    if (droneIds) body.drone_ids = droneIds;
    return fetchJSON('/api/mission', 'POST', body);
  }

  async stopMission(droneIds = null) {
    const err = await this._ensureConnected();
    if (err) return err;
    const body = {};
    if (droneIds) body.drone_ids = droneIds;
    return fetchJSON('/api/mission/stop', 'POST', body);
  }

  // --- Follow ---

  async startFollow(droneId, targetClass) {
    const err = await this._ensureConnected();
    if (err) return err;
    return fetchJSON('/api/follow', 'POST', { drone_id: droneId, target_class: targetClass });
  }

  async stopFollow(droneId) {
    const err = await this._ensureConnected();
    if (err) return err;
    return fetchJSON('/api/follow/stop', 'POST', { drone_id: droneId });
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
