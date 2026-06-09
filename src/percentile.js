/**
 * OFFLINE percentile estimate for Claude Code token usage.
 *
 * ⚠️ HEURISTIC, NOT MEASURED DATA. The distribution table below is a static,
 * hand-built approximation of *monthly* token usage across Claude Code users,
 * derived from a plausible heavy-tailed (log-normal-ish) model — NOT from any
 * real population survey or telemetry. It is baked into the package so the
 * badge stays 100% offline and makes ZERO network requests. Treat the number
 * as a fun, directional estimate, not a precise ranking.
 *
 * The table maps "monthly tokens" -> "percentile of users at or below this
 * volume". Anchors were chosen so that:
 *   - a light/occasional user (a few hundred K tok/mo) sits low,
 *   - a steady daily user (a few million tok/mo) sits around the middle,
 *   - a heavy power user (tens of millions / mo, dominated by cache reads)
 *     sits in the top single-digit percentages.
 * Cache reads inflate token counts a lot in real Claude Code usage, so the
 * upper anchors are deliberately large.
 *
 * Pure Node stdlib, no dependencies, no I/O.
 */

/**
 * Cumulative distribution anchors: [monthlyTokens, cumulativePercentile].
 * cumulativePercentile = estimated % of users whose monthly volume is <= this.
 * Must be sorted ascending by tokens AND by percentile (monotonic).
 */
const DISTRIBUTION = [
  [0, 0],
  [25_000, 5],
  [100_000, 15],
  [300_000, 30],
  [750_000, 45],
  [1_500_000, 55],
  [3_000_000, 65],
  [6_000_000, 75],
  [12_000_000, 84],
  [25_000_000, 91],
  [50_000_000, 96],
  [100_000_000, 98],
  [250_000_000, 99],
  [1_000_000_000, 100],
];

/**
 * Estimated cumulative percentile (0..100) of users at or below `tokensPerMonth`.
 * Linearly interpolated between table anchors, clamped to [0,100], monotonic
 * non-decreasing in the input.
 */
export function cumulativePercentile(tokensPerMonth) {
  const t = typeof tokensPerMonth === 'number' && tokensPerMonth > 0 ? tokensPerMonth : 0;
  const last = DISTRIBUTION[DISTRIBUTION.length - 1];
  if (t >= last[0]) return 100;
  for (let i = 1; i < DISTRIBUTION.length; i++) {
    const [hx, hy] = DISTRIBUTION[i];
    if (t <= hx) {
      const [lx, ly] = DISTRIBUTION[i - 1];
      if (hx === lx) return Math.round(hy);
      const frac = (t - lx) / (hx - lx);
      return Math.round(ly + (hy - ly) * frac);
    }
  }
  return 100;
}

/**
 * Percentile for a monthly token volume, returned as an integer 0..100.
 * (Alias of cumulativePercentile — kept as the documented public name.)
 */
export function percentileForMonthlyTokens(tokensPerMonth) {
  return cumulativePercentile(tokensPerMonth);
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Normalize the user's total tokens to a 30-day rate using their active span.
 * Span = days between totals.firstTs and totals.lastTs (>= 1). The result is
 * totals.tokens scaled by 30 / spanDays, so short histories aren't unfairly
 * penalised and long ones aren't over-counted.
 */
export function monthlyTokenRate(analytics) {
  const totals = (analytics && analytics.totals) || {};
  const tokens = totals.tokens || 0;
  if (tokens <= 0) return 0;
  const a = totals.firstTs ? new Date(totals.firstTs).getTime() : NaN;
  const b = totals.lastTs ? new Date(totals.lastTs).getTime() : NaN;
  let spanDays = 1;
  if (!isNaN(a) && !isNaN(b) && b > a) {
    spanDays = (b - a) / MS_PER_DAY;
  }
  spanDays = Math.max(1, spanDays);
  return tokens * (30 / spanDays);
}

/**
 * Top-percent summary for the dashboard badge / share card.
 * Returns { percentile, monthlyTokens, label } where:
 *   - percentile  = the cumulative percentile (0..100),
 *   - monthlyTokens = the 30-day-normalized token rate,
 *   - label = e.g. "top 8%" (= 100 - percentile, clamped to >= 1%).
 */
export function topPercent(analytics) {
  const monthlyTokens = monthlyTokenRate(analytics);
  const percentile = cumulativePercentile(monthlyTokens);
  // "top X%" — the higher your percentile, the smaller X. Never claim top 0%.
  const top = Math.max(1, Math.min(100, 100 - percentile));
  return { percentile, monthlyTokens, label: `top ${top}%` };
}
