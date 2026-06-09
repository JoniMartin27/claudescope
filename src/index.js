// Programmatic API for ClaudeScope — use it as a library, not just a CLI.
//
//   import { analyze } from 'claudescope-cli';
//   const { analytics } = await analyze();           // auto-detect ~/.claude
//   const { analytics } = await analyze('/path/.claude');
//
// Everything is local and read-only; nothing touches the network.
import { findClaudeDir } from './paths.js';
import { parseAll, readConversation } from './parser.js';
import { buildAnalytics, search } from './analytics.js';
import { costForUsage, priceForModel } from './pricing.js';

/**
 * Parse a Claude Code data directory and return analytics + raw records.
 * @param {string} [claudeDir] path to a .claude dir (auto-detected if omitted)
 * @returns {Promise<{claudeDir:string, analytics:object, sessions:object[], messages:object[]}>}
 */
export async function analyze(claudeDir) {
  const dir = claudeDir || findClaudeDir();
  if (!dir) throw new Error('Could not find a Claude Code data directory (set CLAUDE_CONFIG_DIR or pass a path).');
  const { sessions, messages } = await parseAll(dir);
  return { claudeDir: dir, analytics: buildAnalytics(sessions), sessions, messages };
}

export { findClaudeDir, parseAll, readConversation, buildAnalytics, search, costForUsage, priceForModel };
