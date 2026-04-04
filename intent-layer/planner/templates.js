/**
 * Behavior Tree Templates — JSON definitions for common missions.
 * 
 * These use the custom BT engine architecture:
 *   - "reactiveSequence": re-checks conditions every tick, halts children on failure
 *   - "reactiveSelector": higher-priority branches preempt lower ones
 *   - StatefulAction nodes get proper halt() calls on interruption
 *   - "timeout": wrapper that fails after N ms
 *   - "retry": wrapper that retries on failure
 * 
 * The LLM can use these templates or compose custom trees from the same node types.
 */

// ─── Find and Surround ─────────────────────────────────────────────
// Search for target → surround it → track & maintain surround.
// If target lost during surround: search last known position.

export const findAndSurround = {
  type: 'reactiveSelector',
  name: 'find_and_surround',
  nodes: [
    {
      // Priority 1: target visible → surround with continuous tracking
      type: 'reactiveSequence',
      name: 'track_and_surround',
      nodes: [
        { type: 'updateTargetPosition' },  // Re-checked every tick. Fails → halts surround
        { type: 'surround' },               // StatefulAction: onRunning re-sends positions
      ],
    },
    {
      // Priority 2: target just lost → search last known position
      type: 'sequence',
      name: 'recover_lost_target',
      nodes: [
        { type: 'hasTarget' }, // Did we ever have it?
        {
          type: 'timeout',
          ms: 15000,
          node: {
            type: 'reactiveSequence',
            nodes: [
              { type: 'inverter', node: { type: 'scanForTarget' } }, // Keep searching while NOT found
              { type: 'searchLastKnown' },
            ],
          },
        },
      ],
    },
    {
      // Priority 3: full area search
      type: 'reactiveSequence',
      name: 'search_for_target',
      nodes: [
        { type: 'inverter', node: { type: 'scanForTarget' } }, // While target NOT found, keep searching
        { type: 'dispatchSearch' },                              // Halted when scanForTarget succeeds
      ],
    },
  ],
};

// ─── Find and Follow ────────────────────────────────────────────────
// Same structure: reactive tracking with recovery fallback.

export const findAndFollow = {
  type: 'reactiveSelector',
  name: 'find_and_follow',
  nodes: [
    {
      type: 'reactiveSequence',
      name: 'track_and_follow',
      nodes: [
        { type: 'updateTargetPosition' },
        { type: 'follow' },
      ],
    },
    {
      type: 'sequence',
      name: 'recover_lost_target',
      nodes: [
        { type: 'hasTarget' },
        {
          type: 'timeout',
          ms: 15000,
          node: {
            type: 'reactiveSequence',
            nodes: [
              { type: 'inverter', node: { type: 'scanForTarget' } },
              { type: 'searchLastKnown' },
            ],
          },
        },
      ],
    },
    {
      type: 'reactiveSequence',
      name: 'search_for_target',
      nodes: [
        { type: 'inverter', node: { type: 'scanForTarget' } },
        { type: 'dispatchSearch' },
      ],
    },
  ],
};

// ─── Find and Intercept ─────────────────────────────────────────────

export const findAndIntercept = {
  type: 'reactiveSelector',
  name: 'find_and_intercept',
  nodes: [
    {
      type: 'reactiveSequence',
      name: 'track_and_intercept',
      nodes: [
        { type: 'updateTargetPosition' },
        { type: 'intercept' },
      ],
    },
    {
      type: 'sequence',
      name: 'recover_lost_target',
      nodes: [
        { type: 'hasTarget' },
        {
          type: 'timeout',
          ms: 10000, // Shorter recovery for intercept — urgency
          node: {
            type: 'reactiveSequence',
            nodes: [
              { type: 'inverter', node: { type: 'scanForTarget' } },
              { type: 'searchLastKnown' },
            ],
          },
        },
      ],
    },
    {
      type: 'reactiveSequence',
      name: 'search_for_target',
      nodes: [
        { type: 'inverter', node: { type: 'scanForTarget' } },
        { type: 'dispatchSearch' },
      ],
    },
  ],
};

// ─── Find and Harass ────────────────────────────────────────────────

export const findAndHarass = {
  type: 'reactiveSelector',
  name: 'find_and_harass',
  nodes: [
    {
      type: 'reactiveSequence',
      name: 'track_and_harass',
      nodes: [
        { type: 'updateTargetPosition' },
        { type: 'harass' },
      ],
    },
    {
      type: 'reactiveSequence',
      name: 'search_for_target',
      nodes: [
        { type: 'inverter', node: { type: 'scanForTarget' } },
        { type: 'dispatchSearch' },
      ],
    },
  ],
};

// ─── Patrol ─────────────────────────────────────────────────────────
// Continuous area search with periodic detection reporting.

export const patrol = {
  type: 'repeat',
  name: 'patrol',
  node: {
    type: 'parallel',
    name: 'patrol_with_detection',
    successThreshold: 1, // Succeeds if search completes (then repeats)
    failureThreshold: 2, // Never fails from detection alone
    nodes: [
      { type: 'dispatchSearch' },
      {
        type: 'forceSuccess',
        node: { type: 'scanForTarget' }, // Runs every tick — sets bb if found
      },
    ],
  },
};

// ─── Scout and React ────────────────────────────────────────────────
// Search an area. React to detections with priority-based response.
// Demonstrates composability: the LLM can modify this structure.

export const scoutAndReact = {
  type: 'reactiveSelector',
  name: 'scout_and_react',
  nodes: [
    {
      // Highest priority: if target found, surround it
      type: 'reactiveSequence',
      name: 'react_surround',
      nodes: [
        { type: 'scanForTarget' },
        { type: 'surround' },
      ],
    },
    {
      // Default: keep searching
      type: 'dispatchSearch',
    },
  ],
};

// ─── Template Registry ──────────────────────────────────────────────

export const TEMPLATES = {
  find_and_surround: findAndSurround,
  find_and_follow: findAndFollow,
  find_and_intercept: findAndIntercept,
  find_and_harass: findAndHarass,
  patrol,
  scout_and_react: scoutAndReact,
};
