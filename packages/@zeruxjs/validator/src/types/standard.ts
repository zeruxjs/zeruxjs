/**
 * The Standard Schema properties interface.
 */
export interface StandardProps<TInput, TOutput> {
  /** Fixed Standard Schema V1 protocol marker; no claim of later-version conformance. */
  readonly version: 1;
  /** Fixed package-owned vendor label; not a tenant or authorization identifier. */
  readonly vendor: '@zeruxjs/validator';
  /** Explicitly validate one candidate through the owning adapter/root execution path.
   * @param {unknown} value - Private unknown candidate; not evaluated as source or used as an authorization identity.
   * @returns {StandardResult<TOutput> | Promise<StandardResult<TOutput>>} Declared output or adapter issues; callers must not expose private message/path content without sanitization.
   */
  readonly validate: (
    value: unknown
  ) => StandardResult<TOutput> | Promise<StandardResult<TOutput>>;
  /** Optional type-only input/output inference marker, normally absent from runtime adapters. */
  readonly types?: StandardTypes<TInput, TOutput> | undefined;
}

/**
 * The result interface of the validate function.
 */
export type StandardResult<TOutput> =
  | StandardSuccessResult<TOutput>
  | StandardFailureResult;

/**
 * The result interface if validation succeeds.
 */
export interface StandardSuccessResult<TOutput> {
  /** Declared parsed output or inference value; nested references may remain borrowed. */
  readonly value: TOutput;
  /** Structured validation failures; messages/paths are not automatically public-safe. */
  readonly issues?: undefined;
}

/**
 * The result interface if validation fails.
 */
export interface StandardFailureResult {
  /** Structured validation failures; messages/paths are not automatically public-safe. */
  readonly issues: readonly StandardIssue[];
}

/**
 * The issue interface of the failure output.
 */
export interface StandardIssue {
  /** Private/native adapter diagnostic text; the host must choose its public redaction policy. */
  readonly message: string;
  /** Optional structured issue path; runtime property names are not authorization scopes. */
  readonly path?: readonly (PropertyKey | StandardPathItem)[] | undefined;
}

/**
 * The path item interface of the issue.
 */
export interface StandardPathItem {
  /** Original property key for a structured Standard Schema path segment. */
  readonly key: PropertyKey;
}

/**
 * The Standard Schema types interface.
 */
export interface StandardTypes<TInput, TOutput> {
  /** Type-only accepted input inference, not a stored submitted value. */
  readonly input: TInput;
  /** Type-only parsed output inference; no validation is performed by this field. */
  readonly output: TOutput;
}
