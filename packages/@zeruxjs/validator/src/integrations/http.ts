import { ValidationLimitError } from '../utils/_run.js';
import { safeParseAsync } from '../methods/safeParseAsync.js';
import type { BaseIssue, Config, InferOutput } from '../types/index.js';
import { clientIssues, HttpValidationError, type InputSchema } from './issues.js';
import { collectFields, checkJsonKeys, validatePolicy, type FieldPolicy } from './fields.js';
import { readBody } from './body.js';
export { HttpValidationError } from './issues.js';
export type { ClientIssue, InputStatus } from './issues.js';
export type { FieldPolicy } from './fields.js';

export interface HttpValidationOptions extends FieldPolicy {
  maxBytes?: number;
  maxQueryFields?: number;
  maxQueryLength?: number;
  maxFields?: number;
  maxFieldBytes?: number;
  bodyTimeoutMs?: number;
  maxConcurrentReads?: number;
  signal?: AbortSignal;
  /** Schema controls remain validator-owned; Request/adapter signals cannot be overridden. */
  validation?: Omit<Config<BaseIssue<unknown>>, 'signal'>;
}
function limit(value: unknown, fallback: number, maximum: number, name: string, minimum = 1): number {
  const result = value === undefined ? fallback : value;
  if (typeof result !== 'number' || !Number.isSafeInteger(result) || result < minimum || result > maximum) throw new TypeError(`${name} must be an integer in ${minimum}..${maximum}`);
  return result;
}
const media = (value: string) => value.split(';')[0].trim().toLowerCase();
const jsonType = (type: string) => {
  if (!/^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)$/.test(media(type))) throw new HttpValidationError(415, 'Expected JSON content type');
};
const formType = (type: string) => {
  if (!['application/x-www-form-urlencoded', 'multipart/form-data'].includes(media(type))) throw new HttpValidationError(415, 'Expected form content type');
};

/** App-owned adapter scope. Construction is inert. Only this instance shares
 * reader slots; close cancels owned operations and waits for their cleanup.
 */
