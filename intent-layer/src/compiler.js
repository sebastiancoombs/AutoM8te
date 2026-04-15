function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function compileToRunPackage(intent, options = {}) {
  const runId = options.runId || `run_${Date.now()}`;
  const actorId = intent.actor.id;
  const rootTreeId = 'MainTree';
  const xml = renderTree(intent.root, rootTreeId);
  const blackboard = buildBlackboard(intent);

  return {
    runId,
    actorIds: [actorId],
    backend: options.backend || 'nav2',
    rootTreeId,
    xml,
    blackboard,
    metadata: {
      mode: intent.mode,
      actorId,
    },
  };
}

function renderTree(root, rootTreeId) {
  const body = renderNode(root);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<root BTCPP_format="4">\n  <BehaviorTree ID="${rootTreeId}">\n${indent(body, 4)}\n  </BehaviorTree>\n</root>\n`;
}

function renderNode(node) {
  if (node.type) {
    switch (node.type) {
      case 'sequence':
        return `<Sequence>\n${node.children.map(renderNode).map(x => indent(x, 2)).join('\n')}\n</Sequence>`;
      case 'fallback':
        return `<Fallback>\n${node.children.map(renderNode).map(x => indent(x, 2)).join('\n')}\n</Fallback>`;
      case 'retry':
        return `<RetryUntilSuccessful num_attempts="${node.times}">\n${indent(renderNode(node.child), 2)}\n</RetryUntilSuccessful>`;
      case 'repeat':
        return `<Repeat num_cycles="-1">\n${indent(renderNode(node.child), 2)}\n</Repeat>`;
      case 'guard':
        return `<Sequence>\n${indent(renderNode(node.condition), 2)}\n${indent(renderNode(node.child), 2)}\n</Sequence>`;
      case 'timeout':
        return `<Timeout msec="${Math.round(node.duration_s * 1000)}">\n${indent(renderNode(node.child), 2)}\n</Timeout>`;
      default:
        throw new Error(`Unsupported structural type: ${node.type}`);
    }
  }

  if (node.op) {
    return renderOperation(node);
  }

  throw new Error('Invalid node');
}

function renderOperation(node) {
  switch (node.op) {
    case 'navigate_to':
      return `<NavigateToPose goal="${escapeXml(node.goal)}" />`;
    case 'compute_path':
      return `<ComputePathToPose goal="${escapeXml(node.goal)}" />`;
    case 'follow_path':
      return `<FollowPath />`;
    case 'wait':
      return `<Wait wait_duration="${escapeXml(node.duration_s)}" />`;
    case 'backup':
      return `<BackUp backup_dist="${escapeXml(node.distance_m)}" />`;
    case 'spin':
      return `<Spin spin_dist="${escapeXml(node.angle_rad)}" />`;
    case 'hold_position':
      return `<KeepRunningUntilFailure><Wait wait_duration="1" /></KeepRunningUntilFailure>`;
    case 'goal_updated':
      return `<GoalUpdated />`;
    case 'goal_reached':
      return `<GoalReached />`;
    case 'is_battery_low':
      return `<IsBatteryLow min_battery="${escapeXml(node.threshold)}" />`;
    case 'clear_costmap':
      return `<ClearEntireCostmap service_name="${escapeXml(node.scope || 'both')}" />`;
    default:
      throw new Error(`Unsupported op: ${node.op}`);
  }
}

function buildBlackboard(intent) {
  return {
    actor_id: intent.actor.id,
    mode: intent.mode,
  };
}

function indent(text, spaces) {
  const pad = ' '.repeat(spaces);
  return text.split('\n').map(line => `${pad}${line}`).join('\n');
}
