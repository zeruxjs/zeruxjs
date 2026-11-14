import type { Brand, ReadonlyAction } from '../../actions/index.js';
import type {
  SchemaWithPipe,
  SchemaWithPipeAsync,
} from '../../methods/index.js';
import type {
  BaseIssue,
  BaseSchema,
  BaseSchemaAsync,
  InferInput,
  InferOutput,
  MarkOptional,
  Prettify,
} from '../../types/index.js';

/**
 * Record issue interface.
 */
export interface RecordIssue extends BaseIssue<unknown> {
  /**
   * Fixed schema failure category; raw rejected input remains private.
   */
  readonly kind: 'schema';
  /**
   * Stable record discriminator for structured issue consumers.
   */
  readonly type: 'record';
  /**
   * Private object-type diagnostic; no own-key authorization or output escaping is implied.
   */
  readonly expected: 'Object';
}

/**
 * Distinguish finite literal keys from broad/brand key types for optional-property inference.
 */
type IsLiteral<TKey extends string | number | symbol> = string extends TKey
  ? false
  : number extends TKey
    ? false
    : symbol extends TKey
      ? false
      : TKey extends Brand<string | number | symbol>
        ? false
        : true;

/**
 * Select finite literal record keys whose presence is not guaranteed by enumeration.
 */
type OptionalKeys<TObject extends Record<string | number | symbol, unknown>> = {
  [TKey in keyof TObject]: IsLiteral<TKey> extends true ? TKey : never;
}[keyof TObject];

/**
 * Mark finite literal keys optional without changing broad dictionary key behavior.
 *
 * Hint: We mark an entry as optional if we detect that its key is a literal
 * type. The reason for this is that it is not technically possible to detect
 * missing literal keys without restricting the key schema to `string`, `enum`
 * and `picklist`. However, if `enum` and `picklist` are used, it is better to
 * use `object` with `entriesFromList` because it already covers the needed
 * functionality. This decision also reduces the bundle size of `record`,
 * because it only needs to check the entries of the input and not any missing
 * keys.
 */
type WithQuestionMarks<
  TObject extends Record<string | number | symbol, unknown>,
> = MarkOptional<TObject, OptionalKeys<TObject>>;

/**
 * Reflect an explicitly present readonly child action in the inferred outer record type; this type alone does not freeze runtime objects.
 */
type WithReadonly<
  TValue extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
  TObject extends WithQuestionMarks<Record<string | number | symbol, unknown>>,
> = TValue extends
  | SchemaWithPipe<infer TPipe>
  | SchemaWithPipeAsync<infer TPipe>
  ? ReadonlyAction<any> extends TPipe[number]
    ? Readonly<TObject>
    : TObject
  : TObject;

/**
 * Infer record input type.
 */
export type InferRecordInput<
  TKey extends
    | BaseSchema<string, string | number | symbol, BaseIssue<unknown>>
    | BaseSchemaAsync<string, string | number | symbol, BaseIssue<unknown>>,
  TValue extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
> = Prettify<WithQuestionMarks<Record<InferInput<TKey>, InferInput<TValue>>>>;

/**
 * Infer record output type.
 */
export type InferRecordOutput<
  TKey extends
    | BaseSchema<string, string | number | symbol, BaseIssue<unknown>>
    | BaseSchemaAsync<string, string | number | symbol, BaseIssue<unknown>>,
  TValue extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
> = Prettify<
  WithReadonly<
    TValue,
    WithQuestionMarks<Record<InferOutput<TKey>, InferOutput<TValue>>>
  >
>;
