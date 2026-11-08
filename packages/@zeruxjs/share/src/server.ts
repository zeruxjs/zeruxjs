import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { validatedShareUrl } from "./url.js";
export interface ShortLinkRecord {
  schema: 1;
  scope: string;
  slug: string;
  tenant: string;
  owner: string;
  destination: string;
  revision: string;
  createdAt: number;
  expiresAt: number | null;
  status: 301 | 302 | 307 | 308;
  editable: boolean;
  revocable: boolean;
  revoked: boolean;
}
export interface ShortLinkStore {
  readonly capability: "short-links-cas-v1";
  readonly durable: true;
  /** Linearizable create-only reservation; never reuse a slug, even after expiry/revocation. */
  reserve(
    key: string,
    value: Readonly<ShortLinkRecord>,
    signal: AbortSignal,
  ): Promise<boolean>;
  read(key: string, signal: AbortSignal): Promise<ShortLinkRecord | null>;
  compareAndSwap(
    key: string,
    expectedRevision: string,
    value: Readonly<ShortLinkRecord>,
    signal: AbortSignal,
  ): Promise<boolean>;
}
export interface ShortLinkPrincipal {
  tenant: string;
  subject: string;
  /** Trusted host grant, still restricted to this tenant. */ manageTenant?: boolean;
}
export type ShortLinkOperation = "create" | "read" | "edit" | "revoke";
export interface ShortLinkOptions {
  origin: string;
  prefix?: string;
  store: ShortLinkStore;
  authorize(
    context: unknown,
    operation: ShortLinkOperation,
    signal: AbortSignal,
  ): Promise<ShortLinkPrincipal | null> | ShortLinkPrincipal | null;
  allowedOrigins: readonly string[];
  allowDestination?: (destination: string) => boolean;
  reservedPaths?: readonly string[];
  defaultTtlMs?: number;
  maxTtlMs?: number;
  /** Explicitly enables permanent redirects with the required immutable/nonexpiring policy. */ permanentCacheSeconds?: number;
  timeoutMs?: number;
  maxPending?: number;
  now?: () => number;
  analytics?: {
    key: Uint8Array;
    consent(request: Request): boolean;
    record(
      event: Readonly<{
        schema: 1;
        link: string;
        day: string;
        action: "redirect";
      }>,
      signal: AbortSignal,
    ): void | Promise<void>;
    maxPending?: number;
    timeoutMs?: number;
  };
}
export interface CreateShortLink {
  slug?: string;
  destination: string;
  expiresAt?: number | null;
  status?: 301 | 302 | 307 | 308;
  editable?: boolean;
  revocable?: boolean;
}
export interface ShortLinkControl {
  signal?: AbortSignal;
  timeoutMs?: number;
}
export class ShortLinkError extends Error {
  constructor(
    readonly code:
      | "INVALID"
      | "DENIED"
      | "CONFLICT"
      | "UNAVAILABLE"
      | "CLOSED"
      | "LIMIT"
      | "CANCELLED"
      | "DEADLINE",
    readonly outcome: "not-started" | "unknown" = "not-started",
    cause?: unknown,
    readonly uncertainSlug?: string,
  ) {
    super(`Short link operation failed (${code})`, { cause });
    this.name = "ShortLinkError";
  }
}
const fail = (code: ShortLinkError["code"]): never => {
  throw new ShortLinkError(code);
};
function plain(
  v: unknown,
  keys: readonly string[],
): asserts v is Record<string, any> {
  if (
    !v ||
    typeof v !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(v)) ||
    Reflect.ownKeys(v).some(
      (k) =>
        typeof k !== "string" ||
        !keys.includes(k) ||
        !("value" in Object.getOwnPropertyDescriptor(v, k)!),
    )
  )
    fail("INVALID");
}
const integer = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
const opaque = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(v);
function origin(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
    /[\x00-\x20\x7f\\]/.test(value)
  )
    return fail("INVALID");
  const u = new URL(validatedShareUrl(value));
  if (u.pathname !== "/" || u.search || u.hash) return fail("INVALID");
  return u.origin;
}
const recordKeys = [
  "schema",
  "scope",
  "slug",
  "tenant",
  "owner",
  "destination",
  "revision",
  "createdAt",
  "expiresAt",
  "status",
  "editable",
  "revocable",
  "revoked",
];
/** Private server service. No default memory backend, management HTTP routes or listener. */
export function createShortLinkService(input: ShortLinkOptions) {
  plain(input, [
    "origin",
    "prefix",
    "store",
    "authorize",
    "allowedOrigins",
    "allowDestination",
    "reservedPaths",
    "defaultTtlMs",
    "maxTtlMs",
    "permanentCacheSeconds",
    "timeoutMs",
    "maxPending",
    "now",
    "analytics",
  ]);
  if (
    input.store?.capability !== "short-links-cas-v1" ||
    input.store.durable !== true ||
    ["reserve", "read", "compareAndSwap"].some(
      (k) => typeof (input.store as any)[k] !== "function",
    ) ||
    typeof input.authorize !== "function" ||
    (input.now !== undefined && typeof input.now !== "function") ||
    (input.allowDestination !== undefined &&
      typeof input.allowDestination !== "function")
  )
    fail("INVALID");
  const publicOrigin = origin(input.origin),
    prefix = input.prefix ?? "/s/";
  if (
    typeof prefix !== "string" ||
    !/^\/(?:[A-Za-z0-9][A-Za-z0-9_-]*\/)*$/.test(prefix) ||
    prefix.length > 128
  )
    fail("INVALID");
  const builtins = [
    "api",
    "admin",
    "auth",
    "login",
    "logout",
    "health",
    "ready",
    "metrics",
    "robots.txt",
    "sitemap.xml",
    "trust.txt",
    "favicon.ico",
    "assets",
    "public",
    "_tags",
    "_actions",
    ".well-known",
  ];
  if (prefix !== "/" && builtins.includes(prefix.split("/")[1].toLowerCase()))
    fail("DENIED");
  if (
    !Array.isArray(input.allowedOrigins) ||
    !input.allowedOrigins.length ||
    input.allowedOrigins.length > 32 ||
    !Array.isArray(input.reservedPaths ?? []) ||
    (input.reservedPaths?.length ?? 0) > 128
  )
    fail("INVALID");
  const allowed = new Set(input.allowedOrigins.map(origin)),
    reserved = [
      ...builtins.map((v) => "/" + v),
      ...(input.reservedPaths ?? []),
    ];
  for (const path of reserved)
    if (
      typeof path !== "string" ||
      !path.startsWith("/") ||
      path.startsWith("//") ||
      path.includes("..") ||
      // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
      /[\x00-\x20\x7f\\?#%]/.test(path)
    )
      fail("INVALID");
  if (
    prefix !== "/" &&
    reserved.some((path) =>
      prefix
        .toLowerCase()
        .startsWith(path.toLowerCase().replace(/\/$/, "") + "/"),
    )
  )
    fail("DENIED");
  const maxTtl = input.maxTtlMs ?? 31536000000,
    defaultTtl = input.defaultTtlMs ?? 2592000000,
    timeout = input.timeoutMs ?? 5000,
    maxPending = input.maxPending ?? 32,
    permanent = input.permanentCacheSeconds;
  if (
    !integer(maxTtl, 1, 31536000000) ||
    !integer(defaultTtl, 1, maxTtl) ||
    !integer(timeout, 1, 60000) ||
    !integer(maxPending, 1, 128) ||
    (permanent !== undefined && !integer(permanent, 1, 31536000))
  )
    fail("INVALID");
  const store = input.store,
    authorize = input.authorize,
    now = input.now ?? Date.now,
    allowDestination = input.allowDestination,
    scope = publicOrigin + prefix;
  const lifetime = new AbortController(),
    pending = new Set<Promise<unknown>>(),
    clicks = new Set<Promise<unknown>>();
  let closed = false,
    closing: Promise<void> | undefined,
    dropped = 0,
    analyticsErrors = 0;
  const analytics = (() => {
    const config = input.analytics;
    if (config)
      plain(config, ["key", "consent", "record", "maxPending", "timeoutMs"]);
    return config && { ...config };
  })();
  if (analytics) {
    plain(analytics, ["key", "consent", "record", "maxPending", "timeoutMs"]);
    if (
      !(analytics.key instanceof Uint8Array) ||
      analytics.key.length !== 32 ||
      typeof analytics.consent !== "function" ||
      typeof analytics.record !== "function" ||
      !integer(analytics.maxPending ?? 16, 1, 128) ||
      !integer(analytics.timeoutMs ?? 1000, 1, 10000)
    )
      fail("INVALID");
  }
  const clickKey = analytics && Buffer.from(analytics.key);
  function clock() {
    const value = now();
    if (!integer(value, 0, 253402300799999)) return fail("INVALID");
    return value;
  }
  function slug(value: unknown): asserts value is string {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{3,64}$/.test(value))
      return fail("INVALID");
    const path = (prefix + value).toLowerCase();
    if (
      builtins.includes(value.toLowerCase()) ||
      reserved.some(
        (r) =>
          path === r.toLowerCase() ||
          path.startsWith(r.toLowerCase().replace(/\/$/, "") + "/"),
      )
    )
      fail("DENIED");
  }
  const key = (value: string) =>
    createHash("sha256")
      .update(JSON.stringify([scope, value]))
      .digest("hex");
  function destination(value: unknown) {
    if (
      typeof value !== "string" ||
      !value ||
      value.length > 4096 ||
      // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
      /[\x00-\x20\x7f\\]/.test(value)
    )
      return fail("INVALID");
    let url: URL;
    try {
      url = new URL(validatedShareUrl(value));
    } catch {
      return fail("INVALID");
    }
    if (url.href.length > 4096 || /%2f|%5c|%25/i.test(url.pathname))
      return fail("DENIED");
    if (
      !allowed.has(url.origin) ||
      (url.origin === publicOrigin && url.pathname.startsWith(prefix))
    )
      return fail("DENIED");
    if (allowDestination) {
      const result = allowDestination(url.href);
      if (result !== true) {
        if (result && typeof (result as any).then === "function")
          void Promise.resolve(result).catch(() => {});
        return fail("DENIED");
      }
    }
    return url.href;
  }
  function record(value: unknown, expectedSlug: string): ShortLinkRecord {
    plain(value, recordKeys);
    if (
      value.schema !== 1 ||
      value.scope !== scope ||
      value.slug !== expectedSlug ||
      !opaque(value.tenant) ||
      !opaque(value.owner) ||
      typeof value.revision !== "string" ||
      !/^[A-Za-z0-9-]{1,64}$/.test(value.revision) ||
      !integer(value.createdAt, 0, 253402300799999) ||
      (value.expiresAt !== null &&
        !integer(value.expiresAt, value.createdAt + 1, 253402300799999)) ||
      ![301, 302, 307, 308].includes(value.status) ||
      ["editable", "revocable", "revoked"].some(
        (k) => typeof value[k] !== "boolean",
      )
    )
      return fail("INVALID");
    if (
      [301, 308].includes(value.status) &&
      (permanent === undefined ||
        value.editable ||
        value.revocable ||
        value.expiresAt !== null)
    )
      return fail("DENIED");
    if (typeof value.destination !== "string") return fail("INVALID");
    return { ...value } as ShortLinkRecord;
  }
  async function principal(
    context: unknown,
    op: ShortLinkOperation,
    signal: AbortSignal,
  ) {
    const value = await authorize(context, op, signal);
    signal.throwIfAborted();
    if (!value) return fail("DENIED");
    plain(value, ["tenant", "subject", "manageTenant"]);
    if (
      !opaque(value.tenant) ||
      !opaque(value.subject) ||
      (value.manageTenant !== undefined &&
        typeof value.manageTenant !== "boolean")
    )
      return fail("DENIED");
    return { ...value };
  }
  async function read(value: string, signal: AbortSignal) {
    const found = await store.read(key(value), signal);
    signal.throwIfAborted();
    return found === null ? null : record(found, value);
  }
  async function managed(
    context: unknown,
    op: ShortLinkOperation,
    value: string,
    signal: AbortSignal,
  ) {
    const who = await principal(context, op, signal),
      found = await read(value, signal);
    if (
      !found ||
      found.tenant !== who.tenant ||
      (found.owner !== who.subject && who.manageTenant !== true)
    )
      return fail("DENIED");
    return found;
  }
  async function run<T>(
    control: ShortLinkControl,
    work: (signal: AbortSignal) => Promise<T>,
    write = false,
  ): Promise<T> {
    plain(control, ["signal", "timeoutMs"]);
    if (
      (control.signal !== undefined &&
        !(control.signal instanceof AbortSignal)) ||
      !integer(control.timeoutMs ?? timeout, 1, timeout)
    )
      return fail("INVALID");
    if (closed) return fail("CLOSED");
    if (control.signal?.aborted) return fail("CANCELLED");
    if (pending.size >= maxPending) return fail("LIMIT");
    const controller = new AbortController(),
      signal = AbortSignal.any([
        lifetime.signal,
        controller.signal,
        ...(control.signal ? [control.signal] : []),
      ]);
    let timer: ReturnType<typeof setTimeout> | undefined,
      abort = () => {};
    const stopped = new Promise<never>((_, reject) => {
      abort = () =>
        reject(
          new ShortLinkError(
            control.signal?.aborted || lifetime.signal.aborted
              ? "CANCELLED"
              : "DEADLINE",
            write ? "unknown" : "not-started",
          ),
        );
      signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(
        () => controller.abort(),
        control.timeoutMs ?? timeout,
      );
    });
    const native = Promise.resolve().then(() => {
      signal.throwIfAborted();
      return work(signal);
    });
    pending.add(native);
    void native.finally(() => pending.delete(native)).catch(() => {});
    try {
      return await Promise.race([native, stopped]);
    } catch (cause) {
      if (cause instanceof ShortLinkError) throw cause;
      throw new ShortLinkError(
        "UNAVAILABLE",
        write ? "unknown" : "not-started",
        cause,
      );
    } finally {
      if (timer) clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
  }
  function click(request: Request, link: ShortLinkRecord) {
    if (!analytics || !clickKey || request.method !== "GET") return;
    if (clicks.size >= (analytics.maxPending ?? 16)) {
      dropped++;
      return;
    }
    const controller = new AbortController(),
      signal = AbortSignal.any([lifetime.signal, controller.signal]),
      timer = setTimeout(() => controller.abort(), analytics.timeoutMs ?? 1000);
    const job = Promise.resolve()
      .then(async () => {
        const consent = analytics.consent(request);
        if (consent !== true) {
          if (consent && typeof (consent as any).then === "function")
            void Promise.resolve(consent).catch(() => {});
          return;
        }
        signal.throwIfAborted();
        const event = Object.freeze({
          schema: 1 as const,
          link: createHmac("sha256", clickKey)
            .update(JSON.stringify([scope, link.tenant, link.slug]))
            .digest("base64url"),
          day: new Date(clock()).toISOString().slice(0, 10),
          action: "redirect" as const,
        });
        await analytics.record(event, signal);
      })
      .catch(() => {
        analyticsErrors++;
      })
      .finally(() => {
        clearTimeout(timer);
        clicks.delete(job);
      });
    clicks.add(job);
  }
  const service = {
    create(
      context: unknown,
      value: CreateShortLink,
      control: ShortLinkControl = {},
    ) {
      plain(value, [
        "slug",
        "destination",
        "expiresAt",
        "status",
        "editable",
        "revocable",
      ]);
      const data = { ...value };
      return run(
        control,
        async (signal) => {
          const who = await principal(context, "create", signal),
            createdAt = clock(),
            status = data.status ?? 302,
            expiresAt =
              data.expiresAt === undefined
                ? createdAt + defaultTtl
                : data.expiresAt,
            editable = data.editable ?? true,
            revocable = data.revocable ?? true;
          if (
            ![301, 302, 307, 308].includes(status) ||
            typeof editable !== "boolean" ||
            typeof revocable !== "boolean" ||
            (expiresAt !== null &&
              !integer(expiresAt, createdAt + 1, createdAt + maxTtl))
          )
            return fail("INVALID");
          if (
            [301, 308].includes(status) &&
            (permanent === undefined ||
              editable ||
              revocable ||
              expiresAt !== null)
          )
            return fail("DENIED");
          const url = destination(data.destination);
          for (let attempt = 0; attempt < 3; attempt++) {
            signal.throwIfAborted();
            const candidate =
              data.slug ?? randomBytes(18).toString("base64url");
            slug(candidate);
            const next: ShortLinkRecord = {
              schema: 1,
              scope,
              slug: candidate,
              tenant: who.tenant,
              owner: who.subject,
              destination: url,
              revision: randomUUID(),
              createdAt,
              expiresAt,
              status,
              editable,
              revocable,
              revoked: false,
            };
            let reserved: boolean;
            try {
              reserved = await store.reserve(
                key(candidate),
                Object.freeze(next),
                signal,
              );
            } catch (cause) {
              throw new ShortLinkError(
                "UNAVAILABLE",
                "unknown",
                cause,
                candidate,
              );
            }
            if (reserved !== true && reserved !== false) return fail("INVALID");
            if (reserved)
              return Object.freeze({ ...next, url: scope + candidate });
            if (data.slug !== undefined) return fail("CONFLICT");
          }
          return fail("CONFLICT");
        },
        true,
      );
    },
    get(context: unknown, value: string, control: ShortLinkControl = {}) {
      slug(value);
      return run(control, async (signal) =>
        Object.freeze(await managed(context, "read", value, signal)),
      );
    },
    edit(
      context: unknown,
      value: string,
      input: { destination: string; expectedRevision: string },
      control: ShortLinkControl = {},
    ) {
      slug(value);
      plain(input, ["destination", "expectedRevision"]);
      const update = { ...input };
      return run(
        control,
        async (signal) => {
          const found = await managed(context, "edit", value, signal);
          if (
            !found.editable ||
            found.revoked ||
            (found.expiresAt !== null && found.expiresAt <= clock())
          )
            return fail("DENIED");
          if (
            typeof update.expectedRevision !== "string" ||
            found.revision !== update.expectedRevision
          )
            return fail("CONFLICT");
          const next = Object.freeze({
            ...found,
            destination: destination(update.destination),
            revision: randomUUID(),
          });
          let saved: boolean;
          try {
            saved = await store.compareAndSwap(
              key(value),
              found.revision,
              next,
              signal,
            );
          } catch (cause) {
            throw new ShortLinkError("UNAVAILABLE", "unknown", cause, value);
          }
          if (saved !== true) return fail("CONFLICT");
          return next;
        },
        true,
      );
    },
    revoke(
      context: unknown,
      value: string,
      expectedRevision: string,
      control: ShortLinkControl = {},
    ) {
      slug(value);
      return run(
        control,
        async (signal) => {
          const found = await managed(context, "revoke", value, signal);
          if (!found.revocable) return fail("DENIED");
          if (found.revision !== expectedRevision) return fail("CONFLICT");
          const next = Object.freeze({
            ...found,
            revoked: true,
            revision: randomUUID(),
          });
          try {
            if (
              (await store.compareAndSwap(
                key(value),
                found.revision,
                next,
                signal,
              )) !== true
            )
              return fail("CONFLICT");
          } catch (cause) {
            if (cause instanceof ShortLinkError) throw cause;
            throw new ShortLinkError("UNAVAILABLE", "unknown", cause, value);
          }
          return next;
        },
        true,
      );
    },
    async handler(request: Request): Promise<Response> {
      if (
        new URL(request.url).origin !== publicOrigin ||
        (request.headers.has("host") &&
          request.headers.get("host") !== new URL(publicOrigin).host)
      )
        return new Response(null, { status: 421 });
      if (!["GET", "HEAD"].includes(request.method))
        return new Response(null, {
          status: 405,
          headers: { allow: "GET, HEAD" },
        });
      const path = new URL(request.url).pathname;
      if (!path.startsWith(prefix))
        return new Response(null, {
          status: 404,
          headers: { "cache-control": "no-store" },
        });
      const candidate = path.slice(prefix.length);
      try {
        slug(candidate);
      } catch {
        return new Response(null, {
          status: 404,
          headers: { "cache-control": "no-store" },
        });
      }
      try {
        const result = await run({ signal: request.signal }, async (signal) => {
          const found = await read(candidate, signal);
          if (
            !found ||
            found.revoked ||
            (found.expiresAt !== null && found.expiresAt <= clock())
          )
            return null;
          destination(found.destination);
          return found;
        });
        if (!result)
          return new Response(null, {
            status: 404,
            headers: { "cache-control": "no-store" },
          });
        const response = new Response(null, {
          status: result.status,
          headers: {
            location: result.destination,
            "cache-control": [301, 308].includes(result.status)
              ? `public, max-age=${permanent}`
              : "no-store",
            "referrer-policy": "no-referrer",
          },
        });
        click(request, result);
        return response;
      } catch {
        return new Response(null, {
          status: 503,
          headers: { "cache-control": "no-store", "retry-after": "1" },
        });
      }
    },
    status: () =>
      Object.freeze({
        closed,
        pending: pending.size,
        analyticsPending: clicks.size,
        analyticsDropped: dropped,
        analyticsErrors,
      }),
    close() {
      if (closing) return closing;
      closed = true;
      lifetime.abort();
      return (closing = (async () => {
        await Promise.allSettled([...pending, ...clicks]);
        clickKey?.fill(0);
      })());
    },
    route: prefix + ":slug",
  };
  return service;
}
export type ShortLinkService = ReturnType<typeof createShortLinkService>;
