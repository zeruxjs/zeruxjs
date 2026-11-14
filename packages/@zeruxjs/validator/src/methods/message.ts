import { _runSchema } from '../utils/_run.js';
import type {
  BaseIssue,
  BaseSchema,
  BaseSchemaAsync,
  ErrorMessage,
  InferIssue,
} from '../types/index.js';
import { _getStandardProps } from '../utils/index.js';

/**
 * Overlay one local private diagnostic message policy without replacing root execution ownership. Custom message callbacks remain trusted code and may throw.
 *
 * @param {TSchema} schema - Borrowed declared schema to wrap.
 * @param {ErrorMessage<InferIssue<TSchema>>} message_ - Private diagnostic text or trusted synchronous callback; not public HTML.
 *
 * @returns {TSchema} Inert message wrapper; parsing still uses the root budgets, signals and cleanup.
 */
// @__NO_SIDE_EFFECTS__
export function message<
  const TSchema extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
>(schema: TSchema, message_: ErrorMessage<InferIssue<TSchema>>): TSchema {
  return {
    ...schema,
    get '~standard'() {
      return _getStandardProps(this);
    },
    '~run'(dataset, config) {
      return _runSchema(schema, dataset, { ...config, message: message_ });
    },
  };
}
