import type { BaseIssue } from './issue.js';

/**
 * Private pre-validation dataset with unproven type and no accumulated issue list.
 */
export interface UnknownDataset {
  /**
   * Whether the declared schema type is established, independently of refinement issues.
   */
  typed?: false;
  /**
   * Private candidate/output value; structural parsing is not a guaranteed deep clone.
   */
  value: unknown;
  /**
   * Raw private issues retaining input/messages; public responses require explicit redaction.
   */
  issues?: undefined;
}

/**
 * Private issue-free typed dataset; value identity may still be borrowed or transformed.
 */
export interface SuccessDataset<TValue> {
  /**
   * Whether the declared schema type is established, independently of refinement issues.
   */
  typed: true;
  /**
   * Private candidate/output value; structural parsing is not a guaranteed deep clone.
   */
  value: TValue;
  /**
   * Raw private issues retaining input/messages; public responses require explicit redaction.
   */
  issues?: undefined;
}

/**
 * Private typed dataset whose refinements produced nonempty issues; typed alone never means successful validation.
 */
export interface PartialDataset<TValue, TIssue extends BaseIssue<unknown>> {
  /**
   * Whether the declared schema type is established, independently of refinement issues.
   */
  typed: true;
  /**
   * Private candidate/output value; structural parsing is not a guaranteed deep clone.
   */
  value: TValue;
  /**
   * Raw private issues retaining input/messages; public responses require explicit redaction.
   */
  issues: [TIssue, ...TIssue[]];
}

/**
 * Private untyped failure dataset retaining unknown input and nonempty raw issues.
 */
export interface FailureDataset<TIssue extends BaseIssue<unknown>> {
  /**
   * Whether the declared schema type is established, independently of refinement issues.
   */
  typed: false;
  /**
   * Private candidate/output value; structural parsing is not a guaranteed deep clone.
   */
  value: unknown;
  /**
   * Raw private issues retaining input/messages; public responses require explicit redaction.
   */
  issues: [TIssue, ...TIssue[]];
}

/**
 * Internal union of success, typed-with-issues and untyped-failure results; check issues as well as typed before treating a result as valid.
 */
export type OutputDataset<TValue, TIssue extends BaseIssue<unknown>> =
  | SuccessDataset<TValue>
  | PartialDataset<TValue, TIssue>
  | FailureDataset<TIssue>;
