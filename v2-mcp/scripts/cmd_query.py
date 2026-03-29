#!/usr/bin/env python3
"""Query drone state using direct topic subscriptions."""
import argparse, json, sys, time
import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, DurabilityPolicy
from geometry_msgs.msg import PoseStamped
from as2_msgs.msg import PlatformInfo

class DroneQuery(Node):
    def __init__(self, drone_ids):
        super().__init__('drone_query')
        self.drone_ids = drone_ids
        self.poses = {did: None for did in drone_ids}
        self.infos = {did: None for did in drone_ids}
        
        # BEST_EFFORT for sensor data (pose)
        sensor_qos = QoSProfile(
            reliability=ReliabilityPolicy.BEST_EFFORT,
            durability=DurabilityPolicy.VOLATILE,
            depth=10
        )
        
        # RELIABLE for platform info
        reliable_qos = QoSProfile(
            reliability=ReliabilityPolicy.RELIABLE,
            durability=DurabilityPolicy.VOLATILE,
            depth=10
        )
        
        for did in drone_ids:
            self.create_subscription(
                PoseStamped,
                f'/{did}/self_localization/pose',
                lambda msg, d=did: self.pose_cb(d, msg),
                sensor_qos
            )
            self.create_subscription(
                PlatformInfo,
                f'/{did}/platform/info',
                lambda msg, d=did: self.info_cb(d, msg),
                reliable_qos
            )
    
    def pose_cb(self, drone_id, msg):
        self.poses[drone_id] = {
            'x': msg.pose.position.x,
            'y': msg.pose.position.y,
            'z': msg.pose.position.z,
        }
    
    def info_cb(self, drone_id, msg):
        self.infos[drone_id] = {
            'connected': msg.connected,
            'armed': msg.armed,
            'offboard': msg.offboard,
            'state': msg.status.state,
        }
    
    def get_results(self):
        results = {}
        for did in self.drone_ids:
            pose = self.poses.get(did)
            info = self.infos.get(did)
            results[did] = {
                'position': [round(pose['x'], 2), round(pose['y'], 2), round(pose['z'], 2)] if pose else [None, None, None],
                'connected': info.get('connected', False) if info else False,
                'armed': info.get('armed', False) if info else False,
                'offboard': info.get('offboard', False) if info else False,
                'state': info.get('state', 0) if info else 0,
            }
        return results

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--drones', type=str, required=True)
    args = parser.parse_args()

    drone_ids = [d.strip() for d in args.drones.split(',')]
    rclpy.init()
    
    try:
        node = DroneQuery(drone_ids)
        
        # Spin for up to 2 seconds to collect data
        start = time.time()
        while time.time() - start < 2.0:
            rclpy.spin_once(node, timeout_sec=0.1)
            # Check if we got both pose and info for all drones
            if all(node.poses.get(d) and node.infos.get(d) for d in drone_ids):
                break
        
        results = node.get_results()
        node.destroy_node()
        
        print(json.dumps({'success': True, 'drones': results}))
    except Exception as e:
        print(json.dumps({'success': False, 'error': str(e)}))
        sys.exit(1)
    finally:
        rclpy.shutdown()

if __name__ == '__main__': main()
