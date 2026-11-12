import { ValidationLimitError } from '../utils/_run.js';
import { safeParseAsync } from '../methods/safeParseAsync.js';
import type { BaseIssue, Config, InferOutput } from '../types/index.js';
import {
  clientIssues,
  HttpValidationError,
  type InputSchema,
} from './issues.js';
import {
  collectFields,
  checkJsonKeys,
  validatePolicy,
  type FieldPolicy,
} from './fields.js';
import { readBody } from './body.js';
export { HttpValidationError } from './issues.js';
export type { ClientIssue, InputStatus } from './issues.js';
export type { FieldPolicy } from './fields.js';

export interface HttpValidationOptions extends FieldPolicy {
  /** Total streamed/decoded field byte limit, default 1 MiB, maximum 16 MiB. */
  maxBytes?: number;
  /** Query occurrence limit, default maxFields, maximum 1000. */
  maxQueryFields?: number;
  /** Absolute URL character limit, default 16384, maximum 1048576. */
  maxQueryLength?: number;
  /** Total decoded field occurrences, default 200, maximum 1000. */
  maxFields?: number;
  /** Per-name/string UTF-8 ceiling, default 16384, maximum 1048576. */
  maxFieldBytes?: number;
  /** Absolute body/decode deadline, default 3000 ms, range 10 through 60000. */
  bodyTimeoutMs?: number;
  /** Instance simultaneous reader limit, default 32, maximum 1024. */
  maxConcurrentReads?: number;
  /** Optional cooperative owner signal combined with Request.signal; neither may override the other. */
  signal?: AbortSignal;
  /** Schema controls remain validator-owned; Request/adapter signals cannot be overridden. */
  validation?: Omit<Config<BaseIssue<unknown>>, 'signal'>;
}
/** Select and validate one finite positive safe-integer resource limit before starting input work.
 * @param {unknown} value - Optional candidate limit.
 * @param {number} fallback - Explicit documented default.
 * @param {number} maximum - Hard implementation ceiling.
 * @param {string} name - Fixed configuration field label used for diagnostics.
 * @param {number} minimum - Inclusive supported minimum, default one.
 * @returns {number} Validated inclusive bounded integer.
 */
function limit(
  value: unknown,
  fallback: number,
  maximum: number,
  name: string,
  minimum = 1
): number {
  /** Validated configuration value or explicit trusted application handler result, never a permission grant. */
  const result = value === undefined ? fallback : value;
  if (
    typeof result !== 'number' ||
    !Number.isSafeInteger(result) ||
    result < minimum ||
    result > maximum
  ) {
    throw new TypeError(`${name} must be an integer in ${minimum}..${maximum}`);
  }
  return result;
}
/** Normalize only the declared media-type token; parameters are validated separately.
 * @param {string} value - Raw declared Content-Type header.
 * @returns {string} Normalized media token without parameters.
 */
const media = (value: string) => value.split(';')[0]!.trim().toLowerCase();
/** Require supported application/json or structured +json before body decoding.
 * @param {string} type - Raw declared Content-Type header.
 * @returns {void} Completes only for supported JSON media types.
 */
const jsonType = (type: string) => {
  if (!/^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)$/.test(media(type))) {
    throw new HttpValidationError(415, 'Expected JSON content type');
  }
};
/** Require the explicit supported form media types before native decoding.
 * @param {string} type - Raw declared Content-Type header.
 * @returns {void} Completes only for supported form media types.
 */
const formType = (type: string) => {
  if (
    !['application/x-www-form-urlencoded', 'multipart/form-data'].includes(
      media(type)
    )
  ) {
    throw new HttpValidationError(415, 'Expected form content type');
  }
};

/** Create an inert app-owned input scope with shared instance reader slots and cooperative cancellation. Does not register routes, grant authorization or share limits across independent adapters.
 * @param {HttpValidationOptions} options - Optional explicit validated input and root schema-execution policy; defaults remain bounded.
 * @returns {object} Owned parse/read methods and close drain; no server or background validation starts automatically.
 */
