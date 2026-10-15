import type {
  BaseIssue,
  BaseSchema,
  BaseSchemaAsync,
  ErrorMessage,
  InferIssue,
  MaybeReadonly,
  ObjectEntries,
  ObjectEntriesAsync,
  OptionalEntrySchema,
  OptionalEntrySchemaAsync,
} from '../../types/index.js';
import type { LooseObjectIssue } from './looseObject.js';
import type { LooseObjectSchema } from '../looseObject.js';
import type { LooseObjectSchemaAsync } from '../looseObjectAsync.js';
import type { ObjectIssue } from './object.js';
import type { ObjectSchema } from '../object.js';
import type { ObjectSchemaAsync } from '../objectAsync.js';
import type { ObjectWithRestIssue } from './objectWithRest.js';
import type { ObjectWithRestSchema } from '../objectWithRest.js';
import type { ObjectWithRestSchemaAsync } from '../objectWithRestAsync.js';
import type { StrictObjectIssue } from './strictObject.js';
import type { StrictObjectSchema } from '../strictObject.js';
import type { StrictObjectSchemaAsync } from '../strictObjectAsync.js';
import type { variant } from '../variant.js';
import type { variantAsync } from '../variantAsync.js';

/**
 * Variant issue interface.
 */
export interface VariantIssue extends BaseIssue<unknown> {
  /**
   * The issue kind.
   */
  readonly kind: 'schema';
  /**
   * The issue type.
   */
  readonly type: 'variant';
  /**
   * The expected property.
   */
  readonly expected: string;
}

/**
 * Variant option schema interface.
 */
export interface VariantOptionSchema<TKey extends string>
  extends BaseSchema<unknown, unknown, VariantIssue | BaseIssue<unknown>> {
  readonly type: 'variant';
  readonly reference: typeof variant;
  readonly key: string;
  readonly options: VariantOptions<TKey>;
  readonly message: ErrorMessage<VariantIssue> | undefined;
}

/**
 * Variant option schema async interface.
 */
export interface VariantOptionSchemaAsync<TKey extends string>
  extends BaseSchemaAsync<unknown, unknown, VariantIssue | BaseIssue<unknown>> {
  readonly type: 'variant';
  readonly reference: typeof variant | typeof variantAsync;
  readonly key: string;
  readonly options: VariantOptionsAsync<TKey>;
  readonly message: ErrorMessage<VariantIssue> | undefined;
}

/**
 * Variant object entries type.
 */
type VariantObjectEntries<TKey extends string> = Record<
  TKey,
  BaseSchema<unknown, unknown, BaseIssue<unknown>> | OptionalEntrySchema
> &
  ObjectEntries;

/**
 * Variant object entries async type.
 */
type VariantObjectEntriesAsync<TKey extends string> = Record<
  TKey,
  | BaseSchema<unknown, unknown, BaseIssue<unknown>>
  | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>
  | OptionalEntrySchema
  | OptionalEntrySchemaAsync
> &
  ObjectEntriesAsync;

/**
 * Variant option type.
 */
type VariantOption<TKey extends string> =
  | LooseObjectSchema<
    VariantObjectEntries<TKey>,
    ErrorMessage<LooseObjectIssue> | undefined
  >
  | ObjectSchema<
    VariantObjectEntries<TKey>,
    ErrorMessage<ObjectIssue> | undefined
  >
  | ObjectWithRestSchema<
    VariantObjectEntries<TKey>,
    BaseSchema<unknown, unknown, BaseIssue<unknown>>,
    ErrorMessage<ObjectWithRestIssue> | undefined
  >
  | StrictObjectSchema<
    VariantObjectEntries<TKey>,
    ErrorMessage<StrictObjectIssue> | undefined
  >
  | VariantOptionSchema<TKey>;

/**
 * Variant option async type.
 */
type VariantOptionAsync<TKey extends string> =
  | LooseObjectSchemaAsync<
    VariantObjectEntriesAsync<TKey>,
    ErrorMessage<LooseObjectIssue> | undefined
  >
  | ObjectSchemaAsync<
    VariantObjectEntriesAsync<TKey>,
    ErrorMessage<ObjectIssue> | undefined
  >
  | ObjectWithRestSchemaAsync<
    VariantObjectEntriesAsync<TKey>,
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
    ErrorMessage<ObjectWithRestIssue> | undefined
  >
  | StrictObjectSchemaAsync<
    VariantObjectEntriesAsync<TKey>,
    ErrorMessage<StrictObjectIssue> | undefined
  >
  | VariantOptionSchemaAsync<TKey>;

/**
 * Variant options type.
 */
export type VariantOptions<TKey extends string> = MaybeReadonly<
  VariantOption<TKey>[]
>;

/**
 * Variant options async type.
 */
export type VariantOptionsAsync<TKey extends string> = MaybeReadonly<
  (VariantOption<TKey> | VariantOptionAsync<TKey>)[]
>;

/**
 * Infer variant issue type.
 */
export type InferVariantIssue<
  TOptions extends VariantOptions<string> | VariantOptionsAsync<string>,
> = Exclude<
  InferIssue<TOptions[number]>,
  { type: 'loose_object' | 'object' | 'object_with_rest' }
>;
