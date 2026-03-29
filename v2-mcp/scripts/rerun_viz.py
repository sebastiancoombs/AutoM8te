#!/usr/bin/env python3
"""
Rerun visualization for AutoM8te drone swarm.
Streams drone positions from ROS2 topics to Rerun viewer.

Usage (inside Aerostack2 container):
    python3 /scripts/rerun_viz.py

Then open Rerun viewer on host:
    rerun
    # Or: rerun --connect 0.0.0.0:9876
"""

import sys
import time
import argparse
import numpy as np

try:
    import rerun as rr
except ImportError:
    print("ERROR: rerun-sdk not installed. Run: pip install rerun-sdk")
    sys.exit(1)

try:
    import rclpy
    from rclpy.node import Node
    from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy
    from geometry_msgs.msg import PoseStamped
    from sensor_msgs.msg import BatteryState
except ImportError:
    print("ERROR: ROS2 not available. Run this inside Aerostack2 container.")
    sys.exit(1)


# Drone colors (RGBA)
DRONE_COLORS = [
    [0, 255, 0, 255],    # Green
    [0, 150, 255, 255],  # Blue
    [255, 150, 0, 255],  # Orange
    [255, 0, 150, 255],  # Pink
    [150, 0, 255, 255],  # Purple
    [255, 255, 0, 255],  # Yellow
    [0, 255, 255, 255],  # Cyan
    [255, 0, 0, 255],    # Red
]


class DroneVisualizer(Node):
    def __init__(self, drone_ids: list[str]):
        super().__init__('autom8te_rerun_viz')
        
        self.drone_ids = drone_ids
        self.positions = {d: None for d in drone_ids}
        self.trails = {d: [] for d in drone_ids}
        self.max_trail_length = 200
        
        # QoS for sensor data (BEST_EFFORT)
        sensor_qos = QoSProfile(
            reliability=ReliabilityPolicy.BEST_EFFORT,
            history=HistoryPolicy.KEEP_LAST,
            depth=1
        )
        
        # Subscribe to each drone's pose topic
        self.pose_subs = []
        for drone_id in drone_ids:
            topic = f'/{drone_id}/self_localization/pose'
            sub = self.create_subscription(
                PoseStamped,
                topic,
                lambda msg, d=drone_id: self.pose_callback(d, msg),
                sensor_qos
            )
            self.pose_subs.append(sub)
            self.get_logger().info(f'Subscribed to {topic}')
        
        # Timer for logging to Rerun (10 Hz)
        self.create_timer(0.1, self.log_to_rerun)
        
        self.get_logger().info(f'Visualizing {len(drone_ids)} drones')
    
    def pose_callback(self, drone_id: str, msg: PoseStamped):
        pos = msg.pose.position
        self.positions[drone_id] = [pos.x, pos.y, pos.z]
        
        # Add to trail
        self.trails[drone_id].append([pos.x, pos.y, pos.z])
        if len(self.trails[drone_id]) > self.max_trail_length:
            self.trails[drone_id].pop(0)
    
    def log_to_rerun(self):
        # Log each drone position
        for i, drone_id in enumerate(self.drone_ids):
            pos = self.positions[drone_id]
            if pos is None:
                continue
            
            color = DRONE_COLORS[i % len(DRONE_COLORS)]
            
            # Log current position as a point
            rr.log(
                f"swarm/{drone_id}/position",
                rr.Points3D(
                    [pos],
                    colors=[color],
                    radii=[0.3]
                )
            )
            
            # Log trail as a line strip
            trail = self.trails[drone_id]
            if len(trail) > 1:
                # Fade trail color
                trail_color = color.copy()
                trail_color[3] = 100  # Semi-transparent
                rr.log(
                    f"swarm/{drone_id}/trail",
                    rr.LineStrips3D(
                        [trail],
                        colors=[trail_color]
                    )
                )
            
            # Log drone label
            rr.log(
                f"swarm/{drone_id}/label",
                rr.Points3D(
                    [[pos[0], pos[1], pos[2] + 0.5]],
                    labels=[drone_id],
                    colors=[[255, 255, 255, 255]],
                    radii=[0.1]
                )
            )
        
        # Log all positions together for swarm view
        all_positions = [p for p in self.positions.values() if p is not None]
        if all_positions:
            rr.log(
                "swarm/all",
                rr.Points3D(
                    all_positions,
                    colors=[DRONE_COLORS[i % len(DRONE_COLORS)] 
                            for i in range(len(all_positions))],
                    radii=[0.3] * len(all_positions)
                )
            )


def setup_rerun_scene():
    """Set up the 3D scene in Rerun."""
    # Log a ground plane
    grid_size = 50
    grid_lines = []
    for i in range(-grid_size, grid_size + 1, 5):
        grid_lines.append([[i, -grid_size, 0], [i, grid_size, 0]])
        grid_lines.append([[-grid_size, i, 0], [grid_size, i, 0]])
    
    rr.log(
        "world/ground_grid",
        rr.LineStrips3D(
            grid_lines,
            colors=[[100, 100, 100, 50]] * len(grid_lines)
        )
    )
    
    # Log origin axes
    rr.log(
        "world/origin",
        rr.Arrows3D(
            origins=[[0, 0, 0], [0, 0, 0], [0, 0, 0]],
            vectors=[[5, 0, 0], [0, 5, 0], [0, 0, 5]],
            colors=[[255, 0, 0], [0, 255, 0], [0, 0, 255]]
        )
    )
    
    # Set up 3D view
    rr.log(
        "world",
        rr.ViewCoordinates.RIGHT_HAND_Z_UP,
        static=True
    )


def main():
    parser = argparse.ArgumentParser(description='AutoM8te Rerun Visualizer')
    parser.add_argument('--drones', type=int, default=4,
                        help='Number of drones (default: 4)')
    parser.add_argument('--connect', type=str, default=None,
                        help='Connect to remote Rerun viewer (e.g., 192.168.1.100:9876)')
    parser.add_argument('--save', type=str, default=None,
                        help='Save recording to .rrd file')
    args = parser.parse_args()
    
    # Initialize Rerun
    rr.init("autom8te_swarm", spawn=args.connect is None and args.save is None)
    
    if args.connect:
        rr.connect(args.connect)
        print(f"Connected to Rerun viewer at {args.connect}")
    elif args.save:
        rr.save(args.save)
        print(f"Recording to {args.save}")
    else:
        print("Spawning Rerun viewer...")
    
    # Set up scene
    setup_rerun_scene()
    
    # Generate drone IDs
    drone_ids = [f"drone{i}" for i in range(args.drones)]
    
    # Initialize ROS2
    rclpy.init()
    
    try:
        visualizer = DroneVisualizer(drone_ids)
        rclpy.spin(visualizer)
    except KeyboardInterrupt:
        pass
    finally:
        rclpy.shutdown()


if __name__ == '__main__':
    main()
