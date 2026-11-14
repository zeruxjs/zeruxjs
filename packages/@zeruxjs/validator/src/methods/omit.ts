import type {
  LooseObjectIssue,
  LooseObjectSchema,
  LooseObjectSchemaAsync,
  ObjectIssue,
  ObjectSchema,
  ObjectSchemaAsync,
  ObjectWithRestIssue,
  ObjectWithRestSchema,
  ObjectWithRestSchemaAsync,
  StrictObjectIssue,
  StrictObjectSchema,
  StrictObjectSchemaAsync,
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
  InferObjectIssue,
  InferObjectOutput,
  InferOutput,
  ObjectEntries,
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
  | LooseObjectSchema<ObjectEntries, ErrorMessage<LooseObjectIssue> | undefined>
  | LooseObjectSchemaAsync<
      ObjectEntriesAsync,
      ErrorMessage<LooseObjectIssue> | undefined
    >
  | ObjectSchema<ObjectEntries, ErrorMessage<ObjectIssue> | undefined>
  | ObjectSchemaAsync<ObjectEntriesAsync, ErrorMessage<ObjectIssue> | undefined>
  | ObjectWithRestSchema<
      ObjectEntries,
      BaseSchema<unknown, unknown, BaseIssue<unknown>>,
      ErrorMessage<ObjectWithRestIssue> | undefined
    >
  | ObjectWithRestSchemaAsync<
      ObjectEntriesAsync,
      | BaseSchema<unknown, unknown, BaseIssue<unknown>>
      | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
      ErrorMessage<ObjectWithRestIssue> | undefined
    >
  | StrictObjectSchema<
      ObjectEntries,
      ErrorMessage<StrictObjectIssue> | undefined
    >
  | StrictObjectSchemaAsync<
      ObjectEntriesAsync,
      ErrorMessage<StrictObjectIssue> | undefined
    >
>;

/**
 * Schema with omit type.
 */
export type SchemaWithOmit<
  TSchema extends Schema,
  TKeys extends ObjectKeys<TSchema>,
> = TSchema extends
  | ObjectSchema<infer TEntries, ErrorMessage<ObjectIssue> | undefined>
  | StrictObjectSchema<
      infer TEntries,
      ErrorMessage<StrictObjectIssue> | undefined
    >
  ? Omit<TSchema, 'entries' | '~standard' | '~run' | '~types'> & {
      /** Fresh selected entry dictionary; nested child schemas remain borrowed. */
      readonly entries: Omit<TEntries, TKeys[number]>;
      /** Standard Schema inference/adapter for the selected fields; not an independent validator.
       * @internal */
      readonly '~standard': StandardProps<
        InferObjectInput<Omit<TEntries, TKeys[number]>>,
        InferObjectOutput<Omit<TEntries, TKeys[number]>>
      >;
      /** Run the declared copied structural shape under the shared root execution policy.
       * @param {UnknownDataset} dataset - Private candidate dataset, never a permission assertion.
       * @param {Config<BaseIssue<unknown>>} config - Shared budgets, cancellation and private message policy.
       * @returns {OutputDataset<InferObjectOutput<Omit<TEntries, TKeys[number]>>, Extract<InferIssue<TSchema>, { type: TSchema['type']; }> | InferObjectIssue<Omit<TEntries, TKeys[number]>>>} Declared output or private issues; operational failures propagate.
       * @internal
       */
      readonly '~run': (
        dataset: UnknownDataset,
        config: Config<BaseIssue<unknown>>
      ) => OutputDataset<
        InferObjectOutput<Omit<TEntries, TKeys[number]>>,
        | Extract<
            InferIssue<TSchema>,
            {
              /** Original schema discriminator retained in the inferred private issue type. */
              type: TSchema['type'];
            }
          >
        | InferObjectIssue<Omit<TEntries, TKeys[number]>>
      >;
      /** Type-only selected field inference; normally absent from runtime descriptors.
       * @internal */
      readonly '~types'?:
        | {
            /** Declared selected input fields; runtime own-key policy remains schema-owned. */
            readonly input: InferObjectInput<Omit<TEntries, TKeys[number]>>;
            /** Declared selected transformed fields; no runtime cloning is implied. */
            readonly output: InferObjectOutput<Omit<TEntries, TKeys[number]>>;
            /** Private selected child/schema issue union. */
            readonly issue:
              | Extract<
                  InferIssue<TSchema>,
                  {
                    /** Original schema discriminator retained in the inferred private issue type. */
                    type: TSchema['type'];
                  }
                >
              | InferObjectIssue<Omit<TEntries, TKeys[number]>>;
          }
        | undefined;
    }
  : TSchema extends
        | ObjectSchemaAsync<
            infer TEntries,
            ErrorMessage<ObjectIssue> | undefined
          >
        | StrictObjectSchemaAsync<
            infer TEntries,
            ErrorMessage<StrictObjectIssue> | undefined
          >
    ? Omit<TSchema, 'entries' | '~standard' | '~run' | '~types'> & {
        /** Fresh selected entry dictionary; nested child schemas remain borrowed. */
        readonly entries: Omit<TEntries, TKeys[number]>;
        /** Standard Schema inference/adapter for the selected fields; not an independent validator.
         * @internal */
        readonly '~standard': StandardProps<
          InferObjectInput<Omit<TEntries, TKeys[number]>>,
          InferObjectOutput<Omit<TEntries, TKeys[number]>>
        >;
        /** Run the declared copied structural shape under the shared root execution policy.
         * @param {UnknownDataset} dataset - Private candidate dataset, never a permission assertion.
         * @param {Config<BaseIssue<unknown>>} config - Shared budgets, cancellation and private message policy.
         * @returns {Promise<OutputDataset<InferObjectOutput<Omit<TEntries, TKeys[number]>>, Extract<InferIssue<TSchema>, { type: TSchema['type']; }> | InferObjectIssue<Omit<TEntries, TKeys[number]>>>>} Declared output or private issues; operational failures propagate.
         * @internal
         */
        readonly '~run': (
          dataset: UnknownDataset,
          config: Config<BaseIssue<unknown>>
        ) => Promise<
          OutputDataset<
            InferObjectOutput<Omit<TEntries, TKeys[number]>>,
            | Extract<
                InferIssue<TSchema>,
                {
                  /** Original schema discriminator retained in the inferred private issue type. */
                  type: TSchema['type'];
                }
              >
            | InferObjectIssue<Omit<TEntries, TKeys[number]>>
          >
        >;
        /** Type-only selected field inference; normally absent from runtime descriptors.
         * @internal */
        readonly '~types'?:
          | {
              /** Declared selected input fields; runtime own-key policy remains schema-owned. */
              readonly input: InferObjectInput<Omit<TEntries, TKeys[number]>>;
              /** Declared selected transformed fields; no runtime cloning is implied. */
              readonly output: InferObjectOutput<Omit<TEntries, TKeys[number]>>;
              /** Private selected child/schema issue union. */
              readonly issue:
                | Extract<
                    InferIssue<TSchema>,
                    {
                      /** Original schema discriminator retained in the inferred private issue type. */
                      type: TSchema['type'];
                    }
                  >
                | InferObjectIssue<Omit<TEntries, TKeys[number]>>;
            }
          | undefined;
      }
    : TSchema extends LooseObjectSchema<
          infer TEntries,
          ErrorMessage<LooseObjectIssue> | undefined
        >
      ? Omit<TSchema, 'entries' | '~standard' | '~run' | '~types'> & {
          /** Fresh selected entry dictionary; nested child schemas remain borrowed. */
          readonly entries: Omit<TEntries, TKeys[number]>;
          /** Standard Schema inference/adapter for the selected fields; not an independent validator.
           * @internal */
          readonly '~standard': StandardProps<
            InferObjectInput<Omit<TEntries, TKeys[number]>> & {
              [key: string]: unknown;
            },
            InferObjectInput<Omit<TEntries, TKeys[number]>> & {
              [key: string]: unknown;
            }
          >;
          /** Run the declared copied structural shape under the shared root execution policy.
           * @param {UnknownDataset} dataset - Private candidate dataset, never a permission assertion.
           * @param {Config<BaseIssue<unknown>>} config - Shared budgets, cancellation and private message policy.
           * @returns {OutputDataset<InferObjectOutput<Omit<TEntries, TKeys[number]>> & { [key: string]: unknown; }, Extract<InferIssue<TSchema>, { type: TSchema['type']; }> | InferObjectIssue<Omit<TEntries, TKeys[number]>>>} Declared output or private issues; operational failures propagate.
           * @internal
           */
          readonly '~run': (
            dataset: UnknownDataset,
            config: Config<BaseIssue<unknown>>
          ) => OutputDataset<
            InferObjectOutput<Omit<TEntries, TKeys[number]>> & {
              [key: string]: unknown;
            },
            | Extract<
                InferIssue<TSchema>,
                {
                  /** Original schema discriminator retained in the inferred private issue type. */
                  type: TSchema['type'];
                }
              >
            | InferObjectIssue<Omit<TEntries, TKeys[number]>>
          >;
          /** Type-only selected field inference; normally absent from runtime descriptors.
           * @internal */
          readonly '~types'?:
            | {
                /** Declared selected input fields; runtime own-key policy remains schema-owned. */
                readonly input: InferObjectInput<
                  Omit<TEntries, TKeys[number]>
                > & {
                  [key: string]: unknown;
                };
                /** Declared selected transformed fields; no runtime cloning is implied. */
                readonly output: InferObjectOutput<
                  Omit<TEntries, TKeys[number]>
                > & {
                  [key: string]: unknown;
                };
                /** Private selected child/schema issue union. */
                readonly issue:
                  | Extract<
                      InferIssue<TSchema>,
                      {
                        /** Original schema discriminator retained in the inferred private issue type. */
                        type: TSchema['type'];
                      }
                    >
                  | InferObjectIssue<Omit<TEntries, TKeys[number]>>;
              }
            | undefined;
        }
      : TSchema extends LooseObjectSchemaAsync<
            infer TEntries,
            ErrorMessage<LooseObjectIssue> | undefined
          >
        ? Omit<TSchema, 'entries' | '~standard' | '~run' | '~types'> & {
            /** Fresh selected entry dictionary; nested child schemas remain borrowed. */
            readonly entries: Omit<TEntries, TKeys[number]>;
            /** Standard Schema inference/adapter for the selected fields; not an independent validator.
             * @internal */
            readonly '~standard': StandardProps<
              InferObjectInput<Omit<TEntries, TKeys[number]>> & {
                [key: string]: unknown;
              },
              InferObjectInput<Omit<TEntries, TKeys[number]>> & {
                [key: string]: unknown;
              }
            >;
            /** Run the declared copied structural shape under the shared root execution policy.
             * @param {UnknownDataset} dataset - Private candidate dataset, never a permission assertion.
             * @param {Config<BaseIssue<unknown>>} config - Shared budgets, cancellation and private message policy.
             * @returns {Promise<OutputDataset<InferObjectOutput<Omit<TEntries, TKeys[number]>> & { [key: string]: unknown; }, Extract<InferIssue<TSchema>, { type: TSchema['type']; }> | InferObjectIssue<Omit<TEntries, TKeys[number]>>>>} Declared output or private issues; operational failures propagate.
             * @internal
             */
            readonly '~run': (
              dataset: UnknownDataset,
              config: Config<BaseIssue<unknown>>
            ) => Promise<
              OutputDataset<
                InferObjectOutput<Omit<TEntries, TKeys[number]>> & {
                  [key: string]: unknown;
                },
                | Extract<
                    InferIssue<TSchema>,
                    {
                      /** Original schema discriminator retained in the inferred private issue type. */
                      type: TSchema['type'];
                    }
                  >
                | InferObjectIssue<Omit<TEntries, TKeys[number]>>
              >
            >;
            /** Type-only selected field inference; normally absent from runtime descriptors.
             * @internal */
            readonly '~types'?:
              | {
                  /** Declared selected input fields; runtime own-key policy remains schema-owned. */
                  readonly input: InferObjectInput<
                    Omit<TEntries, TKeys[number]>
                  > & {
                    [key: string]: unknown;
                  };
                  /** Declared selected transformed fields; no runtime cloning is implied. */
                  readonly output: InferObjectOutput<
                    Omit<TEntries, TKeys[number]>
                  > & {
                    [key: string]: unknown;
                  };
                  /** Private selected child/schema issue union. */
                  readonly issue:
                    | Extract<
                        InferIssue<TSchema>,
                        {
                          /** Original schema discriminator retained in the inferred private issue type. */
                          type: TSchema['type'];
                        }
                      >
                    | InferObjectIssue<Omit<TEntries, TKeys[number]>>;
                }
              | undefined;
          }
        : TSchema extends ObjectWithRestSchema<
              infer TEntries,
              BaseSchema<unknown, unknown, BaseIssue<unknown>>,
              ErrorMessage<ObjectWithRestIssue> | undefined
            >
          ? Omit<TSchema, 'entries' | '~standard' | '~run' | '~types'> & {
              /** Fresh selected entry dictionary; nested child schemas remain borrowed. */
              readonly entries: Omit<TEntries, TKeys[number]>;
              /** Standard Schema inference/adapter for the selected fields; not an independent validator.
               * @internal */
              readonly '~standard': StandardProps<
                InferObjectInput<Omit<TEntries, TKeys[number]>> & {
                  [key: string]: InferInput<TSchema['rest']>;
                },
                InferObjectOutput<Omit<TEntries, TKeys[number]>> & {
                  [key: string]: InferOutput<TSchema['rest']>;
                }
              >;
              /** Run the declared copied structural shape under the shared root execution policy.
               * @param {UnknownDataset} dataset - Private candidate dataset, never a permission assertion.
               * @param {Config<BaseIssue<unknown>>} config - Shared budgets, cancellation and private message policy.
               * @returns {OutputDataset<InferObjectOutput<Omit<TEntries, TKeys[number]>> & { [key: string]: InferOutput<TSchema['rest']>; }, Extract<InferIssue<TSchema>, { type: TSchema['type']; }> | InferObjectIssue<Omit<TEntries, TKeys[number]>> | InferIssue<TSchema['rest']>>} Declared output or private issues; operational failures propagate.
               * @internal
               */
              readonly '~run': (
                dataset: UnknownDataset,
                config: Config<BaseIssue<unknown>>
              ) => OutputDataset<
                InferObjectOutput<Omit<TEntries, TKeys[number]>> & {
                  [key: string]: InferOutput<TSchema['rest']>;
                },
                | Extract<
                    InferIssue<TSchema>,
                    {
                      /** Original schema discriminator retained in the inferred private issue type. */
                      type: TSchema['type'];
                    }
                  >
                | InferObjectIssue<Omit<TEntries, TKeys[number]>>
                | InferIssue<TSchema['rest']>
              >;
              /** Type-only selected field inference; normally absent from runtime descriptors.
               * @internal */
              readonly '~types'?:
                | {
                    /** Declared selected input fields; runtime own-key policy remains schema-owned. */
                    readonly input: InferObjectInput<
                      Omit<TEntries, TKeys[number]>
                    > & {
                      [key: string]: InferInput<TSchema['rest']>;
                    };
                    /** Declared selected transformed fields; no runtime cloning is implied. */
                    readonly output: InferObjectOutput<
                      Omit<TEntries, TKeys[number]>
                    > & { [key: string]: InferOutput<TSchema['rest']> };
                    /** Private selected child/schema issue union. */
                    readonly issue:
                      | Extract<
                          InferIssue<TSchema>,
                          {
                            /** Original schema discriminator retained in the inferred private issue type. */
                            type: TSchema['type'];
                          }
                        >
                      | InferObjectIssue<Omit<TEntries, TKeys[number]>>
                      | InferIssue<TSchema['rest']>;
                  }
                | undefined;
            }
          : TSchema extends ObjectWithRestSchemaAsync<
                infer TEntries,
                BaseSchema<unknown, unknown, BaseIssue<unknown>>,
                ErrorMessage<ObjectWithRestIssue> | undefined
              >
            ? Omit<TSchema, 'entries' | '~standard' | '~run' | '~types'> & {
                /** Fresh selected entry dictionary; nested child schemas remain borrowed. */
                readonly entries: Omit<TEntries, TKeys[number]>;
                /** Standard Schema inference/adapter for the selected fields; not an independent validator.
                 * @internal */
                readonly '~standard': StandardProps<
                  InferObjectInput<Omit<TEntries, TKeys[number]>> & {
                    [key: string]: InferInput<TSchema['rest']>;
                  },
                  InferObjectOutput<Omit<TEntries, TKeys[number]>> & {
                    [key: string]: InferOutput<TSchema['rest']>;
                  }
                >;
                /** Run the declared copied structural shape under the shared root execution policy.
                 * @param {UnknownDataset} dataset - Private candidate dataset, never a permission assertion.
                 * @param {Config<BaseIssue<unknown>>} config - Shared budgets, cancellation and private message policy.
                 * @returns {Promise<OutputDataset<InferObjectOutput<Omit<TEntries, TKeys[number]>> & { [key: string]: InferOutput<TSchema['rest']>; }, Extract<InferIssue<TSchema>, { type: TSchema['type']; }> | InferObjectIssue<Omit<TEntries, TKeys[number]>> | InferIssue<TSchema['rest']>>>} Declared output or private issues; operational failures propagate.
                 * @internal
                 */
                readonly '~run': (
                  dataset: UnknownDataset,
                  config: Config<BaseIssue<unknown>>
                ) => Promise<
                  OutputDataset<
                    InferObjectOutput<Omit<TEntries, TKeys[number]>> & {
                      [key: string]: InferOutput<TSchema['rest']>;
                    },
                    | Extract<
                        InferIssue<TSchema>,
                        {
                          /** Original schema discriminator retained in the inferred private issue type. */
                          type: TSchema['type'];
                        }
                      >
                    | InferObjectIssue<Omit<TEntries, TKeys[number]>>
                    | InferIssue<TSchema['rest']>
                  >
                >;
                /** Type-only selected field inference; normally absent from runtime descriptors.
                 * @internal */
                readonly '~types'?:
                  | {
                      /** Declared selected input fields; runtime own-key policy remains schema-owned. */
                      readonly input: InferObjectInput<
                        Omit<TEntries, TKeys[number]>
                      > & {
                        [key: string]: InferInput<TSchema['rest']>;
                      };
                      /** Declared selected transformed fields; no runtime cloning is implied. */
                      readonly output: InferObjectOutput<
                        Omit<TEntries, TKeys[number]>
                      > & { [key: string]: InferOutput<TSchema['rest']> };
                      /** Private selected child/schema issue union. */
                      readonly issue:
                        | Extract<
                            InferIssue<TSchema>,
                            {
                              /** Original schema discriminator retained in the inferred private issue type. */
                              type: TSchema['type'];
                            }
                          >
                        | InferObjectIssue<Omit<TEntries, TKeys[number]>>
                        | InferIssue<TSchema['rest']>;
                    }
                  | undefined;
              }
            : never;

/** Shallow-copy a structural schema/entry dictionary and remove selected declared keys; rest/loose behavior remains unchanged and this is not value redaction.
 * @param {TSchema} schema - Borrowed declared schema; no runtime data is validated by this structural/metadata operation.
 * @param {TKeys} keys - Explicit trusted declared key selection; invalid untyped keys are not automatically repaired.
 * @returns {SchemaWithOmit<TSchema, TKeys>} Declared borrowed metadata/child or fresh outer action/schema; no new disposal owner or permission boundary.
 */
// @__NO_SIDE_EFFECTS__
export function omit<
  const TSchema extends Schema,
  const TKeys extends ObjectKeys<TSchema>,
>(schema: TSchema, keys: TKeys): SchemaWithOmit<TSchema, TKeys> {
  // Create modified object entries
  /** Fresh top-level selected schema dictionary; child references retain their existing identity. */
  // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
  const entries: Omit<TSchema['entries'], TKeys[number]> = {
    ...schema.entries,
  };
  for (const key of keys) {
    // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.

    delete entries[key];
  }

  // Rerturn modified copy of schema
  // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
  return {
    ...schema,
    entries,
    /** Adapt the new copied structural schema to shared root validation.
     * @returns {object} Inert Standard Schema V1 adapter; no input is parsed during copying.
     */
    get '~standard'() {
      return _getStandardProps(this);
    },
  };
}
