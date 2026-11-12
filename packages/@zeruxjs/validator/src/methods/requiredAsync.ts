import {
  type LooseObjectIssue,
  type LooseObjectSchemaAsync,
  nonOptionalAsync,
  type NonOptionalIssue,
  type NonOptionalSchemaAsync,
  type ObjectIssue,
  type ObjectSchemaAsync,
  type ObjectWithRestIssue,
  type ObjectWithRestSchemaAsync,
  type StrictObjectIssue,
  type StrictObjectSchemaAsync,
} from '../schemas/index.js';
import type {
  BaseIssue,
  BaseSchema,
  BaseSchemaAsync,
  Config,
  ErrorMessage,
  InferInput,
  InferIssue,
  InferObjectInput,
  InferObjectOutput,
  InferOutput,
  ObjectEntriesAsync,
  ObjectKeys,
  OutputDataset,
  SchemaWithoutPipe,
  StandardProps,
  UnknownDataset,
} from '../types/index.js';
import { _getStandardProps } from '../utils/index.js';

/**
 * Schema type.
 */
type Schema = SchemaWithoutPipe<
  | LooseObjectSchemaAsync<
      ObjectEntriesAsync,
      ErrorMessage<LooseObjectIssue> | undefined
    >
  | ObjectSchemaAsync<ObjectEntriesAsync, ErrorMessage<ObjectIssue> | undefined>
  | ObjectWithRestSchemaAsync<
      ObjectEntriesAsync,
      | BaseSchema<unknown, unknown, BaseIssue<unknown>>
      | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
      ErrorMessage<ObjectWithRestIssue> | undefined
    >
  | StrictObjectSchemaAsync<
      ObjectEntriesAsync,
      ErrorMessage<StrictObjectIssue> | undefined
    >
>;

/**
 * Required entries type.
 */
type RequiredEntries<
  TEntries extends ObjectEntriesAsync,
  TKeys extends readonly (keyof TEntries)[] | undefined,
  TMessage extends ErrorMessage<NonOptionalIssue> | undefined,
> = {
  [TKey in keyof TEntries]: TKeys extends readonly (keyof TEntries)[]
    ? TKey extends TKeys[number]
      ? NonOptionalSchemaAsync<TEntries[TKey], TMessage>
      : TEntries[TKey]
    : NonOptionalSchemaAsync<TEntries[TKey], TMessage>;
};

/**
 * Schema with required type.
 */
export type SchemaWithRequiredAsync<
  TSchema extends Schema,
  TKeys extends ObjectKeys<TSchema> | undefined,
  TMessage extends ErrorMessage<NonOptionalIssue> | undefined,
