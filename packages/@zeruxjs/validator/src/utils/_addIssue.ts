import { countIssue } from './_run.js';
import {
  getGlobalMessage,
  getSchemaMessage,
  getSpecificMessage,
} from '../storages/index.js';
import type {
  BaseIssue,
  BaseSchema,
  BaseSchemaAsync,
  BaseTransformation,
  BaseTransformationAsync,
  BaseValidation,
  BaseValidationAsync,
  Config,
  ErrorMessage,
  InferInput,
  InferIssue,
  IssuePathItem,
  OutputDataset,
  UnknownDataset,
} from '../types/index.js';
import { _stringify } from './_stringify.js';

/**
 * Context type.
 */
type Context =
  | BaseSchema<unknown, unknown, BaseIssue<unknown>>
  | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>
  | BaseValidation<any, unknown, BaseIssue<unknown>>
  | BaseValidationAsync<any, unknown, BaseIssue<unknown>>
  | BaseTransformation<any, unknown, BaseIssue<unknown>>
  | BaseTransformationAsync<any, unknown, BaseIssue<unknown>>;

/**
 * Other interface.
 */
interface Other<TContext extends Context> {
  /** Optional private rejected-input override, preserving explicit undefined when supplied. */
  input?: unknown | undefined;
  /** Optional private expectation text overriding declared schema expectation. */
  expected?: string | undefined;
  /** Optional private received-value text instead of automatic value description. */
  received?: string | undefined;
  /** Optional trusted private message or callback; exceptions remain operational failures. */
  message?: ErrorMessage<InferIssue<TContext>> | undefined;
  /** Optional nonempty private path segments; dynamic keys require redaction before external feedback. */
  path?: [IssuePathItem, ...IssuePathItem[]] | undefined;
  /** Optional nonempty nested raw issues retaining private input/message details. */
  issues?:
    | [BaseIssue<InferInput<TContext>>, ...BaseIssue<InferInput<TContext>>[]]
    | undefined;
}

/** Charge the current parse issue budget before constructing one private raw issue. Preserve declared message precedence and typed-dataset transitions; raw values/messages are not a public response format.
 * @param {TContext & {
    expects?: string | null;
    requirement?: unknown;
    message?:
    | ErrorMessage<Extract<InferIssue<TContext>, { type: TContext['type'] }>>
    | undefined;
  }} context - Trusted schema/action context providing fixed kind/type/reference and optional requirement/message.
 * @param {string | null} context.expects - Optional declared expectation text, not a public escaping policy.
 * @param {unknown} context.requirement - Optional declared validation requirement retained privately.
 * @param {ErrorMessage} context.message - Optional trusted context-specific message or callback.
 * @param {string} label - Fixed issue label used only to build private diagnostic text.
 * @param {UnknownDataset | OutputDataset<unknown, BaseIssue<unknown>>} dataset - Current internal dataset retaining rejected input and cumulative issues.
 * @param {Config<InferIssue<TContext>>} config - Current parse configuration, language/message policy and owned issue counter.
 * @param {Other<TContext>} other - Optional explicit private issue input/path/nested issue/message overrides.
 * @returns {void} Mutates the current private dataset after budget checks; custom message exceptions retain operational meaning.
 * @internal
 */
export function _addIssue<const TContext extends Context>(
  context: TContext & {
    /** Optional declared schema expectation text; this is not an output escaping policy. */
    expects?: string | null;
    /** Optional declared validation requirement retained on the private raw issue. */
    requirement?: unknown;
    /** Optional trusted private message or callback; exceptions remain operational failures. */
    message?:
      | ErrorMessage<Extract<InferIssue<TContext>, { type: TContext['type'] }>>
      | undefined;
  },
  label: string,
  dataset: UnknownDataset | OutputDataset<unknown, BaseIssue<unknown>>,
  config: Config<InferIssue<TContext>>,
  other?: Other<TContext>
): void {
  countIssue(config);
  // Get expected and received string
  /** Private rejected input selected from explicit override or current dataset; never a default public log field. */
  const input = other && 'input' in other ? other.input : dataset.value;
  /** Private expectation diagnostic selected by override then declared schema expectation. */
  const expected = other?.expected ?? context.expects ?? null;
  /** Private received-value description; public HTTP serializers never echo it. */
  const received = other?.received ?? _stringify(input);

  // Create issue object
  // Hint: The issue is deliberately not constructed with the spread operator
  // for performance reasons
  /** Private raw structured issue including input, requirement and nested causes; sanitize through explicit client feedback APIs. */
  const issue: BaseIssue<unknown> = {
    kind: context.kind,
    code: `${context.kind}.${context.type}`,
    type: context.type,
    input,
    expected,
    received,
    message: `Invalid ${label}: ${
      expected ? `Expected ${expected} but r` : 'R'
    }eceived ${received}`,
    requirement: context.requirement,
    path: other?.path,
    issues: other?.issues,
    lang: config.lang,
    abortEarly: config.abortEarly,
    abortPipeEarly: config.abortPipeEarly,
  };

  // Check if context is a schema
  /** Whether this failure invalidates the dataset’s typed status rather than only refining a typed value. */
  const isSchema = context.kind === 'schema';

  // Get custom issue message
  /** Explicit override/context/specific/schema/config/global message precedence; trusted callbacks may throw. */
  const message =
    other?.message ??
    context.message ??
    getSpecificMessage(context.reference, issue.lang) ??
    (isSchema ? getSchemaMessage(issue.lang) : null) ??
    config.message ??
    getGlobalMessage(issue.lang);

  // If custom message if specified, override default message
  if (message !== undefined) {
    // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
    issue.message =
      typeof message === 'function'
        ? // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
          message(issue)
        : message;
  }

  // If context is a schema, set typed to `false`
  if (isSchema) {
    dataset.typed = false;
  }

  // Add issue to dataset
  if (dataset.issues) {
    dataset.issues.push(issue);
  } else {
    // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
    dataset.issues = [issue];
  }
}
