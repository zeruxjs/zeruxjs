import { _runSchema } from '../utils/_run.js';
import type {
  BaseIssue,
  BaseSchema,
  BaseSchemaAsync,
  Config,
  InferIssue,
} from '../types/index.js';
import { _getStandardProps } from '../utils/index.js';

/**
 * Overlay legacy local language/message/abort flags on a schema without accepting root execution controls. Per-request limits, hooks and signals belong on each parse call.
 *
 * @param {TSchema} schema - Borrowed trusted schema; wrapper construction starts no parse.
 * @param {Pick<Config<InferIssue<TSchema>>, 'lang' | 'message' | 'abortEarly' | 'abortPipeEarly'>} config - Borrowed compatible local flags; explicit execution-control keys reject.
 *
 * @returns {TSchema} Local wrapper preserving schema contracts; this does not allocate a global/tenant config registry.
 */
// @__NO_SIDE_EFFECTS__
export function config<
  const TSchema extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
>(
  schema: TSchema,
  config: Pick<
    Config<InferIssue<TSchema>>,
    'lang' | 'message' | 'abortEarly' | 'abortPipeEarly'
  >
): TSchema {
  // Root controls must not be hidden inside a shared schema wrapper.
  for (const key of [
    'maxDepth',
    'maxNodes',
    'maxCollectionSize',
    'maxIssues',
    'maxConcurrency',
    'signal',
    'onSuccess',
    'onError',
  ]) {
    if (Object.hasOwn(config, key)) {
      throw new TypeError('Execution controls belong on the parse call');
    }
  }
  return {
    ...schema,
    get '~standard'() {
      return _getStandardProps(this);
    },
    '~run'(dataset, config_) {
      return _runSchema(schema, dataset, { ...config_, ...config });
    },
  };
}
