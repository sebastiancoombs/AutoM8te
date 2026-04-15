#!/usr/bin/env python3
"""
Test the interceptor system with simulated drones.

4 interceptors vs 4 evasive enemy drones.
No SITL needed — pure math simulation.
"""

import numpy as np
import time
from .mission import InterceptCoordinator

np.random.seed(7)


def simulate_evasive_target(pos, vel, t, style="jink", dt=0.1):
    """
    Simulate an evasive enemy drone with realistic acceleration limits.
    
    Now models acceleration → velocity → position (like real physics).
    """
    pos = np.array(pos, dtype=float)
    vel = np.array(vel, dtype=float)

    # Compute desired acceleration based on evasion style
    if style == "jink":
        # Periodic lateral jinking acceleration
        accel = np.array([
            5.0 * np.sin(t * 2.0),
            5.0 * np.cos(t * 1.5),
            1.0 * np.sin(t * 0.8),
        ])
    elif style == "circle":
        # Circular evasion with centripetal acceleration
        speed = np.linalg.norm(vel)
        if speed < 1.0:
            speed = 8.0  # Minimum speed for circle
        radius = 20.0
        omega = speed / radius
        angle = t * omega
        # Tangent vector
        tangent = np.array([-np.sin(angle), np.cos(angle), 0])
        # Centripetal acceleration toward center
        center_dir = np.array([-np.cos(angle), -np.sin(angle), 0])
        accel = tangent * 2.0 + center_dir * (speed * omega)
    elif style == "sprint":
        # Straight line sprint with slight corrections
        forward = vel / max(np.linalg.norm(vel), 1.0)
        accel = forward * 1.0  # Gentle forward bias
    elif style == "random":
        # Random acceleration changes
        accel = np.random.randn(3) * 3.0
    else:
        accel = np.zeros(3)

    # Limit acceleration to realistic drone limits (6 m/s²)
    max_accel = 6.0
    accel_mag = np.linalg.norm(accel)
    if accel_mag > max_accel:
        accel = accel * (max_accel / accel_mag)

    # Integrate acceleration → velocity
    new_vel = vel + accel * dt

    # Speed limit (targets max at 15 m/s)
    speed = np.linalg.norm(new_vel)
    if speed > 15.0:
        new_vel = new_vel * (15.0 / speed)

    # Integrate velocity → position
    new_pos = pos + vel * dt + 0.5 * accel * dt * dt

    return new_pos.tolist(), new_vel.tolist()


def run_simulation():
    """Run a full intercept simulation."""
    print("=" * 60)
    print("INTERCEPTOR SIMULATION")
    print("4 interceptors vs 4 evasive targets")
    print("=" * 60)
    print()

    coord = InterceptCoordinator()

    # Add 4 interceptors at starting positions
    interceptor_positions = {
        "int_0": {"position": [0, 0, 10], "velocity": [0, 0, 0]},
        "int_1": {"position": [10, 0, 10], "velocity": [0, 0, 0]},
        "int_2": {"position": [0, 10, 10], "velocity": [0, 0, 0]},
        "int_3": {"position": [10, 10, 10], "velocity": [0, 0, 0]},
    }

    for did in interceptor_positions:
        coord.add_interceptor(did)

    # 4 enemy drones with different evasion styles
    target_states = {
        "enemy_0": {"position": [50, 20, 12], "velocity": [3, 1, 0]},   # jink
        "enemy_1": {"position": [30, 60, 15], "velocity": [-2, 2, 0]},  # circle
        "enemy_2": {"position": [70, 70, 10], "velocity": [-1, -3, 0]}, # sprint
        "enemy_3": {"position": [20, 40, 8], "velocity": [2, -1, 0.5]}, # random
    }
    evasion_styles = ["jink", "circle", "sprint", "random"]

    # Run assignment
    print("Running target assignment...")
    coord.update_targets(target_states)
    assignments = coord.execute_assignment()
    print(f"Assignments: {assignments}")
    print()

    # Simulate 1200 ticks (120 seconds at 10Hz)
    dt = 0.1
    kills = 0

    for tick in range(1200):
        t = tick * dt

        # Update target positions (evasive maneuvers)
        for i, (tid, state) in enumerate(list(target_states.items())):
            if coord.targets.get(tid, {}).get("alive", True):
                new_pos, new_vel = simulate_evasive_target(
                    state["position"], state["velocity"],
                    t, evasion_styles[i],
                )
                target_states[tid] = {"position": new_pos, "velocity": new_vel}

        # Run coordinator tick
        commands, status = coord.tick(interceptor_positions, target_states, dt)

        # Apply acceleration to interceptors (simple Euler integration)
        for did, accel in commands.items():
            if accel is not None:
                state = interceptor_positions[did]
                prev_vel = np.array(state["velocity"])
                vel = prev_vel + accel * dt
                # Speed cap at 25 m/s (interceptors 67% faster than 15 m/s targets)
                speed = np.linalg.norm(vel)
                if speed > 25.0:
                    vel = vel * (25.0 / speed)
                avg_vel = 0.5 * (prev_vel + vel)
                pos = np.array(state["position"]) + avg_vel * dt
                interceptor_positions[did] = {
                    "position": pos.tolist(),
                    "velocity": vel.tolist(),
                }

        # Check for new kills (target marked dead by coordinator)
        current_alive = sum(1 for t in coord.targets.values() if t.get("alive", True))
        if current_alive < (4 - kills):
            kills = 4 - current_alive  # Update kill count based on alive targets

        # Periodic status
        if tick % 20 == 0:  # Every 2 seconds
            mission_status = coord.get_status()
            alive = mission_status["targets_alive"]
            killed = mission_status["targets_killed"]
            print(f"t={t:5.1f}s | Alive: {alive} | Killed: {killed}")
            for did, info in status.items():
                if info.get("state") == "pursuing":
                    dist = info.get("distance", 0)
                    eti = info.get("eti", 0)
                    jink = "JINK!" if info.get("jink_detected") else ""
                    mode = info.get("mode", "?")
                    print(f"  {did} → {info.get('target')}: {dist:.1f}m, ETA {eti:.1f}s [{mode}] {jink}")
                elif info.get("state") == "intercepted":
                    print(f"  {did} → {info.get('target')}: INTERCEPTED ✓")
                elif info.get("state") == "idle":
                    print(f"  {did}: idle")

        # Stop if all targets killed
        if all(not t.get("alive", True) for t in coord.targets.values()):
            print(f"\nAll targets destroyed at t={t:.1f}s!")
            break

    # Final status
    print()
    print("=" * 60)
    print("FINAL STATUS")
    print("=" * 60)
    final = coord.get_status()
    print(f"Targets killed: {final['targets_killed']}/{final['targets_total']}")
    print(f"Assignments: {final['assignments']}")
    for did, info in final["interceptors"].items():
        print(f"  {did}: {info['state']} (target: {info['target']})")


if __name__ == "__main__":
    run_simulation()
