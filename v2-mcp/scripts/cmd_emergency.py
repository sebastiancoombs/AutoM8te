#!/usr/bin/env python3
"""Emergency stop."""
import argparse, json, sys
import rclpy
from as2_python_api.drone_interface import DroneInterface

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--drones', type=str, required=True)
    args = parser.parse_args()

    drone_ids = [d.strip() for d in args.drones.split(',')]
    rclpy.init()
    results = {}
    
    try:
        for did in drone_ids:
            drone = DroneInterface(drone_id=did, verbose=False, use_sim_time=True)
            try:
                drone.send_emergency_land()
                results[did] = {'emergency_land': True}
            except:
                drone.land(speed=1.0, wait=False)
                results[did] = {'emergency_land': False, 'landing': True}
            drone.shutdown()
        
        print(json.dumps({'success': True, 'results': results}))
    except Exception as e:
        print(json.dumps({'success': False, 'error': str(e)}))
        sys.exit(1)
    finally:
        rclpy.shutdown()

if __name__ == '__main__': main()
