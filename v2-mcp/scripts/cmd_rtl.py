#!/usr/bin/env python3
"""Return to launch."""
import argparse, json, sys
import rclpy
from as2_python_api.drone_interface import DroneInterface

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--drones', type=str, required=True)
    parser.add_argument('--altitude', type=float, default=10)
    parser.add_argument('--speed', type=float, default=2)
    parser.add_argument('--land', action='store_true')
    args = parser.parse_args()

    drone_ids = [d.strip() for d in args.drones.split(',')]
    home = [0, 0, 0]
    rclpy.init()
    results, drones = {}, {}
    
    try:
        for did in drone_ids:
            drones[did] = DroneInterface(drone_id=did, verbose=False, use_sim_time=True)
        
        for did, drone in drones.items():
            pos = drone.position or [0, 0, 0]
            drone.go_to(x=pos[0], y=pos[1], z=args.altitude, speed=args.speed, wait=True)
            drone.go_to(x=home[0], y=home[1], z=args.altitude, speed=args.speed, wait=True)
            results[did] = {'returned': True}
            
            if args.land:
                drone.land(speed=0.5, wait=True)
                drone.manual()
                results[did]['landed'] = True
        
        print(json.dumps({'success': True, 'results': results}))
    except Exception as e:
        print(json.dumps({'success': False, 'error': str(e)}))
        sys.exit(1)
    finally:
        for d in drones.values(): d.shutdown()
        rclpy.shutdown()

if __name__ == '__main__': main()
