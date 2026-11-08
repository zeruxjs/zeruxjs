import { _runSchema } from '../utils/_run.js';
import { getFallback } from '../methods/index.js';
import type {
  BaseSchema,
  ErrorMessage,
  InferObjectInput,
  InferObjectIssue,
  InferObjectOutput,
  ObjectEntries,
  ObjectPathItem,
  OutputDataset,
} from '../types/index.js';
import {
  _addIssue,
  _getStandardProps,
  _isValidObjectKey,
} from '../utils/index.js';
import type { LooseObjectIssue } from './types/looseObject.js';

/**
 * Loose object schema interface.
 */
export interface LooseObjectSchema<
  TEntries extends ObjectEntries,
  TMessage extends ErrorMessage<LooseObjectIssue> | undefined,
> extends BaseSchema<
  InferObjectInput<TEntries> & { [key: string]: unknown },
  InferObjectOutput<TEntries> & { [key: string]: unknown },
  LooseObjectIssue | InferObjectIssue<TEntries>
> {
  /**
   * The schema type.
   */
  readonly type: 'loose_object';
  /**
   * The schema reference.
   */
  readonly reference: typeof looseObject;
  /**
   * The expected property.
   */
  readonly expects: 'Object';
  /**
   * The entries schema.
   */
  readonly entries: TEntries;
  /**
   * The error message.
   */
  readonly message: TMessage;
}

/**
 * Creates a loose object schema.
 *
 * @param entries The entries schema.
 *
 * @returns A loose object schema.
 */
export function looseObject<const TEntries extends ObjectEntries>(
  entries: TEntries
): LooseObjectSchema<TEntries, undefined>;

/**
 * Creates a loose object schema.
 *
 * @param entries The entries schema.
 * @param message The error message.
 *
 * @returns A loose object schema.
 */
export function looseObject<
  const TEntries extends ObjectEntries,
  const TMessage extends ErrorMessage<LooseObjectIssue> | undefined,
>(entries: TEntries, message: TMessage): LooseObjectSchema<TEntries, TMessage>;

// @__NO_SIDE_EFFECTS__
export function looseObject(
  entries: ObjectEntries,
  message?: ErrorMessage<LooseObjectIssue>
): LooseObjectSchema<
  ObjectEntries,
  ErrorMessage<LooseObjectIssue> | undefined
> {
  return {
    kind: 'schema',
    type: 'loose_object',
    reference: looseObject,
    expects: 'Object',
    async: false,
    entries,
    message,
    get '~standard'() {
      return _getStandardProps(this);
    },
    '~run'(dataset, config) {
      // Get input value from dataset
      const input = dataset.value;

      // If root type is valid, check nested types
      if (input && typeof input === 'object' && !Array.isArray(input)) {
        // Set typed to `true` and value to blank object
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        dataset.typed = true;
        dataset.value = {};

        // Process each object entry of schema
        for (const key of Object.keys(this.entries)) {
          if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new TypeError('Unsafe object schema key');
          const valueSchema = this.entries[key];

          // If key is present or its an optional schema with a default value,
          // parse input of key or default value
          if (
            Object.hasOwn(input, key) ||
            ((valueSchema.type === 'exact_optional' ||
              valueSchema.type === 'optional' ||
              valueSchema.type === 'nullish') &&
              // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
              valueSchema.default !== undefined)
          ) {
            const value: unknown =
              Object.hasOwn(input, key)
                ? // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
                input[key]
                : undefined;
            const valueDataset = _runSchema(valueSchema, { value }, config);

            // If there are issues, capture them
            if (valueDataset.issues) {
              // Create object path item
              const pathItem: ObjectPathItem = {
                type: 'object',
                origin: 'value',
                input: input as Record<string, unknown>,
                key,
                value,
              };

              // Add modified entry dataset issues to issues
              for (const issue of valueDataset.issues) {
                if (issue.path) {
                  issue.path.unshift(pathItem);
                } else {
                  // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
                  issue.path = [pathItem];
                }
                // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
                dataset.issues?.push(issue);
              }
              if (!dataset.issues) {
                // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
                dataset.issues = valueDataset.issues;
              }

              // If necessary, abort early
              if (config.abortEarly) {
                dataset.typed = false;
                break;
              }
            }

            // If not typed, set typed to `false`
            if (!valueDataset.typed) {
              dataset.typed = false;
            }

            // Add entry to dataset
            // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
            dataset.value[key] = valueDataset.value;

            // Otherwise, if key is missing but has a fallback, use it
            // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
          } else if (valueSchema.fallback !== undefined) {
            // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
            dataset.value[key] = getFallback(valueSchema);

            // Otherwise, if key is missing and required, add issue
          } else if (
            valueSchema.type !== 'exact_optional' &&
            valueSchema.type !== 'optional' &&
            valueSchema.type !== 'nullish'
          ) {
            _addIssue(this, 'key', dataset, config, {
              input: undefined,
              expected: `"${key}"`,
              path: [
                {
                  type: 'object',
                  origin: 'key',
                  input: input as Record<string, unknown>,
                  key,
                  // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
                  value: input[key],
                },
              ],
            });

            // If necessary, abort early
            if (config.abortEarly) {
              break;
            }
          }
        }

        // Add rest to dataset if necessary
        // Hint: We exclude specific keys for security reasons
        if (!dataset.issues || !config.abortEarly) {
          for (const key of Object.keys(input)) {
            if (_isValidObjectKey(input, key) && !(Object.hasOwn(this.entries, key))) {
              // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
              dataset.value[key] = input[key];
            }
          }
        }

        // Otherwise, add object issue
      } else {
        _addIssue(this, 'type', dataset, config);
      }

      // Return output dataset
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      return dataset as OutputDataset<
        InferObjectOutput<ObjectEntries> & { [key: string]: unknown },
        LooseObjectIssue | InferObjectIssue<ObjectEntries>
      >;
    },
  };
}