export function createHttpInputAdapter(options: HttpValidationOptions = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('options must be an object');
  }
  validatePolicy(options);
  if (
    options.signal !== undefined &&
    !(options.signal instanceof AbortSignal)
  ) {
    throw new TypeError('signal must be an AbortSignal');
  }
  if (
    options.validation !== undefined &&
    (!options.validation ||
      typeof options.validation !== 'object' ||
      Array.isArray(options.validation) ||
      Object.hasOwn(options.validation, 'signal'))
  ) {
    throw new TypeError('validation must be a config without signal');
  }
  /** Borrowed configured owner signal combined with every initiating Request signal. */
  const sourceSignal = options.signal;
  /** Independent shallow field policy/coercion snapshot for this adapter instance. */
  const policy = {
    ...options,
    coerce: options.coerce ? { ...options.coerce } : undefined,
  };
  /** Independent root parse controls excluding any competing schema signal. */
  const validation = options.validation ? { ...options.validation } : undefined;
  /** Validated bounded reader/field resource limits owned by this instance. */
  const limits = {
    maxBytes: limit(
      options.maxBytes,
      1024 * 1024,
      16 * 1024 * 1024,
      'maxBytes'
    ),
    bodyTimeoutMs: limit(
      options.bodyTimeoutMs,
      3000,
      60000,
      'bodyTimeoutMs',
      10
    ),
    maxConcurrentReads: limit(
      options.maxConcurrentReads,
      32,
      1024,
      'maxConcurrentReads'
    ),
    maxFields: limit(options.maxFields, 200, 1000, 'maxFields'),
    maxFieldBytes: limit(
      options.maxFieldBytes,
      16384,
      1024 * 1024,
      'maxFieldBytes'
    ),
  };
  /** Validated literal query occurrence cap independent of duplicate selection. */
  const maxQueryFields = limit(
    options.maxQueryFields,
    limits.maxFields,
    1000,
    'maxQueryFields'
  );
  /** Validated absolute input URL character ceiling before parsing. */
  const maxQueryLength = limit(
    options.maxQueryLength,
    16384,
    1024 * 1024,
    'maxQueryLength'
  );
  /** Instance reader counter; it is neither global nor distributed admission. */
  const readers = { active: 0 };
  /** Owned cooperative operation controllers retained until actual settlement. */
  const controllers = new Set<AbortController>();
  /** Actual scoped promises retained until their cleanup completes. */
  const pending = new Set<Promise<unknown>>();
  let closed = false;
  /** Retain one actual scoped operation and combine initiating Request/adapter cancellation without replacing either signal. Remove listeners/controllers only after work settles.
   * @param {Request | undefined} request - Optional borrowed Fetch request supplying cancellation.
   * @param {(signal: AbortSignal) => Promise<T>} run - Trusted scoped operation invoked with its combined cooperative signal.
   * @returns {Promise<T>} Actual operation settlement; close waits for it and does not force-cancel arbitrary schema callbacks.
   */
  function operation<T>(
    request: Request | undefined,
    run: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    if (closed) {
      return Promise.reject(new Error('HTTP input adapter is closed'));
    }
    if (request !== undefined && !(request instanceof Request)) {
      return Promise.reject(new TypeError('Expected a Fetch Request'));
    }
    /** Owned combined operation controller; cancellation does not force external callbacks. */
    const controller = new AbortController();
    controllers.add(controller);
    /** Borrowed initiating/owner signals retained only until this operation settles. */
    const sources = [request?.signal, sourceSignal].filter(
      (value): value is AbortSignal => !!value
    );
    /** Owned source-abort removal functions released on actual operation completion. */
    const listeners = sources.map((source) => {
      /** Propagate this borrowed source’s reason into the owned cooperative controller.
       * @returns {void} Propagates cooperative cancellation; actual work remains retained.
       */
      const abort = () => controller.abort(source.reason);
      source.addEventListener('abort', abort, { once: true });
      if (source.aborted) {
        abort();
      }
      return () => source.removeEventListener('abort', abort);
    });
    /** Actual operation promise whose finally removes listeners/controllers/capacity ownership. */
    const promise = Promise.resolve()
      .then(() => run(controller.signal))
      .finally(() => {
        // Release both initiating and owner signal listeners after actual settlement.
        for (const remove of listeners) {
          remove();
        }
        controllers.delete(controller);
        pending.delete(promise);
      });
    pending.add(promise);
    return promise;
  }
  /** Run async-compatible schema validation under the existing validator-owned execution limits and signal. Redact public issues while preserving raw issues/callback failures privately.
   * @param {T} schema - Trusted synchronous or asynchronous input schema; raw issues and callback exceptions remain private.
   * @param {unknown} input - Decoded bounded input, not a presumed authorization grant.
   * @param {AbortSignal} signal - Combined initiating and adapter cooperative signal.
   * @returns {Promise<InferOutput<T>>} Validated/transformed output; execution exhaustion maps to 413 and ordinary issues to 422.
   */
  async function checked<T extends InputSchema>(
    schema: T,
    input: unknown,
    signal: AbortSignal
  ): Promise<InferOutput<T>> {
    let result;
    try {
      result = await safeParseAsync(schema, input, { ...validation, signal });
    } catch (cause) {
      if (cause instanceof ValidationLimitError) {
        throw new HttpValidationError(
          413,
          'Validation budget exceeded',
          undefined,
          { cause }
        );
      }
      throw cause;
    }
    if (!result.success) {
      throw new HttpValidationError(
        422,
        'Input validation failed',
        clientIssues(schema, result.issues),
        { cause: result.issues }
      );
    }
    return result.output;
  }
  /** Read bounded UTF-8 JSON and reject unsafe nested literal keys before schema stripping. The native JSON parser cannot be preempted by a timer.
   * @param {Request} request - Borrowed Fetch request with initiating signal; this scope owns only its body-reader operation.
   * @param {AbortSignal} signal - Combined cooperative signal for reader/decode observation.
   * @returns {Promise<unknown>} Decoded bounded JSON data; malformed media/encoding/length/content rejects.
   */
  function readJson(request: Request, signal: AbortSignal) {
    return readBody(request, signal, limits, readers, jsonType, (bytes) => {
      try {
        if (!bytes.byteLength) {
          throw new SyntaxError('Empty JSON body');
        }
        /** Decoded bounded JSON data checked for unsafe literal keys before schema validation. */
        const value: unknown = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        );
        checkJsonKeys(value);
        return value;
      } catch (cause) {
        if (cause instanceof HttpValidationError) {
          throw cause;
        }
        throw new HttpValidationError(400, 'Malformed JSON body', undefined, {
          cause,
        });
      }
    });
  }
  return {
    /** Read bounded JSON through the selected instance scope, or a one-call scope for the standalone export. Separate standalone calls do not share reader capacity.
     * @param {Request} request - Borrowed Fetch request with initiating signal; this scope owns only its body-reader operation.
     * @returns {Promise<unknown>} Decoded JSON only; no schema validation, file write or authorization occurs.
     */
    readJsonBody(request: Request) {
      return operation(request, (signal) => readJson(request, signal));
    },
    /** Read bounded JSON, then validate it with the declared schema. Raw values and custom messages remain outside public HTTP feedback.
     * @param {T} schema - Trusted synchronous or asynchronous input schema; raw issues and callback exceptions remain private.
     * @param {Request} request - Borrowed Fetch request with initiating signal; this scope owns only its body-reader operation.
     * @returns {Promise<InferOutput<T>>} Schema output; cancellation and operational callback failures propagate.
     */
    parseJsonRequest<T extends InputSchema>(
      schema: T,
      request: Request
    ): Promise<InferOutput<T>> {
      return operation(request, async (signal) =>
        checked(schema, await readJson(request, signal), signal)
      );
    },
    /** Collect bounded literal URL query fields using explicit duplicate/empty/coercion policy, then validate without fetching the URL.
     * @param {T} schema - Trusted synchronous or asynchronous input schema; raw issues and callback exceptions remain private.
     * @param {string | URL | Request} input - Explicit decoded input or absolute URL/request according to this method; no network fetch occurs.
     * @returns {Promise<InferOutput<T>>} Schema output; reserved key segments reject even when unknown fields would otherwise strip.
     */
    parseQuery<T extends InputSchema>(
      schema: T,
      input: string | URL | Request
    ): Promise<InferOutput<T>> {
      return operation(
        input instanceof Request ? input : undefined,
        async (signal) => {
          // Preserve explicit supported input kinds without coercing arbitrary objects.
          let text: string | undefined;
          if (typeof input === 'string') {
            text = input;
          } else if (input instanceof URL) {
            text = input.href;
          } else if (input instanceof Request) {
            text = input.url;
          }
          if (text === undefined) {
            throw new TypeError('Expected a URL string, URL or Request');
          }
          if (text.length > maxQueryLength) {
            throw new HttpValidationError(413, 'Query URL too long');
          }
          let url: URL;
          try {
            url = new URL(text);
          } catch (cause) {
            throw new HttpValidationError(
              400,
              'Malformed query URL',
              undefined,
              { cause }
            );
          }
          return checked(
            schema,
            collectFields(url.searchParams, policy, {
              ...limits,
              maxFields: maxQueryFields,
            }),
            signal
          );
        }
      );
    },
    /** Collect explicit header pairs with lowercased names and bounded field policy. Native Headers may already have merged wire duplicates; commas are never split.
     * @param {T} schema - Trusted synchronous or asynchronous input schema; raw issues and callback exceptions remain private.
     * @param {Headers | Request | Iterable<readonly [string, string]>} input - Explicit decoded input or absolute URL/request according to this method; no network fetch occurs.
     * @returns {Promise<InferOutput<T>>} Schema output; no attempt is made to recover lost native wire duplicates.
     */
    parseHeaders<T extends InputSchema>(
      schema: T,
      input: Headers | Request | Iterable<readonly [string, string]>
    ): Promise<InferOutput<T>> {
      return operation(
        input instanceof Request ? input : undefined,
        async (signal) => {
          /** Explicit native/raw header iterable; already-merged native wire duplicates remain merged. */
          const entries = input instanceof Request ? input.headers : input;
          return checked(
            schema,
            collectFields(entries, policy, limits, true),
            signal
          );
        }
      );
    },
    /** Validate already-decoded FormData under bounded name/value/file-size policy. Files reject by default; explicit preserve never writes or inspects their bytes.
     * @param {T} schema - Trusted synchronous or asynchronous input schema; raw issues and callback exceptions remain private.
     * @param {FormData} input - Explicit decoded input or absolute URL/request according to this method; no network fetch occurs.
     * @returns {Promise<InferOutput<T>>} Schema output; content-type validation belongs to request decoding, not predecoded FormData.
     */
    parseFormData<T extends InputSchema>(
      schema: T,
      input: FormData
    ): Promise<InferOutput<T>> {
      return operation(undefined, async (signal) => {
        if (!(input instanceof FormData)) {
          throw new TypeError('Expected FormData');
        }
        return checked(schema, collectFields(input, policy, limits), signal);
      });
    },
    /** Read bounded UTF-8 URL-encoded or native-decoded multipart form data, then apply field/schema policy. This is not a streaming multipart parser or upload authorization.
     * @param {T} schema - Trusted synchronous or asynchronous input schema; raw issues and callback exceptions remain private.
     * @param {Request} request - Borrowed Fetch request with initiating signal; this scope owns only its body-reader operation.
     * @returns {Promise<InferOutput<T>>} Validated output; field limits apply after bounded native form decoding.
     */
    parseFormRequest<T extends InputSchema>(
      schema: T,
      request: Request
    ): Promise<InferOutput<T>> {
      return operation(request, async (signal) => {
        /** Bounded decoded form dictionary produced before schema validation. */
        const fields = await readBody(
          request,
          signal,
          limits,
          readers,
          formType,
          async (bytes, type) => {
            if (media(type) === 'application/x-www-form-urlencoded') {
              let text: string;
              try {
                text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
              } catch (cause) {
                throw new HttpValidationError(
                  400,
                  'Invalid form encoding',
                  undefined,
                  { cause }
                );
              }
              return collectFields(new URLSearchParams(text), policy, limits);
            }
            let data: FormData;
            try {
              data = await new Response(new Uint8Array(bytes), {
                headers: { 'content-type': type },
              }).formData();
            } catch (cause) {
              throw new HttpValidationError(
                400,
                'Malformed multipart form',
                undefined,
                { cause }
              );
            }
            return collectFields(data, policy, limits);
          }
        );
        return checked(schema, fields, signal);
      });
    },
    /** Reject new operations, abort owned cooperative work and await actual scope cleanup. No host request, global Fetch pool or external schema dependency is forcibly closed.
     * @returns {Promise<void>} Drain of currently retained operations; noncooperative trusted callbacks may delay it.
     */
    async close(): Promise<void> {
      closed = true;
      // Abort every owned operation before awaiting the retained cleanup promises.
      for (const controller of controllers) {
        controller.abort(new Error('HTTP input adapter closed'));
      }
      await Promise.allSettled([...pending]);
    },
  };
}
export type HttpInputAdapter = ReturnType<typeof createHttpInputAdapter>;

