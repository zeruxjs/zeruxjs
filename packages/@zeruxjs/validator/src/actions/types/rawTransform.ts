import type {
  BaseIssue,
  Config,
  ErrorMessage,
  IssuePathItem,
  SuccessDataset,
} from '../../types/index.js';

/**
 * Raw transform issue interface.
 */
export interface RawTransformIssue<TInput> extends BaseIssue<TInput> {
  /**
   * Fixed private action issue category.
   */
  readonly kind: 'transformation';
  /**
   * Stable action discriminator for structured issue consumers.
   */
  readonly type: 'raw_transform';
}

/**
 * Raw transform issue info interface.
 */
export interface RawTransformIssueInfo<TInput> {
  /** Optional private diagnostic label; omission uses the action input label. */
  label?: string | undefined;
  /** Optional private issue input override, never safe client feedback. */
  input?: unknown | undefined;
  /** Optional private expectation text; output encoders/redaction remain separate. */
  expected?: string | undefined;
  /** Optional private rejected-value description, not public telemetry. */
  received?: string | undefined;
  /** Trusted private diagnostic text/callback; may inspect submitted values. */
  message?: ErrorMessage<RawTransformIssue<TInput>> | undefined;
  /** Optional private nonempty path retaining original input/value references. */
  path?: [IssuePathItem, ...IssuePathItem[]] | undefined;
}

/** Append one private issue through the current root budget/message policy; never retain or call this closure after callback settlement.
 * @param {RawTransformIssueInfo<TInput>} info - Optional trusted issue overrides; raw values/messages remain private.
 * @returns {void} Updates the current dataset or propagates budget/callback failures; no external audit or side effect is implied.
 */
export type RawTransformAddIssue<TInput> = (
  info?: RawTransformIssueInfo<TInput>
) => void;

/**
 * Raw transform context interface.
 */
export interface RawTransformContext<TInput> {
  /** Borrowed current private dataset; this trusted context is valid only during the explicit callback. */
  readonly dataset: SuccessDataset<TInput>;
  /** Current root budgets/signal/private message policy; do not retain per-parse context. */
  readonly config: Config<RawTransformIssue<TInput>>;
  /** Parse-owned issue insertion closure; obey root budgets and never call it after the callback settles. */
  readonly addIssue: RawTransformAddIssue<TInput>;
  /** Type-only never sentinel represented by null at runtime; it neither throws nor adds an issue by itself. */
  readonly NEVER: never;
}
