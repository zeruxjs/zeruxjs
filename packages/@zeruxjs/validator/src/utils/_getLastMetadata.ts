import type { DescriptionAction, TitleAction } from '../actions/index.js';
import type { SchemaWithPipe, SchemaWithPipeAsync } from '../methods/index.js';
import type {
  BaseIssue,
  BaseSchema,
  BaseSchemaAsync,
  PipeItem,
  PipeItemAsync,
} from '../types/index.js';

/**
 * Metadata action type.
 */
type MetadataAction =
  | TitleAction<unknown, string>
  | DescriptionAction<unknown, string>;

/**
 * Schema type.
 */
type Schema =
  | BaseSchema<unknown, unknown, BaseIssue<unknown>>
  | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>
  | SchemaWithPipe<
      readonly [
        BaseSchema<unknown, unknown, BaseIssue<unknown>>,

        ...(PipeItem<any, unknown, BaseIssue<unknown>> | MetadataAction)[],
      ]
    >
  | SchemaWithPipeAsync<
      readonly [
        (
          | BaseSchema<unknown, unknown, BaseIssue<unknown>>
          | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>
        ),
        ...(
          | PipeItem<any, unknown, BaseIssue<unknown>>
          | PipeItemAsync<any, unknown, BaseIssue<unknown>>
          | MetadataAction
        )[],
      ]
    >;

/**
 * Returns the last top-level value of a given metadata type from a schema
 * using a breadth-first search that starts with the last item in the pipeline.
 *
 * @param {Schema} schema - Borrowed trusted schema/pipeline graph; metadata lookup does not parse input or invoke validation actions.
 * @param {'title' | 'description'} type - Explicit supported metadata field to inspect.
 *
 * @returns {string | undefined} Last direct matching value before searching nested pipelines; absent metadata stays undefined.
 *
 * @internal
 */
// @__NO_SIDE_EFFECTS__
export function _getLastMetadata(
  schema: Schema,
  type: 'title' | 'description'
): string | undefined {
  if ('pipe' in schema) {
    /** Nested pipelines retained in reverse source order only after direct metadata has been checked. */
    const nestedSchemas: Schema[] = [];
    // Prefer the last metadata at this pipeline level before recursively consulting nested schemas.
    for (let index = schema.pipe.length - 1; index >= 0; index--) {
      // Descending bounds select an existing item in the trusted pipeline tuple.
      /** Existing pipeline item; references stay borrowed and no action is executed. */
      const item = schema.pipe[index]!;
      if (item.kind === 'schema' && 'pipe' in item) {
        nestedSchemas.push(item);
      } else if (item.kind === 'metadata' && item.type === type) {
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        return item[type];
      }
    }
    // Search deferred nested pipelines in the recorded order, stopping at the first result.
    for (const nestedSchema of nestedSchemas) {
      /** Nested metadata result; undefined alone means continue searching. */
      const result = _getLastMetadata(nestedSchema, type);
      if (result !== undefined) {
        return result;
      }
    }
  }
}
