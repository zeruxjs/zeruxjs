import type {
  BaseIssue,
  BaseSchema,
  BaseSchemaAsync,
  InferIssue,
  IssueDotPath,
} from '../types/index.js';

/**
 * Join convertible raw diagnostic string/number keys; no escaping, selector interpolation or privacy redaction occurs.
 *
 * @param {BaseIssue<unknown>} issue - Private raw issue whose path may contain user-derived keys.
 *
 * @returns {string | null} Joined raw path or null for absence/nonconvertible keys.
 */
export function getDotPath(issue: BaseIssue<unknown>): string | null;

/**
 * Join convertible raw diagnostic string/number keys; no escaping, selector interpolation or privacy redaction occurs.
 *
 * @param {InferIssue<TSchema>} issue - Private schema-specific issue path.
 *
 * @returns {IssueDotPath<TSchema> | null} Typed joined path or null; output is not sanitized public feedback.
 */
export function getDotPath<
  TSchema extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
>(issue: InferIssue<TSchema>): IssueDotPath<TSchema> | null;

/** Join raw string/number path keys for trusted diagnostic formatting.
 * @param {BaseIssue<unknown>} issue - Private issue path, not a selector to execute.
 * @returns {string | null} Joined raw keys or null for unsupported/absent path.
 */
// @__NO_SIDE_EFFECTS__
export function getDotPath(issue: BaseIssue<unknown>): string | null {
  if (issue.path) {
    let key = '';
    // Preserve declared segment order and reject unrepresentable Map/Set-style keys.
    for (const item of issue.path) {
      if (typeof item.key === 'string' || typeof item.key === 'number') {
        if (key) {
          key += `.${item.key}`;
        } else {
          key += item.key;
        }
      } else {
        return null;
      }
    }
    return key;
  }
  return null;
}
