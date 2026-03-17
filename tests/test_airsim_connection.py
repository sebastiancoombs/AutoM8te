#!/usr/bin/env python3
"""
Test AirSim connection and basic control.

Prerequisites:
1. AirSim + Unreal Engine running
2. At least one drone configured in settings.json

Usage:
    python test_airsim_connection.py
"""

import sys
import os
import time
import logging

# Add src to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from swarm_manager import SwarmManager
from airsim_bridge import AirSimBridge

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S'
)

logger = logging.getLogger(__name__)


def main():
    """Test basic AirSim connection and control"""
    
    logger.info("=== AutoM8te AirSim Connection Test ===\n")
    
    # Initialize components
    swarm = SwarmManager()
    bridge = AirSimBridge(swarm)
    
    # Connect to AirSim
    logger.info("Step 1: Connecting to AirSim...")
    if not bridge.connect():
        logger.error("Failed to connect. Is AirSim running?")
        return 1
        
    print()
    
    # Register a drone (default AirSim drone is usually "Drone0")
    drone_id = "Drone0"
    logger.info(f"Step 2: Registering {drone_id}...")
    drone = swarm.register_drone(drone_id, name="Test Drone")
    print()
    
    # Enable API control
    logger.info("Step 3: Enabling API control...")
    bridge.enable_api_control(drone_id)
    bridge.arm_drone(drone_id)
    print()
    
    # Update telemetry (grounded state)
    logger.info("Step 4: Reading initial telemetry...")
    bridge.update_telemetry(drone_id)
    logger.info(f"  {drone}")
    print()
    
    # Take off
    logger.info("Step 5: Taking off...")
    bridge.takeoff(drone_id)
    time.sleep(1)
    bridge.update_telemetry(drone_id)
    logger.info(f"  {drone}")
    print()
    
    # Hover for 3 seconds
    logger.info("Step 6: Hovering for 3 seconds...")
    time.sleep(3)
    bridge.update_telemetry(drone_id)
    logger.info(f"  {drone}")
    print()
    
    # Move forward 10 meters (North)
    logger.info("Step 7: Moving forward 10 meters...")
    bridge.move_to_position(drone_id, x=10.0, y=0.0, z=-10.0, velocity=3.0)
    bridge.update_telemetry(drone_id)
    logger.info(f"  {drone}")
    print()
    
    # Hover again
    logger.info("Step 8: Hovering for 2 seconds...")
    bridge.hover(drone_id)
    time.sleep(2)
    bridge.update_telemetry(drone_id)
    logger.info(f"  {drone}")
    print()
    
    # Land
    logger.info("Step 9: Landing...")
    bridge.land(drone_id)
    bridge.update_telemetry(drone_id)
    logger.info(f"  {drone}")
    print()
    
    # Print swarm status
    logger.info("Step 10: Final swarm status")
    status = swarm.status_summary()
    for key, value in status.items():
        logger.info(f"  {key}: {value}")
    print()
    
    logger.info("✓ Test complete!")
    return 0


if __name__ == "__main__":
    sys.exit(main())
