import { _runSchema } from '../utils/_run.js';
import type {
  BaseIssue,
  BaseSchema,
  ErrorMessage,
  InferIssue,
  OutputDataset,
} from '../types/index.js';
import { _addIssue, _getStandardProps, _joinExpects } from '../utils/index.js';
import type {
  InferIntersectInput,
  InferIntersectOutput,
  IntersectIssue,
  IntersectOptions,
} from './types/intersect.js';
import { _merge } from './_merge.js';

/**
 * Intersect schema interface.
 */
export interface IntersectSchema<
  TOptions extends IntersectOptions,
  TMessage extends ErrorMessage<IntersectIssue> | undefined,
> extends BaseSchema<
  InferIntersectInput<TOptions>,
  InferIntersectOutput<TOptions>,
  IntersectIssue | InferIssue<TOptions[number]>
> {
  /**
   * Stable schema discriminator used by structured issue consumers.
   */
  readonly type: 'intersect';
  /**
   * Authored constructor identity; no runtime package discovery occurs.
   */
  readonly reference: typeof intersect;
  /**
   * The intersect options.
   */
  readonly options: TOptions;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Validate every declared branch in order and merge compatible outputs into the first branch result; merge conflicts create a private issue. Construction does not parse input or authorize its source.
 * @param {TOptions} options - Borrowed ordered trusted branch schemas; mutation after construction is not isolated.
 * @returns {IntersectSchema<TOptions, undefined>} Inert schema retaining its declared references and message policy; no external resource owner is allocated.
 */
export function intersect<const TOptions extends IntersectOptions>(
  options: TOptions
): IntersectSchema<TOptions, undefined>;

/** Validate every declared branch in order and merge compatible outputs into the first branch result; merge conflicts create a private issue. Construction does not parse input or authorize its source.
 * @param {TOptions} options - Borrowed ordered trusted branch schemas; mutation after construction is not isolated.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; raw errors may retain input.
 * @returns {IntersectSchema<TOptions, TMessage>} Inert schema retaining its declared references and message policy; no external resource owner is allocated.
 */
export function intersect<
  const TOptions extends IntersectOptions,
  const TMessage extends ErrorMessage<IntersectIssue> | undefined,
>(options: TOptions, message: TMessage): IntersectSchema<TOptions, TMessage>;

/** Validate every declared branch in order and merge compatible outputs into the first branch result; merge conflicts create a private issue. Construction does not parse input or authorize its source.
 * @param {IntersectOptions} options - Borrowed ordered trusted branch schemas; mutation after construction is not isolated.
 * @param {ErrorMessage<IntersectIssue>} message - Optional trusted private diagnostic text/callback; raw errors may retain input.
 * @returns {IntersectSchema<IntersectOptions, ErrorMessage<IntersectIssue> | undefined>} Inert schema retaining its declared references and message policy; no external resource owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function intersect(
  options: IntersectOptions,
  message?: ErrorMessage<IntersectIssue>
): IntersectSchema<IntersectOptions, ErrorMessage<IntersectIssue> | undefined> {
  return {
    kind: 'schema',
    type: 'intersect',
    reference: intersect,
    expects: _joinExpects(
      options.map((option) => option.expects),
      '&'
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
    /** Validate every declared branch in order and merge compatible outputs into the first branch result; merge conflicts create a private issue. Raw issues remain private and operational failures propagate.
     * @param {import('../types/index.js').UnknownDataset} dataset - Private current candidate; this schema does not grant permissions or sanitize output.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root budgets, cancellation, abort flags and diagnostic policy.
     * @returns {OutputDataset<unknown, BaseIssue<unknown>>} Declared output or private issue dataset; child result identity follows its schema.
     */
    '~run'(dataset, config) {
      // Parse input with schema of options, if not empty
      if (this.options.length) {
        // Get input value from dataset
        /** Borrowed candidate retained for child reads and private issue paths. */
        const input = dataset.value;

        // Create variable to store outputs
        let outputs: unknown[] | undefined;

        // Set typed initially to `true`
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        dataset.typed = true;

        // Parse schema of each option and collect outputs
        for (const schema of this.options) {
          /** Current attempted branch result sharing the root work and issue budget. */
          const optionDataset = _runSchema(schema, { value: input }, config);

          // If there are issues, capture them
          if (optionDataset.issues) {
            if (dataset.issues) {
              // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
              dataset.issues.push(...optionDataset.issues);
            } else {
              // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
              dataset.issues = optionDataset.issues;
            }

            // If necessary, abort early
            if (config.abortEarly) {
              dataset.typed = false;
              break;
            }
          }

          // If not typed, set typed to `false`
          if (!optionDataset.typed) {
            dataset.typed = false;
          }

          // Add output of option if necessary
          if (dataset.typed) {
            if (outputs) {
              outputs.push(optionDataset.value);
            } else {
              outputs = [optionDataset.value];
            }
          }
        }

        // If outputs are typed, merge them
        if (dataset.typed) {
          // Set first output as initial output
          dataset.value = outputs![0];

          // Merge outputs into one final output
          for (let index = 1; index < outputs!.length; index++) {
            /** Legacy recursive merge result; earlier mutations to the first output are not rolled back on a later conflict. */
            const mergeDataset = _merge(dataset.value, outputs![index]);

            // If outputs can't be merged, add issue and break loop
            if (mergeDataset.issue) {
              _addIssue(this, 'type', dataset, config, {
                received: 'unknown',
              });
              break;
            }

            // Otherwise, set merged output
            dataset.value = mergeDataset.value;
          }
        }

        // Otherwise, add intersect issue
      } else {
        _addIssue(this, 'type', dataset, config);
      }

      // Return output dataset
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      return dataset as OutputDataset<
        never,
        IntersectIssue | BaseIssue<unknown>
      >;
    },
  };
}