> = TSchema extends
  | ObjectSchemaAsync<infer TEntries, ErrorMessage<ObjectIssue> | undefined>
  | StrictObjectSchemaAsync<
      infer TEntries,
      ErrorMessage<StrictObjectIssue> | undefined
    >
  ? Omit<TSchema, 'entries' | '~standard' | '~run' | '~types'> & {
      /**
       * Fresh mapped entry dictionary; unselected children retain their borrowed identity.
       */
      readonly entries: RequiredEntries<TEntries, TKeys, TMessage>;
      /**
       * Adapter metadata for the copied entry shape, not a separate validator.
       *
       * @internal
       */
      readonly '~standard': StandardProps<
        InferObjectInput<RequiredEntries<TEntries, TKeys, TMessage>>,
        InferObjectOutput<RequiredEntries<TEntries, TKeys, TMessage>>
      >;
      /** Run the copied structural schema under the shared root context.
       * @param {UnknownDataset} dataset - Private candidate dataset; validation does not grant tenant permissions.
       * @param {Config<BaseIssue<unknown>>} config - Shared root work/issue budgets, abort flags and private diagnostic policy.
       * @returns {Promise<OutputDataset<InferObjectOutput<RequiredEntries<TEntries, TKeys, TMessage>>, NonOptionalIssue | InferIssue<TSchema>>>} Declared output or private issues; execution exceptions and budget failures propagate.
       * @internal
       */
      readonly '~run': (
        dataset: UnknownDataset,
        config: Config<BaseIssue<unknown>>
      ) => Promise<
        OutputDataset<
          InferObjectOutput<RequiredEntries<TEntries, TKeys, TMessage>>,
          NonOptionalIssue | InferIssue<TSchema>
        >
      >;
      /**
       * The input, output and issue type.
       *
       * @internal
       */
      readonly '~types'?:
        | {
            /** Type-only accepted object fields after selected wrappers are applied. */
            readonly input: InferObjectInput<
              RequiredEntries<TEntries, TKeys, TMessage>
            >;
            /** Type-only child output fields; runtime transforms remain schema-owned. */
            readonly output: InferObjectOutput<
              RequiredEntries<TEntries, TKeys, TMessage>
            >;
            /** Type-only private child/undefined issue union. */
            readonly issue: NonOptionalIssue | InferIssue<TSchema>;
          }
        | undefined;
    }
  : TSchema extends LooseObjectSchemaAsync<
        infer TEntries,
        ErrorMessage<LooseObjectIssue> | undefined
      >
    ? Omit<TSchema, 'entries' | '~standard' | '~run' | '~types'> & {
        /**
         * Fresh mapped entry dictionary; unselected children retain their borrowed identity.
         */
        readonly entries: RequiredEntries<TEntries, TKeys, TMessage>;
        /**
         * Adapter metadata for the copied entry shape, not a separate validator.
         *
         * @internal
         */
        readonly '~standard': StandardProps<
          InferObjectInput<RequiredEntries<TEntries, TKeys, TMessage>> & {
            [key: string]: unknown;
          },
          InferObjectOutput<RequiredEntries<TEntries, TKeys, TMessage>> & {
            [key: string]: unknown;
          }
        >;
        /** Run the copied structural schema under the shared root context.
         * @param {UnknownDataset} dataset - Private candidate dataset; validation does not grant tenant permissions.
         * @param {Config<BaseIssue<unknown>>} config - Shared root work/issue budgets, abort flags and private diagnostic policy.
         * @returns {Promise<OutputDataset<InferObjectOutput<RequiredEntries<TEntries, TKeys, TMessage>> & { [key: string]: unknown; }, NonOptionalIssue | InferIssue<TSchema>>>} Declared output or private issues; execution exceptions and budget failures propagate.
         * @internal
         */
        readonly '~run': (
          dataset: UnknownDataset,
          config: Config<BaseIssue<unknown>>
        ) => Promise<
          OutputDataset<
            InferObjectOutput<RequiredEntries<TEntries, TKeys, TMessage>> & {
              [key: string]: unknown;
            },
            NonOptionalIssue | InferIssue<TSchema>
          >
        >;
        /**
         * The input, output and issue type.
         *
         * @internal
         */
        readonly '~types'?:
          | {
              /** Type-only accepted object fields after selected wrappers are applied. */
              readonly input: InferObjectInput<
                RequiredEntries<TEntries, TKeys, TMessage>
              > & {
                [key: string]: unknown;
              };
              /** Type-only child output fields; runtime transforms remain schema-owned. */
              readonly output: InferObjectOutput<
                RequiredEntries<TEntries, TKeys, TMessage>
              > & {
                [key: string]: unknown;
              };
              /** Type-only private child/undefined issue union. */
              readonly issue: NonOptionalIssue | InferIssue<TSchema>;
            }
          | undefined;
      }
    : TSchema extends ObjectWithRestSchemaAsync<
          infer TEntries,
          infer TRest,
          ErrorMessage<ObjectWithRestIssue> | undefined
        >
      ? Omit<TSchema, 'entries' | '~standard' | '~run' | '~types'> & {
          /**
           * Fresh mapped entry dictionary; unselected children retain their borrowed identity.
           */
          readonly entries: RequiredEntries<TEntries, TKeys, TMessage>;
          /**
           * Adapter metadata for the copied entry shape, not a separate validator.
           *
           * @internal
           */
          readonly '~standard': StandardProps<
            InferObjectInput<RequiredEntries<TEntries, TKeys, TMessage>> & {
              [key: string]: InferInput<TRest>;
            },
            InferObjectOutput<RequiredEntries<TEntries, TKeys, TMessage>> & {
              [key: string]: InferOutput<TRest>;
            }
          >;
          /** Run the copied structural schema under the shared root context.
           * @param {UnknownDataset} dataset - Private candidate dataset; validation does not grant tenant permissions.
           * @param {Config<BaseIssue<unknown>>} config - Shared root work/issue budgets, abort flags and private diagnostic policy.
           * @returns {Promise<OutputDataset<InferObjectOutput<RequiredEntries<TEntries, TKeys, TMessage>> & { [key: string]: InferOutput<TRest>; }, NonOptionalIssue | InferIssue<TSchema>>>} Declared output or private issues; execution exceptions and budget failures propagate.
           * @internal
           */
          readonly '~run': (
            dataset: UnknownDataset,
            config: Config<BaseIssue<unknown>>
          ) => Promise<
            OutputDataset<
              InferObjectOutput<RequiredEntries<TEntries, TKeys, TMessage>> & {
                [key: string]: InferOutput<TRest>;
              },
              NonOptionalIssue | InferIssue<TSchema>
            >
          >;
          /**
           * The input, output and issue type.
           *
           * @internal
           */
          readonly '~types'?:
            | {
                /** Type-only accepted object fields after selected wrappers are applied. */
                readonly input: InferObjectInput<
                  RequiredEntries<TEntries, TKeys, TMessage>
                > & {
                  [key: string]: InferInput<TRest>;
                };
                /** Type-only child output fields; runtime transforms remain schema-owned. */
                readonly output: InferObjectOutput<
                  RequiredEntries<TEntries, TKeys, TMessage>
                > & { [key: string]: InferOutput<TRest> };
                /** Type-only private child/undefined issue union. */
                readonly issue: NonOptionalIssue | InferIssue<TSchema>;
              }
            | undefined;
        }
      : never;

