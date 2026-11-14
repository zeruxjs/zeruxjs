import { _runSchema } from '../utils/_run.js';
import type {
  BaseIssue,
  BaseSchema,
  ErrorMessage,
  FailureDataset,
  InferInput,
  InferIssue,
  InferOutput,
  MaybeReadonly,
  OutputDataset,
  PartialDataset,
  SuccessDataset,
} from '../types/index.js';
import { _addIssue, _getStandardProps, _joinExpects } from '../utils/index.js';
import type { UnionIssue } from './types/union.js';
import { _subIssues } from './_subIssues.js';

/**
 * Union options type.
 */
export type UnionOptions = MaybeReadonly<
  BaseSchema<unknown, unknown, BaseIssue<unknown>>[]
>;

/**
 * Union schema interface.
 */
export interface UnionSchema<
  TOptions extends UnionOptions,
  TMessage extends
    | ErrorMessage<UnionIssue<InferIssue<TOptions[number]>>>
    | undefined,
> extends BaseSchema<
  InferInput<TOptions[number]>,
  InferOutput<TOptions[number]>,
  UnionIssue<InferIssue<TOptions[number]>> | InferIssue<TOptions[number]>
> {
  /**
   * Stable schema discriminator used by structured issue consumers.
   */
  readonly type: 'union';
  /**
   * Authored constructor identity; no runtime package discovery occurs.
   */
  readonly reference: typeof union;
  /**
   * Borrowed ordered branch schemas; no automatic rebucketing or fallback mutation.
   */
  readonly options: TOptions;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Try declared branches in source order, preferring the first issue-free result and then typed failures. Construction does not parse input or authorize its source.
 * @param {TOptions} options - Borrowed ordered trusted branch schemas; mutation after construction is not isolated.
 * @returns {UnionSchema<TOptions, undefined>} Inert schema retaining its declared references and message policy; no external resource owner is allocated.
 */
export function union<const TOptions extends UnionOptions>(
  options: TOptions
): UnionSchema<TOptions, undefined>;

/** Try declared branches in source order, preferring the first issue-free result and then typed failures. Construction does not parse input or authorize its source.
 * @param {TOptions} options - Borrowed ordered trusted branch schemas; mutation after construction is not isolated.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; raw errors may retain input.
 * @returns {UnionSchema<TOptions, TMessage>} Inert schema retaining its declared references and message policy; no external resource owner is allocated.
 */
export function union<
  const TOptions extends UnionOptions,
  const TMessage extends
    | ErrorMessage<UnionIssue<InferIssue<TOptions[number]>>>
    | undefined,
>(options: TOptions, message: TMessage): UnionSchema<TOptions, TMessage>;

/** Try declared branches in source order, preferring the first issue-free result and then typed failures. Construction does not parse input or authorize its source.
 * @param {UnionOptions} options - Borrowed ordered trusted branch schemas; mutation after construction is not isolated.
 * @param {ErrorMessage<UnionIssue<BaseIssue<unknown>>>} message - Optional trusted private diagnostic text/callback; raw errors may retain input.
 * @returns {UnionSchema<UnionOptions, ErrorMessage<UnionIssue<BaseIssue<unknown>>> | undefined>} Inert schema retaining its declared references and message policy; no external resource owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function union(
  options: UnionOptions,
  message?: ErrorMessage<UnionIssue<BaseIssue<unknown>>>
): UnionSchema<
  UnionOptions,
  ErrorMessage<UnionIssue<BaseIssue<unknown>>> | undefined
> {
  return {
    kind: 'schema',
    type: 'union',
    reference: union,
    expects: _joinExpects(
      options.map((option) => option.expects),
      '|'
    ),
    async: false,
    options,
    message,
    /** Adapt explicit validation to the bounded shared root execution path.
     * @returns {object} Inert Standard Schema V1 adapter.
     */
    get '~standard'() {
      return _getStandardProps(this);
    },
    /** Try declared branches in source order, preferring the first issue-free result and then typed failures. Raw issues remain private and operational failures propagate.
     * @param {import('../types/index.js').UnknownDataset} dataset - Private current candidate; this schema does not grant permissions or sanitize output.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root budgets, cancellation, abort flags and diagnostic policy.
     * @returns {OutputDataset<unknown, BaseIssue<unknown>>} Declared output or private issue dataset; child result identity follows its schema.
     */
    '~run'(dataset, config) {
      // Create variables to collect datasets
      let validDataset: SuccessDataset<unknown> | undefined;
      let typedDatasets:
        | PartialDataset<unknown, BaseIssue<unknown>>[]
        | undefined;
      let untypedDatasets: FailureDataset<BaseIssue<unknown>>[] | undefined;

      // Parse schema of each option and collect datasets
      for (const schema of this.options) {
        /** Current attempted branch result sharing the root work and issue budget. */
        const optionDataset = _runSchema(
          schema,
          { value: dataset.value },
          config
        );

        // If typed, add it to valid or typed datasets
        if (optionDataset.typed) {
          // If there are issues, add it to typed datasets
          if (optionDataset.issues) {
            if (typedDatasets) {
              typedDatasets.push(optionDataset);
            } else {
              typedDatasets = [optionDataset];
            }

            // Otherwise, add it as valid dataset and break loop
          } else {
            validDataset = optionDataset;
            break;
          }

          // Otherwise, add it to untyped datasets
        } else {
          if (untypedDatasets) {
            untypedDatasets.push(optionDataset);
          } else {
            untypedDatasets = [optionDataset];
          }
        }
      }

      // If there is a valid dataset, return it
      if (validDataset) {
        return validDataset;
      }

      // If there are typed datasets process only those
      if (typedDatasets) {
        // If there is only one typed dataset, return it
        if (typedDatasets.length === 1) {
          return typedDatasets[0]!;
        }

        // Otherwise, add issue with typed subissues
        // Hint: If there is more than one typed dataset, we use a general
        // union issue with subissues because the issues could contradict
        // each other.
        _addIssue(this, 'type', dataset, config, {
          issues: _subIssues(typedDatasets),
        });

        // And set typed to `true`
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        dataset.typed = true;

        // Otherwise, if there is exactly one untyped dataset, return it
      } else if (untypedDatasets?.length === 1) {
        return untypedDatasets[0]!;

        // Otherwise, add issue with untyped subissues
      } else {
        // Hint: If there are zero or more than one untyped results, we use a
        // general union issue with subissues because the issues could
        // contradict each other.
        _addIssue(this, 'type', dataset, config, {
          issues: _subIssues(untypedDatasets),
        });
      }

      // Return output dataset
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      return dataset as OutputDataset<unknown, BaseIssue<unknown>>;
    },
  };
}
