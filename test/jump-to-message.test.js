import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// "Jump to message" turn-matching logic lives in public/app.js, which is loaded
// in the browser as a classic <script> (no build step, no module wrapper) and
// runs boot() at top level referencing `document`. It therefore can't be
// imported under Node. To still get regression coverage for the pure matching
// algorithm, this test:
//   (a) keeps a byte-for-byte reference copy of normForMatch + findTurnIndex,
//   (b) GUARDS against drift by asserting the live source in app.js still
//       contains these exact function bodies.
// If app.js changes the algorithm, the guard fails loudly and this test must be
// updated in lockstep — preventing a silent divergence.
// ---------------------------------------------------------------------------

// --- reference implementation (must mirror public/app.js) ---
function normForMatch(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
}
function findTurnIndex(turns, jump) {
  if (!jump || !Array.isArray(turns) || !turns.length) return -1;
  const norm = turns.map((t) => normForMatch(t.text));
  const snip = normForMatch(jump.snippet);
  if (snip) {
    for (const len of [snip.length, 80, 48, 24]) {
      if (len > snip.length) continue;
      const probe = snip.slice(0, len).trim();
      if (probe.length < 8) break;
      const i = norm.findIndex((n) => n.includes(probe));
      if (i !== -1) return i;
    }
  }
  const terms = String(jump.query || '')
    .split(/\s+/)
    .map((t) => normForMatch(t))
    .filter((t) => t.length >= 2);
  if (terms.length) {
    let best = -1, bestScore = 0;
    for (let i = 0; i < norm.length; i++) {
      let score = 0;
      for (const term of terms) if (norm[i].includes(term)) score++;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (bestScore > 0) return best;
  }
  return -1;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

function turns(...texts) {
  return texts.map((text, i) => ({ text, role: i % 2 ? 'assistant' : 'user' }));
}

// Collapse all whitespace and strip line comments so formatting/comment edits
// don't cause false drift alarms — we care about the algorithm's tokens.
const squash = (s) =>
  s
    .split('\n')
    .map((l) => l.replace(/\/\/[^\n\r]*/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

test('guard: app.js still defines the matching helpers this test mirrors', () => {
  const appSquashed = squash(APP_JS);
  assert.ok(
    appSquashed.includes(squash(normForMatch.toString())),
    'normForMatch in app.js diverged from the test reference'
  );
  assert.ok(
    appSquashed.includes(squash(findTurnIndex.toString())),
    'findTurnIndex in app.js diverged from the test reference'
  );
  // And app.js must actually wire jump-to into the open path.
  assert.match(APP_JS, /openSession\(r\.sessionId,[\s\S]*?\{ query: q, snippet: r\.snippet \}\)/);
  assert.match(APP_JS, /jumpToTurn\(/);
  assert.match(APP_JS, /classList\.add\('ct-hit'\)/);
});

test('matches by snippet substring first (exact)', () => {
  const t = turns('hello there', 'the quick brown fox jumps', 'goodbye');
  const i = findTurnIndex(t, { query: 'fox', snippet: 'the quick brown fox jumps' });
  assert.equal(i, 1);
});

test('snippet match tolerates whitespace/case differences', () => {
  const t = turns('Intro line', 'The   QUICK\n\tbrown   fox', 'tail');
  // Snippet as produced by the parser: whitespace-collapsed, original case.
  const i = findTurnIndex(t, { query: 'brown', snippet: 'The QUICK brown fox' });
  assert.equal(i, 1);
});

test('snippet match survives truncation (falls back to a leading chunk)', () => {
  const full = 'the configuration loader reads the local cache before hitting disk every time';
  const t = turns('unrelated', full, 'also unrelated');
  // Simulate a snippet that was cut short mid-sentence.
  const i = findTurnIndex(t, { query: 'configuration', snippet: 'the configuration loader reads the lo' });
  assert.equal(i, 1);
});

test('falls back to query terms when snippet does not match any turn', () => {
  const t = turns('alpha beta', 'gamma delta epsilon', 'zeta');
  const i = findTurnIndex(t, { query: 'gamma epsilon', snippet: 'no such text anywhere in transcript' });
  assert.equal(i, 1);
});

test('query-term fallback prefers the turn with the most distinct terms', () => {
  const t = turns('apple', 'apple banana', 'apple banana cherry');
  const i = findTurnIndex(t, { query: 'apple banana cherry', snippet: 'zzz unmatched' });
  assert.equal(i, 2);
});

test('returns -1 when nothing matches (caller opens at top)', () => {
  const t = turns('one', 'two', 'three');
  assert.equal(findTurnIndex(t, { query: 'xx', snippet: 'nope nope nope' }), -1);
});

test('returns -1 for a normal (non-search) open with no jump info', () => {
  const t = turns('one', 'two');
  assert.equal(findTurnIndex(t, undefined), -1);
  assert.equal(findTurnIndex(t, null), -1);
  assert.equal(findTurnIndex([], { snippet: 'x', query: 'x' }), -1);
});

test('does not throw on turns with null/empty text', () => {
  const t = [{ text: null }, { text: '' }, { text: 'real match here' }];
  assert.equal(findTurnIndex(t, { query: 'real', snippet: 'real match here' }), 2);
});

test('very short snippet (<8 chars after norm) skips substring, uses terms', () => {
  const t = turns('foo', 'bar baz', 'qux');
  // snippet too short to be a reliable probe -> term fallback finds "baz".
  const i = findTurnIndex(t, { query: 'baz', snippet: 'bar' });
  assert.equal(i, 1);
});
