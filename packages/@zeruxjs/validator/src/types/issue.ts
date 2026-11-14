import type { SchemaWithPipe, SchemaWithPipeAsync } from '../methods/index.js';
import type {
  ArrayIssue,
  ArraySchema,
  ArraySchemaAsync,
  ExactOptionalSchema,
  ExactOptionalSchemaAsync,
  IntersectIssue,
  IntersectSchema,
  IntersectSchemaAsync,
  LazySchema,
  LazySchemaAsync,
  LooseObjectIssue,
  LooseObjectSchema,
  LooseObjectSchemaAsync,
  LooseTupleIssue,
  LooseTupleSchema,
  LooseTupleSchemaAsync,
  MapIssue,
  MapSchema,
  MapSchemaAsync,
  NonNullableIssue,
  NonNullableSchema,
  NonNullableSchemaAsync,
  NonNullishIssue,
  NonNullishSchema,
  NonNullishSchemaAsync,
  NonOptionalIssue,
  NonOptionalSchema,
  NonOptionalSchemaAsync,
  NullableSchema,
  NullableSchemaAsync,
  NullishSchema,
  NullishSchemaAsync,
  ObjectIssue,
  ObjectSchema,
  ObjectSchemaAsync,
  ObjectWithRestIssue,
  ObjectWithRestSchema,
  ObjectWithRestSchemaAsync,
  OptionalSchema,
  OptionalSchemaAsync,
  RecordIssue,
  RecordSchema,
  RecordSchemaAsync,
  SetIssue,
  SetSchema,
  SetSchemaAsync,
  StrictObjectIssue,
  StrictObjectSchema,
  StrictObjectSchemaAsync,
  StrictTupleIssue,
  StrictTupleSchema,
  StrictTupleSchemaAsync,
  TupleIssue,
  TupleSchema,
  TupleSchemaAsync,
  TupleWithRestIssue,
  TupleWithRestSchema,
  TupleWithRestSchemaAsync,
  UndefinedableSchema,
  UndefinedableSchemaAsync,
  UnionIssue,
  UnionSchema,
  UnionSchemaAsync,
  VariantIssue,
  VariantSchema,
  VariantSchemaAsync,
} from '../schemas/index.js';
import type { Config } from './config.js';
import type { InferInput } from './infer.js';
import type { ObjectEntries, ObjectEntriesAsync } from './object.js';
import type { Default, DefaultAsync, ErrorMessage } from './other.js';
import type { BaseSchema, BaseSchemaAsync } from './schema.js';
import type { TupleItems, TupleItemsAsync } from './tuple.js';
import type { FirstTupleItem, MaybeReadonly } from './utils.js';

/**
 * Array path item interface.
 */
export interface ArrayPathItem {
  /** Private path/action discriminator; not a permission or public routing label. */
  readonly type: 'array';
  /** Whether this private path points to a failing key or value. */
  readonly origin: 'value';
  /** Original private candidate reference; never expose it through public responses or telemetry. */
  readonly input: MaybeReadonly<unknown[]>;
  /** Original private key/index; user-controlled names may contain separators or secrets. */
  readonly key: number;
  /** Original private value retained for structured issue context; no redaction or cloning is implied. */
  readonly value: unknown;
}

/**
 * Map path item interface.
 */
export interface MapPathItem {
  /** Private path/action discriminator; not a permission or public routing label. */
  readonly type: 'map';
  /** Whether this private path points to a failing key or value. */
  readonly origin: 'key' | 'value';
  /** Original private candidate reference; never expose it through public responses or telemetry. */
  readonly input: Map<unknown, unknown>;
  /** Original private key/index; user-controlled names may contain separators or secrets. */
  readonly key: unknown;
  /** Original private value retained for structured issue context; no redaction or cloning is implied. */
  readonly value: unknown;
}

/**
 * Object path item interface.
 */
