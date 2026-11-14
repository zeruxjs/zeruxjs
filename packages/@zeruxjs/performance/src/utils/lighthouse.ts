export interface LighthouseSummary {
  /** Explicit audited target returned by the lab runner; host must redact private URLs before logging. */
  url: string;
  /** Measured category facts with null for unavailable scores. */
  categories: Record<
    string,
    {
      /** Measured finite score or null if unavailable. */
      score: number | null;
      /** Runner-provided inert category display label; UI must escape it. */
      title: string;
    }
  >;
  /** Allowlisted lab audit numeric/display facts; no ranking guarantee. */
  metrics: Record<
    string,
    {
      /** Finite nonnegative observation; milliseconds for timing and score for CLS. */
      value: number | null;
      /** Optional inert runner display text; not trusted HTML. */
      displayValue?: string;
    }
  >;
}
export interface LighthouseOptions {
  /** Existing private Chrome debugging port, default 9222; never starts a browser. */
  port?: number;
  /** Optional borrowed audit runner; host owns its transport and lifecycle. */
  runner?: (url: string, options: Record<string, unknown>) => Promise<unknown>;
}
/** Run an explicit lab audit through an already-running Chrome debugging port or injected runner. Does not install/start Chrome or enforce outbound host policy.
 * @param {string} input - Deliberate HTTP(S) audit target without URL credentials; host controls destination/egress.
 * @param {LighthouseOptions} options - Optional fixed debugging port and borrowed runner.
 * @returns {Promise<LighthouseSummary>} Normalized measured lab facts; missing dependency/report/runner failure rejects.
 */
export async function auditLighthouse(
  input: string,
  options: LighthouseOptions = {}
): Promise<LighthouseSummary> {
  /** Parsed deliberate HTTP(S) resource or audit URL, never fetched by serialization. */
  const url = new URL(input);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new TypeError('Lighthouse URL must be HTTP(S) without credentials');
  }
  if (
    options.port !== undefined &&
    (!Number.isInteger(options.port) ||
      options.port < 1 ||
      options.port > 65535)
  ) {
    throw new RangeError('Invalid Chrome debugging port');
  }
  /** Borrowed explicit runner or lazy optional Lighthouse loader; no browser is spawned.
   * @param {string} url - Deliberate validated audit target.
   * @param {Record<string,unknown>} opts - Fixed Chrome port/output options.
   * @returns {Promise<unknown>} Optional native runner report; dependency/runner failures reject.
   */
  const runner =
    options.runner ??
    (async (url: string, opts: Record<string, unknown>) => {
      /** Fixed optional package identity, never a caller-supplied import path. */
      const specifier = 'lighthouse';
      /** Lazily loaded maintained lab runner; import occurs only for an explicit audit. */
      const imported = await import(specifier);
      return (
        imported.default as (
          url: string,
          options: Record<string, unknown>
        ) => Promise<unknown>
      )(url, opts);
    });
  /** Original measured callback or lab-runner outcome; no automatic retry. */
  const result = await runner(url.href, {
    port: options.port ?? 9222,
    output: 'json',
  });
  /** Untrusted runner report shape projected into inert normalized lab facts. */
  const lhr = (
    result as {
      /** Untrusted runner report normalized into the restricted public projection. */
      lhr?: unknown;
    } | null
  )?.lhr as
    | {
        /** Measured category facts with null for unavailable scores. */
        categories?: Record<
          string,
          {
            /** Measured finite score or null if unavailable. */
            score?: number | null;
            /** Runner-provided inert category display label; UI must escape it. */
            title?: string;
          }
        >;
        /** Runner audit collection, only fixed metric names are projected. */
        audits?: Record<
          string,
          {
            /** Optional finite native lab measurement. */
            numericValue?: number;
            /** Optional inert runner display text; not trusted HTML. */
            displayValue?: string;
          }
        >;
      }
    | undefined;
  if (!lhr) {
    throw new Error('Lighthouse returned no audit report');
  }
  /** Null-prototype measured category projection, not arbitrary report copying. */
  const categories: LighthouseSummary['categories'] = Object.create(null);
  // Process only the explicit representation bytes, native entries or fixed report fields for this call.
  for (const [name, item] of Object.entries(lhr.categories ?? {})) {
    categories[name] = {
      score:
        typeof item.score === 'number' && Number.isFinite(item.score)
          ? item.score
          : null,
      title: item.title ?? name,
    };
  }
  /** Null-prototype allowlisted lab metric projection. */
  const metrics: LighthouseSummary['metrics'] = Object.create(null);
  // Process only the explicit representation bytes, native entries or fixed report fields for this call.
  for (const name of [
    'first-contentful-paint',
    'largest-contentful-paint',
    'speed-index',
    'total-blocking-time',
    'cumulative-layout-shift',
    'interactive',
  ]) {
    /** One optional runner measurement checked before numeric projection. */
    const value = lhr.audits?.[name];
    if (value) {
      metrics[name] = {
        value:
          typeof value.numericValue === 'number' &&
          Number.isFinite(value.numericValue)
            ? value.numericValue
            : null,
        displayValue: value.displayValue,
      };
    }
  }
  return { url: url.href, categories, metrics };
}
