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
  /**
   * The object kind.
   */
  readonly kind: 'validation';
  /**
   * The validation type.
   */
  readonly type: string;
  /**
   * The validation reference.
   */
  readonly reference: (
     
    ...args: any[]
     
  ) => BaseValidation<any, any, BaseIssue<unknown>>;
  /**
   * The expected property.
   */
  readonly expects: string | null;
  /**
   * Whether it's async.
   */
  readonly async: false;
  /**
   * Validates known input values.
   *
   * @param dataset The input dataset.
   * @param config The configuration.
   *
   * @returns The output dataset.
   *
   * @internal
   */
  readonly '~run': (
    dataset: OutputDataset<TInput, BaseIssue<unknown>>,
    config: Config<BaseIssue<unknown>>
  ) => OutputDataset<TOutput, BaseIssue<unknown> | TIssue>;
  /**
   * The input, output and issue type.
   *
   * @internal
   */
  readonly '~types'?:
  | {
    readonly input: TInput;
    readonly output: TOutput;
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
  /**
   * The validation reference.
   */
  readonly reference: (
     
    ...args: any[]
  ) =>  
    | BaseValidation<any, any, BaseIssue<unknown>>
     
    | BaseValidationAsync<any, any, BaseIssue<unknown>>;
  /**
   * Whether it's async.
   */
  readonly async: true;
  /**
   * Validates known input values.
   *
   * @param dataset The input dataset.
   * @param config The configuration.
   *
   * @returns The output dataset.
   *
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
