import { safeCode, type ClientIssue } from './client.js';
export type { ClientIssue } from './client.js';
import type { BaseIssue, BaseSchema, BaseSchemaAsync } from '../types/index.js';
export type InputSchema = BaseSchema<unknown, unknown, BaseIssue<unknown>> | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>;
export type InputStatus = 400 | 408 | 413 | 415 | 422 | 429;
const messages: Record<InputStatus, string> = {
  400: 'Invalid request input', 408: 'Request body timed out', 413: 'Input limits exceeded',
  415: 'Unsupported content type', 422: 'Validation failed', 429: 'Too many active body readers'
};

/** Public response is sanitized independently of the trusted internal message/cause. */
export class HttpValidationError extends Error {
  constructor(readonly status: InputStatus, message: string, readonly issues?: readonly ClientIssue[], options?: ErrorOptions) {
    super(message, options);
    if (!Object.hasOwn(messages, status)) throw new TypeError('Invalid validation HTTP status');
    this.name = 'HttpValidationError';
  }
  toResponse(): Response {
    return Response.json({ error: messages[this.status], issues: (this.issues ?? []).slice(0, 20).map(issue => ({
      path: typeof issue.path === 'string' ? issue.path.slice(0, 300) : '',
      message: 'Invalid input', code: safeCode(issue.code)
    })) }, { status: this.status, headers: { 'Cache-Control': 'no-store' } });
  }
}

function unwrap(schema: any): any {
  for (let steps = 0; steps < 64; steps++) {
    if (schema?.wrapped) schema = schema.wrapped;
    else if (schema?.pipe?.length) schema = schema.pipe[0];
    else return schema;
  }
  return undefined;
}

/** Keep only schema-declared field names and array indexes; redact record/map keys. */
export function clientIssues(schema: InputSchema, issues: readonly BaseIssue<unknown>[]): ClientIssue[] {
  return issues.slice(0, 20).map(issue => {
    let current: any = schema;
    const segments = (issue.path ?? []).slice(0, 64).map(item => {
      current = unwrap(current);
      if (item.type === 'array' && typeof item.key === 'number') {
        current = current?.item ?? current?.items?.[item.key] ?? current?.rest;
        return String(item.key);
      }
      if (typeof item.key === 'string' && current?.entries && Object.hasOwn(current.entries, item.key)) {
        current = current.entries[item.key]; return item.key;
      }
      current = undefined; return '<field>';
    });
    return { path: segments.join('.').slice(0, 300), code: safeCode(issue.code ?? `${issue.kind}.${issue.type}`), message: 'Invalid input' };
  });
}
