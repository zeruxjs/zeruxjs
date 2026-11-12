import type {
  createSenderFeedbackService,
  SenderFeedbackInput,
} from './sender-feedback.js';
import { validateEmailAddress } from './validation.js';
import type {
  MarketingFeedback,
  createMarketingSuppressionService,
} from './suppression.js';
/** Provider-authenticated mail transport notification; not recipient-suppression input. */
export interface ProviderDeliveryNotification {
  /** Bounded provider identity; syntax alone is not provider authentication. */
  eventId: string;
  /** Explicit authenticated delivered/deferred/bounce/complaint outcome. */
  kind: 'delivered' | 'deferred';
  /** Optional authenticated provider epoch timestamp with bounded future skew. */
  at?: number;
}
export type VerifiedEmailNotification =
  | MarketingFeedback
  | ProviderDeliveryNotification;
export interface MarketingFeedbackHttpOptions {
  /** Provider-specific signature verification with replay-window checks is a host responsibility. */
  verifySignature: (
    body: Uint8Array,
    headers: Headers
  ) => Promise<boolean> | boolean;
  /** Trusted provider parser invoked only after signature success; must return inert event data. */
  parse: (
    body: Uint8Array,
    headers: Headers
  ) => Promise<VerifiedEmailNotification[]> | VerifiedEmailNotification[];
  /** Explicit committed legacy suppression service; no fallback is selected here. */
  suppression: ReturnType<typeof createMarketingSuppressionService>;
  /** Optional independent legacy account heuristic sink; failures do not roll back earlier stores. */
  reputation?: {
    /** Persist authenticated legacy account feedback through the supplied reputation service.
 * @param {{
      account: string;
      email: string;
      eventId: string;
      kind: 'hard-bounce' | 'soft-bounce' | 'complaint';
      at?: number;
    }} input - Authenticated private legacy account/recipient outcome; never public analytics labels.
 * @returns {Promise<unknown>} Private store outcome; failure produces a retryable endpoint failure without undoing prior stores.
 */
    recordFeedback(input: {
      /** Trusted provider-derived configured account, never an unsigned browser role claim. */
      account: string;
      /** Private authenticated/correlated recipient mailbox; exclude from metrics/audit labels. */
      email: string;
      /** Bounded provider identity; syntax alone is not provider authentication. */
      eventId: string;
      /** Explicit authenticated delivered/deferred/bounce/complaint outcome. */
      kind: 'hard-bounce' | 'soft-bounce' | 'complaint';
      /** Optional authenticated provider epoch timestamp with bounded future skew. */
      at?: number;
    }): Promise<unknown>;
  };
  /** Account attribution MUST be derived from trusted provider metadata. */
  feedbackAccount?: (event: MarketingFeedback) => string;
  /** Optional separately committed delivery-state sink requiring trusted reference resolution. */
  providerOutcomes?: {
    /** Persist one authenticated normalized provider delivery outcome.
 * @param {{
      eventId: string;
      provider: string;
      campaignId: string;
      messageId: string;
      kind:
        | 'hard-bounce'
        | 'soft-bounce'
        | 'complaint'
        | 'delivered'
        | 'deferred';
      occurredAt: number;
    }} event - Authenticated normalized provider event with trusted campaign/message correlation.
 * @returns {Promise<boolean>} Store-specific new/duplicate outcome; independent from suppression and correlated ledger commits.
 */
    record(event: {
      /** Bounded provider identity; syntax alone is not provider authentication. */
      eventId: string;
      /** Explicit trusted provider reference, never a user-selected endpoint. */
      provider: string;
      /** Trusted correlated opaque campaign reference; no recipient data embedded. */
      campaignId: string;
      /** Trusted exact recorded outbound identity; no fuzzy recipient matching. */
      messageId: string;
      /** Explicit authenticated delivered/deferred/bounce/complaint outcome. */
      kind:
        | 'hard-bounce'
        | 'soft-bounce'
        | 'complaint'
        | 'delivered'
        | 'deferred';
      /** Validated authenticated epoch observation timestamp. */
      occurredAt: number;
    }): Promise<boolean>;
  };
  /** Trusted exact provider/campaign/message/time attribution; no arbitrary endpoint fetch. */
  feedbackDelivery?: (event: VerifiedEmailNotification) => {
    /** Explicit trusted provider reference, never a user-selected endpoint. */
    provider: string;
    /** Trusted correlated opaque campaign reference; no recipient data embedded. */
    campaignId: string;
    /** Trusted exact recorded outbound identity; no fuzzy recipient matching. */
    messageId: string;
    /** Validated authenticated epoch observation timestamp. */
    occurredAt: number;
  };
  /** Required for correlated feedback; verifier must authenticate this timestamp with the raw body. */
  signatureTime?: (headers: Headers) => number;
  /** Configured signed replay window 1–600000ms, default 300000. */
  maxSignatureAgeMs?: number;
  /** Optional trusted epoch clock, default Date.now. */
  now?: () => number;
  /** Optional tenant-bound durable correlation sink; requires signed freshness and pure normalization. */
  correlatedFeedback?: {
    /** Explicit scoped correlated ledger, never discovered from request fields. */
    service: ReturnType<typeof createSenderFeedbackService>;
    /** Trusted pure mapping to the scoped correlated schema; it must not perform writes during validation. */
    normalize: (event: VerifiedEmailNotification) => SenderFeedbackInput;
  };
  /** Explicit validated route declaration, default /_email/feedback; host router owns matching. */
  path?: string;
  /** Streaming raw-byte ceiling 256–262144, default 65536. */
  maxBodyBytes?: number;
  /** Body-read observation timeout 100–30000ms, default 5000; host callbacks need separate deadlines. */
  timeoutMs?: number;
  /** Permits bounded signed event batches. Defaults to 100. */
  maxEvents?: number;
}
/** Fixed no-store/nosniff/no-referrer policy; no private provider detail is returned. */
const responseHeaders = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};
/** Bounded native provider identity syntax; authenticity remains with the signature verifier. */
const eventId = /^[A-Za-z0-9:_./-]{1,160}$/;
/** Configured account spelling required after trusted provider attribution. */
const trustedAccount = /^[a-z][a-z0-9_-]{0,63}$/;
/** Bounded opaque provider/campaign/message reference syntax, never a fetch URL. */
const trustedRef = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
/** Fixed remotely accepted outcome vocabulary; manual suppression is not a webhook event. */
const kinds = new Set([
  'hard-bounce',
  'soft-bounce',
  'complaint',
  'delivered',
  'deferred',
]);
/** Require explicit provider authentication/normalization and validate a complete batch before framework store updates.
 * @param {MarketingFeedbackHttpOptions} config - Trusted provider callbacks and private store bindings with finite body/event/freshness policies.
 * @returns {object} Explicit mounted endpoint; trusted parser/normalizer callbacks are not sandboxed and separate stores are not atomic.
 */
