import type {
  BaseIssue,
  BaseSchema,
  ErrorMessage,
  OutputDataset,
} from '../types/index.js';
import {
  _addIssue,
  _getStandardProps,
  _joinExpects,
  _stringify,
} from '../utils/index.js';

/**
 * Enum interface.
 */
export interface Enum {
  [key: string]: string | number;
}

/**
 * Enum values type.
 */
export type EnumValues<TEnum extends Enum> = {
  [TKey in keyof TEnum]: TKey extends number
    ? TEnum[TKey] extends string
      ? TEnum[TEnum[TKey]] extends TKey
        ? never
        : TEnum[TKey]
      : TEnum[TKey]
    : TKey extends 'NaN' | 'Infinity' | '-Infinity'
      ? TEnum[TKey] extends string
        ? TEnum[TEnum[TKey]] extends number
          ? never
          : TEnum[TKey]
        : TEnum[TKey]
      : TKey extends `+${number}`
        ? TEnum[TKey]
        : TKey extends `${infer TNumber extends number}`
          ? TEnum[TKey] extends string
            ? TEnum[TEnum[TKey]] extends TNumber
              ? never
              : TEnum[TKey]
            : TEnum[TKey]
          : TEnum[TKey];
}[keyof TEnum];

/**
 * Enum issue interface.
 */
export interface EnumIssue extends BaseIssue<unknown> {
  /**
   * Fixed schema issue category; raw rejected values remain private.
   */
  readonly kind: 'schema';
  /**
   * Stable discriminator used by structured issue consumers.
   */
  readonly type: 'enum';
  /**
   * Private diagnostic expectation, not a coercion, escaping or authorization policy.
   */
  readonly expected: string;
}

/**
 * Enum schema interface.
 */
export interface EnumSchema<
  TEnum extends Enum,
  TMessage extends ErrorMessage<EnumIssue> | undefined,
> extends BaseSchema<EnumValues<TEnum>, EnumValues<TEnum>, EnumIssue> {
  /**
   * Stable schema discriminator used by structured issue consumers.
   */
  readonly type: 'enum';
  /**
   * Authored constructor identity; no runtime package discovery occurs.
   */
  readonly reference: typeof enum_;
  /**
   * Borrowed trusted enum dictionary; captured option values are built separately.
   */
  readonly enum: TEnum;
  /**
   * Captured allowed values; includes uses SameValueZero comparison without coercion.
   */
  readonly options: EnumValues<TEnum>[];
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Capture enum values while excluding TypeScript numeric reverse mappings; explicit validation uses includes equality. Construction does not parse input or authorize its source.
 * @param {TEnum} enum__ - Borrowed trusted enum dictionary; enumeration/metadata getters remain host code.
 * @returns {EnumSchema<TEnum, undefined>} Inert schema retaining its declared references and message policy; no external resource owner is allocated.
 */
export function enum_<const TEnum extends Enum>(
  enum__: TEnum
): EnumSchema<TEnum, undefined>;

/** Capture enum values while excluding TypeScript numeric reverse mappings; explicit validation uses includes equality. Construction does not parse input or authorize its source.
 * @param {TEnum} enum__ - Borrowed trusted enum dictionary; enumeration/metadata getters remain host code.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; raw errors may retain input.
 * @returns {EnumSchema<TEnum, TMessage>} Inert schema retaining its declared references and message policy; no external resource owner is allocated.
 */
export function enum_<
  const TEnum extends Enum,
  const TMessage extends ErrorMessage<EnumIssue> | undefined,
>(enum__: TEnum, message: TMessage): EnumSchema<TEnum, TMessage>;

/** Capture enum values while excluding TypeScript numeric reverse mappings; explicit validation uses includes equality. Construction does not parse input or authorize its source.
 * @param {Enum} enum__ - Borrowed trusted enum dictionary; enumeration/metadata getters remain host code.
 * @param {ErrorMessage<EnumIssue>} message - Optional trusted private diagnostic text/callback; raw errors may retain input.
 * @returns {EnumSchema<Enum, ErrorMessage<EnumIssue> | undefined>} Inert schema retaining its declared references and message policy; no external resource owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function enum_(
  enum__: Enum,
  message?: ErrorMessage<EnumIssue>
): EnumSchema<Enum, ErrorMessage<EnumIssue> | undefined> {
  /** Captured allowed enum values after removing numeric reverse mappings; not an authorization allowlist. */
  const options: EnumValues<Enum>[] = [];
  for (const key in enum__) {
    if (
      `${+key}` !== key ||
      typeof enum__[key] !== 'string' ||
      !Object.is(enum__[enum__[key]], +key)
    ) {
      // The enumerated key belongs to the trusted enum dictionary.
      options.push(enum__[key]!);
    }
  }
  return {
    kind: 'schema',
    type: 'enum',
    reference: enum_,
    expects: _joinExpects(options.map(_stringify), '|'),
    async: false,
    enum: enum__,
    options,
    message,
    /** Adapt explicit validation to the bounded shared root execution path.
     * @returns {object} Inert Standard Schema V1 adapter.
     */
    get '~standard'() {
      return _getStandardProps(this);
    },
    /** Capture enum values while excluding TypeScript numeric reverse mappings; explicit validation uses includes equality. Raw issues remain private and operational failures propagate.
     * @param {import('../types/index.js').UnknownDataset} dataset - Private current candidate; this schema does not grant permissions or sanitize output.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root budgets, cancellation, abort flags and diagnostic policy.
     * @returns {OutputDataset<unknown, BaseIssue<unknown>>} Declared output or private issue dataset; child result identity follows its schema.
     */
    '~run'(dataset, config) {
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      if (this.options.includes(dataset.value)) {
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        dataset.typed = true;
      } else {
        _addIssue(this, 'type', dataset, config);
      }
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      return dataset as OutputDataset<string | number, EnumIssue>;
    },
  };
}

export { enum_ as enum };
