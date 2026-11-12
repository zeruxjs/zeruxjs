import {
  ReportSourceError,
  sourceScope,
  type ReportSourceScope,
} from './sources.js';
/** Explicit GA4 analytics.readonly permission; no application login or write scope. */
export const GA4_READONLY_SCOPE =
  'https://www.googleapis.com/auth/analytics.readonly';
/** Explicit AdSense readonly permission; no account-management writes. */
export const ADSENSE_READONLY_SCOPE =
  'https://www.googleapis.com/auth/adsense.readonly';
export interface GoogleReportCredentials {
  /** Acquire one explicit short-lived token for the configured permission under cooperative cancellation. Credential callbacks are trusted host code; no background cache/refresh or login flow is implied.
   * @param {object} context - Explicit required scope/verified identity and cooperative signal appropriate to this borrowed credential/request contract.
   * @param {string} context.scope - Required exact verified grant identity or configured read-only OAuth permission.
   * @param {AbortSignal} context.signal - Cooperative owner cancellation.
   * @returns {Promise<object>} Explicit checked token/provider result or fixed failure; private causes and grants remain server-side.
   */
  getAccessToken(context: {
    /** Required configured read-only Google scope; application authentication is a separate boundary. */
    scope: string;
    /** Cooperative cancellation; uncooperative callbacks may retain slots/close indefinitely. */
    signal: AbortSignal;
  }): Promise<{
    /** Private short-lived bearer token, never a response/audit label. */
    accessToken: string;
    /** Required safe future epoch milliseconds; token validity is rechecked before each retry. */
    expiresAt: number;
    /** Explicit granted permission strings; requested read-only scope must be present. */
    scopes: readonly string[];
  }>;
}
export interface GoogleReportOptions {
  /** Exact verified tenant/site/principal/credential-partition tuple, matched before token acquisition. */
  binding: ReportSourceScope;
  /** Borrowed trusted token provider; report source disposal never owns its lifecycle. */
  credentials: GoogleReportCredentials;
  /** Optional trusted injected Fetch implementation; fixed code-owned endpoints/redirect policy remain authoritative. */
  fetch?: typeof fetch;
  /** Default2, allowed1–3 read-only attempts; only declared quota/transient HTTP failures retry. */
  maxAttempts?: number;
}
/** Throw a fixed public source category while retaining a private optional cause.
 * @param {ReportSourceError['code']} code - Fixed public category, never a token body, URL or provider diagnostic.
 * @param {unknown} cause - Optional private non-enumerable cause for trusted host diagnostics.
 * @returns {never} Explicit checked token/provider result or fixed failure; private causes and grants remain server-side.
 */
export function providerFailure(
  code: ReportSourceError['code'],
  cause?: unknown
): never {
  throw new ReportSourceError(code, cause);
}
/** Read strict UTF-8 JSON under a finite byte ceiling with cancellation and reader release. Never forward raw provider blobs as public errors.
 * @param {Response} response - Owned provider response whose reader must be cancelled/released on every exit.
 * @param {AbortSignal} signal - Cooperative cancellation signal; it cannot force-stop a custom transport.
 * @param {number} max - Internal finite response byte budget, default1 MiB; token/error callers use16 KiB.
 * @returns {Promise<any>} Explicit checked token/provider result or fixed failure; private causes and grants remain server-side.
 */
