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
    """Reads RGB frames from camera_streamer TCP stream (length-prefixed)."""

    def __init__(self, drone_id, port, width=640, height=480):
        self.drone_id = drone_id
        self.port = port
        self.width = width
        self.height = height
        self.frame = None
        self.connected = False
        self.sock = None
        self.lock = threading.Lock()
        self.frame_count = 0

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
            if self.sock:
                self.sock.close()
            self.sock = None
            self.connected = False
            return False

    def _recv_exact(self, n):
        """Receive exactly n bytes."""
        data = b''
        while len(data) < n:
            chunk = self.sock.recv(n - len(data))
            if not chunk:
                raise ConnectionError("Connection closed")
            data += chunk
        return data

    def read_frame(self):
        """Read one length-prefixed RGB frame."""
        if not self.connected:
            return None
        try:
            # Read 4-byte length header (big-endian uint32)
            header = self._recv_exact(4)
            frame_size = struct.unpack('>I', header)[0]

            # Read RGB frame data
            data = self._recv_exact(frame_size)

            # Reshape to HxWx3 RGB
            frame = np.frombuffer(data, dtype=np.uint8).reshape(self.height, self.width, 3)

            with self.lock:
                self.frame = frame
                self.frame_count += 1

            return frame
        except Exception as e:
            self.connected = False
            if self.sock:
                self.sock.close()
            self.sock = None
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
        print(f"[YOLO] Built-in tracking: BoT-SORT + ByteTrack")

    def add_camera(self, drone_id, port):
        cam = CameraStream(drone_id, port)
        self.cameras[drone_id] = cam
        return cam

    def detect_frame(self, frame, confidence=0.4, track=True):
        """Run YOLO detection + tracking on a numpy frame."""
        if frame is None:
            return []

        # Convert grayscale to 3-channel for YOLO
        if len(frame.shape) == 2:
            frame = np.stack([frame] * 3, axis=-1)

        # Use .track() for persistent IDs, .predict() for detection only
        if track:
            results = self.model.track(frame, persist=True, verbose=False, conf=confidence)
        else:
            results = self.model(frame, verbose=False, conf=confidence)

        detections = []
        for r in results:
            for box in r.boxes:
                cls_id = int(box.cls[0])
                cls_name = self.model.names[cls_id]
                conf = float(box.conf[0])
                x1, y1, x2, y2 = box.xyxy[0].tolist()

                det = {
                    "class": cls_name,
                    "confidence": round(conf, 3),
                    "bbox": [round(x1), round(y1), round(x2), round(y2)],
                    "center": [round((x1+x2)/2, 1), round((y1+y2)/2, 1)],
                }

                # Add track ID if available
                if track and box.id is not None:
                    track_id = int(box.id[0])
                    det["track_id"] = track_id
                    det["id"] = f"{cls_name}_{track_id}"

                detections.append(det)

        return detections

    def detect_all(self, confidence=0.4):
        """Run detection + tracking on all cameras with available frames."""
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
            # Return cached detections (updated by background detection loop)
            results = detector.get_cached()
            self._json(200, {"detections": results})

        elif self.path.startswith('/api/detect/'):
            drone_id = self.path.split('/')[-1]
            cached = detector.get_cached()
            if drone_id in cached:
                self._json(200, {"drone_id": drone_id, "detections": cached[drone_id]})
            elif drone_id in detector.cameras:
                self._json(200, {"drone_id": drone_id, "detections": [], "note": "no detections yet"})
            else:
                self._json(404, {"error": f"no camera for {drone_id}"})

        elif self.path == '/api/vision/status':
            self._json(200, {
                "model": "yolov8n",
                "tracker": "BoT-SORT (built-in)",
                "classes": len(detector.model.names),
                "cameras": {
                    did: {"connected": cam.connected, "frames": cam.frame_count}
                    for did, cam in detector.cameras.items()
                },
                "cached_detections": {did: len(dets) for did, dets in detector.get_cached().items()},
            })

        else:
            self._json(404, {"error": "not found"})


# ─── Camera Reader Threads ───────────────────────────────────────────

def camera_reader(cam):
    """Continuously read frames from a camera stream."""
    while True:
        if not cam.connected:
            if not cam.connect():
                time.sleep(3)
                continue
        frame = cam.read_frame()
        if frame is None and not cam.connected:
            time.sleep(1)


def detection_loop(det, interval=0.5):
    """Run YOLO detection continuously in background (2 fps)."""
    while True:
        det.detect_all()
        time.sleep(interval)


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

    # Start background detection loop (runs YOLO continuously)
    det_thread = threading.Thread(target=detection_loop, args=(detector,), daemon=True)
    det_thread.start()
    print(f"[YOLO] Detection loop running (2 fps)")

    print(f"[YOLO] Server starting on port {args.port}")
    server = HTTPServer(('0.0.0.0', args.port), YOLOHandler)
    server.serve_forever()


if __name__ == '__main__':
    main()
