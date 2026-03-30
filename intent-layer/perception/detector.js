/**
 * YOLO Object Detection Integration
 * 
 * Runs YOLO on camera frames, tracks objects over time,
 * provides positions to intent layer.
 */

import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * @typedef {Object} DetectedObject
 * @property {string} id - Unique tracking ID
 * @property {string} class - Object class (person, car, truck, etc.)
 * @property {number} confidence - Detection confidence 0-1
 * @property {[number, number, number]} position - Estimated [x, y, z] in world frame
 * @property {[number, number, number, number]} bbox - [x, y, width, height] in image
 * @property {number} lastSeen - Timestamp of last detection
 * @property {[number, number, number][]} trajectory - Recent positions
 */

export class ObjectDetector {
  constructor(options = {}) {
    this.modelPath = options.modelPath || 'yolov8n.pt';
    this.confidence = options.confidence || 0.5;
    this.process = null;
    this.objects = new Map(); // id -> DetectedObject
    this.nextId = 1;
    this.maxTrajectoryLength = 50;
    this.staleThresholdMs = 2000; // Object considered lost after 2s
    
    // Camera intrinsics (default, should be calibrated)
    this.focalLength = options.focalLength || 500;
    this.principalPoint = options.principalPoint || [320, 240];
    
    // Known object sizes for depth estimation (meters)
    this.knownSizes = {
      person: 1.7,   // height
      car: 4.5,      // length
      truck: 8.0,
      bicycle: 1.8,
      motorcycle: 2.0,
      dog: 0.5,
      cat: 0.3,
      bird: 0.2,
      tree: 5.0,
      ...options.knownSizes,
    };
  }

  /**
   * Start the YOLO detection process
   */
  async start() {
    const scriptPath = join(__dirname, 'yolo_bridge.py');
    
    this.process = spawn('python3', [
      scriptPath,
      '--model', this.modelPath,
      '--confidence', this.confidence.toString(),
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.stdout.on('data', (data) => {
      this._handleDetections(data.toString());
    });

    this.process.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (!msg.includes('Model loaded') && !msg.includes('Ultralytics')) {
        console.error('[Detector]', msg);
      }
    });

    console.log('[Detector] Started YOLO detection');
  }

  /**
   * Stop the detection process
   */
  async stop() {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    console.log('[Detector] Stopped');
  }

  /**
   * Process a camera frame
   * @param {Buffer} imageData - Raw image bytes (JPEG/PNG)
   * @param {string} droneId - Which drone's camera
   * @param {[number, number, number]} dronePosition - Drone world position
   * @param {number} droneHeading - Drone yaw in radians
   */
  async processFrame(imageData, droneId, dronePosition, droneHeading) {
    if (!this.process) return [];

    const request = {
      image: imageData.toString('base64'),
      drone_id: droneId,
      drone_position: dronePosition,
      drone_heading: droneHeading,
    };

    this.process.stdin.write(JSON.stringify(request) + '\n');
  }

  /**
   * Handle detections from YOLO process
   */
  _handleDetections(data) {
    const lines = data.trim().split('\n');
    for (const line of lines) {
      try {
        const result = JSON.parse(line);
        this._updateObjects(result.detections, result.drone_position, result.drone_heading);
      } catch (e) {
        // Ignore parse errors
      }
    }
  }

  /**
   * Update tracked objects with new detections
   */
  _updateObjects(detections, dronePosition, droneHeading) {
    const now = Date.now();
    
    for (const det of detections) {
      // Estimate world position from bbox
      const worldPos = this._estimateWorldPosition(
        det.bbox, 
        det.class, 
        dronePosition, 
        droneHeading
      );

      // Try to match with existing object
      let matched = this._matchObject(det.class, worldPos);
      
      if (matched) {
        // Update existing
        matched.confidence = det.confidence;
        matched.bbox = det.bbox;
        matched.position = worldPos;
        matched.lastSeen = now;
        matched.trajectory.push([...worldPos]);
        if (matched.trajectory.length > this.maxTrajectoryLength) {
          matched.trajectory.shift();
        }
      } else {
        // Create new
        const obj = {
          id: `obj_${this.nextId++}`,
          class: det.class,
          confidence: det.confidence,
          position: worldPos,
          bbox: det.bbox,
          lastSeen: now,
          trajectory: [[...worldPos]],
        };
        this.objects.set(obj.id, obj);
      }
    }

    // Remove stale objects
    for (const [id, obj] of this.objects) {
      if (now - obj.lastSeen > this.staleThresholdMs) {
        this.objects.delete(id);
      }
    }
  }

  /**
   * Match detection to existing tracked object
   */
  _matchObject(className, position, maxDistance = 3) {
    let bestMatch = null;
    let bestDist = maxDistance;

    for (const obj of this.objects.values()) {
      if (obj.class !== className) continue;
      
      const dist = Math.sqrt(
        (obj.position[0] - position[0]) ** 2 +
        (obj.position[1] - position[1]) ** 2 +
        (obj.position[2] - position[2]) ** 2
      );

      if (dist < bestDist) {
        bestDist = dist;
        bestMatch = obj;
      }
    }

    return bestMatch;
  }

