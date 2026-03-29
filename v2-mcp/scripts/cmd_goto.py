#!/usr/bin/env python3
"""Go to position."""
import argparse, json, sys
import rclpy
from as2_python_api.drone_interface import DroneInterface
from as2_msgs.msg import YawMode

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--drone', type=str, required=True)
    parser.add_argument('--x', type=float, required=True)
    parser.add_argument('--y', type=float, required=True)
    parser.add_argument('--z', type=float, required=True)
    parser.add_argument('--speed', type=float, default=1.5)
    parser.add_argument('--yaw', type=str, default='keep', choices=['keep', 'path_facing', 'fixed'])
    parser.add_argument('--yaw_angle', type=float, default=0)
    parser.add_argument('--wait', action='store_true')
    args = parser.parse_args()

    yaw_modes = {'keep': YawMode.KEEP_YAW, 'path_facing': YawMode.PATH_FACING, 'fixed': YawMode.FIXED_YAW}
    rclpy.init()
    
    try:
        drone = DroneInterface(drone_id=args.drone, verbose=False, use_sim_time=True)
        success = drone.go_to(x=args.x, y=args.y, z=args.z, speed=args.speed,
                              yaw_mode=yaw_modes[args.yaw],
                              yaw_angle=args.yaw_angle if args.yaw == 'fixed' else None,
                              frame_id='earth', wait=args.wait)
        print(json.dumps({'success': success, 'drone': args.drone, 'target': [args.x, args.y, args.z]}))
        drone.shutdown()
    except Exception as e:
        print(json.dumps({'success': False, 'error': str(e)}))
        sys.exit(1)
    finally:
        rclpy.shutdown()

if __name__ == '__main__': main()
