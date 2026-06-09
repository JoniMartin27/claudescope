/**
 * Derive a single, playful "coding archetype" from an already-built analytics
 * object. Pure & dependency-free: it only reads fields the analytics payload
 * already exposes (totals.cacheHitRate, byTool counts, totals.tools, byModel,
 * totals.interruptedSessions, totals.perSession).
 *
 * Thresholds are deliberately simple and documented inline so the result is
 * explainable. Order matters: the first rule that fires wins, so the more
 * specific / striking signals are checked before the broad tool-mix buckets.
 */

/** Sum the counts of a set of tool names from the byTool array. */
function toolCount(byTool, names) {
  let sum = 0;
  for (const t of byTool || []) {
    if (names.includes(t.tool)) sum += t.count || 0;
  }
  return sum;
}

export function classifyArchetype(analytics) {
  const a = analytics || {};
  const totals = a.totals || {};
  const byTool = a.byTool || [];
  const totalTools = totals.tools || 0;
  const sessions = totals.sessions || 0;
  const cacheHitRate = totals.cacheHitRate || 0;
  const interrupted = totals.interruptedSessions || 0;
  const interruptedRatio = sessions > 0 ? interrupted / sessions : 0;

  // Tool families.
  const investigate = toolCount(byTool, ['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch']);
  const automate = toolCount(byTool, ['Bash']);
  const build = toolCount(byTool, ['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);
  const share = totalTools > 0 ? 1 : 0; // guard for "no tools at all"

  // The fraction of all tool calls a family represents (0 when no tools used).
  const frac = (n) => (totalTools > 0 ? n / totalTools : 0);

  // 1) The Context Hoarder — almost everything comes from cache reads. A very
  //    high cache hit-rate (>0.9) means huge contexts are replayed turn after
  //    turn. Checked first because it's a distinctive, surprising signal.
  if (cacheHitRate > 0.9) {
    return {
      key: 'context-hoarder',
      name: 'The Context Hoarder',
      emoji: '🧠',
      blurb: `A ${(cacheHitRate * 100).toFixed(0)}% cache hit-rate — you keep enormous context warm across turns.`,
    };
  }

  // 2) The Course-Corrector — you stop Claude mid-flight a lot. If >30% of
  //    sessions had an interruption, steering is your defining habit.
  if (sessions >= 3 && interruptedRatio > 0.3) {
    return {
      key: 'course-corrector',
      name: 'The Course-Corrector',
      emoji: '🛟',
      blurb: `You interrupted ${(interruptedRatio * 100).toFixed(0)}% of sessions — a hands-on steerer.`,
    };
  }

  // Tool-mix archetypes need a meaningful number of tool calls to be honest.
  if (totalTools >= 5 && share) {
    // A family is "dominant" when it's both the largest and >40% of all calls.
    const families = [
      { f: investigate, key: 'investigator', name: 'The Investigator', emoji: '🔎',
        verb: 'reading & searching' },
      { f: automate, key: 'automator', name: 'The Automator', emoji: '⚙️',
        verb: 'shelling out to Bash' },
      { f: build, key: 'builder', name: 'The Builder', emoji: '🔨',
        verb: 'editing & writing files' },
    ];
    families.sort((x, y) => y.f - x.f);
    const top = families[0];
    if (top.f > 0 && frac(top.f) > 0.4) {
      return {
        key: top.key,
        name: top.name,
        emoji: top.emoji,
        blurb: `${(frac(top.f) * 100).toFixed(0)}% of your tool calls are ${top.verb}.`,
      };
    }
  }

  // 3) The Generalist — no single signal dominates.
  return {
    key: 'generalist',
    name: 'The Generalist',
    emoji: '🧭',
    blurb: sessions > 0
      ? `A balanced mix across ${sessions} session${sessions === 1 ? '' : 's'} — no single habit dominates.`
      : 'Not enough activity yet to read your style.',
  };
}