export interface ObjectPathItem {
  /** Private path/action discriminator; not a permission or public routing label. */
  readonly type: 'object';
  /** Whether this private path points to a failing key or value. */
  readonly origin: 'key' | 'value';
  /** Original private candidate reference; never expose it through public responses or telemetry. */
  readonly input: Record<string, unknown>;
  /** Original private key/index; user-controlled names may contain separators or secrets. */
  readonly key: string;
  /** Original private value retained for structured issue context; no redaction or cloning is implied. */
  readonly value: unknown;
}

/**
 * Set path item interface.
 */
export interface SetPathItem {
  /** Private path/action discriminator; not a permission or public routing label. */
  readonly type: 'set';
  /** Whether this private path points to a failing key or value. */
  readonly origin: 'value';
  /** Original private candidate reference; never expose it through public responses or telemetry. */
  readonly input: Set<unknown>;
  /** Original private key/index; user-controlled names may contain separators or secrets. */
  readonly key: null;
  /** Original private value retained for structured issue context; no redaction or cloning is implied. */
  readonly value: unknown;
}

/**
 * Unknown path item interface.
 */
export interface UnknownPathItem {
  /** Private path/action discriminator; not a permission or public routing label. */
  readonly type: 'unknown';
  /** Whether this private path points to a failing key or value. */
  readonly origin: 'key' | 'value';
  /** Original private candidate reference; never expose it through public responses or telemetry. */
  readonly input: unknown;
  /** Original private key/index; user-controlled names may contain separators or secrets. */
  readonly key: unknown;
  /** Original private value retained for structured issue context; no redaction or cloning is implied. */
  readonly value: unknown;
}

/**
 * Issue path item type.
 */
export type IssuePathItem =
  | ArrayPathItem
  | MapPathItem
  | ObjectPathItem
  | SetPathItem
  | UnknownPathItem;

/**
 * Base issue interface.
 */
export interface BaseIssue<TInput> extends Config<BaseIssue<TInput>> {
  /** Optional stable machine code for compatibility with custom issue producers; it is not authorization. */
  readonly code?: string;
  /** Schema/refinement/transformation failure category; operational exceptions remain distinct. */
  readonly kind: 'schema' | 'validation' | 'transformation';
  /** Private path/action discriminator; not a permission or public routing label. */
  readonly type: string;
  /** Original private candidate reference; never expose it through public responses or telemetry. */
  readonly input: TInput;
  /** Private unescaped diagnostic expectation, not safe HTML. */
  readonly expected: string | null;
  /** Private unescaped rejected-value description, potentially containing submitted content. */
  readonly received: string;
  /** Private diagnostic text produced by trusted message policy; public HTTP adapters select safe fields separately. */
  readonly message: string;
  /** Borrowed private rule/constructor/threshold metadata; may contain trusted callbacks or policy values. */
  readonly requirement?: unknown | undefined;
  /** Nonempty private structured path; use explicit client sanitization instead of serializing this record. */
  readonly path?: [IssuePathItem, ...IssuePathItem[]] | undefined;
  /** Nonempty private nested branch issues retaining their original input references. */
  readonly issues?: [BaseIssue<TInput>, ...BaseIssue<TInput>[]] | undefined;
}

/**
 * Generic issue type.
 */
export type GenericIssue<TInput = unknown> = BaseIssue<TInput>;

/**
 * Dot path type.
 */
type DotPath<
  TKey extends string | number | symbol,
  TSchema extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
> = TKey extends string | number
  ? `${TKey}` | `${TKey}.${IssueDotPath<TSchema>}`
  : never;

/**
 * Object path type.
 */
type ObjectPath<TEntries extends ObjectEntries | ObjectEntriesAsync> = {
  [TKey in keyof TEntries]: DotPath<TKey, TEntries[TKey]>;
}[keyof TEntries];

/**
 * Tuple keys type.
 */
type TupleKeys<TItems extends TupleItems | TupleItemsAsync> = Exclude<
  keyof TItems,
  keyof []
