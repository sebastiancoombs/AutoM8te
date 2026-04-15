export const ALLOWED_MISSION_INTENTS = new Set([
  'search',
  'track',
  'follow',
  'escort',
  'inspect',
  'patrol',
]);

export function validateMissionIntent(doc) {
  const errors = [];

  if (!doc || typeof doc !== 'object') {
    return { ok: false, errors: ['Mission intent must be an object'] };
  }

  if (doc.version !== 'v1') errors.push('version must be "v1"');
  if (!ALLOWED_MISSION_INTENTS.has(doc.intent)) {
    errors.push(`intent must be one of: ${[...ALLOWED_MISSION_INTENTS].join(', ')}`);
  }

  if (!doc.actors || typeof doc.actors !== 'object') {
    errors.push('actors is required');
  } else {
    if (!doc.actors.type || typeof doc.actors.type !== 'string') {
      errors.push('actors.type is required');
    }
    if (typeof doc.actors.count !== 'number' || doc.actors.count < 1) {
      errors.push('actors.count must be >= 1');
    }
  }

  if (!doc.target || typeof doc.target !== 'object' || !doc.target.query) {
    errors.push('target.query is required');
  }

  return { ok: errors.length === 0, errors };
}

export function expandMissionIntent(doc, options = {}) {
  const validation = validateMissionIntent(doc);
  if (!validation.ok) {
    throw new Error(validation.errors.join('; '));
  }

  const count = doc.actors.count;
  const actorType = doc.actors.type;
  const startup = doc.actors.startup || 'launch';
  const mode = doc.policy?.mode || 'continuous';
  const onFind = doc.policy?.on_find || 'report_and_hold';

  const runs = [];
  for (let i = 0; i < count; i += 1) {
    const actorId = `${actorType}_${i + 1}`;
    const sectorId = `sector_${i + 1}`;
    runs.push({
      version: 'v1',
      actor: { id: actorId },
      mode,
      metadata: {
        mission_intent: doc.intent,
        target_query: doc.target.query,
        on_find: onFind,
        startup,
        sector_id: sectorId,
      },
      root: buildRoot({ startup, targetQuery: doc.target.query, sectorId, onFind }),
    });
  }

  return {
    mission: structuredClone(doc),
    runs,
    coordination: {
      strategy: 'sector_search',
      on_find: onFind,
    },
    metadata: {
      actorType,
      actorCount: count,
    },
  };
}

function buildRoot({ startup, targetQuery, sectorId, onFind }) {
  const startupNodes = [];
  if (startup === 'launch') {
    startupNodes.push({ op: 'wait', duration_s: 1 });
  }

  return {
    type: 'sequence',
    children: [
      ...startupNodes,
      { op: 'compute_path', goal: sectorId },
      { op: 'follow_path' },
      {
        type: 'repeat',
        child: {
          type: 'fallback',
          children: [
            {
              type: 'sequence',
              children: [
                { op: 'goal_updated' },
                { op: 'hold_position' },
              ],
            },
            {
              type: 'sequence',
              children: [
                { op: 'compute_path', goal: targetQueryToGoalId(targetQuery) },
                { op: 'follow_path' },
                onFind === 'report_and_hold'
                  ? { op: 'hold_position' }
                  : { op: 'wait', duration_s: 1 },
              ],
            },
          ],
        },
      },
    ],
  };
}

function targetQueryToGoalId(query) {
  return `target:${query.toLowerCase().replace(/\s+/g, '_')}`;
}
