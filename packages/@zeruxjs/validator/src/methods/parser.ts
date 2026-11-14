import type {
  BaseIssue,
  BaseSchema,
  Config,
  InferIssue,
  InferOutput,
} from '../types/index.js';
import { parse } from './parse.js';

/**
 * The parser interface.
 */
export interface Parser<
  TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  TConfig extends Config<InferIssue<TSchema>> | undefined,
> {
  /**
   * Parse one explicit input through the same root execution path as the corresponding parse-family API.
   * @param {unknown} input - Candidate bounded input, not a permission grant.
   * @returns {InferOutput<TSchema>} Declared parse outcome; async interfaces wrap it in their declared Promise.
   */
  (input: unknown): InferOutput<TSchema>;
  /**
   * The schema to be used.
   */
  readonly schema: TSchema;
  /**
   * The parser configuration.
   */
  readonly config: TConfig;
}

/**
 * Build an inert reusable parse closure over borrowed schema/config references. Each call owns independent execution state; construction starts no work or resource lifecycle.
 *
 * @param {TSchema} schema - Borrowed trusted declared schema; callbacks are not sandboxed.
 *
 * @returns {Parser<TSchema, undefined>} Inert parse function; operational/budget/cancellation failures preserve their error semantics.
 */
export function parser<
  const TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
>(schema: TSchema): Parser<TSchema, undefined>;

/**
 * Build an inert reusable parse closure over borrowed schema/config references. Each call owns independent execution state; construction starts no work or resource lifecycle.
 *
 * @param {TSchema} schema - Borrowed trusted declared schema; callbacks are not sandboxed.
 * @param {TConfig} config - Borrowed parse controls/hooks; never store tenant-specific state in a shared parser.
 *
 * @returns {Parser<TSchema, TConfig>} Inert configured parse function; config/schema values are not deep-copied or frozen.
 */
export function parser<
  const TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  const TConfig extends Config<InferIssue<TSchema>> | undefined,
>(schema: TSchema, config: TConfig): Parser<TSchema, TConfig>;

/** Capture borrowed schema/config references without parsing or acquiring native resources.
 * @param {object} schema - Trusted declared schema whose callback behavior remains host-owned.
 * @param {Config<BaseIssue<unknown>>} config - Optional root parse configuration captured by reference.
 * @returns {Function} Reusable typed parse closure with schema/config metadata and no invented close API.
 */
// @__NO_SIDE_EFFECTS__
export function parser(
  schema: BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  config?: Config<InferIssue<BaseSchema<unknown, unknown, BaseIssue<unknown>>>>
): Parser<
  BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  Config<BaseIssue<unknown>> | undefined
> {
  /** Parse one explicit input using the captured trusted schema/config references.
   * @param {unknown} input - Candidate input scanned under this call’s execution budgets.
   * @returns {ReturnType<typeof parse>} Corresponding parse result; root execution owns cancellation/drain.
   */
  const func: Parser<
    BaseSchema<unknown, unknown, BaseIssue<unknown>>,
    Config<BaseIssue<unknown>> | undefined
  > = (input: unknown) => parse(schema, input, config);
  // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
  func.schema = schema;
  // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
  func.config = config;
  return func;
}