/** Read bounded JSON through the selected instance scope, or a one-call scope for the standalone export. Separate standalone calls do not share reader capacity.
 * @param {Request} request - Borrowed Fetch request with initiating signal; this scope owns only its body-reader operation.
 * @param {HttpValidationOptions} options - Explicit validated byte/field/duplicate/coercion/cancellation policy; standalone calls create an independent scope.
 * @returns {Promise<unknown>} Decoded JSON only; no schema validation, file write or authorization occurs.
 */
export function readJsonBody(
  request: Request,
  options: HttpValidationOptions = {}
) {
  return createHttpInputAdapter(options).readJsonBody(request);
}
/** Read bounded JSON, then validate it with the declared schema. Raw values and custom messages remain outside public HTTP feedback.
 * @param {T} schema - Trusted synchronous or asynchronous input schema; raw issues and callback exceptions remain private.
 * @param {Request} request - Borrowed Fetch request with initiating signal; this scope owns only its body-reader operation.
 * @param {HttpValidationOptions} options - Explicit validated byte/field/duplicate/coercion/cancellation policy; standalone calls create an independent scope.
 * @returns {Promise<InferOutput<T>>} Schema output; cancellation and operational callback failures propagate.
 */
export function parseJsonRequest<T extends InputSchema>(
  schema: T,
  request: Request,
  options: HttpValidationOptions = {}
) {
  return createHttpInputAdapter(options).parseJsonRequest(schema, request);
}
/** Collect bounded literal URL query fields using explicit duplicate/empty/coercion policy, then validate without fetching the URL.
 * @param {T} schema - Trusted synchronous or asynchronous input schema; raw issues and callback exceptions remain private.
 * @param {string | URL | Request} input - Explicit decoded input or absolute URL/request according to this method; no network fetch occurs.
 * @param {HttpValidationOptions} options - Explicit validated byte/field/duplicate/coercion/cancellation policy; standalone calls create an independent scope.
 * @returns {Promise<InferOutput<T>>} Schema output; reserved key segments reject even when unknown fields would otherwise strip.
 */
