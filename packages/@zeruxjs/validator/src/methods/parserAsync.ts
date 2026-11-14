import type {
  BaseIssue,
  BaseSchema,
  BaseSchemaAsync,
  Config,
  InferIssue,
  InferOutput,
} from '../types/index.js';
import { parseAsync } from './parseAsync.js';

/**
 * The parser async interface.
 */
export interface ParserAsync<
  TSchema extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
  TConfig extends Config<InferIssue<TSchema>> | undefined,
> {
  /**
   * Parse one explicit input through the same root execution path as the corresponding parse-family API.
   * @param {unknown} input - Candidate bounded input, not a permission grant.
   * @returns {Promise<InferOutput<TSchema>>} Declared async parse outcome after actual execution cleanup.
   */
  (input: unknown): Promise<InferOutput<TSchema>>;
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
 * @returns {ParserAsync<TSchema, undefined>} Inert parse function; operational/budget/cancellation failures preserve their error semantics.
 */
export function parserAsync<
  const TSchema extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
>(schema: TSchema): ParserAsync<TSchema, undefined>;

/**
 * Build an inert reusable parse closure over borrowed schema/config references. Each call owns independent execution state; construction starts no work or resource lifecycle.
 *
 * @param {TSchema} schema - Borrowed trusted declared schema; callbacks are not sandboxed.
 * @param {TConfig} config - Borrowed parse controls/hooks; never store tenant-specific state in a shared parser.
 *
 * @returns {ParserAsync<TSchema, TConfig>} Inert configured parse function; config/schema values are not deep-copied or frozen.
 */
export function parserAsync<
  const TSchema extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
  const TConfig extends Config<InferIssue<TSchema>> | undefined,
>(schema: TSchema, config: TConfig): ParserAsync<TSchema, TConfig>;

/** Capture borrowed schema/config references without parsing or acquiring native resources.
 * @param {object} schema - Trusted declared schema whose callback behavior remains host-owned.
 * @param {Config<BaseIssue<unknown>>} config - Optional root parse configuration captured by reference.
 * @returns {Function} Reusable typed parse closure with schema/config metadata and no invented close API.
 */
// @__NO_SIDE_EFFECTS__
export function parserAsync(
  schema:
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
  config?: Config<
    InferIssue<
      | BaseSchema<unknown, unknown, BaseIssue<unknown>>
      | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>
    >
  >
): ParserAsync<
  | BaseSchema<unknown, unknown, BaseIssue<unknown>>
  | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
  Config<BaseIssue<unknown>> | undefined
> {
  /** Parse one explicit input using the captured trusted schema/config references.
   * @param {unknown} input - Candidate input scanned under this call’s execution budgets.
   * @returns {ReturnType<typeof parseAsync>} Corresponding parse result; root execution owns cancellation/drain.
   */
  const func: ParserAsync<
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
    Config<BaseIssue<unknown>> | undefined
  > = (input: unknown) => parseAsync(schema, input, config);
  // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
  func.schema = schema;
  // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
  func.config = config;
  return func;
}
