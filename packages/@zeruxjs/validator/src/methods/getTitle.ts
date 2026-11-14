import type { TitleAction } from '../actions/title.js';
import type {
  BaseIssue,
  BaseSchema,
  BaseSchemaAsync,
  PipeItem,
  PipeItemAsync,
} from '../types/index.js';
import { _getLastMetadata } from '../utils/index.js';
import type { SchemaWithPipe, SchemaWithPipeAsync } from './index.js';

/**
 * Schema type.
 */
type Schema =
  | BaseSchema<unknown, unknown, BaseIssue<unknown>>
  | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>
  | SchemaWithPipe<
      readonly [
        BaseSchema<unknown, unknown, BaseIssue<unknown>>,
        ...(
          | PipeItem<any, unknown, BaseIssue<unknown>>
          | TitleAction<unknown, string>
        )[],
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
          | TitleAction<unknown, string>
        )[],
      ]
    >;

/**
 * Returns the title of the schema.
 *
 * If multiple titles are defined, the last one of the highest level is
 * returned. If no title is defined, `undefined` is returned.
 *
 * @param {Schema} schema - Borrowed trusted schema graph; reads structured metadata without parsing input or executing validation actions.
 *
 * @returns {string | undefined} Last matching title at the highest available level; returned text remains unescaped for its eventual rendering context.
 *
 * @beta
 */
// TODO: Investigate if return type can be strongly typed
// @__NO_SIDE_EFFECTS__
export function getTitle(schema: Schema): string | undefined {
  return _getLastMetadata(schema, 'title');
}