export function createMarketingFeedbackEndpoint(
  config: MarketingFeedbackHttpOptions
) {
  if (
    !config ||
    typeof config.verifySignature !== 'function' ||
    typeof config.parse !== 'function' ||
    typeof config.suppression?.recordFeedback !== 'function' ||
    (config.reputation && typeof config.feedbackAccount !== 'function') ||
    Boolean(config.providerOutcomes) !== Boolean(config.feedbackDelivery) ||
    (config.providerOutcomes && typeof config.feedbackDelivery !== 'function')
  ) {
    throw new TypeError('Authenticated provider feedback callbacks required');
  }
  if (
    config.correlatedFeedback &&
    (typeof config.signatureTime !== 'function' ||
      typeof config.correlatedFeedback.normalize !== 'function' ||
      typeof config.correlatedFeedback.service?.validateFeedback !==
        'function' ||
      typeof config.correlatedFeedback.service.recordFeedback !== 'function')
  ) {
    throw new TypeError(
      'Correlated feedback requires signed freshness and normalization'
    );
  }
  if (
    (config.signatureTime !== undefined &&
      typeof config.signatureTime !== 'function') ||
    (config.maxSignatureAgeMs !== undefined && !config.signatureTime) ||
    (config.now !== undefined && typeof config.now !== 'function')
  ) {
    throw new TypeError('Invalid feedback clock');
  }
  /** Trusted epoch clock, default Date.now. */
  const clock = config.now ?? Date.now;
  /** Bounded signed freshness age, default five minutes; not durable deduplication. */
  const signatureAge = config.maxSignatureAgeMs ?? 300000;
  if (
    !Number.isSafeInteger(signatureAge) ||
    signatureAge < 1 ||
    signatureAge > 600000
  ) {
    throw new RangeError('Invalid signature replay window');
  }
  /** Explicit validated host route declaration; handle relies on the host router for matching. */
  const path = config.path ?? '/_email/feedback';
  if (
    !/^\/[A-Za-z0-9/_-]{2,120}$/.test(path) ||
    path.includes('//') ||
    path.endsWith('/') ||
    path.includes('..')
  ) {
    throw new TypeError('Invalid provider feedback path');
  }
  /** Streaming body ceiling independent of any untrusted content-length claim. */
  const maxBytes = config.maxBodyBytes ?? 65_536;
  /** Owned request-reader observation interval; custom verifier/store callbacks need host deadlines. */
  const timeout = config.timeoutMs ?? 5000;
  /** Configured authenticated batch ceiling, default one hundred; empty batches remain compatible. */
  const maxEvents = config.maxEvents ?? 100;
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 256 ||
    maxBytes > 262_144 ||
    !Number.isSafeInteger(timeout) ||
    timeout < 100 ||
    timeout > 30_000 ||
    !Number.isSafeInteger(maxEvents) ||
    maxEvents < 1 ||
    maxEvents > 1000
  ) {
    throw new RangeError('Invalid feedback request limit');
  }
  /** Return only a fixed status with no provider body/cause in the response.
   * @param {number} status - Explicit bounded HTTP outcome selected by the endpoint.
   * @returns {Response} No-store empty response, never private store/native diagnostics. */
  const response = (status: number) =>
    new Response(null, { status, headers: responseHeaders });
  /** Bound raw request reading, require signed freshness when configured and persist only fully validated authenticated events.
   * @param {Request} request - Explicit raw Fetch request; host router owns exact mount selection.
   * @returns {Promise<Response>} No-store fixed status response; partial persistence can precede a 503 and needs idempotent host stores.
   */
  async function handle(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response(null, {
        status: 405,
        headers: { ...responseHeaders, allow: 'POST' },
      });
    }
    /** Untrusted declared byte count used only for preflight; streaming bytes are checked independently. */
    const length = request.headers.get('content-length');
    if (
      length !== null &&
      (!/^\d+$/.test(length) || Number(length) > maxBytes)
    ) {
      return response(413);
    }
    if (
      !/^application\/json(?:\s*;.*)?$/i.test(
        request.headers.get('content-type') ?? ''
      )
    ) {
      return response(415);
    }
    /** Owned raw-body reader; abort/timer observation and lock are always released. */
    const reader = request.body?.getReader();
    if (!reader) {
      return response(400);
    }
    let timedOut = false,
      oversize = false;
    /** Bounded raw byte copies retained only for one signature/parser invocation. */
    const parts: Buffer[] = [];
    let bytes = 0;
    /** Request cooperative reader cancellation when the HTTP caller aborts.

 * @returns {void} Cancellation requested; active native/user callbacks are not force-stopped. */
    const abort = () => {
      void reader.cancel().catch(() => {});
    };
    request.signal.addEventListener('abort', abort, { once: true });
    if (request.signal.aborted) {
      abort();
    }
    /** Owned body-read deadline cleared before signature parsing or persistence. */
    const timer = setTimeout(() => {
      timedOut = true;
      void reader.cancel().catch(() => {});
    }, timeout);
    timer.unref?.();
    try {
      // Bound actual streamed bytes independently of content-length before signature/parsing.
      for (;;) {
        /** One raw reader result; streamed byte count is checked before retaining its chunk. */
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        bytes += value.byteLength;
        if (bytes > maxBytes) {
          oversize = true;
          await reader.cancel().catch(() => {});
          break;
        }
        parts.push(Buffer.from(value));
      }
    } catch {
      return response(timedOut ? 408 : 400);
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener('abort', abort);
      reader.releaseLock();
    }
    if (timedOut || request.signal.aborted) {
      return response(408);
    }
    if (oversize) {
      return response(413);
    }
    /** Exact bounded bytes authenticated before parsing; never logged by this endpoint. */
    const raw = Buffer.concat(parts);
    if (config.signatureTime) {
      try {
        /** Host-extracted timestamp that the configured signature verifier must authenticate. */
        const signedAt = config.signatureTime(request.headers);
        /** One trusted clock read for signed freshness/skew checks. */
        const now = clock();
        if (
          !Number.isSafeInteger(now) ||
          !Number.isSafeInteger(signedAt) ||
          signedAt < 0 ||
          signedAt > now + 60000 ||
          now - signedAt > signatureAge
        ) {
          return response(401);
        }
      } catch {
        return response(401);
      }
    }
    let verified = false;
    try {
      verified = (await config.verifySignature(raw, request.headers)) === true;
    } catch {
      return response(401);
    }
    if (!verified) {
      return response(401);
    }
    let events: VerifiedEmailNotification[];
    try {
      events = await config.parse(raw, request.headers);
    } catch {
      return response(400);
    }
    if (
      !Array.isArray(events) ||
      events.length > maxEvents ||
      events.some((e) => !e || typeof e !== 'object')
    ) {
      return response(400);
    }
    type Ready = {
      /** Private parsed event retained only while the authenticated batch is being processed. */
      event: VerifiedEmailNotification;
      /** Explicit authenticated delivered/deferred/bounce/complaint outcome. */
      kind:
        | 'hard-bounce'
        | 'soft-bounce'
        | 'complaint'
        | 'delivered'
        | 'deferred';
      /** Trusted provider-derived configured account, never an unsigned browser role claim. */
      account?: string;
      /** Validated private provider delivery-state write prepared before any framework persistence. */
      outcome?: {
        /** Bounded provider identity; syntax alone is not provider authentication. */
        eventId: string;
        /** Explicit trusted provider reference, never a user-selected endpoint. */
        provider: string;
        /** Trusted correlated opaque campaign reference; no recipient data embedded. */
        campaignId: string;
        /** Trusted exact recorded outbound identity; no fuzzy recipient matching. */
        messageId: string;
        /** Explicit authenticated delivered/deferred/bounce/complaint outcome. */
        kind:
          | 'hard-bounce'
          | 'soft-bounce'
          | 'complaint'
          | 'delivered'
          | 'deferred';
        /** Validated authenticated epoch observation timestamp. */
        occurredAt: number;
      };
    };
    /** Fully validated framework write intents; validation alone does not execute persistence. */
    const prepared: Ready[] = [];
    /** Private normalized per-intent records for the explicit tenant-bound durable ledger. */
    const correlated = new Map<Ready, SenderFeedbackInput>();
    /** Request-local identity/meaning comparisons; not a persistent deduplication store. */
    const batchIds = new Map<string, string>();
    // Resolve/validate ALL signed provider events before any suppression or reputation writes.
    // This does not provide multi-store atomicity; retries must be idempotent across stores.
    for (const event of events) {
      if (
        typeof event.kind !== 'string' ||
        !kinds.has(event.kind) ||
        typeof event.eventId !== 'string' ||
        !eventId.test(event.eventId)
      ) {
        return response(400);
      }
      /** Validated allowed provider outcome, separate from sender/recipient permission. */
      const kind = event.kind as Ready['kind'];
      let normalized: SenderFeedbackInput | undefined;
      if (config.correlatedFeedback) {
        try {
          normalized = config.correlatedFeedback.normalize(event);
          if (
            normalized.eventId !== event.eventId ||
            normalized.kind !== kind ||
            (event.at !== undefined && normalized.at !== event.at)
          ) {
            return response(400);
          }
          config.correlatedFeedback.service.validateFeedback(normalized);
          normalized = {
            ...normalized,
            email:
              typeof normalized.email === 'string'
                ? normalized.email
                : { ...normalized.email },
          };
        } catch {
          return response(400);
        }
      }
      // Duplicate records in a signed batch are harmless only when their identity and meaning agree.
      /** Private normalized meaning comparison for duplicate IDs in this one signed batch. */
      const identity = JSON.stringify([
        kind,
        'email' in event ? event.email : null,
        event.at ?? null,
        normalized ?? null,
      ]);
      /** Earlier same-ID meaning; conflicting reuse rejects the complete batch before writes. */
      const previous = batchIds.get(event.eventId);
      if (previous !== undefined) {
        if (previous !== identity) {
          return response(400);
        }
        continue;
      }
      batchIds.set(event.eventId, identity);
      if (
        event.at !== undefined &&
        (!Number.isSafeInteger(event.at) ||
          event.at < 0 ||
          event.at > clock() + 300_000)
      ) {
        return response(400);
      }
      /** True only for delivered/deferred events requiring the explicit delivery-state sink. */
      const delivery = kind === 'delivered' || kind === 'deferred';
      if (delivery && !config.providerOutcomes) {
        return response(503);
      }
      if (!delivery) {
        try {
          validateEmailAddress((event as MarketingFeedback).email);
        } catch {
          return response(400);
        }
      }
      let account: string | undefined;
      if (config.reputation && !delivery) {
        try {
          account = config.feedbackAccount!(event as MarketingFeedback);
        } catch {
          return response(503);
        }
        if (typeof account !== 'string' || !trustedAccount.test(account)) {
          return response(400);
        }
      }
      let outcome: Ready['outcome'];
      if (config.providerOutcomes) {
        let ref: ReturnType<
          NonNullable<MarketingFeedbackHttpOptions['feedbackDelivery']>
        >;
        try {
          ref = config.feedbackDelivery!(event);
        } catch {
          return response(503);
        }
        if (
          !ref ||
          typeof ref !== 'object' ||
          ![ref.provider, ref.campaignId, ref.messageId].every(
            (x) => typeof x === 'string' && trustedRef.test(x)
          ) ||
          !Number.isSafeInteger(ref.occurredAt) ||
          ref.occurredAt < 0 ||
          ref.occurredAt > clock() + 300_000
        ) {
          return response(400);
        }
        outcome = { ...ref, eventId: event.eventId, kind };
      }
      /** Validated private event/account/outcome intent, persisted only after the full batch is prepared. */
      const ready: Ready = { event, kind, account, outcome };
      if (normalized) {
        correlated.set(ready, normalized);
      }
      prepared.push(ready);
    }
    // Persist only fully validated intents; earlier stores can remain committed if a later sink fails.
    for (const ready of prepared) {
      try {
        if (request.signal.aborted) {
          return response(408);
        }
        if (correlated.has(ready)) {
          await config.correlatedFeedback!.service.recordFeedback(
            correlated.get(ready)!
          );
        }
        if (ready.kind !== 'delivered' && ready.kind !== 'deferred') {
          await config.suppression.recordFeedback(
            ready.event as MarketingFeedback
          );
          if (config.reputation) {
            await config.reputation.recordFeedback({
              account: ready.account!,
              email: (ready.event as MarketingFeedback).email,
              eventId: ready.event.eventId,
              kind: ready.kind,
              at: ready.event.at,
            });
          }
        }
        if (ready.outcome) {
          await config.providerOutcomes!.record(ready.outcome);
        }
      } catch {
        return response(503);
      }
    }
    return response(204);
  }
  return { path, handle, routes: () => [{ pattern: path, handler: handle }] };
}
