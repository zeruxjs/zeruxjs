import type { BaseIssue } from '../types/index.js';

export interface FormattedIssueTree {
  readonly _errors: string[];
  readonly [key: string]: FormattedIssueTree | string[];
}

function createNode(): { _errors: string[];[key: string]: FormattedIssueTree | string[] } {
  return { _errors: [] };
}

/**
 * Formats issues into a nested object similar to `error.format()`.
 *
 * @param issues The issues to format.
 *
 * @returns A nested error tree.
 */
export function formatIssues(
  issues: [BaseIssue<unknown>, ...BaseIssue<unknown>[]]
): FormattedIssueTree {
  const root = createNode();

  for (const issue of issues) {
    let cursor = root;

    if (issue.path?.length) {
      for (const item of issue.path) {
        const key =
          typeof item.key === 'string' || typeof item.key === 'number'
            ? `${item.key}`
            : null;

        if (!key) {
          cursor._errors.push(issue.message);
          cursor = root;
          break;
        }

        if (!(key in cursor)) {
          cursor[key] = createNode();
        }

        cursor = cursor[key] as FormattedIssueTree;
      }
    }

    cursor._errors.push(issue.message);
  }

  return root as FormattedIssueTree;
}
