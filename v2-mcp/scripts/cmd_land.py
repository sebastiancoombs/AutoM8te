#!/usr/bin/env python3
"""Land command."""
import argparse, json, sys
import rclpy
from as2_python_api.drone_interface import DroneInterface

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--drones', type=str, required=True)
    parser.add_argument('--speed', type=float, default=0.5)
    args = parser.parse_args()

    drone_ids = [d.strip() for d in args.drones.split(',')]
    rclpy.init()
    results, drones = {}, {}
    
    try:
        for did in drone_ids:
            drones[did] = DroneInterface(drone_id=did, verbose=False, use_sim_time=True)
        
        for did, drone in drones.items():
            drone.land(speed=args.speed, wait=False)
        
        for did, drone in drones.items():
            results[did] = {'landed': drone.land.wait()}
            drone.manual()
        
        print(json.dumps({'success': True, 'results': results}))
    except Exception as e:
        print(json.dumps({'success': False, 'error': str(e)}))
        sys.exit(1)
    finally:
        for d in drones.values(): d.shutdown()
        rclpy.shutdown()

if __name__ == '__main__': main()