export function parseQuery<T extends InputSchema>(
  schema: T,
  input: string | URL | Request,
  options: HttpValidationOptions = {}
) {
  return createHttpInputAdapter(options).parseQuery(schema, input);
}
/** Collect explicit header pairs with lowercased names and bounded field policy. Native Headers may already have merged wire duplicates; commas are never split.
 * @param {T} schema - Trusted synchronous or asynchronous input schema; raw issues and callback exceptions remain private.
 * @param {Headers | Request | Iterable<readonly [string, string]>} input - Explicit decoded input or absolute URL/request according to this method; no network fetch occurs.
 * @param {HttpValidationOptions} options - Explicit validated byte/field/duplicate/coercion/cancellation policy; standalone calls create an independent scope.
 * @returns {Promise<InferOutput<T>>} Schema output; no attempt is made to recover lost native wire duplicates.
 */
export function parseHeaders<T extends InputSchema>(
  schema: T,
  input: Headers | Request | Iterable<readonly [string, string]>,
  options: HttpValidationOptions = {}
) {
  return createHttpInputAdapter(options).parseHeaders(schema, input);
}
/** Validate already-decoded FormData under bounded name/value/file-size policy. Files reject by default; explicit preserve never writes or inspects their bytes.
 * @param {T} schema - Trusted synchronous or asynchronous input schema; raw issues and callback exceptions remain private.
 * @param {FormData} input - Explicit decoded input or absolute URL/request according to this method; no network fetch occurs.
 * @param {HttpValidationOptions} options - Explicit validated byte/field/duplicate/coercion/cancellation policy; standalone calls create an independent scope.
 * @returns {Promise<InferOutput<T>>} Schema output; content-type validation belongs to request decoding, not predecoded FormData.
 */
