/**
 * DroneKit Adapter — connects intent layer to ArduPilot SITL via MAVLink.
 * 
 * Uses mavlink-tcp connections to N SITL instances.
 * Each drone is on tcp:127.0.0.1:(5760 + instance*10)
 * 
 * Since DroneKit is Python and our intent layer is Node.js,
 * we run a thin Python process (dronekit_bridge.py) that exposes HTTP.
 * The adapter talks to that bridge on :8080.
 * 
 * This is the same HTTP interface as SupervisorAdapter — 
 * the bridge translates HTTP → DroneKit → MAVLink → SITL.
 */

const BRIDGE_URL = process.env.DRONEKIT_BRIDGE_URL || 'http://localhost:8080';

async function fetchJSON(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BRIDGE_URL}${path}`, opts);
  return res.json();
}

export class DroneKitAdapter {
  constructor({ droneCount = 4 } = {}) {
    this.droneCount = droneCount;
    this.connected = false;
    this.drones = new Map();
    this.formation = 'none';
  }

  async connect() {
    // Try to reach the bridge
    try {
      const status = await fetchJSON('/api/status');
      if (status.drones) {
        this.connected = true;
        this.droneCount = status.count;
        this._updateDrones(status.drones);
        console.error(`[DroneKit] Connected — ${this.droneCount} drones via bridge`);
        return;
      }
    } catch (e) {
      console.error(`[DroneKit] Bridge not available at ${BRIDGE_URL}: ${e.message}`);
      console.error(`[DroneKit] Start it with: python3 dronekit_bridge.py`);
    }
  }

  _updateDrones(droneData) {
    for (const [id, state] of Object.entries(droneData)) {
      this.drones.set(id, {
        id,
        position: state.position,
        velocity: state.velocity || [0, 0, 0],
        heading: 0,
        armed: state.armed,
        mode: state.mode,
        battery: state.battery || 100,
        status: state.mode?.toLowerCase() || 'unknown',
      });
    }
  }

  async _ensureConnected() {
    try {
      const status = await fetchJSON('/api/status');
      if (status.drones) {
        this.connected = true;
        this.droneCount = status.count;
        this._updateDrones(status.drones);
        return null;
      }
    } catch {
      this.connected = false;
    }
    return { error: `DroneKit bridge not running on ${BRIDGE_URL}. Start: python3 dronekit_bridge.py` };
  }

  async disconnect() {
    this.connected = false;
    this.drones.clear();
  }

  isConnected() { return this.connected; }

  async getDroneStates() {
    await this._ensureConnected();
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

  // --- Commands (all via bridge HTTP → DroneKit → MAVLink → SITL) ---

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

  async goTo(droneId, north, east, alt, speed) {
    const err = await this._ensureConnected();
    if (err) return err;
    return fetchJSON('/api/goto', 'POST', { drone_id: droneId, north, east, altitude: alt, speed });
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
    const err = await this._ensureConnected();
    if (err) return err;
    const positions = {};
    const ids = droneIds || [...this.drones.keys()];
    for (let i = 0; i < Math.min(ids.length, offsets.length); i++) {
      positions[ids[i]] = offsets[i];
    }
    return fetchJSON('/api/formation', 'POST', { positions });
  }
}
