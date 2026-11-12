import type { Config } from './config.js';
import type { OutputDataset, UnknownDataset } from './dataset.js';
import type { BaseIssue } from './issue.js';
import type { StandardProps } from './standard.js';

/**
 * Base schema interface.
 */
export interface BaseSchema<
  TInput,
  TOutput,
  TIssue extends BaseIssue<unknown>,
> {
  /** Fixed schema category used by pipeline dispatch; not a permission grant. */
  readonly kind: 'schema';
  /** Stable authored schema discriminator used by structured diagnostics. */
  readonly type: string;
  /** Authored factory identity used by metadata/diagnostics; never resolve this from submitted source or a package name.
   * @param {any[]} args - Trusted authored constructor arguments; this reference is not a general-purpose execution interface.
   * @returns {BaseSchema<unknown, unknown, BaseIssue<unknown>>} Inert schema descriptor retaining declared capabilities; no source string is evaluated.
   */
  readonly reference: (
    ...args: any[]
  ) => BaseSchema<unknown, unknown, BaseIssue<unknown>>;
  /** Private textual schema expectation; never a coercion rule, authorization scope or safe rendered value. */
  readonly expects: string;
  /** Explicit sync/async contract; synchronous parsing rejects async work instead of invoking it. */
  readonly async: false;
  /** Structured Standard Schema V1 adapter; root execution still owns budgets, cancellation and private issues.
   * @internal
   */
  readonly '~standard': StandardProps<TInput, TOutput>;
  /** Parse a candidate dataset under the shared root execution policy.
   * @param {UnknownDataset} dataset - Private candidate dataset; raw values and issue objects are not safe public diagnostics.
   * @param {Config<BaseIssue<unknown>>} config - Root budgets, cooperative cancellation and private issue policy; callbacks own external work they start.
   * @returns {OutputDataset<TOutput, TIssue>} Declared output/private issue dataset; budget failures and operational exceptions propagate without implying rollback.
   * @internal
   */
  readonly '~run': (
    dataset: UnknownDataset,
    config: Config<BaseIssue<unknown>>
  ) => OutputDataset<TOutput, TIssue>;
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
 * Base schema async interface.
 */
export interface BaseSchemaAsync<
  TInput,
  TOutput,
  TIssue extends BaseIssue<unknown>,
> extends Omit<
  BaseSchema<TInput, TOutput, TIssue>,
  'reference' | 'async' | '~run'
> {
  /** Authored factory identity used by metadata/diagnostics; never resolve this from submitted source or a package name.
   * @param {any[]} args - Trusted authored constructor arguments; this reference is not a general-purpose execution interface.
   * @returns {BaseSchema<unknown, unknown, BaseIssue<unknown>> | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>} Inert schema descriptor retaining declared capabilities; no source string is evaluated.
   */
  readonly reference: (
    ...args: any[]
  ) =>
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>;
  /** Explicit sync/async contract; synchronous parsing rejects async work instead of invoking it. */
  readonly async: true;
  /** Parse a candidate dataset under the shared root execution policy.
   * @param {UnknownDataset} dataset - Private candidate dataset; raw values and issue objects are not safe public diagnostics.
   * @param {Config<BaseIssue<unknown>>} config - Root budgets, cooperative cancellation and private issue policy; callbacks own external work they start.
   * @returns {Promise<OutputDataset<TOutput, TIssue>>} Declared output/private issue dataset; budget failures and operational exceptions propagate without implying rollback.
   * @internal
   */
  readonly '~run': (
    dataset: UnknownDataset,
    config: Config<BaseIssue<unknown>>
  ) => Promise<OutputDataset<TOutput, TIssue>>;
}

/**
 * Generic schema type.
 */
export type GenericSchema<
  TInput = unknown,
  TOutput = TInput,
  TIssue extends BaseIssue<unknown> = BaseIssue<unknown>,
> = BaseSchema<TInput, TOutput, TIssue>;

/**
 * Generic schema async type.
 */
export type GenericSchemaAsync<
  TInput = unknown,
  TOutput = TInput,
  TIssue extends BaseIssue<unknown> = BaseIssue<unknown>,
> = BaseSchemaAsync<TInput, TOutput, TIssue>;
