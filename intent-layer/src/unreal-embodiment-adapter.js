export class UnrealEmbodimentAdapter {
  constructor({ profile = 'generic_unreal', actorClass = 'UnrealActor', controller = 'AIController' } = {}) {
    this.profile = profile;
    this.actorClass = actorClass;
    this.controller = controller;
  }

  buildActionGraph({ backendPackage, actor = null }) {
    const actions = [];
    this.walkBehaviorTree(backendPackage.behaviorTree?.root, actions);

    return {
      embodimentProfile: this.profile,
      actorId: backendPackage.actorId,
      actorClass: actor?.actorClass || this.actorClass,
      controller: actor?.controller || backendPackage.aiController || this.controller,
      blackboard: structuredClone(backendPackage.blackboard || {}),
      behaviorTree: structuredClone(backendPackage.behaviorTree || {}),
      bindings: structuredClone(backendPackage.bindings || {}),
      actions: actions.map(action => this.mapAction(action, { backendPackage, actor })),
    };
  }

  mapAction(action) {
    return action;
  }

  walkBehaviorTree(node, actions) {
    if (!node) return;

    if (node.kind === 'Task' || node.kind === 'Decorator') {
      actions.push({
        type: node.kind,
        name: node.task,
        params: structuredClone(node.params || {}),
      });
      return;
    }

    if (Array.isArray(node.children)) {
      node.children.forEach(child => this.walkBehaviorTree(child, actions));
    }
    if (node.child) this.walkBehaviorTree(node.child, actions);
    if (node.condition) this.walkBehaviorTree(node.condition, actions);
  }
}
