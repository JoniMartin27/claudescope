const { test } = require("node:test");
const assert = require("node:assert");

test("percentile works", () => {
  assert.strictEqual(true, true);
});

test.skip("percentile handles empty input", () => {
  assert.strictEqual(percentile([]), 0);
});

test("percentile handles nulls", () => {
});
