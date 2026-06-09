import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyArchetype } from '../src/archetype.js';

// Minimal hand-built analytics objects exercising each classifier branch.
function base(overrides = {}) {
  return {
    totals: {
      sessions: 10,
      tools: 0,
      cacheHitRate: 0.5,
      interruptedSessions: 0,
      ...overrides.totals,
    },
    byTool: overrides.byTool || [],
    byModel: overrides.byModel || [],
  };
}

test('very high cache hit-rate -> Context Hoarder', () => {
  const a = classifyArchetype(base({ totals: { cacheHitRate: 0.95, sessions: 10 } }));
  assert.equal(a.key, 'context-hoarder');
  assert.equal(a.emoji, '🧠');
  assert.match(a.blurb, /95%/);
});

test('high interrupted ratio -> Course-Corrector', () => {
  const a = classifyArchetype(
    base({ totals: { cacheHitRate: 0.4, sessions: 10, interruptedSessions: 6 } })
  );
  assert.equal(a.key, 'course-corrector');
  assert.equal(a.emoji, '🛟');
});

test('Read/Grep dominant -> Investigator', () => {
  const a = classifyArchetype(
    base({
      totals: { cacheHitRate: 0.4, tools: 20, sessions: 5 },
      byTool: [
        { tool: 'Read', count: 12 },
        { tool: 'Grep', count: 4 },
        { tool: 'Bash', count: 2 },
        { tool: 'Edit', count: 2 },
      ],
    })
  );
  assert.equal(a.key, 'investigator');
  assert.equal(a.emoji, '🔎');
});

test('Bash dominant -> Automator', () => {
  const a = classifyArchetype(
    base({
      totals: { cacheHitRate: 0.4, tools: 20, sessions: 5 },
      byTool: [
        { tool: 'Bash', count: 15 },
        { tool: 'Read', count: 3 },
        { tool: 'Edit', count: 2 },
      ],
    })
  );
  assert.equal(a.key, 'automator');
});

test('Edit/Write dominant -> Builder', () => {
  const a = classifyArchetype(
    base({
      totals: { cacheHitRate: 0.4, tools: 20, sessions: 5 },
      byTool: [
        { tool: 'Edit', count: 9 },
        { tool: 'Write', count: 6 },
        { tool: 'Read', count: 3 },
        { tool: 'Bash', count: 2 },
      ],
    })
  );
  assert.equal(a.key, 'builder');
  assert.equal(a.emoji, '🔨');
});

test('balanced / sparse -> Generalist', () => {
  const a = classifyArchetype(
    base({
      totals: { cacheHitRate: 0.4, tools: 6, sessions: 3 },
      byTool: [
        { tool: 'Read', count: 2 },
        { tool: 'Bash', count: 2 },
        { tool: 'Edit', count: 2 },
      ],
    })
  );
  assert.equal(a.key, 'generalist');
  assert.equal(a.emoji, '🧭');
});

test('empty analytics never throws and falls back to Generalist', () => {
  const a = classifyArchetype({});
  assert.equal(a.key, 'generalist');
  assert.equal(typeof a.blurb, 'string');
});
