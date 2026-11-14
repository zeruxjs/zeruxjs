import { _runSchema } from '../utils/_run.js';
import type {
  BaseIssue,
  BaseSchemaAsync,
  ErrorMessage,
  InferInput,
  InferOutput,
  OutputDataset,
} from '../types/index.js';
import { _addIssue, _getStandardProps, _joinExpects } from '../utils/index.js';
import type {
  InferVariantIssue,
  VariantIssue,
  VariantOptionsAsync,
  VariantOptionSchema,
  VariantOptionSchemaAsync,
} from './types/variant.js';
import type { variant } from './variant.js';

/**
 * Variant schema async interface.
 */
export interface VariantSchemaAsync<
  TKey extends string,
  TOptions extends VariantOptionsAsync<TKey>,
  TMessage extends ErrorMessage<VariantIssue> | undefined,
> extends BaseSchemaAsync<
  InferInput<TOptions[number]>,
  InferOutput<TOptions[number]>,
  VariantIssue | InferVariantIssue<TOptions>
> {
  /**
   * Stable schema discriminator used by structured issue consumers.
   */
  readonly type: 'variant';
  /**
   * Authored constructor identity; no runtime package discovery occurs.
   */
  readonly reference: typeof variant | typeof variantAsync;
  /**
   * Private diagnostic expectation, not a coercion, escaping or authorization policy.
   */
  readonly expects: 'Object';
  /**
   * Declared key whose presence/value selects eligible branches; not an authorization scope.
   */
  readonly key: TKey;
  /**
   * Borrowed declared discriminator branches; no dynamic handler lookup from input.
   */
  readonly options: TOptions;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Await explicit discriminator branches sequentially, retaining the first successful or best typed result. Construction does not parse input or authorize its source.
 * @param {TKey} key - Explicit discriminator key required by each declared option; never a module name or execution target.
 * @param {TOptions} options - Borrowed ordered trusted branch schemas; mutation after construction is not isolated.
 * @returns {VariantSchemaAsync<TKey, TOptions, undefined>} Inert schema retaining its declared references and message policy; no external resource owner is allocated.
 */
export function variantAsync<
  const TKey extends string,
  const TOptions extends VariantOptionsAsync<TKey>,
>(key: TKey, options: TOptions): VariantSchemaAsync<TKey, TOptions, undefined>;

/** Await explicit discriminator branches sequentially, retaining the first successful or best typed result. Construction does not parse input or authorize its source.
 * @param {TKey} key - Explicit discriminator key required by each declared option; never a module name or execution target.
 * @param {TOptions} options - Borrowed ordered trusted branch schemas; mutation after construction is not isolated.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; raw errors may retain input.
 * @returns {VariantSchemaAsync<TKey, TOptions, TMessage>} Inert schema retaining its declared references and message policy; no external resource owner is allocated.
 */
export function variantAsync<
  const TKey extends string,
  const TOptions extends VariantOptionsAsync<TKey>,
  const TMessage extends ErrorMessage<VariantIssue> | undefined,
>(
  key: TKey,
  options: TOptions,
  message: TMessage
): VariantSchemaAsync<TKey, TOptions, TMessage>;

/** Await explicit discriminator branches sequentially, retaining the first successful or best typed result. Construction does not parse input or authorize its source.
 * @param {string} key - Explicit discriminator key required by each declared option; never a module name or execution target.
 * @param {VariantOptionsAsync<string>} options - Borrowed ordered trusted branch schemas; mutation after construction is not isolated.
 * @param {ErrorMessage<VariantIssue>} message - Optional trusted private diagnostic text/callback; raw errors may retain input.
 * @returns {VariantSchemaAsync<string, VariantOptionsAsync<string>, ErrorMessage<VariantIssue> | undefined>} Inert schema retaining its declared references and message policy; no external resource owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function variantAsync(
  key: string,
  options: VariantOptionsAsync<string>,
  message?: ErrorMessage<VariantIssue>
): VariantSchemaAsync<
  string,
  VariantOptionsAsync<string>,
  ErrorMessage<VariantIssue> | undefined
> {
  return {
    kind: 'schema',
    type: 'variant',
    reference: variantAsync,
    expects: 'Object',
    async: true,
    key,
    options,
    message,
    /** Adapt explicit validation to the bounded shared root execution path.
     * @returns {object} Inert Standard Schema V1 adapter.
     */
    get '~standard'() {
      return _getStandardProps(this);
    },
    /** Await explicit discriminator branches sequentially, retaining the first successful or best typed result. Raw issues remain private and operational failures propagate.
     * @param {import('../types/index.js').UnknownDataset} dataset - Private current candidate; this schema does not grant permissions or sanitize output.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root budgets, cancellation, abort flags and diagnostic policy.
     * @returns {Promise<OutputDataset<unknown, BaseIssue<unknown>>>} Declared output or private issue dataset; child result identity follows its schema.
     */
    async '~run'(dataset, config) {
      // Get input value from dataset
      /** Borrowed candidate retained for child reads and private issue paths. */
      const input = dataset.value;

      // If root type is valid, check nested types
      if (input && typeof input === 'object') {
        // Create output dataset variable
        let outputDataset:
          | OutputDataset<unknown, BaseIssue<unknown>>
          | undefined;

        // Create variables to store invalid discriminator information
        let maxDiscriminatorPriority = 0;
        let invalidDiscriminatorKey = this.key;
        let expectedDiscriminators: string[] = [];

        // Create recursive function to parse nested variant options
        /** Traverse trusted nested variant declarations in order; this is not arbitrary source evaluation.
         * @param {VariantOptionSchema<string> | VariantOptionSchemaAsync<string>} variant - Current borrowed variant branch.
         * @param {Set<string>} allKeys - Declared discriminator keys accumulated by this recursion path.
         * @returns {Promise<void>} Updates only the enclosing result/diagnostic selection; child failures and operational exceptions propagate. */
        const parseOptions = async (
          variant:
            | VariantOptionSchema<string>
            | VariantOptionSchemaAsync<string>,
          allKeys: Set<string>
        ) => {
          for (const schema of variant.options) {
            // If it is a variant schema, parse its options recursively
            if (schema.type === 'variant') {
              await parseOptions(schema, new Set(allKeys).add(schema.key));

              // Otherwise, check discriminators and parse object schema
            } else {
              // Create variables to store local discriminator information
              let keysAreValid = true;
              let currentPriority = 0;

              // Check if all discriminator keys are valid and collect
              // information about invalid discriminator keys if not
              for (const currentKey of allKeys) {
                // If any discriminator is invalid, mark keys as invalid
                // Variant option types require a schema for every discriminator key.
                /** Trusted option child for a declared discriminator; preserve legacy presence checks and explicit abortEarly probing. */
                const discriminatorSchema = schema.entries[currentKey]!;
                if (
                  currentKey in input
                    ? (
                        await _runSchema(
                          discriminatorSchema,
                          // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
                          { typed: false, value: input[currentKey] },
                          { abortEarly: true }
                        )
                      ).issues
                    : discriminatorSchema.type !== 'exact_optional' &&
                      discriminatorSchema.type !== 'optional' &&
                      discriminatorSchema.type !== 'nullish'
                ) {
                  keysAreValid = false;

                  // If invalid discriminator key is not equal to current key
                  // and if current key has a higher priority or same priority
                  // but is the first one present in input, reset invalid
                  // discriminator information
                  if (
                    invalidDiscriminatorKey !== currentKey &&
                    (maxDiscriminatorPriority < currentPriority ||
                      (maxDiscriminatorPriority === currentPriority &&
                        currentKey in input &&
                        !(invalidDiscriminatorKey in input)))
                  ) {
                    maxDiscriminatorPriority = currentPriority;
                    invalidDiscriminatorKey = currentKey;
                    expectedDiscriminators = [];
                  }

                  // If invalid discriminator key is equal to current key,
                  // store its expected value
                  if (invalidDiscriminatorKey === currentKey) {
                    expectedDiscriminators.push(
                      schema.entries[currentKey]!.expects
                    );
                  }

                  // Break loop on first invalid discriminator key
                  break;
                }

                // Increase priority for next discriminator key
                currentPriority++;
              }

              // If all discriminators are valid, parse input with schema of option
              if (keysAreValid) {
                /** Current attempted branch result sharing the root work and issue budget. */
                const optionDataset = await _runSchema(
                  schema,
                  { value: input },
                  config
                );

                // Store output dataset if necessary
                // Hint: Only the first untyped or typed dataset is returned, and
                // typed datasets take precedence over untyped ones.
                if (
                  !outputDataset ||
                  (!outputDataset.typed && optionDataset.typed)
                ) {
                  outputDataset = optionDataset;
                }
              }
            }

            // If valid option is found, break loop
            // Hint: The `break` statement is intentionally placed at the end of
            // the loop to break any outer loops in case of recursive execution.
            if (outputDataset && !outputDataset.issues) {
              break;
            }
          }
        };

        // Parse input with nested variant options recursively
        await parseOptions(this, new Set([this.key]));

        // If any output dataset is available, return it
        if (outputDataset) {
          return outputDataset;
        }

        // Otherwise, add discriminator issue
        _addIssue(this, 'type', dataset, config, {
          // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
          input: input[invalidDiscriminatorKey],
          expected: _joinExpects(expectedDiscriminators, '|'),
          path: [
            {
              type: 'object',
              origin: 'value',
              input: input as Record<string, unknown>,
              key: invalidDiscriminatorKey,
              // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
              value: input[invalidDiscriminatorKey],
            },
          ],
        });

        // Otherwise, add variant issue
      } else {
        _addIssue(this, 'type', dataset, config);
      }

      // Finally, return  output dataset
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      return dataset as OutputDataset<
        InferOutput<VariantOptionsAsync<string>[number]>,
        VariantIssue | BaseIssue<unknown>
      >;
    },
  };
}
