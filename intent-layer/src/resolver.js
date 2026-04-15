export function resolveIntentDocument(intent, worldContext = {}) {
  const resolvedGoals = worldContext.goals || {};
  const clone = structuredClone(intent);
  resolveNode(clone.root, resolvedGoals);
  return clone;
}

function resolveNode(node, goals) {
  if (!node || typeof node !== 'object') return;

  if (node.goal && typeof node.goal === 'string' && goals[node.goal]) {
    node.resolved_goal = goals[node.goal];
  }

  if (Array.isArray(node.children)) node.children.forEach(child => resolveNode(child, goals));
  if (node.child) resolveNode(node.child, goals);
  if (node.condition) resolveNode(node.condition, goals);
}
