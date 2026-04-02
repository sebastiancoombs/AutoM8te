"""
YOLO Vision Module for Webots Supervisor

Processes camera images from drone nodes via Webots Camera API.
Runs YOLOv8 detection and returns objects with positions.
"""

import os
import sys
import numpy as np
import time
from collections import defaultdict

# Webots path
WEBOTS_HOME = os.environ.get("WEBOTS_HOME", "/Applications/Webots.app")
sys.path.append(f"{WEBOTS_HOME}/lib/controller/python")

try:
    from ultralytics import YOLO
    HAS_YOLO = True
except ImportError:
    HAS_YOLO = False


class DroneVision:
    """
    Per-drone vision processor.
    Grabs camera frames from Webots and runs YOLO detection.
    """

    def __init__(self, drone_id, camera_device, model):
        self.drone_id = drone_id
        self.camera = camera_device
        self.model = model
        self.width = camera_device.getWidth()
        self.height = camera_device.getHeight()
        self.last_detections = []
        self.last_frame_time = 0

    def detect(self, confidence_threshold=0.4):
        """
        Run YOLO on current camera frame.
        
        Returns list of detections:
        [{"class": "car", "confidence": 0.92, "bbox": [x1,y1,x2,y2], "center": [cx,cy]}]
        """
        # Get image from Webots camera
        image_data = self.camera.getImage()
        if image_data is None:
            return []

        # Convert Webots BGRA image to numpy RGB
        img = np.frombuffer(image_data, dtype=np.uint8).reshape(self.height, self.width, 4)
        img_rgb = img[:, :, [2, 1, 0]]  # BGRA → RGB

        # Run YOLO
        results = self.model(img_rgb, verbose=False, conf=confidence_threshold)

        detections = []
        for r in results:
            for box in r.boxes:
                cls_id = int(box.cls[0])
                cls_name = self.model.names[cls_id]
                conf = float(box.conf[0])
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                cx = (x1 + x2) / 2
                cy = (y1 + y2) / 2

                detections.append({
                    "class": cls_name,
                    "confidence": round(conf, 3),
                    "bbox": [round(x1), round(y1), round(x2), round(y2)],
                    "center": [round(cx, 1), round(cy, 1)],
                    "width_px": round(x2 - x1),
                    "height_px": round(y2 - y1),
                })

        self.last_detections = detections
        self.last_frame_time = time.time()
        return detections


class VisionManager:
    """
    Manages YOLO detection across all drone cameras.
    """

    def __init__(self, model_path="yolov8n.pt"):
        self.model = None
        self.drone_visions = {}  # drone_id -> DroneVision
        self.enabled = False

        if HAS_YOLO:
            try:
                self.model = YOLO(model_path)
                self.enabled = True
                print(f"[Vision] YOLOv8 loaded ({len(self.model.names)} classes)")
            except Exception as e:
                print(f"[Vision] Failed to load YOLO: {e}")
        else:
            print("[Vision] ultralytics not installed — vision disabled")

    def register_drone(self, drone_id, camera_device):
        """Register a drone's camera for processing."""
        if not self.enabled:
            return
        vision = DroneVision(drone_id, camera_device, self.model)
        self.drone_visions[drone_id] = vision
        print(f"[Vision] Registered {drone_id} camera ({vision.width}x{vision.height})")

    def detect_all(self, confidence=0.4):
        """
        Run detection on all registered cameras.
        
        Returns {drone_id: [detections]}
        """
        if not self.enabled:
            return {}

        results = {}
        for drone_id, vision in self.drone_visions.items():
            detections = vision.detect(confidence_threshold=confidence)
            if detections:
                results[drone_id] = detections
        return results

    def detect_one(self, drone_id, confidence=0.4):
        """Run detection on a single drone's camera."""
        if not self.enabled:
            return []
        vision = self.drone_visions.get(drone_id)
        if not vision:
            return []
        return vision.detect(confidence_threshold=confidence)

    def get_status(self):
        return {
            "enabled": self.enabled,
            "model": "yolov8n" if self.enabled else None,
            "classes": len(self.model.names) if self.model else 0,
            "cameras": list(self.drone_visions.keys()),
        }
