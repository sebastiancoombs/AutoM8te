#!/usr/bin/env python3
"""
AutoM8te YOLO Detection Server

Connects to drone camera streams (ports 5600+) and runs YOLOv8.
Exposes detections via HTTP API on port 8081.

Usage:
    python3 yolo_server.py --drones 4 --camera-base-port 5600
"""

import argparse
import json
import socket
import struct
import threading
import time
import numpy as np
from http.server import HTTPServer, BaseHTTPRequestHandler

from ultralytics import YOLO

# ─── Camera Stream Reader ────────────────────────────────────────────

class CameraStream:
    """Reads grayscale images from Webots camera stream port."""

    def __init__(self, drone_id, port, width=640, height=480):
        self.drone_id = drone_id
        self.port = port
        self.width = width
        self.height = height
        self.frame = None
        self.connected = False
        self.lock = threading.Lock()

    def connect(self):
        """Connect to camera stream port."""
        try:
            self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.sock.settimeout(5)
            self.sock.connect(('127.0.0.1', self.port))
            self.connected = True
            print(f"[YOLO] Connected to {self.drone_id} camera on port {self.port}")
            return True
        except Exception as e:
            print(f"[YOLO] Cannot connect to {self.drone_id} camera port {self.port}: {e}")
            return False

    def read_frame(self):
        """Read one frame from the stream."""
        if not self.connected:
            return None
        try:
            # Webots streams grayscale images as raw bytes
            frame_size = self.width * self.height
            data = b''
            while len(data) < frame_size:
                chunk = self.sock.recv(frame_size - len(data))
                if not chunk:
                    self.connected = False
                    return None
                data += chunk
            frame = np.frombuffer(data, dtype=np.uint8).reshape(self.height, self.width)
            with self.lock:
                self.frame = frame
            return frame
        except Exception:
            self.connected = False
            return None

    def get_latest(self):
        with self.lock:
            return self.frame


# ─── YOLO Detector ───────────────────────────────────────────────────

class YOLODetector:
    def __init__(self, model_path="yolov8n.pt"):
        self.model = YOLO(model_path)
        self.cameras = {}  # drone_id -> CameraStream
        self.detections = {}  # drone_id -> [detections]
        self.lock = threading.Lock()
        print(f"[YOLO] Model loaded ({len(self.model.names)} classes)")

    def add_camera(self, drone_id, port):
        cam = CameraStream(drone_id, port)
        self.cameras[drone_id] = cam
        return cam

    def detect_frame(self, frame, confidence=0.4):
        """Run YOLO on a numpy frame."""
        if frame is None:
            return []

        # Convert grayscale to 3-channel for YOLO
        if len(frame.shape) == 2:
            frame = np.stack([frame] * 3, axis=-1)

        results = self.model(frame, verbose=False, conf=confidence)

        detections = []
        for r in results:
            for box in r.boxes:
                cls_id = int(box.cls[0])
                cls_name = self.model.names[cls_id]
                conf = float(box.conf[0])
                x1, y1, x2, y2 = box.xyxy[0].tolist()

                detections.append({
                    "class": cls_name,
                    "confidence": round(conf, 3),
                    "bbox": [round(x1), round(y1), round(x2), round(y2)],
                    "center": [round((x1+x2)/2, 1), round((y1+y2)/2, 1)],
                })

        return detections

    def detect_all(self, confidence=0.4):
        """Run detection on all cameras with available frames."""
        results = {}
        for drone_id, cam in self.cameras.items():
            frame = cam.get_latest()
            if frame is not None:
                dets = self.detect_frame(frame, confidence)
                results[drone_id] = dets
                with self.lock:
                    self.detections[drone_id] = dets
        return results

    def get_cached(self):
        with self.lock:
            return dict(self.detections)


# ─── Global State ────────────────────────────────────────────────────

detector = None


# ─── HTTP API ────────────────────────────────────────────────────────

class YOLOHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def _json(self, code, data):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def do_GET(self):
        if self.path == '/api/detect':
            results = detector.detect_all()
            self._json(200, {"detections": results})

        elif self.path.startswith('/api/detect/'):
            drone_id = self.path.split('/')[-1]
            cam = detector.cameras.get(drone_id)
            if cam:
                frame = cam.get_latest()
                dets = detector.detect_frame(frame)
                self._json(200, {"drone_id": drone_id, "detections": dets})
            else:
                self._json(404, {"error": f"no camera for {drone_id}"})

        elif self.path == '/api/vision/status':
            self._json(200, {
                "model": "yolov8n",
                "classes": len(detector.model.names),
                "cameras": {did: cam.connected for did, cam in detector.cameras.items()},
                "cached_detections": {did: len(dets) for did, dets in detector.get_cached().items()},
            })

        else:
            self._json(404, {"error": "not found"})


# ─── Camera Reader Threads ───────────────────────────────────────────

def camera_reader(cam):
    """Continuously read frames from a camera stream."""
    while True:
        if not cam.connected:
            cam.connect()
            time.sleep(1)
            continue
        cam.read_frame()
        time.sleep(0.1)  # 10 fps


# ─── Main ────────────────────────────────────────────────────────────

def main():
    global detector

    parser = argparse.ArgumentParser()
    parser.add_argument('--drones', type=int, default=4)
    parser.add_argument('--camera-base-port', type=int, default=5600)
    parser.add_argument('--port', type=int, default=8081)
    parser.add_argument('--model', type=str, default='yolov8n.pt')
    args = parser.parse_args()

    detector = YOLODetector(args.model)

    # Set up camera streams
    for i in range(args.drones):
        drone_id = f"drone_{i}"
        cam_port = args.camera_base_port + i
        cam = detector.add_camera(drone_id, cam_port)

        # Start reader thread
        t = threading.Thread(target=camera_reader, args=(cam,), daemon=True)
        t.start()

    print(f"[YOLO] Server starting on port {args.port}")
    server = HTTPServer(('0.0.0.0', args.port), YOLOHandler)
    server.serve_forever()


if __name__ == '__main__':
    main()
