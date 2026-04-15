import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class UnrealMcpTransport {
  constructor({
    serverName = 'unreal',
    mcporterConfig = '/Users/seb/.openclaw/workspace/config/mcporter.json',
    cwd = '/Users/seb/.openclaw/workspace',
  } = {}) {
    this.serverName = serverName;
    this.mcporterConfig = mcporterConfig;
    this.cwd = cwd;
  }

  async dispatch(payload) {
    const dispatch = payload.dispatch || {};
    const actions = dispatch.actions || [];
    const actorId = dispatch.actorId;
    const results = [];

    if (dispatch.behaviorTree || dispatch.blackboard) {
      results.push({
        action: 'generator_target',
        status: 'prepared',
        generated: {
          behaviorTree: dispatch.behaviorTree || null,
          blackboard: dispatch.blackboard || null,
          bindings: dispatch.bindings || null,
        },
      });
    }

    for (const action of actions) {
      const toolCall = this.#mapActionToToolCall({ actorId, dispatch, action });
      if (!toolCall) {
        results.push({
          action: action.name,
          status: 'skipped',
          reason: 'no-mcp-tool-mapping',
        });
        continue;
      }
      const result = await this.#callTool(toolCall.tool, toolCall.args);
      results.push({
        action: action.name,
        tool: toolCall.tool,
        args: toolCall.args,
        result,
      });
    }

    return {
      status: 'dispatched-via-mcp',
      payload,
      results,
    };
  }

  async fetchState(query = {}) {
    const outliner = await this.#callTool('editor_get_world_outliner', {});
    const mapInfo = await this.#callTool('editor_get_map_info', {});
    return {
      status: 'state-fetched-via-mcp',
      query,
      payload: {
        actors: normalizeOutlinerActors(outliner, query),
        map: mapInfo,
      },
    };
  }

  async pushState(payload) {
    return {
      status: 'state-push-not-implemented',
      payload,
    };
  }

  async #callTool(tool, args) {
    const selector = `${this.serverName}.${tool}`;
    const commandArgs = ['call', selector, '--config', this.mcporterConfig, '--args', JSON.stringify(args)];
    const { stdout } = await execFileAsync('mcporter', commandArgs, { cwd: this.cwd, maxBuffer: 1024 * 1024 * 10 });
    return parseJsonSafe(stdout);
  }

  #mapActionToToolCall({ actorId, dispatch, action }) {
    const location = resolveGoalLocation(dispatch.blackboard, action.params);
    const actorName = actorId;

    switch (action.name) {
      case 'MoveTo':
      case 'FollowResolvedPath':
        if (!location) return null;
        return {
          tool: 'editor_update_object',
          args: {
            actor_name: actorName,
            location,
          },
        };
      case 'RotateInPlace':
        return {
          tool: 'editor_update_object',
          args: {
            actor_name: actorName,
            rotation: {
              pitch: 0,
              yaw: radiansToDegrees(action.params?.angle_rad || 0),
              roll: 0,
            },
          },
        };
      case 'Wait':
      case 'HoldPosition':
      case 'RunEQSOrPathQuery':
      case 'GoalUpdated':
      case 'GoalReached':
      case 'IsBatteryLow':
      case 'RefreshNavigation':
      case 'MoveBackward':
        return null;
      default:
        return null;
    }
  }
}

function resolveGoalLocation(blackboard = {}, params = {}) {
  const goalId = params.goal;
  const goals = blackboard.goals || {};
  const goal = goalId ? goals[goalId] : null;
  if (!goal) return null;
  return {
    x: goal.x ?? goal.pose?.x ?? 0,
    y: goal.y ?? goal.pose?.y ?? 0,
    z: goal.z ?? goal.pose?.z ?? 0,
  };
}

function normalizeOutlinerActors(outliner, query = {}) {
  const actors = outliner?.actors || [];
  return actors
    .filter(actor => !query.actorId || actor.name === query.actorId || actor.actor_label === query.actorId)
    .map(actor => ({
      id: actor.actor_label || actor.name,
      type: actor.class,
      x: actor.location?.x ?? 0,
      y: actor.location?.y ?? 0,
      z: actor.location?.z ?? 0,
      rotation: actor.rotation || null,
      scale: actor.scale || null,
      components: actor.components || [],
      folder_path: actor.folder_path || null,
    }));
}

function radiansToDegrees(value) {
  return value * (180 / Math.PI);
}

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.trim() };
  }
}
