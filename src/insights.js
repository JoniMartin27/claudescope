/**
 * Build a handful of short, surprising one-liner insights from an already-built
 * analytics object. Pure & dependency-free. Every string is plain text (safe to
 * render without HTML), self-contained, and guarded against empty/zero data.
 *
 * Reads only fields the analytics payload already exposes: totals.*, byProject,
 * byModel, byDay, heatmap (heatmap[weekday][hour], weekday 0 = Sunday).
 */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function fmtInt(n) {
  return Math.round(n).toLocaleString('en-US');
}

function pct(n) {
  return `${(n * 100).toFixed(n >= 0.1 ? 0 : 1)}%`;
}

/** Human-friendly hour label, e.g. 0 -> "12am", 13 -> "1pm". */
function hourLabel(h) {
  const ampm = h < 12 ? 'am' : 'pm';
  let hr = h % 12;
  if (hr === 0) hr = 12;
  return `${hr}${ampm}`;
}

export function buildInsights(analytics) {
  const a = analytics || {};
  const totals = a.totals || {};
  const out = [];

  // 1) Cache reads as a share of all tokens — usually a startling fraction.
  const tokens = totals.tokens || 0;
  const cacheRead = (totals.usage && totals.usage.cacheRead) || 0;
  if (tokens > 0 && cacheRead > 0) {
    out.push(`Cache reads make up ${pct(cacheRead / tokens)} of every token you've moved — ${fmtInt(cacheRead)} of ${fmtInt(tokens)}.`);
  }

  // 2) Busiest weekday + hour, scanned from the heatmap.
  const heatmap = Array.isArray(a.heatmap) ? a.heatmap : [];
  let best = -1;
  let bestDay = 0;
  let bestHour = 0;
  for (let d = 0; d < heatmap.length; d++) {
    const row = heatmap[d] || [];
    for (let h = 0; h < row.length; h++) {
      if (row[h] > best) {
        best = row[h];
        bestDay = d;
        bestHour = h;
      }
    }
  }
  if (best > 0) {
    out.push(`Your peak coding hour is ${WEEKDAYS[bestDay]} at ${hourLabel(bestHour)} (${fmtInt(best)} replies land in that slot).`);
  }

  // 3) Top project's share of total cost vs the rest.
  const byProject = a.byProject || [];
  const totalCost = totals.cost || 0;
  if (byProject.length >= 2 && totalCost > 0) {
    const top = byProject[0];
    out.push(`"${top.label || top.path || 'top project'}" alone is ${pct((top.cost || 0) / totalCost)} of your spend, across ${byProject.length} projects.`);
  } else if (byProject.length === 1 && totalCost > 0) {
    out.push(`Everything you've spent so far lives in a single project: "${byProject[0].label || byProject[0].path || 'it'}".`);
  }

  // 4) Interrupted session percentage.
  const sessions = totals.sessions || 0;
  const interrupted = totals.interruptedSessions || 0;
  if (sessions > 0 && interrupted > 0) {
    out.push(`You hit the stop button in ${pct(interrupted / sessions)} of sessions (${fmtInt(interrupted)} of ${fmtInt(sessions)}).`);
  }

  // 5) Dominant model by cost.
  const byModel = a.byModel || [];
  if (byModel.length > 0 && totalCost > 0) {
    const top = byModel[0];
    if ((top.cost || 0) > 0) {
      out.push(`${top.model} drives ${pct((top.cost || 0) / totalCost)} of your cost.`);
    }
  }

  // 6) Average tokens per active day.
  const byDay = a.byDay || [];
  if (byDay.length > 0 && tokens > 0) {
    out.push(`That's about ${fmtInt(tokens / byDay.length)} tokens on each of your ${fmtInt(byDay.length)} active days.`);
  }

  // Always return SOMETHING so the UI never renders an empty section.
  if (out.length === 0) {
    out.push('No activity scanned yet — run Claude Code a bit and refresh to see insights.');
  }
  return out;
}
