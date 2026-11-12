import type { BaseIssue } from '../types/index.js';
import { getDotPath } from '../utils/index.js';

/**
 * Build a private multi-line diagnostic summary preserving raw messages and convertible paths. It is not an HTML encoder or public privacy boundary.
 *
 * @param {[BaseIssue<unknown>, ...BaseIssue<unknown>[]]} issues - Nonempty private raw issue list.
 *
 * @returns {string} Private multi-line summary; escape for destination context and redact before public output.
 *
 * @beta
 */
// @__NO_SIDE_EFFECTS__
export function summarize(
  issues: [BaseIssue<unknown>, ...BaseIssue<unknown>[]]
): string {
  // Create variable to store summary
  let summary = '';

  // Add message of each issue to summary
  for (const issue of issues) {
    // Add newline if summary is not empty
    if (summary) {
      summary += '\n';
    }

    // Add message to summary
    summary += `× ${issue.message}`;

    // Get dot path from issue
    /** Raw convertible path selected only for private diagnostic presentation. */
    const dotPath = getDotPath(issue);

    // If dot path is available, add it to summary
    if (dotPath) {
      summary += `\n  → at ${dotPath}`;
    }
  }

  // Return summary
  return summary;
}