/** Create a shallow structural schema copy with selected entries wrapped to reject undefined before and after child transforms. Child schemas and unselected references remain borrowed.
 * @param {TSchema} schema - Borrowed supported structural schema without a pipeline; no input is parsed by this operation.
 * @returns {SchemaWithRequiredAsync<TSchema, undefined, undefined>} Fresh outer schema/entry dictionary with existing root behavior and Standard Schema adaptation; no disposer or deep isolation is introduced.
 */
// @ts-expect-error FIXME: TypeScript incorrectly claims that the overload
// signature is not compatible with the implementation signature
export function requiredAsync<const TSchema extends Schema>(
  schema: TSchema
): SchemaWithRequiredAsync<TSchema, undefined, undefined>;

/** Create a shallow structural schema copy with selected entries wrapped to reject undefined before and after child transforms. Child schemas and unselected references remain borrowed.
 * @param {TSchema} schema - Borrowed supported structural schema without a pipeline; no input is parsed by this operation.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback for undefined rejection.
 * @returns {SchemaWithRequiredAsync<TSchema, undefined, TMessage>} Fresh outer schema/entry dictionary with existing root behavior and Standard Schema adaptation; no disposer or deep isolation is introduced.
 */
export function requiredAsync<
  const TSchema extends Schema,
  const TMessage extends ErrorMessage<NonOptionalIssue> | undefined,
>(
  schema: TSchema,
  message: TMessage
): SchemaWithRequiredAsync<TSchema, undefined, TMessage>;

/** Create a shallow structural schema copy with selected entries wrapped to reject undefined before and after child transforms. Child schemas and unselected references remain borrowed.
 * @param {TSchema} schema - Borrowed supported structural schema without a pipeline; no input is parsed by this operation.
 * @param {TKeys} keys - Optional selected declared entry keys; omission selects every entry.
 * @returns {SchemaWithRequiredAsync<TSchema, TKeys, undefined>} Fresh outer schema/entry dictionary with existing root behavior and Standard Schema adaptation; no disposer or deep isolation is introduced.
 */
