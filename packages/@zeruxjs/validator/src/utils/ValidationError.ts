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
 * A error with useful information.
 */
export class ValidationError<
  TSchema extends
  | BaseSchema<unknown, unknown, BaseIssue<unknown>>
  | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
> extends Error {
  /**
   * The error issues.
   */
  public readonly issues: [InferIssue<TSchema>, ...InferIssue<TSchema>[]];
  public readonly summary: string;

  /**
   * Creates a error with useful information.
   *
   * @param issues The error issues.
   */
  // @__NO_SIDE_EFFECTS__
  constructor(issues: [InferIssue<TSchema>, ...InferIssue<TSchema>[]]) {
    const summary = summarize(issues as [BaseIssue<unknown>, ...BaseIssue<unknown>[]]);
    super(issues.length === 1 ? issues[0].message : summary, { cause: issues });
    this.name = 'ValidationError';
    this.issues = issues;
    this.summary = summary;
  }

  flatten() {
    return flatten(this.issues as [BaseIssue<unknown>, ...BaseIssue<unknown>[]]);
  }

  format(): FormattedIssueTree {
    return formatIssues(this.issues as [BaseIssue<unknown>, ...BaseIssue<unknown>[]]);
  }

  summarize() {
    return this.summary;
  }

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
