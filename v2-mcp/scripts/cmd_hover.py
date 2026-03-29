#!/usr/bin/env python3
"""Hover (stop in place)."""
import argparse, json, sys
import rclpy
from as2_python_api.drone_interface import DroneInterface

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--drones', type=str, required=True)
    args = parser.parse_args()

    drone_ids = [d.strip() for d in args.drones.split(',')]
    rclpy.init()
    results, drones = {}, {}
    
    try:
        for did in drone_ids:
            drones[did] = DroneInterface(drone_id=did, verbose=False, use_sim_time=True)
            rclpy.spin_once(drones[did], timeout_sec=0.5)
        
        for did, drone in drones.items():
            pos = drone.position
            if pos:
                drone.go_to(x=pos[0], y=pos[1], z=pos[2], speed=0.5, wait=False)
                results[did] = {'hovering': True, 'position': list(pos)}
            else:
                results[did] = {'hovering': False, 'error': 'No position'}
        
        print(json.dumps({'success': True, 'results': results}))
    except Exception as e:
        print(json.dumps({'success': False, 'error': str(e)}))
        sys.exit(1)
    finally:
        for d in drones.values(): d.shutdown()
        rclpy.shutdown()

if __name__ == '__main__': main()
