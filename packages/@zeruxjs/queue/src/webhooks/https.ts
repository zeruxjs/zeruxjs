import { request } from 'node:https';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import {
  fail,
  fields,
  number,
  type WebhookTransport,
  type WebhookResponse,
} from './contracts.js';
/** Explicit IPv4 special/private subnet policy; not a complete routing/egress guarantee. */
const denied = new BlockList();
// Populate only the fixed denied IPv4 subnets; no endpoint is contacted.
for (const [ip, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  denied.addSubnet(ip, prefix, 'ipv4');
}
/** Apply the explicit IPv4 special/private-address denylist. IPv6/mapped/transition forms fail closed; deployment egress controls remain required.
 * @param {string} address - Resolved or literal IP string; no DNS lookup occurs here.
 * @returns {boolean} Whether this IPv4 value passes the built-in subset, before separate host approval.
 */
export function isWebhookAddressAllowed(address: string): boolean {
  return isIP(address) === 4 && !denied.check(address, 'ipv4');
}
/** Validate a private registered HTTPS destination with exact origins and no credentials/query/fragment. This is not public caller endpoint discovery.
 * @param {string} value - Host-registry destination, bounded to 2048 characters.
 * @param {readonly string[]} origins - Explicit exact HTTPS-origin allowlist.
 * @returns {URL} Parsed destination; connection-time lookup must independently validate resolved addresses.
 */
export function webhookURL(value: string, origins: readonly string[]): URL {
  if (
    typeof value !== 'string' ||
    value.length > 2048 ||
    // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
    /[\x00-\x20\x7f]/.test(value)
  ) {
    throw fail('DESTINATION_DENIED');
  }
  let target: URL;
  try {
    target = new URL(value);
  } catch {
    throw fail('DESTINATION_DENIED');
  }
  if (
    target.protocol !== 'https:' ||
    target.username ||
    target.password ||
    target.search ||
    target.hash ||
    !origins.includes(target.origin) ||
    target.hostname.includes(':') ||
    (isIP(target.hostname) && !isWebhookAddressAllowed(target.hostname))
  ) {
    throw fail('DESTINATION_DENIED');
  }
  return target;
}
export interface WebhookHttpsOptions {
  /** One through 32 exact HTTPS origins; host credentials remain private. */
  allowedOrigins: readonly string[];
  /** Actual unsettled native request ceiling, default 16 and maximum 128. */
  maxPending?: number;
  /** Response byte ceiling, default 8192, valid zero through 65536. */
  maxResponseBytes?: number;
  /** Trusted resolver hook for tests/deployment DNS. Every returned address is still validated. */
  resolve?: (host: string) => Promise<readonly string[]>;
  /** Required host egress approval, in addition to built-in special-address denial. */
  approveAddress: (host: string, address: string) => boolean;
  /** Optional trusted native request injection; host must separately qualify any replacement connector. */
  request?: typeof request;
}
/** Own bounded single-attempt Node HTTPS requests with connection-time DNS/address approval, verified TLS and redirects denied. Starts no connection on import/configuration.
 * @param {WebhookHttpsOptions} options - Exact origins, mandatory host egress approval and optional trusted native hooks/bounds.
 * @returns {object} Explicit transport with awaited close and fixed counters; no global pool or borrowed resolver is closed.
 */
export function createWebhookHttpsTransport(options: WebhookHttpsOptions) {
  fields(options, [
    'allowedOrigins',
    'maxPending',
    'maxResponseBytes',
    'resolve',
    'approveAddress',
    'request',
  ]);
  if (
    !Array.isArray(options.allowedOrigins) ||
    !options.allowedOrigins.length ||
    options.allowedOrigins.length > 32 ||
    typeof options.approveAddress !== 'function' ||
    (options.resolve !== undefined && typeof options.resolve !== 'function')
  ) {
    throw fail('INVALID_TRANSPORT');
  }
  /** Validated exact HTTPS-origin snapshot, independent of caller mutation. */
  const origins = options.allowedOrigins.map((origin) => {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw fail('INVALID_TRANSPORT');
    }
    if (parsed.origin !== origin || parsed.protocol !== 'https:') {
      throw fail('INVALID_TRANSPORT');
    }
    return origin;
  });
  /** Borrowed required synchronous host egress approval for every resolved/literal address. */
  const approve = options.approveAddress;
  /** Borrowed explicit resolver or native IPv4 all-address lookup; every returned address is validated.
   * @param {string} host - Native connection hostname, not an arbitrary caller endpoint.
   * @returns {Promise<readonly string[]>} All native IPv4 answers, independently checked before connecting.
   */
  const resolve =
    options.resolve ??
    (async (host: string) =>
      (await lookup(host, { all: true, family: 4, verbatim: true })).map(
        (item) => item.address
      ));
  if (options.request !== undefined && typeof options.request !== 'function') {
    throw fail('INVALID_TRANSPORT');
  }
  /** Borrowed explicit connector or verified native HTTPS request implementation. */
  const nativeRequest = options.request ?? request;
  /** Validated actual unsettled request ceiling, default 16. */
  const max = number(options.maxPending ?? 16, 1, 128);
  /** Validated bounded response byte ceiling, default 8 KiB. */
  const responseLimit = number(options.maxResponseBytes ?? 8192, 0, 65536);
  let closed = false;
  /** Actually unsettled attempt promises, retained through native and DNS cleanup. */
  const active = new Set<Promise<unknown>>();
  /** Owned per-attempt abort controllers signalled during close. */
  const controllers = new Set<AbortController>();
  /** Owned bounded explicit HTTPS transport; no automatic timer/worker/retry loop. */
  const transport: WebhookTransport & {
    /** Stop admission, signal every owned request and await native plus DNS settlement. An uncooperative injected resolver may delay close instead of freeing capacity early.
     * @returns {Promise<void>} Actual admitted-work drain; abort never proves remote rollback.
     */
    close(): Promise<void>;
    /** Report fixed process-local closed/pending counters without destination/principal/payload labels.
     * @returns {object} Native unsettled admission status, not receiver durability evidence.
     */
    status(): {
      /** Actually unsettled attempts, including DNS cleanup; not merely waiting callers. */
      pending: number;
      /** Whether transport admission has permanently stopped. */
      closed: boolean;
    };
  } = {
    contract: 'webhook-https-v1',
    /** Check only static destination syntax/origin before claiming work; no DNS or request occurs here.
     * @param {string} url - Private registered destination selected under current tenant policy.
     * @returns {void} Rejects disallowed destinations before outbound side effects.
     */
    validate(url) {
      webhookURL(url, origins);
    },

    /** Perform one bounded approved attempt, retaining native requests and DNS work through actual settlement. Post-connect ambiguous failures are uncertain and are never replayed here.
     * @param {Parameters<WebhookTransport["send"]>[0]} input - Approved URL, exact signed bytes/headers, owned signal and finite deadline.
     * @returns {Promise<WebhookResponse>} Complete bounded HTTP facts or a fixed known-not-sent/uncertain failure.
     */
    async send(input) {
      fields(input, ['url', 'body', 'headers', 'signal', 'timeoutMs']);
      fields(input.headers, [
        'x-zerux-webhook-id',
        'x-zerux-webhook-timestamp',
        'x-zerux-webhook-signature',
        'x-zerux-webhook-schema',
      ]);
      if (
        Object.values(input.headers).some(
          (value) =>
            typeof value !== 'string' ||
            value.length > 256 ||
            // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
            /[\x00-\x1f\x7f]/.test(value)
        )
      ) {
        throw fail('NOT_SENT');
      }
      if (closed || active.size >= max) {
        throw fail(closed ? 'TRANSPORT_CLOSED' : 'TRANSPORT_OVERLOAD');
      }
      /** Validated private destination; hostname/address checks still occur at connection time. */
      const target = webhookURL(input.url, origins);
      number(input.timeoutMs, 1, 30000);
      if (
        !(input.signal instanceof AbortSignal) ||
        typeof input.body !== 'string' ||
        Buffer.byteLength(input.body) > 65536 ||
        input.signal.aborted
      ) {
        throw fail('NOT_SENT');
      }
      if (
        isIP(target.hostname) &&
        approve(target.hostname, target.hostname) !== true
      ) {
        throw fail('ADDRESS_DENIED');
      }
      /** Owned per-attempt signal; cancellation does not imply remote side-effect rollback. */
      const controller = new AbortController();
      /** Forward the initiating attempt cancellation without releasing capacity before settlement.
       * @returns {void} Signals the owned request while native/DNS work remains retained.
       */
      const abort = () => controller.abort();
      controllers.add(controller);
      input.signal.addEventListener('abort', abort, { once: true });
      /** Every actual native lookup promise retained until completion even after cancellation. */
      const nativeLookups: Promise<unknown>[] = [];
      /** Single native request lifetime plus all lookup settlement and listener cleanup. */
      const job = new Promise<WebhookResponse>((resolveResponse, reject) => {
        let secured = false,
          ended = false,
          answer: WebhookResponse | undefined,
          error: Error | undefined;
        /** Owned finite attempt deadline timer, cleared on native request settlement. */
        const timer = setTimeout(() => controller.abort(), input.timeoutMs);
        let req: ReturnType<typeof request>;
        try {
          req = nativeRequest(
            target,
            {
              method: 'POST',
              agent: false,
              rejectUnauthorized: true,
              family: 4,
              signal: controller.signal,
              headers: {
                ...input.headers,
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(input.body),
              },
              maxHeaderSize: 8192,
              lookup: ((
                host: string,
                _settings: unknown,
                callback: (
                  error: Error | null,
                  address?: string,
                  family?: number
                ) => void
              ) => {
                /** Connection-time lookup promise whose late result cannot connect after abort. */
                const pending = Promise.resolve()
                  .then(() => resolve(host))
                  .then(
                    (addresses) => {
                      if (
                        !Array.isArray(addresses) ||
                        !addresses.length ||
                        addresses.length > 32
                      ) {
                        throw fail('ADDRESS_DENIED');
                      }
                      /** Copied resolved IPv4 answers; all must pass built-in and host egress policy before one is pinned. */
                      const approved = [...addresses];
                      if (
                        approved.some(
                          (address) =>
                            !isWebhookAddressAllowed(address) ||
                            approve(host, address) !== true
                        )
                      ) {
                        throw fail('ADDRESS_DENIED');
                      }
                      if (controller.signal.aborted) {
                        throw fail('NOT_SENT');
                      }
                      callback(null, approved[0], 4);
                    },
                    (cause) => {
                      throw fail('DNS_FAILED', cause);
                    }
                  )
                  .catch((cause) => callback(cause));
                nativeLookups.push(pending);
              }) as any,
            },
            (response) => {
              let bytes = 0;
              answer = {
                status: response.statusCode ?? 0,
                ...(typeof response.headers['retry-after'] === 'string'
                  ? {
                      retryAfter: response.headers['retry-after'].slice(0, 128),
                    }
                  : {}),
              };
              if (answer.status >= 300 && answer.status < 400) {
                response.destroy();
                return;
              }
              response.on('data', (chunk: Buffer) => {
                bytes += chunk.length;
                if (bytes > responseLimit) {
                  error = fail('OUTCOME_UNKNOWN');
                  response.destroy();
                  req.destroy();
                }
              });
              response.on('aborted', () => {
                if (!error) {
                  error = fail('OUTCOME_UNKNOWN');
                }
              });
              response.on('error', () => {
                error = fail('OUTCOME_UNKNOWN');
              });
              response.on('end', () => {
                ended = true;
              });
            }
          );
        } catch (cause) {
          clearTimeout(timer);
          reject(fail('NOT_SENT', cause));
          return;
        }
        req.on('socket', (socket) => {
          socket.once('secureConnect', () => {
            secured = true;
          });
        });
        req.on('error', (cause) => {
          if (
            cause instanceof Error &&
            'code' in cause &&
            cause.code === 'ADDRESS_DENIED'
          ) {
            error = cause;
          } else {
            error = fail(secured ? 'OUTCOME_UNKNOWN' : 'NOT_SENT', cause);
          }
        });
        req.on('close', () => {
          clearTimeout(timer);
          if (answer && answer.status >= 300 && answer.status < 400) {
            resolveResponse(answer);
          } else if (error) {
            reject(error);
          } else if (
            answer &&
            ended &&
            answer.status >= 100 &&
            answer.status <= 599
          ) {
            resolveResponse(answer);
          } else {
            reject(fail(secured ? 'OUTCOME_UNKNOWN' : 'NOT_SENT'));
          }
        });
        try {
          req.end(input.body);
        } catch (cause) {
          error = fail(secured ? 'OUTCOME_UNKNOWN' : 'NOT_SENT', cause);
          req.destroy();
        }
      }).finally(async () => {
        await Promise.allSettled(nativeLookups);
        controllers.delete(controller);
        input.signal.removeEventListener('abort', abort);
      });
      active.add(job);
      try {
        return await job;
      } finally {
        active.delete(job);
      }
    },
    /** Stop admission, signal every owned request and await native plus DNS settlement. An uncooperative injected resolver may delay close instead of freeing capacity early.
     * @returns {Promise<void>} Actual admitted-work drain; abort never proves remote rollback.
     */
    async close() {
      closed = true;
      // Signal all owned requests before waiting for their actual native/DNS cleanup.
      for (const controller of controllers) {
        controller.abort();
      }
      await Promise.allSettled([...active]);
    },
    /** Report fixed process-local closed/pending counters without destination/principal/payload labels.
     * @returns {object} Native unsettled admission status, not receiver durability evidence.
     */
    status() {
      return { pending: active.size, closed };
    },
  };
  return transport;
}
