import type { Config } from './config.js';
import type { OutputDataset, SuccessDataset } from './dataset.js';
import type { BaseIssue } from './issue.js';

/**
 * Base transformation interface.
 */
export interface BaseTransformation<
  TInput,
  TOutput,
  TIssue extends BaseIssue<unknown>,
> {
  /** Fixed transformation category; a typed pipeline must establish admissible input before invoking it. */
  readonly kind: 'transformation';
  /** Stable authored transformation discriminator used by structured diagnostics. */
  readonly type: string;
  /** Authored factory identity used by metadata/diagnostics; never resolve this from submitted source or a package name.
   * @param {any[]} args - Trusted authored constructor arguments; this reference is not a general-purpose execution interface.
   * @returns {BaseTransformation<any, any, BaseIssue<unknown>>} Inert transformation descriptor retaining declared capabilities; no source string is evaluated.
   */
  readonly reference: (
    ...args: any[]
  ) => BaseTransformation<any, any, BaseIssue<unknown>>;
  /** Explicit sync/async contract; synchronous parsing rejects async work instead of invoking it. */
  readonly async: false;
  /** Transform an already typed dataset under the current root execution policy.
   * @param {SuccessDataset<TInput>} dataset - Private typed input dataset; transformations may preserve nested object identity.
   * @param {Config<BaseIssue<unknown>>} config - Root budgets, cooperative cancellation and private issue policy; callbacks own external work they start.
   * @returns {OutputDataset<TOutput, BaseIssue<unknown> | TIssue>} Declared output/private issue dataset; budget failures and operational exceptions propagate without implying rollback.
   * @internal
   */
  readonly '~run': (
    dataset: SuccessDataset<TInput>,
    config: Config<BaseIssue<unknown>>
  ) => OutputDataset<TOutput, BaseIssue<unknown> | TIssue>;
  /** Optional type-only input/output/issue inference; it stores no runtime validator or submitted value.
   * @internal
   */
  readonly '~types'?:
    | {
        /** Declared pre-transformation value type, established by the preceding schema/pipeline stage. */
        readonly input: TInput;
        /** Declared post-transformation type; runtime callbacks remain trusted application code. */
        readonly output: TOutput;
        /** Declared private issue union; transforms and operational exceptions are distinct outcomes. */
        readonly issue: TIssue;
      }
    | undefined;
}

/**
 * Base transformation async interface.
 */
export interface BaseTransformationAsync<
  TInput,
  TOutput,
  TIssue extends BaseIssue<unknown>,
> extends Omit<
  BaseTransformation<TInput, TOutput, TIssue>,
  'reference' | 'async' | '~run'
> {
  /** Authored factory identity used by metadata/diagnostics; never resolve this from submitted source or a package name.
   * @param {any[]} args - Trusted authored constructor arguments; this reference is not a general-purpose execution interface.
   * @returns {BaseTransformation<any, any, BaseIssue<unknown>> | BaseTransformationAsync<any, any, BaseIssue<unknown>>} Inert transformation descriptor retaining declared capabilities; no source string is evaluated.
   */
  readonly reference: (
    ...args: any[]
  ) =>
    | BaseTransformation<any, any, BaseIssue<unknown>>
    | BaseTransformationAsync<any, any, BaseIssue<unknown>>;
  /** Explicit sync/async contract; synchronous parsing rejects async work instead of invoking it. */
  readonly async: true;
  /** Transform an already typed dataset under the current root execution policy.
   * @param {SuccessDataset<TInput>} dataset - Private typed input dataset; transformations may preserve nested object identity.
   * @param {Config<BaseIssue<unknown>>} config - Root budgets, cooperative cancellation and private issue policy; callbacks own external work they start.
   * @returns {Promise<OutputDataset<TOutput, BaseIssue<unknown> | TIssue>>} Declared output/private issue dataset; budget failures and operational exceptions propagate without implying rollback.
   * @internal
   */
  readonly '~run': (
    dataset: SuccessDataset<TInput>,
    config: Config<BaseIssue<unknown>>
  ) => Promise<OutputDataset<TOutput, BaseIssue<unknown> | TIssue>>;
}

/**
 * Generic transformation type.
 */
export type GenericTransformation<
  TInput = any,
  TOutput = TInput,
  TIssue extends BaseIssue<unknown> = BaseIssue<unknown>,
> = BaseTransformation<TInput, TOutput, TIssue>;

/**
 * Generic transformation async type.
 */
export type GenericTransformationAsync<
  TInput = any,
  TOutput = TInput,
  TIssue extends BaseIssue<unknown> = BaseIssue<unknown>,
> = BaseTransformationAsync<TInput, TOutput, TIssue>;
