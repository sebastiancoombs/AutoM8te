/**
 * Behavior Tree Templates — Pre-built trees for common missions.
 * 
 * These are JSON definitions that the BehaviorTreeImporter can load.
 * The LLM can also generate custom trees in this same format.
 * 
 * Node types:
 *   - "sequence": All children must succeed (left to right)
 *   - "selector": First child that succeeds wins (fallback)
 *   - "parallel": Run children concurrently
 *   - "repeat": Decorator — repeat child N times (or forever if no limit)
 *   - "invert": Decorator — flip success/failure
 *   - Any registered task name (from actions.js / conditions.js)
 */

// ─── Find and Surround ─────────────────────────────────────────────

export const findAndSurround = {
  type: 'selector',
  name: 'find_and_surround',
  nodes: [
    {
      // Fast path: target already visible
      type: 'sequence',
      name: 'target_visible_path',
      nodes: [
        { type: 'scanForTarget' },
        { type: 'hoverAll' },
        { type: 'surround' },
        {
          // Tracking loop: keep updating surround position
          type: 'repeat',
          name: 'track_and_surround',
          node: {
            type: 'sequence',
            nodes: [
              { type: 'wait' },
              { type: 'updateTargetPosition' },
              { type: 'surround' },
            ],
          },
        },
      ],
    },
    {
      // Slow path: search first
      type: 'sequence',
      name: 'search_then_surround',
      nodes: [
        { type: 'dispatchSearch' },
        {
          // Search loop: scan while searching
          type: 'repeat',
          name: 'search_loop',
          node: {
            type: 'selector',
            nodes: [
              {
                type: 'sequence',
                nodes: [
                  { type: 'scanForTarget' },
                  { type: 'hoverAll' },
                  { type: 'surround' },
                ],
              },
              { type: 'wait' }, // Keep searching
            ],
          },
        },
      ],
    },
  ],
};

// ─── Find and Follow ────────────────────────────────────────────────

export const findAndFollow = {
  type: 'selector',
  name: 'find_and_follow',
  nodes: [
    {
      type: 'sequence',
      name: 'target_visible_follow',
      nodes: [
        { type: 'scanForTarget' },
        {
          type: 'repeat',
          name: 'follow_loop',
          node: {
            type: 'sequence',
            nodes: [
              { type: 'updateTargetPosition' },
              { type: 'follow' },
              { type: 'wait' },
            ],
          },
        },
      ],
    },
    {
      type: 'sequence',
      name: 'search_then_follow',
      nodes: [
        { type: 'dispatchSearch' },
        {
          type: 'repeat',
          name: 'search_for_follow',
          node: {
            type: 'selector',
            nodes: [
              {
                type: 'sequence',
                nodes: [
                  { type: 'scanForTarget' },
                  { type: 'hoverAll' },
                  { type: 'follow' },
                ],
              },
              { type: 'wait' },
            ],
          },
        },
      ],
    },
  ],
};

// ─── Find and Intercept ─────────────────────────────────────────────

export const findAndIntercept = {
  type: 'selector',
  name: 'find_and_intercept',
  nodes: [
    {
      type: 'sequence',
      name: 'target_visible_intercept',
      nodes: [
        { type: 'scanForTarget' },
        {
          type: 'repeat',
          name: 'intercept_loop',
          node: {
            type: 'sequence',
            nodes: [
              { type: 'updateTargetPosition' },
              { type: 'intercept' },
              { type: 'wait' },
            ],
          },
        },
      ],
    },
    {
      type: 'sequence',
      name: 'search_then_intercept',
      nodes: [
        { type: 'dispatchSearch' },
        {
          type: 'repeat',
          name: 'search_for_intercept',
          node: {
            type: 'selector',
            nodes: [
              {
                type: 'sequence',
                nodes: [
                  { type: 'scanForTarget' },
                  { type: 'hoverAll' },
                  { type: 'intercept' },
                ],
              },
              { type: 'wait' },
            ],
          },
        },
      ],
    },
  ],
};

// ─── Find and Harass ────────────────────────────────────────────────

export const findAndHarass = {
  type: 'selector',
  name: 'find_and_harass',
  nodes: [
    {
      type: 'sequence',
      name: 'target_visible_harass',
      nodes: [
        { type: 'scanForTarget' },
        { type: 'harass' },
      ],
    },
    {
      type: 'sequence',
      name: 'search_then_harass',
      nodes: [
        { type: 'dispatchSearch' },
        {
          type: 'repeat',
          name: 'search_for_harass',
          node: {
            type: 'selector',
            nodes: [
              {
                type: 'sequence',
                nodes: [
                  { type: 'scanForTarget' },
                  { type: 'hoverAll' },
                  { type: 'harass' },
                ],
              },
              { type: 'wait' },
            ],
          },
        },
      ],
    },
  ],
};

// ─── Patrol ─────────────────────────────────────────────────────────

export const patrol = {
  type: 'repeat',
  name: 'patrol',
  node: {
    type: 'sequence',
    nodes: [
      { type: 'dispatchSearch' },
      {
        type: 'repeat',
        name: 'patrol_scan_loop',
        node: {
          type: 'sequence',
          nodes: [
            { type: 'wait' },
            {
              type: 'selector',
              nodes: [
                {
                  // If we spot something, report it but keep patrolling
                  type: 'sequence',
                  nodes: [
                    { type: 'scanForTarget' },
                    { type: 'wait' }, // Brief pause to register detection
                  ],
                },
                { type: 'wait' }, // Nothing found, keep going
              ],
            },
          ],
        },
      },
    ],
  },
};

// ─── Scout and React ────────────────────────────────────────────────
// Example of a more complex composed behavior:
// "Search an area. If you find a car, follow it. If you find a person, surround them."

export const scoutAndReact = {
  type: 'repeat',
  name: 'scout_and_react',
  node: {
    type: 'sequence',
    nodes: [
      { type: 'dispatchSearch' },
      {
        type: 'selector',
        name: 'react_to_detection',
        nodes: [
          {
            // Priority 1: person detected → surround
            type: 'sequence',
            nodes: [
              { type: 'scanForTarget' }, // bb.targetClass should be set
              { type: 'hoverAll' },
              { type: 'surround' },
            ],
          },
          {
            // Priority 2: keep searching
            type: 'wait',
          },
        ],
      },
    ],
  },
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
