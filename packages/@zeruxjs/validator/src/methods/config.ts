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
 * Changes the local configuration of a schema.
 *
 * @param schema The schema to configure.
 * @param config The parse configuration.
 *
 * @returns The configured schema.
 */
// @__NO_SIDE_EFFECTS__
export function config<
  const TSchema extends
  | BaseSchema<unknown, unknown, BaseIssue<unknown>>
  | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
>(schema: TSchema, config: Pick<Config<InferIssue<TSchema>>, 'lang' | 'message' | 'abortEarly' | 'abortPipeEarly'>): TSchema {
  for (const key of ['maxDepth', 'maxNodes', 'maxCollectionSize', 'maxIssues', 'maxConcurrency', 'signal', 'onSuccess', 'onError']) {
    if (Object.hasOwn(config, key)) throw new TypeError('Execution controls belong on the parse call');
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
