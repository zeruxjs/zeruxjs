/** Safe parse notification. No submitted values, custom messages or exception text. */
export interface ParseEvent {
  /** True only for an issue-free parse notification; never includes validated data. */
  readonly success: boolean;
  /** Fixed validation/limit/cancelled/exception class on failed notifications. */
  readonly failure?: 'validation' | 'limit' | 'cancelled' | 'exception';
  /** Value-free stable codes and redacted paths; no custom messages, exception text or output. */
  readonly issues: readonly {
    /** Stable issue category, normally kind.type. */
    readonly code: string;
    /** Numeric array indexes plus fixed field redaction markers, never raw private keys. */
    readonly path: readonly (string | number)[];
  }[];
}
/** Cooperative context supplied only to explicitly asynchronous callbacks. */
export interface ValidationContext {
  /** Optional cooperative initiating signal; started callbacks must settle before cleanup completes. */
  readonly signal?: AbortSignal;
}
/** Per-parse controls. Hooks are synchronous and never stored globally. */
export interface ValidationOptions {
  /** Per-call input/schema depth, default 64, hard maximum 128. */
  readonly maxDepth?: number;
  /** Per-call input scan and separately schema/callback work, default 10000, hard maximum 100000. */
  readonly maxNodes?: number;
  /** Per-call collection/own-field cap, default 1000, hard maximum 10000. */
  readonly maxCollectionSize?: number;
  /** Cumulative generated/reused issues across speculative branches, default 100, hard maximum 1000. */
  readonly maxIssues?: number;
  /** Built-in async leaf-callback concurrency, default 8, hard maximum 32; not a distributed quota. */
  readonly maxConcurrency?: number;
  /** Optional cooperative initiating signal; started callbacks must settle before cleanup completes. */
  readonly signal?: AbortSignal;
  /** Synchronous per-parse value-free success notification after cleanup; returned thenables/throws are explicit failures. */
  readonly onSuccess?: (event: ParseEvent) => void;
  /** Synchronous per-parse value-free failure notification after cleanup; never automatically called after a success-hook failure. */
  readonly onError?: (event: ParseEvent) => void;
}