export async function boundedJson(
  response: Response,
  signal: AbortSignal,
  max = 1024 * 1024
): Promise<any> {
  if (!response.body) {
    providerFailure('INVALID_RESULT');
  }
  /** Owned bounded provider body reader, cancelled/released even after parse failure. */
  const reader = response.body.getReader();
  let size = 0,
    text = '';
  /** Strict streaming UTF-8 decoder; malformed response bytes reject. */
  const decoder = new TextDecoder('utf-8', { fatal: true });
  /** Scoped cancellation callback releasing a reader/wait or aborting the owned request.
   * @returns {void} Result of this documented read/update/cleanup; borrowed resources remain host-owned.
   */
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    // Keep work within finite retries/response bytes or actually owned cancellation handles.
    while (true) {
      if (signal.aborted) {
        providerFailure('CANCELLED');
      }
      /** One provider response chunk or terminal read receipt, bounded before parsing. */
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      size += value.byteLength;
      if (size > max) {
        providerFailure('INVALID_RESULT');
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof ReportSourceError) {
      throw error;
    }
    providerFailure('INVALID_RESULT', error);
  } finally {
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
/** Own a finite abortable retry wait and remove its timer/listener on either settlement path.
 * @param {number} ms - Finite retry pause, not a background refresh or mutation replay timer.
 * @param {AbortSignal} signal - Cooperative cancellation signal; it cannot force-stop a custom transport.
 * @returns {Promise<void>} Explicit checked token/provider result or fixed failure; private causes and grants remain server-side.
 */
function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    /** Resolve one retry pause after releasing its timer/listener.
     * @returns {void} Result of this documented read/update/cleanup; borrowed resources remain host-owned.
     */
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      resolve();
    };
    /** Scoped cancellation callback releasing a reader/wait or aborting the owned request.
     * @returns {void} Result of this documented read/update/cleanup; borrowed resources remain host-owned.
     */
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(new ReportSourceError('CANCELLED'));
    };
    /** Owned finite request/refresh/retry timer cleared on actual settlement. */
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      abort();
    }
  });
}
/** Create the internal read-only provider transport with exact tenant/site/principal/grant binding before credentials. It is not a general arbitrary-URL client; only code-owned provider adapters choose destinations.
 * @param {GoogleReportOptions} options - Trusted fixed-provider request policy and exact verified grant binding; credentials remain borrowed.
 * @param {string} scope - Exactly the configured read-only provider permission; not application login authorization.
 * @returns {object} Explicit checked token/provider result or fixed failure; private causes and grants remain server-side.
 */
