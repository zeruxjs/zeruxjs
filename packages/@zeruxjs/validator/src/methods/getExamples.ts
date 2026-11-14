import type { ExamplesAction } from '../actions/index.js';
import type {
  BaseIssue,
  BaseSchema,
  BaseSchemaAsync,
  PipeItem,
  PipeItemAsync,
} from '../types/index.js';
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
          | ExamplesAction<unknown, readonly unknown[]>
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
          | ExamplesAction<unknown, readonly unknown[]>
        )[],
      ]
    >;

/**
 * Recursively concat type.
 */
type RecursiveConcat<
  TRootPipe extends readonly // prettier-ignore

  (| PipeItem<any, unknown, BaseIssue<unknown>>
     
    | PipeItemAsync<any, unknown, BaseIssue<unknown>>
  )[],
  TCollectedExamples extends unknown[] = [],
> = TRootPipe extends readonly [
  infer TFirstItem,
  ...infer TPipeRest extends readonly // prettier-ignore

  (| PipeItem<any, unknown, BaseIssue<unknown>>
     
    | PipeItemAsync<any, unknown, BaseIssue<unknown>>
  )[],
]
  ? TFirstItem extends
      | SchemaWithPipe<infer TNestedPipe>
      | SchemaWithPipeAsync<infer TNestedPipe>
    ? RecursiveConcat<
        TPipeRest,
        RecursiveConcat<TNestedPipe, TCollectedExamples>
      >
    : TFirstItem extends ExamplesAction<unknown, infer TCurrentExamples>
      ? RecursiveConcat<TPipeRest, [...TCollectedExamples, ...TCurrentExamples]>
      : RecursiveConcat<TPipeRest, TCollectedExamples>
  : TCollectedExamples;

/**
 * Infer examples type.
 */
export type InferExamples<TSchema extends Schema> = TSchema extends
  | SchemaWithPipe<infer TPipe>
  | SchemaWithPipeAsync<infer TPipe>
  ? Readonly<RecursiveConcat<TPipe>>
  : [];

/** Collect borrowed example values in depth-first pipeline order without validating, evaluating or redacting the examples.
 * @param {TSchema} schema - Borrowed declared schema; no runtime data is validated by this structural/metadata operation.
 * @returns {InferExamples<TSchema>} Declared borrowed metadata/child or fresh outer action/schema; no new disposal owner or permission boundary.
 * @beta
 */
// @__NO_SIDE_EFFECTS__
export function getExamples<const TSchema extends Schema>(
  schema: TSchema
): InferExamples<TSchema> {
  /** Fresh top-level collection; example values remain borrowed and unvalidated. */
  const examples: unknown[] = [];
  /** Visit explicit trusted nested pipelines and append their borrowed example values; cyclic graphs have no independent metadata traversal budget.
   * @param {Schema} schema - Borrowed declared schema; no runtime data is validated by this structural/metadata operation.
   * @returns {void} Appends borrowed examples to the local collection; trusted graph/property failures propagate.
   */
  function depthFirstCollect(schema: Schema): void {
    if ('pipe' in schema) {
      for (const item of schema.pipe) {
        if (item.kind === 'schema' && 'pipe' in item) {
          depthFirstCollect(item);
        } else if (item.kind === 'metadata' && item.type === 'examples') {
          // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
          examples.push(...item.examples);
        }
      }
    }
  }
  depthFirstCollect(schema);
  // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
  return examples;
}
