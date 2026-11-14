import type {
  BaseIssue,
  BaseSchema,
  ErrorMessage,
  OutputDataset,
} from '../types/index.js';
import { _addIssue, _getStandardProps, _stringify } from '../utils/index.js';

/**
 * Literal type.
 */
export type Literal = bigint | boolean | number | string | symbol;

/**
 * Literal issue interface.
 */
export interface LiteralIssue extends BaseIssue<unknown> {
  /**
   * Fixed schema failure category; raw candidate values remain private.
   */
  readonly kind: 'schema';
  /**
   * Stable discriminator for structured issue consumers.
   */
  readonly type: 'literal';
  /**
   * Private diagnostic expectation; never sanitized output or a permission grant.
   */
  readonly expected: string;
}

/**
 * Literal schema interface.
 */
export interface LiteralSchema<
  TLiteral extends Literal,
  TMessage extends ErrorMessage<LiteralIssue> | undefined,
> extends BaseSchema<TLiteral, TLiteral, LiteralIssue> {
  /**
   * Stable schema discriminator used by structured issue consumers.
   */
  readonly type: 'literal';
  /**
   * Authored constructor identity; no runtime package discovery occurs.
   */
  readonly reference: typeof literal;
  /**
   * Primitive used for strict equality; no coercion or source evaluation.
   */
  readonly literal: TLiteral;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Accept only strict equality with the configured primitive; NaN does not match itself and signed zero values compare equal. Construction does not parse input or authorize its source.
 * @param {TLiteral} literal_ - Explicit primitive comparison value; diagnostics are private and unescaped.
 * @returns {LiteralSchema<TLiteral, undefined>} Inert schema retaining its declared references and message policy; no external resource owner is allocated.
 */
export function literal<const TLiteral extends Literal>(
  literal_: TLiteral
): LiteralSchema<TLiteral, undefined>;

/** Accept only strict equality with the configured primitive; NaN does not match itself and signed zero values compare equal. Construction does not parse input or authorize its source.
 * @param {TLiteral} literal_ - Explicit primitive comparison value; diagnostics are private and unescaped.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; raw errors may retain input.
 * @returns {LiteralSchema<TLiteral, TMessage>} Inert schema retaining its declared references and message policy; no external resource owner is allocated.
 */
export function literal<
  const TLiteral extends Literal,
  const TMessage extends ErrorMessage<LiteralIssue> | undefined,
>(literal_: TLiteral, message: TMessage): LiteralSchema<TLiteral, TMessage>;

/** Accept only strict equality with the configured primitive; NaN does not match itself and signed zero values compare equal. Construction does not parse input or authorize its source.
 * @param {Literal} literal_ - Explicit primitive comparison value; diagnostics are private and unescaped.
 * @param {ErrorMessage<LiteralIssue>} message - Optional trusted private diagnostic text/callback; raw errors may retain input.
 * @returns {LiteralSchema<Literal, ErrorMessage<LiteralIssue> | undefined>} Inert schema retaining its declared references and message policy; no external resource owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function literal(
  literal_: Literal,
  message?: ErrorMessage<LiteralIssue>
): LiteralSchema<Literal, ErrorMessage<LiteralIssue> | undefined> {
  return {
    kind: 'schema',
    type: 'literal',
    reference: literal,
    expects: _stringify(literal_),
    async: false,
    literal: literal_,
    message,
    /** Adapt explicit validation to the bounded shared root execution path.
     * @returns {object} Inert Standard Schema V1 adapter.
     */
    get '~standard'() {
      return _getStandardProps(this);
    },
    /** Accept only strict equality with the configured primitive; NaN does not match itself and signed zero values compare equal. Raw issues remain private and operational failures propagate.
     * @param {import('../types/index.js').UnknownDataset} dataset - Private current candidate; this schema does not grant permissions or sanitize output.
     * @param {import('../types/index.js').Config<import('../types/index.js').BaseIssue<unknown>>} config - Shared root budgets, cancellation, abort flags and diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} Declared output or private issue dataset; child result identity follows its schema.
     */
    '~run'(dataset, config) {
      if (dataset.value === this.literal) {
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        dataset.typed = true;
      } else {
        _addIssue(this, 'type', dataset, config);
      }
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      return dataset as OutputDataset<Literal, LiteralIssue>;
    },
  };
}