export function googleReporting(options: GoogleReportOptions, scope: string) {
  /** Frozen verified grant identity captured before any credential acquisition. */
  const binding = sourceScope(options?.binding);
  if (
    typeof options.credentials?.getAccessToken !== 'function' ||
    (options.fetch !== undefined && typeof options.fetch !== 'function')
  ) {
    providerFailure('INVALID_QUERY');
  }
  /** Validated finite read-only attempt budget, default2 and maximum3. */
  const attempts = options.maxAttempts ?? 2;
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 3) {
    providerFailure('INVALID_QUERY');
  }
  /** Trusted explicit Fetch transport or platform default; no remote discovery. */
  const fetcher = options.fetch ?? globalThis.fetch;
  let closed = false;
  /** Actual active cooperative request owners; maximum4 per helper. */
  const active = new Set<AbortController>();
  /** Actual unsettled trusted token/Fetch work; deadlines do not release ownership early. */
  const jobs = new Set<Promise<unknown>>();
  return {
    /** Run one bound read-only report request with at most the declared transient attempts. Redirects reject; unknown transport failures and malformed successes never auto-replay. Retain actual custom work through disposal.
     * @param {string} url - Code-owned fixed Google reporting endpoint selected only by the internal GA4/AdSense adapters.
     * @param {RequestInit} init - Code-owned read-only request method/body/headers; never a saved arbitrary URL/expression.
     * @param {object} context - Explicit required scope/verified identity and cooperative signal appropriate to this borrowed credential/request contract.
     * @param {Readonly<ReportSourceScope>} context.scope - Required exact verified grant identity or configured read-only OAuth permission.
     * @param {AbortSignal} context.signal - Cooperative owner cancellation.
     * @returns {Promise<any>} Explicit checked token/provider result or fixed failure; private causes and grants remain server-side.
     */
    request(
      url: string,
      init: RequestInit,
      context: {
        /** Required configured read-only Google scope; application authentication is a separate boundary. */
        scope: Readonly<ReportSourceScope>;
        /** Cooperative cancellation; uncooperative callbacks may retain slots/close indefinitely. */
        signal: AbortSignal;
      }
    ): Promise<any> {
      if (closed) {
        providerFailure('CLOSED');
      }
      if (
        Object.keys(binding).some(
          (k) =>
            binding[k as keyof ReportSourceScope] !==
            context.scope[k as keyof ReportSourceScope]
        )
      ) {
        providerFailure('DENIED');
      }
      if (active.size >= 4) {
        providerFailure('OVERLOAD');
      }
      /** Owned cooperative report-request signal; bound scope checked before acquisition. */
      const controller = new AbortController();
      /** Scoped cancellation callback releasing a reader/wait or aborting the owned request.
       * @returns {void} Result of this documented read/update/cleanup; borrowed resources remain host-owned.
       */
      const abort = () => controller.abort();
      context.signal.addEventListener('abort', abort, { once: true });
      if (context.signal.aborted) {
        abort();
      }
      active.add(controller);
      /** Owned finite request/refresh/retry timer cleared on actual settlement. */
      const timer = setTimeout(abort, 30000);
      /** Actual request/refresh promise retained until settlement and drained on disposal. */
      const job = (async () => {
        try {
          if (controller.signal.aborted) {
            providerFailure('CANCELLED');
          }
          /** Private short-lived token checked for scope/expiry/control characters; never public output. */
          const token = await options.credentials.getAccessToken({
            scope,
            signal: controller.signal,
          });

          if (controller.signal.aborted) {
            providerFailure('CANCELLED');
          }
          if (
            !token ||
            typeof token.accessToken !== 'string' ||
            !token.accessToken.length ||
            token.accessToken.length > 8192 ||
            // eslint-disable-next-line no-control-regex -- Intentionally matches control characters for validation or output sanitization.
            /[\x00-\x20\x7f]/.test(token.accessToken) ||
            !Number.isSafeInteger(token.expiresAt) ||
            token.expiresAt <= Date.now() ||
            !Array.isArray(token.scopes) ||
            !token.scopes.includes(scope)
          ) {
            providerFailure('DENIED');
          }
          // Keep work within finite retries/response bytes or actually owned cancellation handles.
          for (let attempt = 0; attempt < attempts; attempt++) {
            if (controller.signal.aborted) {
              providerFailure('CANCELLED');
            }
            if (token.expiresAt <= Date.now()) {
              providerFailure('DENIED');
            }
            let response: Response;
            try {
              response = await fetcher(url, {
                ...init,
                headers: {
                  ...init.headers,
                  authorization: `Bearer ${token.accessToken}`,
                },
                redirect: 'error',
                signal: controller.signal,
              });
            } catch (error) {
              providerFailure(
                controller.signal.aborted ? 'CANCELLED' : 'UNAVAILABLE',
                error
              );
            }
            if (controller.signal.aborted) {
              await response.body?.cancel().catch(() => {});
              providerFailure('CANCELLED');
            }
            if (response.ok) {
              return await boundedJson(response, controller.signal);
            }
            /** Provider HTTP status used only for the declared read-only retry policy. */
            const status = response.status;
            /** Provider retry hint; unsupported or above2 seconds stops retry instead of retrying early. */
            const retryAfter = response.headers.get('retry-after');
            let errorBody: any;
            try {
              errorBody = await boundedJson(response, controller.signal, 16384);
            } catch (error) {
              if (controller.signal.aborted) {
                providerFailure('CANCELLED');
              }
            }
            /** Recognized explicit quota status/reason; distinct from denied identity or empty rows. */
            const quota =
              status === 429 ||
              (status === 403 &&
                (errorBody?.error?.status === 'RESOURCE_EXHAUSTED' ||
                  (Array.isArray(errorBody?.error?.errors) &&
                    errorBody.error.errors.some((e: any) =>
                      [
                        'quotaExceeded',
                        'rateLimitExceeded',
                        'dailyLimitExceeded',
                        'userRateLimitExceeded',
                      ].includes(e?.reason)
                    ))));
            if (status === 401 || (status === 403 && !quota)) {
              providerFailure('DENIED');
            }
            if (
              (quota || [500, 502, 503, 504].includes(status)) &&
              attempt + 1 < attempts
            ) {
              let wait = 100 * 2 ** attempt;
              if (retryAfter !== null) {
                if (!/^\d{1,5}$/.test(retryAfter) || Number(retryAfter) > 2) {
                  providerFailure(quota ? 'QUOTA' : 'UNAVAILABLE');
                }
                wait = Math.max(wait, Number(retryAfter) * 1000);
              }
              await sleep(wait, controller.signal);
              continue;
            }
            providerFailure(quota ? 'QUOTA' : 'UNAVAILABLE');
          }
          providerFailure('UNAVAILABLE');
        } catch (error) {
          if (error instanceof ReportSourceError) {
            throw error;
          }
          providerFailure(
            controller.signal.aborted ? 'CANCELLED' : 'UNAVAILABLE',
            error
          );
        }
      })().finally(() => {
        clearTimeout(timer);
        active.delete(controller);
        jobs.delete(job);
        context.signal.removeEventListener('abort', abort);
      });
      jobs.add(job);
      return job;
    },
    /** Stop admission, abort cooperative work and await actual pending settlement. Borrowed credentials stay host-owned; credential-helper disposal drops its stored references without promising secure memory zeroization.
     * @returns {Promise<void>} Explicit checked token/provider result or fixed failure; private causes and grants remain server-side.
     */
    async dispose() {
      closed = true;
      // Keep work within finite retries/response bytes or actually owned cancellation handles.
      for (const c of active) {
        c.abort();
      }
      await Promise.allSettled([...jobs]);
    },
  };
}
/** Own explicit on-demand fixed-endpoint OAuth refresh exchanges under finite pending/time/byte limits. Host owns original consent/state/code flow and durable secret storage; no background refresh or persisted token cache is started.
 * @param {object} input - Private host-owned OAuth refresh grant and explicit one read-only scope; authorization-code consent/state flow remains host-owned.
 * @param {string} input.clientId - Private host OAuth client ID.
 * @param {string} input.clientSecret - Private client secret, never telemetry.
 * @param {string} input.refreshToken - Private previously consented grant.
 * @param {string} input.scope - Exactly GA4 or AdSense readonly scope.
 * @param {typeof fetch} [input.fetch] - Optional trusted explicit transport.
 * @returns {GoogleReportCredentials & {dispose():Promise<void>}} Explicit checked token/provider result or fixed failure; private causes and grants remain server-side.
 */
