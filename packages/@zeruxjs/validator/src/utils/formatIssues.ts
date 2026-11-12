import type { BaseIssue } from '../types/index.js';

export interface FormattedIssueTree {
  /** Private raw diagnostic messages for this node; never sanitized merely by being structured. */
  readonly _errors: string[];
  readonly [key: string]: FormattedIssueTree | string[];
}

/** Create a null-prototype private diagnostic node with a reserved message list. Prototype safety does not remove private messages or dynamic paths.
 * @returns {object} Fresh own _errors array with no inherited object keys.
 */
function createNode(): {
  /** Private raw diagnostic messages for this node; never sanitized merely by being structured. */
  _errors: string[];
  [key: string]: FormattedIssueTree | string[];
} {
  return Object.assign(Object.create(null), { _errors: [] });
}

/** Format private raw messages into a null-prototype nested tree, reserving _errors for each node. This never makes custom messages safe for HTML or public disclosure.
 * @param {[BaseIssue<unknown>, ...BaseIssue<unknown>[]]} issues - Nonempty private raw issue list; unrepresentable/reserved path segments fall back to node/root diagnostics.
 * @returns {FormattedIssueTree} Private message tree preserving authored diagnostic text; use clientIssues for explicit public redaction.
 */
export function formatIssues(
  issues: [BaseIssue<unknown>, ...BaseIssue<unknown>[]]
): FormattedIssueTree {
  /** Owned null-prototype root for private structured diagnostic messages. */
  const root = createNode();

  // Preserve issue order while keeping prototype-sensitive raw keys inside null-prototype nodes.
  for (const issue of issues) {
    let cursor = root;

    if (issue.path?.length) {
      // Follow only representable raw diagnostic segments; never interpolate a DOM selector.
      for (const item of issue.path) {
        /** Raw string/number path segment; reserved _errors/unrepresentable keys never become child nodes. */
        const key =
          typeof item.key === 'string' || typeof item.key === 'number'
            ? `${item.key}`
            : null;

        if (!key || key === '_errors') {
          cursor._errors.push(issue.message);
          cursor = root;
          break;
        }

        if (!Object.hasOwn(cursor, key)) {
          cursor[key] = createNode();
        }

        cursor = cursor[key] as FormattedIssueTree;
      }
    }

    cursor._errors.push(issue.message);
  }

  return root as FormattedIssueTree;
}
