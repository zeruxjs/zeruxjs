import { safeParseAsync } from '../methods/safeParseAsync.js';
import type { BaseIssue, BaseSchema, BaseSchemaAsync, InferOutput } from '../types/index.js';

type AnySchema = BaseSchema<unknown, unknown, BaseIssue<unknown>> | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>;
export interface HttpValidationOptions { maxBytes?: number; maxQueryFields?: number; maxQueryLength?: number }

export class HttpValidationError extends Error {
  constructor(readonly status: 400 | 413 | 415 | 422, message: string, readonly issues?: readonly { path: string; message: string }[]) {
    super(message);
    this.name = 'HttpValidationError';
  }
  toResponse(): Response {
    return Response.json({ error: this.message, issues: this.issues ?? [] }, {
      status: this.status, headers: { 'Cache-Control': 'no-store' }
    });
  }
}

const checkLimit = (value: number | undefined, fallback: number) => {
  const limit = value ?? fallback;
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('Invalid input size limit');
  return limit;
};

/** Reads request bodies incrementally and enforces a hard byte limit before JSON parsing. */
export async function readJsonBody(request: Request, options: HttpValidationOptions = {}): Promise<unknown> {
  const max = checkLimit(options.maxBytes, 1024 * 1024);
  const contentType = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (contentType !== 'application/json' && !(contentType?.startsWith('application/') && contentType.endsWith('+json'))) throw new HttpValidationError(415, 'Expected a JSON request');
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > max)) throw new HttpValidationError(413, 'Request body too large');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpValidationError(400, 'Missing JSON request body');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > max) throw new HttpValidationError(413, 'Request body too large');
      chunks.push(value);
    }
  } catch (error) {
    try { await reader.cancel(); } catch { /* connection may already be closed */ }
    throw error;
  } finally { reader.releaseLock(); }
  if (!bytes) throw new HttpValidationError(400, 'Empty JSON request body');
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)); }
  catch { throw new HttpValidationError(400, 'Malformed JSON request body'); }
}

function formatIssues(issues: readonly BaseIssue<unknown>[]) {
  return issues.slice(0, 20).map(issue => ({
    message: String(issue.message).slice(0, 300),
    path: (issue.path ?? []).map((part: any) => String(part.key ?? '')).join('.').slice(0, 300)
  }));
}

/** Validate JSON using sync or async schemas with a uniform typed result. */
export async function parseJsonRequest<TSchema extends AnySchema>(schema: TSchema, request: Request, options: HttpValidationOptions = {}): Promise<InferOutput<TSchema>> {
  const json = await readJsonBody(request, options);
  const checked = await safeParseAsync(schema, json);
  if (!checked.success) throw new HttpValidationError(422, 'Request validation failed', formatIssues(checked.issues ?? []));
  return checked.output as InferOutput<TSchema>;
}

export async function parseQuery<TSchema extends AnySchema>(schema: TSchema, input: string | URL | Request, options: HttpValidationOptions = {}): Promise<InferOutput<TSchema>> {
  const urlText = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  if (urlText.length > checkLimit(options.maxQueryLength, 16384)) throw new HttpValidationError(413, 'Query URL too long');
  const url = new URL(urlText);
  const max = checkLimit(options.maxQueryFields, 200);
  const query: Record<string, string | string[]> = Object.create(null);
  let fields = 0;
  for (const [key, value] of url.searchParams) {
    if (++fields > max) throw new HttpValidationError(413, 'Too many query parameters');
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new HttpValidationError(400, 'Unsafe query parameter');
    const prior = query[key];
    query[key] = prior === undefined ? value : Array.isArray(prior) ? [...prior, value] : [prior, value];
  }
  const checked = await safeParseAsync(schema, query);
  if (!checked.success) throw new HttpValidationError(422, 'Query validation failed', formatIssues(checked.issues ?? []));
  return checked.output as InferOutput<TSchema>;
}

/** Framework-neutral validation middleware for Fetch-compatible handlers. */
export function validatedJsonHandler<TSchema extends AnySchema>(schema: TSchema, handler: (body: InferOutput<TSchema>, request: Request) => Response | Promise<Response> | unknown, options: HttpValidationOptions = {}) {
  return async (request: Request): Promise<Response> => {
    let body: InferOutput<TSchema>;
    try { body = await parseJsonRequest(schema, request, options); }
    catch (error) { if (error instanceof HttpValidationError) return error.toResponse(); throw error; }
    const result = await handler(body, request);
    return result instanceof Response ? result : result === undefined ? new Response(null, { status: 204 }) : Response.json(result);
  };
}
