#!/usr/bin/env python3
"""
YOLO Bridge for AutoM8te Intent Layer

Receives image frames, runs YOLO detection, returns bounding boxes.
Communicates via JSON over stdin/stdout.
"""

import sys
import json
import base64
import argparse
from io import BytesIO

try:
    from ultralytics import YOLO
    from PIL import Image
    import numpy as np
except ImportError:
    print(json.dumps({
        "error": "Dependencies not installed. Run: pip install ultralytics pillow numpy"
    }), flush=True)
    sys.exit(1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', default='yolov8n.pt', help='YOLO model path')
    parser.add_argument('--confidence', type=float, default=0.5, help='Detection confidence threshold')
    args = parser.parse_args()

    # Load model
    print(f"Loading YOLO model: {args.model}", file=sys.stderr)
    model = YOLO(args.model)
    print("Model loaded", file=sys.stderr)

    # Process frames
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
            
            # Decode image
            image_data = base64.b64decode(request['image'])
            image = Image.open(BytesIO(image_data))
            
            # Run detection
            results = model(image, conf=args.confidence, verbose=False)
            
            # Format detections
            detections = []
            for result in results:
                boxes = result.boxes
                for i in range(len(boxes)):
                    box = boxes[i]
                    xyxy = box.xyxy[0].cpu().numpy()
                    
                    detections.append({
                        'class': result.names[int(box.cls[0])],
                        'confidence': float(box.conf[0]),
                        'bbox': [
                            float(xyxy[0]),  # x
                            float(xyxy[1]),  # y
                            float(xyxy[2] - xyxy[0]),  # width
                            float(xyxy[3] - xyxy[1]),  # height
                        ],
                    })

            response = {
                'detections': detections,
                'drone_id': request.get('drone_id'),
                'drone_position': request.get('drone_position', [0, 0, 0]),
                'drone_heading': request.get('drone_heading', 0),
            }
            
            print(json.dumps(response), flush=True)

        except Exception as e:
            print(json.dumps({'error': str(e)}), flush=True)


if __name__ == '__main__':
    main()
