import type {
  BaseIssue,
  BaseSchema,
  BaseSchemaAsync,
  InferIssue,
} from '../types/index.js';
import { flatten } from '../methods/flatten.js';
import { summarize } from '../methods/summarize.js';
import { formatIssues, type FormattedIssueTree } from './formatIssues.js';

/**
 * Private raw validation diagnostics, including rejected values and custom messages. Use explicit sanitized HTTP/client feedback instead of serializing this error to untrusted callers.
 */
export class ValidationError<
  TSchema extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
> extends Error {
  /**
   * Private nonempty raw issues retaining rejected inputs, paths and custom messages.
   */
  public readonly issues: [InferIssue<TSchema>, ...InferIssue<TSchema>[]];
  /** Private multi-line diagnostic summary; it may contain custom messages and dynamic paths. */
  public readonly summary: string;

  /**
   * Retain raw issue diagnostics and native cause; this constructor does not sanitize private values.
   *
   * @param {[InferIssue<TSchema>, ...InferIssue<TSchema>[]]} issues - Nonempty private issue list, never a public response payload.
   */
  // @__NO_SIDE_EFFECTS__
  constructor(issues: [InferIssue<TSchema>, ...InferIssue<TSchema>[]]) {
    /** Private multi-issue diagnostic selected before constructing the native error. */
    const summary = summarize(
      issues as [BaseIssue<unknown>, ...BaseIssue<unknown>[]]
    );
    super(issues.length === 1 ? issues[0].message : summary, { cause: issues });
    this.name = 'ValidationError';
    this.issues = issues;
    this.summary = summary;
  }

  /** Group private diagnostic messages by root/dot-path/other categories.
   * @returns {ReturnType<typeof flatten>} Private flattened messages; dynamic paths are not redacted here.
   */
  flatten() {
    return flatten(
      this.issues as [BaseIssue<unknown>, ...BaseIssue<unknown>[]]
    );
  }

  /** Format private raw messages into a prototype-safe nested tree.
   * @returns {FormattedIssueTree} Private message tree; prototype safety is not privacy redaction.
   */
  format(): FormattedIssueTree {
    return formatIssues(
      this.issues as [BaseIssue<unknown>, ...BaseIssue<unknown>[]]
    );
  }

  /** Read the retained private summary without recomputing it.
   * @returns {string} Diagnostic text that may contain user-authored messages/paths.
   */
  summarize() {
    return this.summary;
  }

  /** Export private diagnostics for explicitly trusted host use only.
   * @returns {object} Raw message, summary, issues and derived forms; never expose this as sanitized HTTP JSON.
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      summary: this.summary,
      issues: this.issues,
      flat: this.flatten(),
      formatted: this.format(),
    };
  }
}
