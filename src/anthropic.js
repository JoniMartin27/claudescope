/**
 * OPT-IN connector to Anthropic's Admin Cost Report API.
 *
 * THIS IS THE ONLY NETWORKED CODE PATH IN CLAUDESCOPE. It never runs at
 * startup or on the default dashboard — it only fires when the user has
 * explicitly configured an admin key AND hits /api/anthropic-usage. By
 * default ClaudeScope makes ZERO network requests.
 *
 * The endpoint/response shape below is best-effort against Anthropic's
 * Admin "cost report" API and may need adjustment as that API evolves. We
 * parse defensively: pull a total USD figure plus per-day buckets when the
 * payload exposes them, and degrade gracefully when it doesn't.
 */

const COST_REPORT_URL = 'https://api.anthropic.com/v1/organizations/cost_report';
const ANTHROPIC_VERSION = '2023-06-01';

/** UTC YYYY-MM-DD for a Date — the API expects ISO date boundaries. */
function isoDay(d) {
  return d.toISOString().slice(0, 10);
}

/** Coerce anything number-ish (string or number) to a finite number or 0. */
function num(v) {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return typeof n === 'number' && isFinite(n) ? n : 0;
}

/**
 * Walk an unknown cost-report payload and pull out USD amounts. The Admin
 * API has used a few shapes over time (data[].results[].amount, flat
 * data[].amount, top-level total_cost, …), so we look in the likely places
 * and sum whatever USD amounts we find, bucketed by day when a date is
 * present. Defensive by design: unknown shapes yield total 0 rather than a
 * throw.
 */
function parseCostReport(payload) {
  const perDay = new Map(); // day -> usd
  let total = 0;

  const addAmount = (day, usd) => {
    const amt = num(usd);
    if (!amt) return;
    total += amt;
    if (day) perDay.set(day, (perDay.get(day) || 0) + amt);
  };

  // Pull a USD amount out of an arbitrary leaf object.
  const amountOf = (obj) => {
    if (!obj || typeof obj !== 'object') return 0;
    // Common keys across API versions / billing exports.
    if (obj.amount != null) {
      // Skip explicitly non-USD currency buckets when labelled.
      if (obj.currency && String(obj.currency).toUpperCase() !== 'USD') return 0;
      return num(obj.amount);
    }
    if (obj.cost != null) return num(obj.cost);
    if (obj.amount_usd != null) return num(obj.amount_usd);
    if (obj.total_cost != null) return num(obj.total_cost);
    return 0;
  };

  const dayOf = (obj) =>
    (obj && (obj.date || obj.day || obj.starting_at || obj.start_time || obj.bucket)) || null;

  if (payload && typeof payload === 'object') {
    const buckets = Array.isArray(payload.data)
      ? payload.data
      : Array.isArray(payload.results)
        ? payload.results
        : [];

    for (const b of buckets) {
      if (!b || typeof b !== 'object') continue;
      const day = dayOf(b) ? isoDayMaybe(dayOf(b)) : null;
      // A bucket may itself hold a list of results, or be a leaf with an amount.
      const inner = Array.isArray(b.results) ? b.results : Array.isArray(b.items) ? b.items : null;
      if (inner) {
        for (const r of inner) addAmount(dayOf(r) ? isoDayMaybe(dayOf(r)) : day, amountOf(r));
      } else {
        addAmount(day, amountOf(b));
      }
    }

    // Fall back to a top-level total if the buckets gave us nothing.
    if (!total) {
      const top = amountOf(payload);
      if (top) total = top;
    }
  }

  const days = [...perDay.entries()]
    .map(([day, usd]) => ({ day, cost: Math.round(usd * 1e6) / 1e6 }))
    .sort((a, b) => (a.day < b.day ? -1 : 1));

  return { totalCost: Math.round(total * 1e6) / 1e6, days };
}

/** Best-effort normalize a timestamp/date string to YYYY-MM-DD (UTC). */
function isoDayMaybe(v) {
  if (typeof v !== 'string') return null;
  // Already a bare date.
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const t = Date.parse(v);
  return isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

/**
 * Fetch real billed cost from Anthropic's Admin cost-report API.
 *
 * @param {object} opts
 * @param {string} opts.apiKey  Anthropic ADMIN key (sk-ant-admin…). Required.
 * @param {number} [opts.days]  Look-back window in days (default 30).
 * @returns {Promise<{ totalCost:number, days:Array<{day:string,cost:number}>, currency:string, since:string, until:string }>}
 * @throws {Error} on missing key, non-200 response, or network failure.
 */
export async function fetchAnthropicCost({ apiKey, days = 30 } = {}) {
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new Error('Missing Anthropic admin key');
  }
  if (typeof fetch !== 'function') {
    throw new Error('global fetch is unavailable (requires Node 18+)');
  }

  const window = Math.max(1, Math.min(365, Math.floor(Number(days) || 30)));
  const until = new Date();
  const since = new Date(until.getTime() - window * 86400000);

  const url = new URL(COST_REPORT_URL);
  url.searchParams.set('starting_at', isoDay(since));
  url.searchParams.set('ending_at', isoDay(until));

  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey.trim(),
        'anthropic-version': ANTHROPIC_VERSION,
        accept: 'application/json',
      },
    });
  } catch (err) {
    throw new Error(`Network error contacting Anthropic: ${err && err.message ? err.message : err}`);
  }

  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 300);
    } catch {
      /* ignore */
    }
    throw new Error(`Anthropic cost API returned ${res.status}${detail ? `: ${detail}` : ''}`);
  }

  let payload;
  try {
    payload = await res.json();
  } catch (err) {
    throw new Error(`Could not parse Anthropic cost API response: ${err && err.message ? err.message : err}`);
  }

  const { totalCost, days: perDay } = parseCostReport(payload);
  return {
    totalCost,
    days: perDay,
    currency: 'USD',
    since: isoDay(since),
    until: isoDay(until),
  };
}

// Exported for unit testing the defensive parser without touching the network.
export const __test = { parseCostReport, isoDayMaybe };
