import type { Config } from './config.js';
import type { OutputDataset } from './dataset.js';
import type { BaseIssue } from './issue.js';

/**
 * Base validation interface.
 */
export interface BaseValidation<
  TInput,
  TOutput,
  TIssue extends BaseIssue<unknown>,
> {
  /** Fixed validation category used by pipeline dispatch; not a permission grant. */
  readonly kind: 'validation';
  /** Stable authored validation discriminator used by structured diagnostics. */
  readonly type: string;
  /** Authored factory identity used by metadata/diagnostics; never resolve this from submitted source or a package name.
   * @param {any[]} args - Trusted authored constructor arguments; this reference is not a general-purpose execution interface.
   * @returns {BaseValidation<any, any, BaseIssue<unknown>>} Inert validation descriptor retaining declared capabilities; no source string is evaluated.
   */
  readonly reference: (
    ...args: any[]
  ) => BaseValidation<any, any, BaseIssue<unknown>>;
  /** Private diagnostic expectation; null means the action has no fixed textual expectation. */
  readonly expects: string | null;
  /** Explicit sync/async contract; synchronous parsing rejects async work instead of invoking it. */
  readonly async: false;
  /** Refine the current dataset under the shared root execution policy; pipeline typing controls whether a value can be checked.
   * @param {OutputDataset<TInput, BaseIssue<unknown>>} dataset - Private candidate dataset; raw values and issue objects are not safe public diagnostics.
   * @param {Config<BaseIssue<unknown>>} config - Root budgets, cooperative cancellation and private issue policy; callbacks own external work they start.
   * @returns {OutputDataset<TOutput, BaseIssue<unknown> | TIssue>} Declared output/private issue dataset; budget failures and operational exceptions propagate without implying rollback.
   * @internal
   */
  readonly '~run': (
    dataset: OutputDataset<TInput, BaseIssue<unknown>>,
    config: Config<BaseIssue<unknown>>
  ) => OutputDataset<TOutput, BaseIssue<unknown> | TIssue>;
  /** Optional type-only input/output/issue inference; it stores no runtime validator or submitted value.
   * @internal
   */
  readonly '~types'?:
    | {
        /** Declared accepted input type; this field is inference-only and is absent from normal runtime descriptors. */
        readonly input: TInput;
        /** Declared parsed output type; input and output need not be identical after child transforms. */
        readonly output: TOutput;
        /** Declared private issue union; transforms and operational exceptions are distinct outcomes. */
        readonly issue: TIssue;
      }
    | undefined;
}

/**
 * Base validation async interface.
 */
export interface BaseValidationAsync<
  TInput,
  TOutput,
  TIssue extends BaseIssue<unknown>,
> extends Omit<
  BaseValidation<TInput, TOutput, TIssue>,
  'reference' | 'async' | '~run'
> {
  /** Authored factory identity used by metadata/diagnostics; never resolve this from submitted source or a package name.
   * @param {any[]} args - Trusted authored constructor arguments; this reference is not a general-purpose execution interface.
   * @returns {BaseValidation<any, any, BaseIssue<unknown>> | BaseValidationAsync<any, any, BaseIssue<unknown>>} Inert validation descriptor retaining declared capabilities; no source string is evaluated.
   */
  readonly reference: (
    ...args: any[]
  ) =>
    | BaseValidation<any, any, BaseIssue<unknown>>
    | BaseValidationAsync<any, any, BaseIssue<unknown>>;
  /** Explicit sync/async contract; synchronous parsing rejects async work instead of invoking it. */
  readonly async: true;
  /** Refine the current dataset under the shared root execution policy; pipeline typing controls whether a value can be checked.
   * @param {OutputDataset<TInput, BaseIssue<unknown>>} dataset - Private candidate dataset; raw values and issue objects are not safe public diagnostics.
   * @param {Config<BaseIssue<unknown>>} config - Root budgets, cooperative cancellation and private issue policy; callbacks own external work they start.
   * @returns {Promise<OutputDataset<TOutput, BaseIssue<unknown> | TIssue>>} Declared output/private issue dataset; budget failures and operational exceptions propagate without implying rollback.
   * @internal
   */
  readonly '~run': (
    dataset: OutputDataset<TInput, BaseIssue<unknown>>,
    config: Config<BaseIssue<unknown>>
  ) => Promise<OutputDataset<TOutput, BaseIssue<unknown> | TIssue>>;
}

/**
 * Generic validation type.
 */
export type GenericValidation<
  TInput = any,
  TOutput = TInput,
  TIssue extends BaseIssue<unknown> = BaseIssue<unknown>,
> = BaseValidation<TInput, TOutput, TIssue>;

/**
 * Generic validation async type.
 */
export type GenericValidationAsync<
  TInput = any,
  TOutput = TInput,
  TIssue extends BaseIssue<unknown> = BaseIssue<unknown>,
> = BaseValidationAsync<TInput, TOutput, TIssue>;
