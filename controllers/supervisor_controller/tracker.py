"""
Object Tracker — Ultralytics Built-in BoT-SORT/ByteTrack

Uses YOLO's built-in .track() method which handles:
- Persistent ID assignment across frames
- Re-identification after occlusion (BoT-SORT)
- Kalman filter prediction
- IOU + appearance matching

We just wrap it with a clean interface for the follow controller.
"""

import time

try:
    from ultralytics import YOLO
    HAS_YOLO = True
except ImportError:
    HAS_YOLO = False


class TrackedObject:
    """Thin wrapper around a YOLO tracking result for our follow controller."""

    def __init__(self, track_id, cls, bbox, center, confidence):
        self.id = f"{cls}_{track_id}"
        self.track_id = track_id
        self.cls = cls
        self.bbox = bbox
        self.center = center
        self.confidence = confidence
        self.misses = 0  # Always 0 for current-frame detections

    def to_dict(self):
        return {
            "id": self.id,
            "track_id": self.track_id,
            "class": self.cls,
            "bbox": self.bbox,
            "center": self.center,
            "confidence": self.confidence,
        }


class ObjectTracker:
    """
    YOLO-based tracker using built-in BoT-SORT or ByteTrack.
    
    Just call update(frame) each tick — YOLO handles everything.
    """

    def __init__(self, model_path="yolov8n.pt", tracker="botsort.yaml", confidence=0.4):
        self.model = None
        self.tracker_config = tracker
        self.confidence = confidence
        self.tracks = {}  # track_id_str -> TrackedObject
        self.enabled = False

        if HAS_YOLO:
            try:
                self.model = YOLO(model_path)
                self.enabled = True
                print(f"[Tracker] YOLOv8 + {tracker} ready ({len(self.model.names)} classes)")
            except Exception as e:
                print(f"[Tracker] Failed to load model: {e}")

    def update(self, frame):
        """
        Run YOLO tracking on a frame.
        
        Args:
            frame: numpy array (H, W, 3) RGB image
            
        Returns:
            list of TrackedObject (current frame detections with persistent IDs)
        """
        if not self.enabled or frame is None:
            return []

        # model.track() handles detection + tracking + ID persistence
        results = self.model.track(
            frame,
            persist=True,
            tracker=self.tracker_config,
            conf=self.confidence,
            verbose=False,
        )

        tracked = []
        self.tracks.clear()

        for r in results:
            if r.boxes is None or not r.boxes.is_track:
                continue

            for box in r.boxes:
                if box.id is None:
                    continue

                track_id = int(box.id[0])
                cls_id = int(box.cls[0])
                cls_name = self.model.names[cls_id]
                conf = float(box.conf[0])
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                cx = (x1 + x2) / 2
                cy = (y1 + y2) / 2

                obj = TrackedObject(
                    track_id=track_id,
                    cls=cls_name,
                    bbox=[round(x1), round(y1), round(x2), round(y2)],
                    center=[round(cx, 1), round(cy, 1)],
                    confidence=round(conf, 3),
                )
                tracked.append(obj)
                self.tracks[obj.id] = obj

        return tracked

    def get_by_class(self, cls):
        return [t for t in self.tracks.values() if t.cls == cls]

    def get_by_id(self, track_id_str):
        return self.tracks.get(track_id_str)

    def get_all(self):
        return list(self.tracks.values())

    def to_dict(self):
        return {tid: t.to_dict() for tid, t in self.tracks.items()}
