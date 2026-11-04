/** Safe parse notification. No submitted values, custom messages or exception text. */
export interface ParseEvent {
  readonly success: boolean;
  readonly failure?: 'validation' | 'limit' | 'cancelled' | 'exception';
  readonly issues: readonly { readonly code: string; readonly path: readonly (string | number)[] }[];
}
/** Cooperative context supplied only to explicitly asynchronous callbacks. */
export interface ValidationContext { readonly signal?: AbortSignal }
/** Per-parse controls. Hooks are synchronous and never stored globally. */
export interface ValidationOptions {
  readonly maxDepth?: number;
  readonly maxNodes?: number;
  readonly maxCollectionSize?: number;
  readonly maxIssues?: number;
  readonly maxConcurrency?: number;
  readonly signal?: AbortSignal;
  readonly onSuccess?: (event: ParseEvent) => void;
  readonly onError?: (event: ParseEvent) => void;
}