export function requiredAsync<
  const TSchema extends Schema,
  const TKeys extends ObjectKeys<TSchema>,
>(
  schema: TSchema,
  keys: TKeys
): SchemaWithRequiredAsync<TSchema, TKeys, undefined>;

/** Create a shallow structural schema copy with selected entries wrapped to reject undefined before and after child transforms. Child schemas and unselected references remain borrowed.
 * @param {TSchema} schema - Borrowed supported structural schema without a pipeline; no input is parsed by this operation.
 * @param {TKeys} keys - Optional selected declared entry keys; omission selects every entry.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback for undefined rejection.
 * @returns {SchemaWithRequiredAsync<TSchema, TKeys, TMessage>} Fresh outer schema/entry dictionary with existing root behavior and Standard Schema adaptation; no disposer or deep isolation is introduced.
 */
export function requiredAsync<
  const TSchema extends Schema,
  const TKeys extends ObjectKeys<TSchema>,
  const TMessage extends ErrorMessage<NonOptionalIssue> | undefined,
>(
  schema: TSchema,
  keys: TKeys,
  message: TMessage
): SchemaWithRequiredAsync<TSchema, TKeys, TMessage>;

/** Create a shallow structural schema copy with selected entries wrapped to reject undefined before and after child transforms. Child schemas and unselected references remain borrowed.
 * @param {Schema} schema - Borrowed supported structural schema without a pipeline; no input is parsed by this operation.
 * @param {ErrorMessage<NonOptionalIssue> | ObjectKeys<Schema>} arg2 - Optional selected key array or trusted private message; an array is always interpreted as keys.
 * @param {ErrorMessage<NonOptionalIssue>} arg3 - Optional private message used when the second argument is a key array.
 * @returns {SchemaWithRequiredAsync<Schema, ObjectKeys<Schema> | undefined, ErrorMessage<NonOptionalIssue> | undefined>} Fresh outer schema/entry dictionary with existing root behavior and Standard Schema adaptation; no disposer or deep isolation is introduced.
 */
// @__NO_SIDE_EFFECTS__
export function requiredAsync(
  schema: Schema,
  arg2?: ErrorMessage<NonOptionalIssue> | ObjectKeys<Schema>,
  arg3?: ErrorMessage<NonOptionalIssue>
): SchemaWithRequiredAsync<
  Schema,
  ObjectKeys<Schema> | undefined,
  ErrorMessage<NonOptionalIssue> | undefined
> {
  // Get keys and message from arguments
  /** Explicit key selection if the overloaded second argument is an array; otherwise all entries are selected. */
  const keys = Array.isArray(arg2) ? arg2 : undefined;
  /** Borrowed private undefined-rejection policy resolved without invoking callbacks. */
  const message = (Array.isArray(arg2) ? arg3 : arg2) as
    | ErrorMessage<NonOptionalIssue>
    | undefined;

  // Create modified object entries
  /** Fresh schema dictionary receiving wrappers only for selected declared keys. */
  const entries: RequiredEntries<
    ObjectEntriesAsync,
    ObjectKeys<Schema>,
    ErrorMessage<NonOptionalIssue> | undefined
  > = {};
  // Enumerated entries belong to the trusted schema dictionary, whose values are schemas.
  for (const key in schema.entries) {
    // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
    entries[key] =
      !keys || keys.includes(key)
        ? nonOptionalAsync(schema.entries[key]!, message)
        : schema.entries[key]!;
  }

  // Return modified copy of schema
  return {
    ...schema,
    entries,
    /** Adapt the fresh copied schema to the same bounded root execution path.
     * @returns {object} Inert Standard Schema V1 adapter.
     */
    get '~standard'() {
      return _getStandardProps(this);
    },
  };
}
