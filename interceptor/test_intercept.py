#!/usr/bin/env python3
"""
Test the interceptor system with simulated drones.

4 interceptors vs 4 evasive enemy drones.
No SITL needed — pure math simulation.
"""

import numpy as np
import time
from .mission import InterceptCoordinator


def simulate_evasive_target(pos, vel, t, style="jink"):
    """Simulate an evasive enemy drone."""
    pos = np.array(pos, dtype=float)
    vel = np.array(vel, dtype=float)

    if style == "jink":
        # Periodic lateral jinking
        jink = np.array([
            3.0 * np.sin(t * 2.0),
            3.0 * np.cos(t * 1.5),
            0.5 * np.sin(t * 0.8),
        ])
        new_vel = vel + jink * 0.1
    elif style == "circle":
        # Circular evasion
        speed = np.linalg.norm(vel)
        angle = t * 0.5
        new_vel = np.array([speed * np.cos(angle), speed * np.sin(angle), 0])
    elif style == "sprint":
        # Straight line sprint (hardest to catch if faster)
        new_vel = vel
    elif style == "random":
        # Random acceleration
        new_vel = vel + np.random.randn(3) * 0.5
    else:
        new_vel = vel

    new_pos = pos + new_vel * 0.1
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

    # Simulate 500 ticks (50 seconds at 10Hz)
    dt = 0.1
    kills = 0

    for tick in range(500):
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
                vel = np.array(state["velocity"]) + accel * dt
                # Speed cap at 15 m/s
                speed = np.linalg.norm(vel)
                if speed > 15.0:
                    vel = vel * (20.0 / speed)  # Interceptors faster than targets
                pos = np.array(state["position"]) + vel * dt
                interceptor_positions[did] = {
                    "position": pos.tolist(),
                    "velocity": vel.tolist(),
                }

        # Check for new kills
        for did, info in status.items():
            if info.get("state") == "intercepted":
                new_kill_target = info.get("target")
                if coord.targets.get(new_kill_target, {}).get("alive") == False:
                    if kills < 4:  # Only print first time
                        pass  # Already counted

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
                    print(f"  {did} → {info.get('target')}: {dist:.1f}m, ETA {eti:.1f}s {jink}")
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