>;

/**
 * Tuple path type.
 */
type TuplePath<TItems extends TupleItems | TupleItemsAsync> = {
  [TKey in TupleKeys<TItems>]: TItems[TKey] extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>
    ? DotPath<TKey, TItems[TKey]>
    : never;
}[TupleKeys<TItems>];

/** Infer dot-path labels through supported schema families; this is not path escaping, authorization or a lossless runtime key codec. */
export type IssueDotPath<
  TSchema extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
> =
  // Pipe (sync)
  TSchema extends SchemaWithPipe<infer TPipe>
    ? IssueDotPath<FirstTupleItem<TPipe>>
    : // Pipe (async)
      TSchema extends SchemaWithPipeAsync<infer TPipe>
      ? IssueDotPath<FirstTupleItem<TPipe>>
      : // Array (sync)
        TSchema extends ArraySchema<
            infer TItem,
            ErrorMessage<ArrayIssue> | undefined
          >
        ? DotPath<number, TItem>
        : // Array (async)
          TSchema extends ArraySchemaAsync<
              infer TItem,
              ErrorMessage<ArrayIssue> | undefined
            >
          ? DotPath<number, TItem>
          : // Intersect, Union or Variant (sync)
            TSchema extends
                | IntersectSchema<
                    infer TOptions,
                    ErrorMessage<IntersectIssue> | undefined
                  >
                | UnionSchema<
                    infer TOptions,
                    ErrorMessage<UnionIssue<BaseIssue<unknown>>> | undefined
                  >
                | VariantSchema<
                    string,
                    infer TOptions,
                    ErrorMessage<VariantIssue> | undefined
                  >
            ? IssueDotPath<TOptions[number]>
            : // Intersect, Union or Variant (async)
              TSchema extends
                  | IntersectSchemaAsync<
                      infer TOptions,
                      ErrorMessage<IntersectIssue> | undefined
                    >
                  | UnionSchemaAsync<
                      infer TOptions,
                      ErrorMessage<UnionIssue<BaseIssue<unknown>>> | undefined
                    >
                  | VariantSchemaAsync<
                      string,
                      infer TOptions,
                      ErrorMessage<VariantIssue> | undefined
                    >
              ? IssueDotPath<TOptions[number]>
              : // Map or Record (sync)
                TSchema extends
                    | MapSchema<
                        infer TKey,
                        infer TValue,
                        ErrorMessage<MapIssue> | undefined
                      >
                    | RecordSchema<
                        infer TKey,
                        infer TValue,
                        ErrorMessage<RecordIssue> | undefined
                      >
                ? DotPath<InferInput<TKey>, TValue>
                : // Map or Record (async)
                  TSchema extends
                      | MapSchemaAsync<
                          infer TKey,
                          infer TValue,
                          ErrorMessage<MapIssue> | undefined
                        >
                      | RecordSchemaAsync<
                          infer TKey,
                          infer TValue,
                          ErrorMessage<RecordIssue> | undefined
                        >
                  ? DotPath<InferInput<TKey>, TValue>
                  : // Object (sync)
                    TSchema extends
                        | LooseObjectSchema<
                            infer TEntries,
                            ErrorMessage<LooseObjectIssue> | undefined
                          >
                        | ObjectSchema<
                            infer TEntries,
                            ErrorMessage<ObjectIssue> | undefined
                          >
                        | StrictObjectSchema<
                            infer TEntries,
                            ErrorMessage<StrictObjectIssue> | undefined
                          >
                    ? ObjectPath<TEntries>
                    : // Object (async)
                      TSchema extends
                          | LooseObjectSchemaAsync<
                              infer TEntries,
                              ErrorMessage<LooseObjectIssue> | undefined
                            >
                          | ObjectSchemaAsync<
                              infer TEntries,
                              ErrorMessage<ObjectIssue> | undefined
                            >
                          | StrictObjectSchemaAsync<
                              infer TEntries,
                              ErrorMessage<StrictObjectIssue> | undefined
                            >
                      ? ObjectPath<TEntries>
                      : // Object with Rest (sync)
                        TSchema extends ObjectWithRestSchema<
                            ObjectEntries,
                            BaseSchema<unknown, unknown, BaseIssue<unknown>>,
                            ErrorMessage<ObjectWithRestIssue> | undefined
                          >
                        ? string
                        : // Object with Rest (async)
                          TSchema extends ObjectWithRestSchemaAsync<
                              ObjectEntriesAsync,
                              | BaseSchema<unknown, unknown, BaseIssue<unknown>>
                              | BaseSchemaAsync<
                                  unknown,
                                  unknown,
                                  BaseIssue<unknown>
                                >,
                              ErrorMessage<ObjectWithRestIssue> | undefined
                            >
                          ? string
                          : // Set (sync)
                            TSchema extends SetSchema<
                                infer TValue,
                                ErrorMessage<SetIssue> | undefined
                              >
                            ? DotPath<number, TValue>
                            : // Set (async)
                              TSchema extends SetSchemaAsync<
                                  infer TValue,
                                  ErrorMessage<SetIssue> | undefined
                                >
                              ? DotPath<number, TValue>
                              : // Tuple (sync)
                                TSchema extends
                                    | LooseTupleSchema<
                                        infer TItems,
                                        | ErrorMessage<LooseTupleIssue>
                                        | undefined
                                      >
                                    | StrictTupleSchema<
                                        infer TItems,
                                        | ErrorMessage<StrictTupleIssue>
                                        | undefined
                                      >
                                    | TupleSchema<
                                        infer TItems,
                                        ErrorMessage<TupleIssue> | undefined
                                      >
                                ? TuplePath<TItems>
                                : // Tuple (async)
                                  TSchema extends
                                      | LooseTupleSchemaAsync<
                                          infer TItems,
                                          | ErrorMessage<LooseTupleIssue>
                                          | undefined
                                        >
                                      | StrictTupleSchemaAsync<
                                          infer TItems,
                                          | ErrorMessage<StrictTupleIssue>
                                          | undefined
                                        >
                                      | TupleSchemaAsync<
                                          infer TItems,
                                          ErrorMessage<TupleIssue> | undefined
                                        >
                                  ? TuplePath<TItems>
                                  : // Tuple with Rest (sync)
                                    TSchema extends TupleWithRestSchema<
                                        infer TItems,
                                        infer TRest,
                                        | ErrorMessage<TupleWithRestIssue>
                                        | undefined
                                      >
                                    ? TuplePath<TItems> | DotPath<number, TRest>
                                    : // Tuple with Rest (async)
                                      TSchema extends TupleWithRestSchemaAsync<
                                          infer TItems,
                                          infer TRest,
                                          | ErrorMessage<TupleWithRestIssue>
                                          | undefined
                                        >
                                      ?
                                          | TuplePath<TItems>
                                          | DotPath<number, TRest>
                                      : // Wrapped (sync)
                                        TSchema extends
                                            | ExactOptionalSchema<
                                                infer TWrapped,
                                                Default<
                                                  BaseSchema<
                                                    unknown,
                                                    unknown,
                                                    BaseIssue<unknown>
                                                  >,
                                                  never
                                                >
                                              >
                                            | LazySchema<infer TWrapped>
                                            | NonNullableSchema<
                                                infer TWrapped,
                                                | ErrorMessage<NonNullableIssue>
                                                | undefined
                                              >
                                            | NonNullishSchema<
                                                infer TWrapped,
                                                | ErrorMessage<NonNullishIssue>
                                                | undefined
                                              >
                                            | NonOptionalSchema<
                                                infer TWrapped,
                                                | ErrorMessage<NonOptionalIssue>
                                                | undefined
                                              >
                                            | NullableSchema<
                                                infer TWrapped,
                                                Default<
                                                  BaseSchema<
                                                    unknown,
                                                    unknown,
                                                    BaseIssue<unknown>
                                                  >,
                                                  null
                                                >
                                              >
                                            | NullishSchema<
                                                infer TWrapped,
                                                Default<
                                                  BaseSchema<
                                                    unknown,
                                                    unknown,
                                                    BaseIssue<unknown>
                                                  >,
                                                  null | undefined
                                                >
                                              >
                                            | OptionalSchema<
                                                infer TWrapped,
                                                Default<
                                                  BaseSchema<
                                                    unknown,
                                                    unknown,
                                                    BaseIssue<unknown>
                                                  >,
                                                  undefined
                                                >
                                              >
                                            | UndefinedableSchema<
                                                infer TWrapped,
                                                Default<
                                                  BaseSchema<
                                                    unknown,
                                                    unknown,
                                                    BaseIssue<unknown>
                                                  >,
                                                  undefined
                                                >
                                              >
                                        ? IssueDotPath<TWrapped>
                                        : // Wrapped (async)
                                          TSchema extends
                                              | ExactOptionalSchemaAsync<
                                                  infer TWrapped,
                                                  DefaultAsync<
                                                    | BaseSchema<
                                                        unknown,
                                                        unknown,
                                                        BaseIssue<unknown>
                                                      >
                                                    | BaseSchemaAsync<
                                                        unknown,
                                                        unknown,
                                                        BaseIssue<unknown>
                                                      >,
                                                    never
                                                  >
                                                >
                                              | LazySchemaAsync<infer TWrapped>
                                              | NonNullableSchemaAsync<
                                                  infer TWrapped,
                                                  | ErrorMessage<NonNullableIssue>
                                                  | undefined
                                                >
                                              | NonNullishSchemaAsync<
                                                  infer TWrapped,
                                                  | ErrorMessage<NonNullishIssue>
                                                  | undefined
                                                >
                                              | NonOptionalSchemaAsync<
                                                  infer TWrapped,
                                                  | ErrorMessage<NonOptionalIssue>
                                                  | undefined
                                                >
                                              | NullableSchemaAsync<
                                                  infer TWrapped,
                                                  DefaultAsync<
                                                    | BaseSchema<
                                                        unknown,
                                                        unknown,
                                                        BaseIssue<unknown>
                                                      >
                                                    | BaseSchemaAsync<
                                                        unknown,
                                                        unknown,
                                                        BaseIssue<unknown>
                                                      >,
                                                    null
                                                  >
                                                >
                                              | NullishSchemaAsync<
                                                  infer TWrapped,
                                                  DefaultAsync<
                                                    | BaseSchema<
                                                        unknown,
                                                        unknown,
                                                        BaseIssue<unknown>
                                                      >
                                                    | BaseSchemaAsync<
                                                        unknown,
                                                        unknown,
                                                        BaseIssue<unknown>
                                                      >,
                                                    null | undefined
                                                  >
                                                >
                                              | OptionalSchemaAsync<
                                                  infer TWrapped,
                                                  DefaultAsync<
                                                    | BaseSchema<
                                                        unknown,
                                                        unknown,
                                                        BaseIssue<unknown>
                                                      >
                                                    | BaseSchemaAsync<
                                                        unknown,
                                                        unknown,
                                                        BaseIssue<unknown>
                                                      >,
                                                    undefined
                                                  >
                                                >
                                              | UndefinedableSchemaAsync<
                                                  infer TWrapped,
                                                  DefaultAsync<
                                                    | BaseSchema<
                                                        unknown,
                                                        unknown,
                                                        BaseIssue<unknown>
                                                      >
                                                    | BaseSchemaAsync<
                                                        unknown,
                                                        unknown,
                                                        BaseIssue<unknown>
                                                      >,
                                                    undefined
                                                  >
                                                >
                                          ? IssueDotPath<TWrapped>
                                          : // Otherwise
                                            never;