export function parseFormData<T extends InputSchema>(
  schema: T,
  input: FormData,
  options: HttpValidationOptions = {}
) {
  return createHttpInputAdapter(options).parseFormData(schema, input);
}
/** Read bounded UTF-8 URL-encoded or native-decoded multipart form data, then apply field/schema policy. This is not a streaming multipart parser or upload authorization.
 * @param {T} schema - Trusted synchronous or asynchronous input schema; raw issues and callback exceptions remain private.
 * @param {Request} request - Borrowed Fetch request with initiating signal; this scope owns only its body-reader operation.
 * @param {HttpValidationOptions} options - Explicit validated byte/field/duplicate/coercion/cancellation policy; standalone calls create an independent scope.
 * @returns {Promise<InferOutput<T>>} Validated output; field limits apply after bounded native form decoding.
 */
export function parseFormRequest<T extends InputSchema>(
  schema: T,
  request: Request,
  options: HttpValidationOptions = {}
) {
  return createHttpInputAdapter(options).parseFormRequest(schema, request);
}

/** Create an owned Fetch wrapper sharing one input scope across invocations. This validates input only; host authorization, method/CSRF policy and downstream effects remain separate.
 * @param {T} schema - Trusted synchronous or asynchronous input schema; raw issues and callback exceptions remain private.
 * @param {(
    body: InferOutput<T>,
    request: Request
  ) => unknown | Promise<unknown>} handler - Trusted explicit application callback invoked only after successful schema validation.
 * @param {HttpValidationOptions} options - Optional bounded input policy shared by this returned handler.
 * @returns {Function} Explicit Fetch handler with close() drain; no route is automatically registered.
 */
export function validatedJsonHandler<T extends InputSchema>(
  schema: T,
  handler: (
    body: InferOutput<T>,
    request: Request
  ) => unknown | Promise<unknown>,
  options: HttpValidationOptions = {}
) {
  /** Owned shared input scope retained by the returned Fetch handler. */
  const adapter = createHttpInputAdapter(options);
  /** Explicit Fetch wrapper with close() ownership; trusted application callback runs after validation.
   * @param {Request} request - Borrowed explicit Fetch request; host still enforces authorization/method/CSRF.
   * @returns {Promise<Response>} Validated application response or bounded sanitized input failure.
   */
  const handle = async (request: Request): Promise<Response> => {
    let body: InferOutput<T>;
    try {
      body = await adapter.parseJsonRequest(schema, request);
    } catch (error) {
      if (error instanceof HttpValidationError) {
        return error.toResponse();
      }
      throw error;
    }
    /** Validated configuration value or explicit trusted application handler result, never a permission grant. */
    const result = await handler(body, request);
    if (result instanceof Response) {
      return result;
    }
    if (result === undefined) {
      return new Response(null, { status: 204 });
    }
    return Response.json(result);
  };
  return Object.assign(handle, { close: () => adapter.close() });
}