export function createGoogleReportCredentials(input: {
  /** Private configured OAuth client ID; not read from browser report JSON. */
  clientId: string;
  /** Private host-owned OAuth client secret, never logged or serialized into report results. */
  clientSecret: string;
  /** Private host-owned previously consented grant; never browser configuration. */
  refreshToken: string;
  /** Required configured read-only Google scope; application authentication is a separate boundary. */
  scope: typeof GA4_READONLY_SCOPE | typeof ADSENSE_READONLY_SCOPE;
  /** Optional trusted injected Fetch implementation; fixed code-owned endpoints/redirect policy remain authoritative. */
  fetch?: typeof fetch;
}): GoogleReportCredentials & {
  /** Stop admission, abort cooperative work and await actual pending settlement. Borrowed credentials stay host-owned; credential-helper disposal drops its stored references without promising secure memory zeroization.
   * @returns {Promise<void>} Explicit checked token/provider result or fixed failure; private causes and grants remain server-side.
   */
  dispose(): Promise<void>;
} {
  if (
    !input ||
    ![GA4_READONLY_SCOPE, ADSENSE_READONLY_SCOPE].includes(input.scope) ||
    !['clientId', 'clientSecret', 'refreshToken'].every(
      (k) =>
        typeof input[k as 'clientId'] === 'string' &&
        input[k as 'clientId'].length > 0 &&
        input[k as 'clientId'].length < 8192 &&
        !/[\r\n\0]/.test(input[k as 'clientId'])
    )
  ) {
    providerFailure('INVALID_QUERY');
  }
  /** One configured narrow read-only OAuth permission. */
  const scope = input.scope;
  /** Trusted explicit Fetch transport or platform default; no remote discovery. */
  const fetcher = input.fetch ?? globalThis.fetch;
  let secrets = {
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      refreshToken: input.refreshToken,
    },
    closed = false;
  /** Actual active cooperative request owners; maximum4 per helper. */
  const active = new Set<AbortController>();
  /** Actual unsettled trusted token/Fetch work; deadlines do not release ownership early. */
  const jobs = new Set<Promise<unknown>>();
  return {
    /** Acquire one explicit short-lived token for the configured permission under cooperative cancellation. Credential callbacks are trusted host code; no background cache/refresh or login flow is implied.
     * @param {object} context - Explicit required scope/verified identity and cooperative signal appropriate to this borrowed credential/request contract.
     * @param {string} context.scope - Required exact verified grant identity or configured read-only OAuth permission.
     * @param {AbortSignal} context.signal - Cooperative owner cancellation.
     * @returns {Promise<object>} Explicit checked token/provider result or fixed failure; private causes and grants remain server-side.
     */
    getAccessToken(context) {
      if (closed) {
        providerFailure('CLOSED');
      }
      if (context.scope !== scope) {
        providerFailure('DENIED');
      }
      if (active.size >= 4) {
        providerFailure('OVERLOAD');
      }
      /** Owned explicit refresh-exchange cancellation signal. */
      const c = new AbortController();
      /** Scoped cancellation callback releasing a reader/wait or aborting the owned request.
       * @returns {void} Result of this documented read/update/cleanup; borrowed resources remain host-owned.
       */
      const abort = () => c.abort();
      context.signal.addEventListener('abort', abort, { once: true });
      if (context.signal.aborted) {
        abort();
      }
      active.add(c);
      /** Owned finite request/refresh/retry timer cleared on actual settlement. */
      const timer = setTimeout(abort, 10000);
      /** Actual request/refresh promise retained until settlement and drained on disposal. */
      const job = (async () => {
        try {
          if (c.signal.aborted) {
            providerFailure('CANCELLED');
          }
          /** Owned fixed-endpoint response; error bodies never leak in client messages. */
          const response = await fetcher(
            'https://oauth2.googleapis.com/token',
            {
              method: 'POST',
              headers: { 'content-type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                client_id: secrets.clientId,
                client_secret: secrets.clientSecret,
                refresh_token: secrets.refreshToken,
                grant_type: 'refresh_token',
              }),
              redirect: 'error',
              signal: c.signal,
            }
          );
          if (!response.ok) {
            await response.body?.cancel().catch(() => {});
            providerFailure('UNAVAILABLE');
          }
          /** Parsed bounded private token JSON validated before projecting the token receipt. */
          const value = await boundedJson(response, c.signal, 16384);
          if (c.signal.aborted) {
            providerFailure('CANCELLED');
          }
          if (
            value.token_type !== 'Bearer' ||
            typeof value.access_token !== 'string' ||
            !Number.isSafeInteger(value.expires_in) ||
            value.expires_in < 1 ||
            value.expires_in > 86400 ||
            (value.scope !== undefined &&
              (typeof value.scope !== 'string' ||
                !value.scope.split(' ').includes(scope)))
          ) {
            providerFailure('DENIED');
          }
          return {
            accessToken: value.access_token,
            expiresAt: Date.now() + value.expires_in * 1000,
            scopes: [scope],
          };
        } catch (error) {
          if (error instanceof ReportSourceError) {
            throw error;
          }
          providerFailure(
            c.signal.aborted ? 'CANCELLED' : 'UNAVAILABLE',
            error
          );
        }
      })().finally(() => {
        clearTimeout(timer);
        context.signal.removeEventListener('abort', abort);
        active.delete(c);
        jobs.delete(job);
      });
      jobs.add(job);
      return job;
    },
    /** Stop admission, abort cooperative work and await actual pending settlement. Borrowed credentials stay host-owned; credential-helper disposal drops its stored references without promising secure memory zeroization.
     * @returns {Promise<void>} Explicit checked token/provider result or fixed failure; private causes and grants remain server-side.
     */
    async dispose() {
      closed = true;
      // Keep work within finite retries/response bytes or actually owned cancellation handles.
      for (const c of active) {
        c.abort();
      }
      await Promise.allSettled([...jobs]);
      secrets = { clientId: '', clientSecret: '', refreshToken: '' };
    },
  };
}