  /**
   * Estimate world position from bounding box
   * Uses known object sizes for depth estimation
   */
  _estimateWorldPosition(bbox, className, dronePosition, droneHeading) {
    const [bx, by, bw, bh] = bbox;
    
    // Known size (use height for most objects)
    const knownSize = this.knownSizes[className] || 1.0;
    
    // Estimate depth from apparent size
    const apparentSize = Math.max(bw, bh);
    const depth = (knownSize * this.focalLength) / apparentSize;
    
    // Convert image coords to camera frame angles
    const cx = bx + bw / 2;
    const cy = by + bh / 2;
    const angleX = Math.atan2(cx - this.principalPoint[0], this.focalLength);
    const angleY = Math.atan2(cy - this.principalPoint[1], this.focalLength);
    
    // Camera frame position
    const camX = depth * Math.tan(angleX);
    const camY = depth * Math.tan(angleY);
    const camZ = depth;
    
    // Rotate by drone heading to world frame
    const cos = Math.cos(droneHeading);
    const sin = Math.sin(droneHeading);
    
    const worldX = dronePosition[0] + camZ * cos - camX * sin;
    const worldY = dronePosition[1] + camZ * sin + camX * cos;
    const worldZ = dronePosition[2] - camY;  // Camera looks forward, Y is down
    
    return [worldX, worldY, worldZ];
  }

  /**
   * Get all tracked objects
   */
  getObjects() {
    return [...this.objects.values()];
  }

  /**
   * Find object by class name or ID
   */
  findObject(target) {
    // Try exact ID match
    if (this.objects.has(target)) {
      return this.objects.get(target);
    }

    // Try class match (return closest/most confident)
    const targetLower = target.toLowerCase();
    let best = null;
    let bestScore = 0;

    for (const obj of this.objects.values()) {
      if (obj.class.toLowerCase().includes(targetLower)) {
        const score = obj.confidence * (1 - (Date.now() - obj.lastSeen) / this.staleThresholdMs);
        if (score > bestScore) {
          bestScore = score;
          best = obj;
        }
      }
    }

    return best;
  }

  /**
   * Get position of a target
   */
  getObjectPosition(target) {
    const obj = this.findObject(target);
    return obj ? { position: obj.position, confidence: obj.confidence } : null;
  }

  /**
   * Predict future position based on trajectory
   */
  predictPosition(target, secondsAhead = 1) {
    const obj = this.findObject(target);
    if (!obj || obj.trajectory.length < 2) return null;

    // Simple linear extrapolation
    const recent = obj.trajectory.slice(-10);
    const first = recent[0];
    const last = recent[recent.length - 1];
    const dt = (recent.length - 1) * 0.1; // Assume 10Hz updates
    
    const vx = (last[0] - first[0]) / dt;
    const vy = (last[1] - first[1]) / dt;
    const vz = (last[2] - first[2]) / dt;

    return {
      position: [
        last[0] + vx * secondsAhead,
        last[1] + vy * secondsAhead,
        last[2] + vz * secondsAhead,
      ],
      velocity: [vx, vy, vz],
      confidence: obj.confidence * 0.8, // Reduce confidence for predictions
    };
  }
}

/**
 * Mock detector for testing without YOLO
 */
export class MockDetector {
  constructor() {
    this.objects = new Map();
    this._setupMockObjects();
  }

  _setupMockObjects() {
    // Simulate some objects in the environment
    this.objects.set('obj_1', {
      id: 'obj_1',
      class: 'person',
      confidence: 0.92,
      position: [15, 5, 0],
      bbox: [100, 150, 50, 120],
      lastSeen: Date.now(),
      trajectory: [[15, 5, 0]],
    });

    this.objects.set('obj_2', {
      id: 'obj_2',
      class: 'car',
      confidence: 0.88,
      position: [25, -10, 0],
      bbox: [200, 180, 100, 60],
      lastSeen: Date.now(),
      trajectory: [[25, -10, 0]],
    });

    this.objects.set('obj_3', {
      id: 'obj_3',
      class: 'truck',
      confidence: 0.95,
      position: [40, 0, 0],
      bbox: [300, 160, 150, 80],
      lastSeen: Date.now(),
      trajectory: [[40, 0, 0]],
    });
  }

  async start() {
    console.log('[MockDetector] Started (simulated objects)');
  }

  async stop() {
    console.log('[MockDetector] Stopped');
  }

  getObjects() {
    // Simulate movement
    for (const obj of this.objects.values()) {
      if (obj.class === 'car' || obj.class === 'truck') {
        obj.position[0] += 0.1; // Moving forward
        obj.trajectory.push([...obj.position]);
        if (obj.trajectory.length > 50) obj.trajectory.shift();
      }
      obj.lastSeen = Date.now();
    }
    return [...this.objects.values()];
  }

  findObject(target) {
    const targetLower = target.toLowerCase();
    for (const obj of this.objects.values()) {
      if (obj.id === target || obj.class.toLowerCase().includes(targetLower)) {
        return obj;
      }
    }
    return null;
  }

  getObjectPosition(target) {
    const obj = this.findObject(target);
    return obj ? { position: obj.position, confidence: obj.confidence } : null;
  }

  predictPosition(target, secondsAhead = 1) {
    const obj = this.findObject(target);
    if (!obj) return null;

    // Mock prediction: assume constant velocity
    const velocity = obj.class === 'car' || obj.class === 'truck' 
      ? [2, 0, 0]  // Moving forward at 2 m/s
      : [0, 0, 0];

    return {
      position: [
        obj.position[0] + velocity[0] * secondsAhead,
        obj.position[1] + velocity[1] * secondsAhead,
        obj.position[2] + velocity[2] * secondsAhead,
      ],
      velocity,
      confidence: obj.confidence * 0.8,
    };
  }
}
