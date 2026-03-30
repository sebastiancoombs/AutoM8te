/**
 * SwarmBackend Interface
 * 
 * All adapters implement this interface.
 * Intent layer calls these methods; adapter handles backend specifics.
 */

/**
 * @typedef {Object} DroneState
 * @property {string} id
 * @property {[number, number, number]} position - [x, y, z] meters
 * @property {[number, number, number]} velocity - [vx, vy, vz] m/s
 * @property {number} heading - yaw in radians
 * @property {boolean} armed
 * @property {boolean} offboard
 * @property {number} battery - 0-100
 * @property {string} status - 'idle' | 'flying' | 'landing' | 'error'
 */

/**
 * @typedef {Object} SwarmState
 * @property {Map<string, DroneState>} drones
 * @property {number} count
 * @property {string} formation - current formation name
 * @property {[number, number, number]} centroid - swarm center position
 */

/**
 * Base class for swarm backend adapters
 */
export class SwarmBackend {
  constructor() {
    if (new.target === SwarmBackend) {
      throw new Error('SwarmBackend is abstract');
    }
  }

  // --- Connection ---
  
  async connect() {
    throw new Error('Not implemented');
  }
  
  async disconnect() {
    throw new Error('Not implemented');
  }
  
  isConnected() {
    throw new Error('Not implemented');
  }

  // --- State ---
  
  /**
   * Get all drone states
   * @returns {Promise<Map<string, DroneState>>}
   */
  async getDroneStates() {
    throw new Error('Not implemented');
  }
  
  /**
   * Get single drone state
   * @param {string} droneId
   * @returns {Promise<DroneState>}
   */
  async getDroneState(droneId) {
    throw new Error('Not implemented');
  }
  
  /**
   * Get swarm summary
   * @returns {Promise<SwarmState>}
   */
  async getSwarmState() {
    throw new Error('Not implemented');
  }
  
  /**
   * Get drone count
   * @returns {Promise<number>}
   */
  async getDroneCount() {
    throw new Error('Not implemented');
  }

  // --- Basic Commands ---
  
  /**
   * Arm drone
   * @param {string} droneId
   */
  async arm(droneId) {
    throw new Error('Not implemented');
  }
  
  /**
   * Disarm drone
   * @param {string} droneId
   */
  async disarm(droneId) {
    throw new Error('Not implemented');
  }
  
  /**
   * Takeoff
   * @param {string} droneId
   * @param {number} altitude - meters
   * @param {number} speed - m/s
   */
  async takeoff(droneId, altitude, speed) {
    throw new Error('Not implemented');
  }
  
  /**
   * Land
   * @param {string} droneId
   * @param {number} speed - m/s
   */
  async land(droneId, speed) {
    throw new Error('Not implemented');
  }
  
  /**
   * Go to position
   * @param {string} droneId
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} speed - m/s
   * @param {string} frame - 'earth' | 'base_link'
   */
  async goTo(droneId, x, y, z, speed, frame = 'earth') {
    throw new Error('Not implemented');
  }
  
  /**
   * Hover in place
   * @param {string} droneId
   */
  async hover(droneId) {
    throw new Error('Not implemented');
  }
  
  /**
   * Return to launch
   * @param {string} droneId
   * @param {number} altitude - RTL altitude
   * @param {number} speed
   */
  async rtl(droneId, altitude, speed) {
    throw new Error('Not implemented');
  }
  
  /**
   * Emergency stop
   * @param {string} droneId - optional, all if omitted
   */
  async emergency(droneId) {
    throw new Error('Not implemented');
  }

  // --- Path Following ---
  
  /**
   * Follow waypoint path
   * @param {string} droneId
   * @param {Array<[number, number, number]>} waypoints
   * @param {number} speed
   */
  async followPath(droneId, waypoints, speed) {
    throw new Error('Not implemented');
  }

  // --- Swarm Commands ---
  
  /**
   * Set swarm formation
   * @param {Array<{id: string, offset: [number, number, number]}>} offsets
   */
  async setFormation(offsets) {
    throw new Error('Not implemented');
  }
  
  /**
   * Move swarm centroid
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {string} frame
   */
  async moveSwarm(x, y, z, frame = 'earth') {
    throw new Error('Not implemented');
  }

  // --- Perception (Phase 3) ---
  
  /**
   * Get tracked object position
   * @param {string} target - object identifier or class
   * @returns {Promise<{position: [number, number, number], confidence: number} | null>}
   */
  async getObjectPosition(target) {
    // Default: not implemented, return null
    return null;
  }
  
  /**
   * Follow a tracked object
   * @param {string} droneId
   * @param {string} target
   */
  async followObject(droneId, target) {
    throw new Error('Perception not available');
  }
}