export function createHttpInputAdapter(options: HttpValidationOptions = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('options must be an object');
  validatePolicy(options);
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) throw new TypeError('signal must be an AbortSignal');
  if (options.validation !== undefined && (!options.validation || typeof options.validation !== 'object' || Array.isArray(options.validation) || Object.hasOwn(options.validation, 'signal'))) throw new TypeError('validation must be a config without signal');
  const sourceSignal = options.signal;
  const policy = { ...options, coerce: options.coerce ? { ...options.coerce } : undefined };
  const validation = options.validation ? { ...options.validation } : undefined;
  const limits = {
    maxBytes: limit(options.maxBytes, 1024 * 1024, 16 * 1024 * 1024, 'maxBytes'),
    bodyTimeoutMs: limit(options.bodyTimeoutMs, 3000, 60000, 'bodyTimeoutMs', 10),
    maxConcurrentReads: limit(options.maxConcurrentReads, 32, 1024, 'maxConcurrentReads'),
    maxFields: limit(options.maxFields, 200, 1000, 'maxFields'),
    maxFieldBytes: limit(options.maxFieldBytes, 16384, 1024 * 1024, 'maxFieldBytes')
  };
  const maxQueryFields = limit(options.maxQueryFields, limits.maxFields, 1000, 'maxQueryFields');
  const maxQueryLength = limit(options.maxQueryLength, 16384, 1024 * 1024, 'maxQueryLength');
  const readers = { active: 0 };
  const controllers = new Set<AbortController>();
  const pending = new Set<Promise<unknown>>();
  let closed = false;
  function operation<T>(request: Request | undefined, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (closed) return Promise.reject(new Error('HTTP input adapter is closed'));
    if (request !== undefined && !(request instanceof Request)) return Promise.reject(new TypeError('Expected a Fetch Request'));
    const controller = new AbortController(); controllers.add(controller);
    const sources = [request?.signal, sourceSignal].filter((value): value is AbortSignal => !!value);
    const listeners = sources.map(source => {
      const abort = () => controller.abort(source.reason);
      source.addEventListener('abort', abort, { once: true });
      if (source.aborted) abort();
      return () => source.removeEventListener('abort', abort);
    });
    const promise = Promise.resolve().then(() => run(controller.signal)).finally(() => {
      for (const remove of listeners) remove(); controllers.delete(controller); pending.delete(promise);
    });
    pending.add(promise); return promise;
  }
  async function checked<T extends InputSchema>(schema: T, input: unknown, signal: AbortSignal): Promise<InferOutput<T>> {
    let result;
    try { result = await safeParseAsync(schema, input, { ...validation, signal }); }
    catch (cause) {
      if (cause instanceof ValidationLimitError) throw new HttpValidationError(413, 'Validation budget exceeded', undefined, { cause });
      throw cause;
    }
    if (!result.success) throw new HttpValidationError(422, 'Input validation failed', clientIssues(schema, result.issues), { cause: result.issues });
    return result.output;
  }
  function readJson(request: Request, signal: AbortSignal) {
    return readBody(request, signal, limits, readers, jsonType, bytes => {
      try {
        if (!bytes.byteLength) throw new SyntaxError('Empty JSON body');
        const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        checkJsonKeys(value); return value;
      } catch (cause) {
        if (cause instanceof HttpValidationError) throw cause;
        throw new HttpValidationError(400, 'Malformed JSON body', undefined, { cause });
      }
    });
  }
  return {
    readJsonBody(request: Request) { return operation(request, signal => readJson(request, signal)); },
    parseJsonRequest<T extends InputSchema>(schema: T, request: Request): Promise<InferOutput<T>> {
      return operation(request, async signal => checked(schema, await readJson(request, signal), signal));
    },
    parseQuery<T extends InputSchema>(schema: T, input: string | URL | Request): Promise<InferOutput<T>> {
      return operation(input instanceof Request ? input : undefined, async signal => {
        const text = typeof input === 'string' ? input : input instanceof URL ? input.href : input instanceof Request ? input.url : undefined;
        if (text === undefined) throw new TypeError('Expected a URL string, URL or Request');
        if (text.length > maxQueryLength) throw new HttpValidationError(413, 'Query URL too long');
        let url: URL;
        try { url = new URL(text); } catch (cause) { throw new HttpValidationError(400, 'Malformed query URL', undefined, { cause }); }
        return checked(schema, collectFields(url.searchParams, policy, { ...limits, maxFields: maxQueryFields }), signal);
      });
    },
    parseHeaders<T extends InputSchema>(schema: T, input: Headers | Request | Iterable<readonly [string, string]>): Promise<InferOutput<T>> {
      return operation(input instanceof Request ? input : undefined, async signal => {
        const entries = input instanceof Request ? input.headers : input;
        return checked(schema, collectFields(entries, policy, limits, true), signal);
      });
    },
    parseFormData<T extends InputSchema>(schema: T, input: FormData): Promise<InferOutput<T>> {
      return operation(undefined, async signal => {
        if (!(input instanceof FormData)) throw new TypeError('Expected FormData');
        return checked(schema, collectFields(input, policy, limits), signal);
      });
    },
    parseFormRequest<T extends InputSchema>(schema: T, request: Request): Promise<InferOutput<T>> {
      return operation(request, async signal => {
        const fields = await readBody(request, signal, limits, readers, formType, async (bytes, type) => {
          if (media(type) === 'application/x-www-form-urlencoded') {
            let text: string;
            try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
            catch (cause) { throw new HttpValidationError(400, 'Invalid form encoding', undefined, { cause }); }
            return collectFields(new URLSearchParams(text), policy, limits);
          }
          let data: FormData;
          try { data = await new Response(new Uint8Array(bytes), { headers: { 'content-type': type } }).formData(); }
          catch (cause) { throw new HttpValidationError(400, 'Malformed multipart form', undefined, { cause }); }
          return collectFields(data, policy, limits);
        });
        return checked(schema, fields, signal);
      });
    },
    async close(): Promise<void> {
      closed = true;
      for (const controller of controllers) controller.abort(new Error('HTTP input adapter closed'));
      await Promise.allSettled([...pending]);
    }
  };
}
export type HttpInputAdapter = ReturnType<typeof createHttpInputAdapter>;

/** Standalone calls own one operation; use a shared adapter to cap concurrent calls. */
export function readJsonBody(request: Request, options: HttpValidationOptions = {}) { return createHttpInputAdapter(options).readJsonBody(request); }
export function parseJsonRequest<T extends InputSchema>(schema: T, request: Request, options: HttpValidationOptions = {}) { return createHttpInputAdapter(options).parseJsonRequest(schema, request); }
export function parseQuery<T extends InputSchema>(schema: T, input: string | URL | Request, options: HttpValidationOptions = {}) { return createHttpInputAdapter(options).parseQuery(schema, input); }
export function parseHeaders<T extends InputSchema>(schema: T, input: Headers | Request | Iterable<readonly [string, string]>, options: HttpValidationOptions = {}) { return createHttpInputAdapter(options).parseHeaders(schema, input); }
export function parseFormData<T extends InputSchema>(schema: T, input: FormData, options: HttpValidationOptions = {}) { return createHttpInputAdapter(options).parseFormData(schema, input); }
export function parseFormRequest<T extends InputSchema>(schema: T, request: Request, options: HttpValidationOptions = {}) { return createHttpInputAdapter(options).parseFormRequest(schema, request); }

/** Fetch middleware; the returned function's close() releases its shared scope. */
export function validatedJsonHandler<T extends InputSchema>(schema: T, handler: (body: InferOutput<T>, request: Request) => unknown | Promise<unknown>, options: HttpValidationOptions = {}) {
  const adapter = createHttpInputAdapter(options);
  const handle = async (request: Request): Promise<Response> => {
    let body: InferOutput<T>;
    try { body = await adapter.parseJsonRequest(schema, request); }
    catch (error) { if (error instanceof HttpValidationError) return error.toResponse(); throw error; }
    const result = await handler(body, request);
    return result instanceof Response ? result : result === undefined ? new Response(null, { status: 204 }) : Response.json(result);
  };
  return Object.assign(handle, { close: () => adapter.close() });
}
