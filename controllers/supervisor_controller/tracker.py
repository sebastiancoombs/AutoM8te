"""
Object Tracker — Simple SORT-style IOU tracker

Maintains persistent IDs across YOLO detection frames.
No deep features needed — uses bounding box overlap (IOU).

"That car at pixel (320,240) is car_3, same one from last frame."
"""

import time
import math
from collections import defaultdict


def iou(box_a, box_b):
    """Intersection over Union for two boxes [x1,y1,x2,y2]."""
    x1 = max(box_a[0], box_b[0])
    y1 = max(box_a[1], box_b[1])
    x2 = min(box_a[2], box_b[2])
    y2 = min(box_a[3], box_b[3])

    inter = max(0, x2 - x1) * max(0, y2 - y1)
    area_a = (box_a[2] - box_a[0]) * (box_a[3] - box_a[1])
    area_b = (box_b[2] - box_b[0]) * (box_b[3] - box_b[1])
    union = area_a + area_b - inter

    return inter / max(union, 1e-6)


class TrackedObject:
    """A tracked object with persistent ID."""

    def __init__(self, track_id, cls, bbox, center, confidence):
        self.id = track_id
        self.cls = cls
        self.bbox = bbox
        self.center = center
        self.confidence = confidence
        self.velocity = [0, 0]  # Pixel velocity (dx, dy per frame)
        self.last_center = center
        self.last_seen = time.time()
        self.age = 0            # Frames since creation
        self.hits = 1           # Frames where detected
        self.misses = 0         # Consecutive frames without detection

    def update(self, bbox, center, confidence):
        """Update with new detection."""
        self.velocity = [
            center[0] - self.center[0],
            center[1] - self.center[1],
        ]
        self.last_center = self.center
        self.bbox = bbox
        self.center = center
        self.confidence = confidence
        self.last_seen = time.time()
        self.age += 1
        self.hits += 1
        self.misses = 0

    def predict(self):
        """Predict next position based on velocity."""
        return [
            self.center[0] + self.velocity[0],
            self.center[1] + self.velocity[1],
        ]

    def to_dict(self):
        return {
            "id": self.id,
            "class": self.cls,
            "bbox": self.bbox,
            "center": self.center,
            "confidence": self.confidence,
            "velocity_px": [round(v, 1) for v in self.velocity],
            "age": self.age,
            "hits": self.hits,
            "time_since_seen": round(time.time() - self.last_seen, 2),
        }


class ObjectTracker:
    """
    IOU-based multi-object tracker.
    
    Matches new YOLO detections to existing tracks using bounding box overlap.
    Creates new tracks for unmatched detections, removes stale tracks.
    """

    def __init__(self, iou_threshold=0.3, max_misses=15):
        self.tracks = {}         # track_id -> TrackedObject
        self.next_id = 0
        self.iou_threshold = iou_threshold
        self.max_misses = max_misses

    def _new_id(self, cls):
        tid = f"{cls}_{self.next_id}"
        self.next_id += 1
        return tid

    def update(self, detections):
        """
        Update tracker with new YOLO detections.
        
        Args:
            detections: list of {"class", "bbox", "center", "confidence"}
        
        Returns:
            list of TrackedObject (active tracks)
        """
        # Mark all tracks as missed this frame
        for track in self.tracks.values():
            track.misses += 1
            track.age += 1

        # Match detections to existing tracks
        unmatched_detections = list(range(len(detections)))
        matched = set()

        # Try to match each track to best detection
        for tid, track in list(self.tracks.items()):
            best_iou = 0
            best_det_idx = None

            for det_idx in unmatched_detections:
                det = detections[det_idx]
                if det["class"] != track.cls:
                    continue
                score = iou(track.bbox, det["bbox"])
                if score > best_iou:
                    best_iou = score
                    best_det_idx = det_idx

            if best_iou >= self.iou_threshold and best_det_idx is not None:
                det = detections[best_det_idx]
                track.update(det["bbox"], det["center"], det["confidence"])
                unmatched_detections.remove(best_det_idx)
                matched.add(tid)

        # Create new tracks for unmatched detections
        for det_idx in unmatched_detections:
            det = detections[det_idx]
            tid = self._new_id(det["class"])
            self.tracks[tid] = TrackedObject(
                tid, det["class"], det["bbox"], det["center"], det["confidence"]
            )

        # Remove stale tracks
        stale = [tid for tid, t in self.tracks.items() if t.misses > self.max_misses]
        for tid in stale:
            del self.tracks[tid]

        return list(self.tracks.values())

    def get_by_class(self, cls):
        """Get all tracks of a specific class."""
        return [t for t in self.tracks.values() if t.cls == cls and t.misses == 0]

    def get_by_id(self, track_id):
        """Get a specific track by ID."""
        return self.tracks.get(track_id)

    def get_closest(self, cls, to_center=None):
        """Get the closest tracked object of a class to frame center."""
        candidates = self.get_by_class(cls)
        if not candidates:
            return None
        if to_center is None:
            to_center = [320, 240]  # Default frame center
        return min(candidates, key=lambda t: 
            math.sqrt((t.center[0]-to_center[0])**2 + (t.center[1]-to_center[1])**2))

    def get_all_active(self):
        """All tracks seen in the last frame."""
        return [t for t in self.tracks.values() if t.misses == 0]

    def to_dict(self):
        return {tid: t.to_dict() for tid, t in self.tracks.items() if t.misses < 5}
