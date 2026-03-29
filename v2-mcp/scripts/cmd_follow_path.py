#!/usr/bin/env python3
"""Follow waypoint path."""
import argparse, json, sys
import rclpy
from as2_python_api.drone_interface import DroneInterface
from as2_msgs.msg import YawMode

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--drone', type=str, required=True)
    parser.add_argument('--waypoints', type=str, required=True)
    parser.add_argument('--speed', type=float, default=1.5)
    parser.add_argument('--yaw', type=str, default='path_facing', choices=['keep', 'path_facing'])
    parser.add_argument('--wait', action='store_true')
    args = parser.parse_args()

    waypoints = json.loads(args.waypoints)
    yaw_modes = {'keep': YawMode.KEEP_YAW, 'path_facing': YawMode.PATH_FACING}
    rclpy.init()
    
    try:
        drone = DroneInterface(drone_id=args.drone, verbose=False, use_sim_time=True)
        success = drone.follow_path(path=waypoints, speed=args.speed,
                                    yaw_mode=yaw_modes[args.yaw],
                                    frame_id='earth', wait=args.wait)
        print(json.dumps({'success': success, 'drone': args.drone, 'waypoints': len(waypoints)}))
        drone.shutdown()
    except Exception as e:
        print(json.dumps({'success': False, 'error': str(e)}))
        sys.exit(1)
    finally:
        rclpy.shutdown()

if __name__ == '__main__': main()
