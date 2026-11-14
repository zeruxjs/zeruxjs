import { safeCode, type ClientIssue } from './client.js';
export type { ClientIssue } from './client.js';
import type { BaseIssue, BaseSchema, BaseSchemaAsync } from '../types/index.js';
export type InputSchema =
  | BaseSchema<unknown, unknown, BaseIssue<unknown>>
  | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>;
export type InputStatus = 400 | 408 | 413 | 415 | 422 | 429;
/** Fixed public messages keyed only by supported statuses, independent of internal diagnostics. */
const messages: Record<InputStatus, string> = {
  400: 'Invalid request input',
  408: 'Request body timed out',
  413: 'Input limits exceeded',
  415: 'Unsupported content type',
  422: 'Validation failed',
  429: 'Too many active body readers',
};

/** Public response is sanitized independently of the trusted internal message/cause. */
export class HttpValidationError extends Error {
  /** Retain trusted internal diagnostics separately from the public sanitized response. Never serialize the Error or cause object directly to a client.
   * @param {InputStatus} status - One supported input-validation HTTP status only.
   * @param {string} message - Private internal diagnostic message, not the public error text.
   * @param {readonly ClientIssue[]} issues - Optional client-safe bounded issue descriptors; raw BaseIssue values stay private.
   * @param {ErrorOptions} options - Optional native ErrorOptions retaining the private underlying cause.
   */
  constructor(
    readonly status: InputStatus,
    message: string,
    readonly issues?: readonly ClientIssue[],
    options?: ErrorOptions
  ) {
    super(message, options);
    if (!Object.hasOwn(messages, status)) {
      throw new TypeError('Invalid validation HTTP status');
    }
    this.name = 'HttpValidationError';
  }
  /** Serialize only fixed public status text, at most twenty generic issues and bounded paths/codes. Internal message/cause and custom issue messages are never returned.
   * @returns {Response} No-store JSON response containing only the declared public feedback representation.
   */
  toResponse(): Response {
    return Response.json(
      {
        error: messages[this.status],
        issues: (this.issues ?? []).slice(0, 20).map((issue) => ({
          path: typeof issue.path === 'string' ? issue.path.slice(0, 300) : '',
          message: 'Invalid input',
          code: safeCode(issue.code),
        })),
      },
      { status: this.status, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

/** Follow at most sixty-four known schema wrapper/first-pipe references to identify declared public path fields. Never execute a schema callback.
 * @param {any} schema - Trusted schema metadata supplied by the validation host.
 * @returns {any} Reached schema metadata or undefined on traversal exhaustion.
 */
function unwrap(schema: any): any {
  // Bound wrapper traversal even for unusual trusted custom schema metadata.
  for (let steps = 0; steps < 64; steps++) {
    if (schema?.wrapped) {
      schema = schema.wrapped;
    } else if (schema?.pipe?.length) {
      schema = schema.pipe[0];
    } else {
      return schema;
    }
  }
  return undefined;
}

/** Keep schema-declared field names and numeric array indexes while redacting dynamic record/map keys. Raw values, custom messages and nested private issue bodies are excluded.
 * @param {InputSchema} schema - Trusted input schema whose declared fields may appear publicly.
 * @param {readonly BaseIssue<unknown>[]} issues - Private validation issues; only bounded path/code metadata is selected.
 * @returns {ClientIssue[]} At most twenty generic public descriptors with at most 300-character paths.
 */
export function clientIssues(
  schema: InputSchema,
  issues: readonly BaseIssue<unknown>[]
): ClientIssue[] {
  return issues.slice(0, 20).map((issue) => {
    let current: any = schema;
    /** At most sixty-four selected path segments; dynamic field names become fixed redaction markers. */
    const segments = (issue.path ?? []).slice(0, 64).map((item) => {
      current = unwrap(current);
      if (item.type === 'array' && typeof item.key === 'number') {
        current = current?.item ?? current?.items?.[item.key] ?? current?.rest;
        return String(item.key);
      }
      if (
        typeof item.key === 'string' &&
        current?.entries &&
        Object.hasOwn(current.entries, item.key)
      ) {
        current = current.entries[item.key];
        return item.key;
      }
      current = undefined;
      return '<field>';
    });
    return {
      path: segments.join('.').slice(0, 300),
      code: safeCode(issue.code ?? `${issue.kind}.${issue.type}`),
      message: 'Invalid input',
    };
  });
}
