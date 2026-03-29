#!/usr/bin/env python3
"""Takeoff command for single or multiple drones."""
import argparse, json, sys
import rclpy
from as2_python_api.drone_interface import DroneInterface

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--drones', type=str, required=True)
    parser.add_argument('--height', type=float, default=5.0)
    parser.add_argument('--speed', type=float, default=1.0)
    args = parser.parse_args()

    drone_ids = [d.strip() for d in args.drones.split(',')]
    rclpy.init()
    results, drones = {}, {}
    
    try:
        for did in drone_ids:
            drones[did] = DroneInterface(drone_id=did, verbose=False, use_sim_time=True)
        
        for did, drone in drones.items():
            try:
                arm_result = drone.arm()
                offboard_result = drone.offboard()
                results[did] = {'armed': arm_result, 'offboard': offboard_result}
            except Exception as e:
                results[did] = {'error': f'arm/offboard: {str(e)}'}
        
        for did, drone in drones.items():
            try:
                # takeoff returns True/False, set wait=True to block
                takeoff_result = drone.takeoff(height=args.height, speed=args.speed, wait=True)
                results[did]['takeoff'] = takeoff_result
            except Exception as e:
                results[did]['takeoff_error'] = str(e)
        
        print(json.dumps({'success': True, 'results': results}))
    except Exception as e:
        print(json.dumps({'success': False, 'error': str(e)}))
        sys.exit(1)
    finally:
        for d in drones.values(): 
            try:
                d.shutdown()
            except:
                pass
        rclpy.shutdown()

if __name__ == '__main__': main()
