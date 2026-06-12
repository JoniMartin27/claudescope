import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv, formatField, neutralize, BOM } from '../src/csv.js';

test('RFC 4180: quotes fields containing comma, quote, CR or LF; doubles inner quotes', () => {
  assert.equal(formatField('plain'), 'plain');
  assert.equal(formatField('a,b'), '"a,b"');
  assert.equal(formatField('say "hi"'), '"say ""hi"""');
  assert.equal(formatField('line1\nline2'), '"line1\nline2"');
  assert.equal(formatField('has\rCR'), '"has\rCR"');
});

test('numbers and booleans are emitted raw, never injection-prefixed', () => {
  assert.equal(formatField(42), '42');
  assert.equal(formatField(0), '0');
  assert.equal(formatField(-5), '-5'); // a negative NUMBER keeps its minus, no quote
  assert.equal(formatField(true), 'true');
  // Non-finite numbers degrade to empty rather than "NaN"/"Infinity".
  assert.equal(formatField(NaN), '');
  assert.equal(formatField(Infinity), '');
});

test('null/undefined become empty cells', () => {
  assert.equal(formatField(null), '');
  assert.equal(formatField(undefined), '');
});

test('anti-injection: strings starting with a formula trigger get a leading apostrophe', () => {
  for (const t of ['=', '+', '-', '@', '\t', '\r']) {
    const payload = t + 'cmd';
    const out = neutralize(payload);
    assert.equal(out[0], "'", `trigger ${JSON.stringify(t)} must be neutralized`);
  }
  // A normal string is untouched.
  assert.equal(neutralize('hello'), 'hello');
  assert.equal(neutralize(''), '');
});

test('classic formula-injection payloads are neutralized through formatField', () => {
  // CR-containing payload gets BOTH neutralized (leading ') and RFC-quoted (CR).
  const cr = formatField('\r=1+1');
  assert.equal(cr[1], "'");
  assert.match(cr, /^"/);
  // The DDE/cmd exec payload.
  assert.match(formatField('=cmd|/c calc!A1'), /^'=cmd/);
  // The =-prefixed value that ALSO contains a comma -> neutralized AND quoted.
  const both = formatField('=HYPERLINK("evil",1)');
  assert.match(both, /^"'=HYPERLINK/);
});

test('toCsv joins records with CRLF and ends on a record boundary', () => {
  const csv = toCsv([
    ['a', 'b'],
    ['1', '2'],
  ]);
  assert.equal(csv, 'a,b\r\n1,2\r\n');
});

test('toCsv prepends a UTF-8 BOM when asked', () => {
  const csv = toCsv([['x']], { bom: true });
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.equal(csv, BOM + 'x\r\n');
});

test('toCsv of an empty row set is empty (no stray CRLF)', () => {
  assert.equal(toCsv([]), '');
  assert.equal(toCsv([], { bom: true }), BOM);
});
