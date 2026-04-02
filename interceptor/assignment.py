"""
Target Assignment — Hungarian Algorithm

Optimally assigns N interceptors to M targets minimizing total
intercept cost (distance + predicted time to intercept).

Reassigns every tick as targets maneuver.
"""

import numpy as np
from scipy.optimize import linear_sum_assignment


def compute_cost_matrix(interceptors, targets):
    """
    Build cost matrix factoring in:
    - Distance to target
    - Closing speed (are we already heading toward it?)
    - Target velocity (faster targets cost more)
    
    Args:
        interceptors: list of {"id", "position", "velocity"}
        targets: list of {"id", "position", "velocity"}
    
    Returns:
        cost_matrix: np.array shape (N_interceptors, M_targets)
        interceptor_ids: list of interceptor ids (row order)
        target_ids: list of target ids (column order)
    """
    n = len(interceptors)
    m = len(targets)
    cost = np.zeros((n, m))

    for i, intc in enumerate(interceptors):
        pi = np.array(intc["position"])
        vi = np.array(intc["velocity"])

        for j, tgt in enumerate(targets):
            pt = np.array(tgt["position"])
            vt = np.array(tgt["velocity"])

            # Distance cost
            dist = np.linalg.norm(pt - pi)

            # Closing speed: positive = closing, negative = opening
            relative_pos = pt - pi
            relative_vel = vi - vt
            if dist > 0.1:
                closing_speed = np.dot(relative_vel, relative_pos / dist)
            else:
                closing_speed = 0

            # Estimated time to intercept (simple)
            if closing_speed > 0.5:
                eti = dist / closing_speed
            else:
                eti = dist / 5.0  # Assume 5 m/s if not closing

            # Target speed penalty (faster targets are harder)
            target_speed = np.linalg.norm(vt)
            speed_penalty = target_speed * 0.5

            cost[i, j] = eti + speed_penalty

    return cost, [x["id"] for x in interceptors], [x["id"] for x in targets]


def assign_targets(interceptors, targets):
    """
    Optimal 1:1 assignment of interceptors to targets.
    
    Returns:
        list of (interceptor_id, target_id) pairs
        unassigned_interceptors: list of ids with no target
        unassigned_targets: list of ids with no interceptor
    """
    if not interceptors or not targets:
        return [], [x["id"] for x in interceptors], [x["id"] for x in targets]

    cost, int_ids, tgt_ids = compute_cost_matrix(interceptors, targets)

    # Hungarian algorithm — finds minimum cost matching
    row_ind, col_ind = linear_sum_assignment(cost)

    assignments = []
    assigned_interceptors = set()
    assigned_targets = set()

    for r, c in zip(row_ind, col_ind):
        assignments.append((int_ids[r], tgt_ids[c]))
        assigned_interceptors.add(int_ids[r])
        assigned_targets.add(tgt_ids[c])

    unassigned_int = [x for x in int_ids if x not in assigned_interceptors]
    unassigned_tgt = [x for x in tgt_ids if x not in assigned_targets]

    return assignments, unassigned_int, unassigned_tgt


def reassign_on_kill(assignments, killed_target_id, interceptors, remaining_targets):
    """
    When a target is destroyed, reassign that interceptor.
    
    Returns new full assignment list.
    """
    # Remove killed target, get free interceptor
    free_interceptor = None
    for int_id, tgt_id in assignments:
        if tgt_id == killed_target_id:
            free_interceptor = int_id
            break

    if free_interceptor is None:
        return assignments

    # Re-run assignment with all available interceptors and remaining targets
    return assign_targets(interceptors, remaining_targets)
