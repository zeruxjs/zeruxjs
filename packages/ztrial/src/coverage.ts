/* eslint-disable no-control-regex -- Control-character validation and glob sentinels are intentional. */
import { createHash } from 'node:crypto';
/** One validated actual native UTF-16 execution range in an exact source/runtime topology. */
export interface CoverageRange {
  /** Original native function position in this exact capture topology. */
  functionIndex: number;
  /** Original range position within that function. */
  rangeIndex: number;
  /** Nonnegative UTF-16 start offset in this exact hashed source text. */
  startOffset: number;
  /** Nonnegative UTF-16 end offset, never before start. */
  endOffset: number;
  /** Nonnegative safe-integer actual execution counter. */
  count: number;
  /** Native isBlockCoverage flag; not a whole-project branch-coverage claim. */
  block: boolean;
}
/** Versioned source/runtime/hash provenance with honest instrumentation state and bounded native ranges. */
export interface CoverageRecord {
  /** Supported coverage schema version, currently one. */
  version: 1;
  /** Explicit native V8 ranges representation; no implicit Istanbul conversion. */
  format: 'v8-ranges';
  /** Exact explicit runtime/version label, not an inferred compatible engine. */
  runtime: string;
  /** Explicit expected public source label; report policy hashes it unless opted in. */
  source: string;
  /** Instrumented/uninstrumented/unsupported with explicit missing coverage. */
  status: 'instrumented' | 'uninstrumented' | 'unsupported';
  /** SHA-256 of actual source text when instrumentation is present; not authorship evidence. */
  sourceHash?: string;
  /** Bounded normalized native ranges; source text is not retained. */
  ranges: readonly CoverageRange[];
  /** Explicit missing/unsupported coverage reason. */
  reason?: string;
}
/** Explicit trusted native-compatible capture input; source text is hashed then excluded from normalized reports. */
export interface V8SourceCoverage {
  /** Native source URL matched only against the explicit expected inventory. */
  url: string;
  /** Explicit expected public source label; report policy hashes it unless opted in. */
  source?: string;
  /** Bounded native function coverage records. */
  functions: readonly {
    /** Actual native V8 block-coverage flag. */
    isBlockCoverage: boolean;
    /** Bounded normalized native ranges; source text is not retained. */
    ranges: readonly {
      /** Nonnegative UTF-16 start offset in this exact hashed source text. */
      startOffset: number;
      /** Nonnegative UTF-16 end offset, never before start. */
      endOffset: number;
      /** Nonnegative safe-integer actual execution counter. */
      count: number;
    }[];
  }[];
}
/** Validate one bounded public provenance label, rejecting control characters.
 * @param {unknown} value Unknown runtime/source label.
 * @returns {boolean} Whether the supported bounded nonempty label shape matches. */
const label = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 2048 &&
  !/[\x00-\x1f\x7f]/.test(value);
/** Require nonnegative safe-integer native coverage offsets/counters without coercion.
 * @param {number} value - Unknown-at-runtime offset/counter selected by the owning coverage validator.
 * @returns {void} Throws for unsupported offsets or counters rather than truncating precision.
 */
function number(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('Invalid coverage counter/offset');
  }
}
/** Normalize only explicitly expected sources under declared runtime provenance; absent/native-unsupported inputs remain unknown coverage, never a fabricated percentage.
 * @param {readonly V8SourceCoverage[]} entries - Trusted bounded native V8-compatible captures containing source text only during normalization.
 * @param {{
    runtime: string;
    expectedSources: readonly string[];
    unsupported?: boolean;
  }} options - Explicit runtime/expected source inventory and optional actual unsupported-runtime flag.
 * @param {string} options.runtime - Exact explicit runtime/version provenance label, excluding secrets.
 * @param {readonly string[]} options.expectedSources - Bounded explicit source inventory; absent instrumentation remains unknown coverage.
 * @param {boolean | undefined} options.unsupported - Explicit true only when this actual runtime cannot supply the declared instrumentation.
 * @returns {CoverageRecord[]} Detached normalized ranges/hash/provenance in expected-source order, without retained source text.
 */
export function normalizeV8Coverage(
  entries: readonly V8SourceCoverage[],
  options: {
    /** Exact explicit runtime/version label, not an inferred compatible engine. */
    runtime: string;
    /** Explicit bounded source inventory; absent expected sources remain uninstrumented. */
    expectedSources: readonly string[];
    /** Explicit actual unsupported-runtime flag, never an automatic green skip. */
    unsupported?: boolean;
  }
): CoverageRecord[] {
  if (
    !options ||
    !label(options.runtime) ||
    !Array.isArray(options.expectedSources) ||
    options.expectedSources.length > 1000 ||
    options.expectedSources.some((source) => !label(source)) ||
    new Set(options.expectedSources).size !== options.expectedSources.length ||
    !Array.isArray(entries) ||
    entries.length > 10000
  ) {
    throw new TypeError('Invalid coverage input');
  }
  /** Per-normalization expected source matches; duplicate expected-source captures reject. */
  const reports = new Map<string, V8SourceCoverage>();
  for (const entry of entries) {
    if (!entry || typeof entry.url !== 'string') {
      throw new TypeError('Invalid coverage source');
    }
    if (options.expectedSources.includes(entry.url)) {
      if (reports.has(entry.url)) {
        throw new TypeError(
          'Duplicate coverage source; normalize separate captures before merging'
        );
      }
      reports.set(entry.url, entry);
    }
  }
  return options.expectedSources.map((source) => {
    /** Matched actual native source capture or undefined when not observed. */
    const entry = reports.get(source);
    if (options.unsupported || !entry || typeof entry.source !== 'string') {
      return {
        version: 1,
        format: 'v8-ranges',
        runtime: options.runtime,
        source,
        status: options.unsupported ? 'unsupported' : 'uninstrumented',
        ranges: [],
        reason: (() => {
          if (options.unsupported) {
            return 'runtime-unsupported';
          } else {
            if (!entry) {
              return 'not-observed';
            } else {
              return 'source-unavailable';
            }
          }
        })(),
      };
    }
    if (
      entry.source.length > 16777216 ||
      !Array.isArray(entry.functions) ||
      entry.functions.length > 100000
    ) {
      throw new RangeError('Coverage input limit');
    }
    /** Detached bounded native range projections, excluding actual source text. */
    const ranges: CoverageRange[] = [];
    entry.functions.forEach((fn, functionIndex) => {
      if (
        !fn ||
        typeof fn.isBlockCoverage !== 'boolean' ||
        !Array.isArray(fn.ranges) ||
        fn.ranges.length > 100000
      ) {
        throw new TypeError('Invalid V8 function coverage');
      }
      fn.ranges.forEach(
        (
          range: V8SourceCoverage['functions'][number]['ranges'][number],
          rangeIndex: number
        ) => {
          number(range.startOffset);
          number(range.endOffset);
          number(range.count);
          if (
            range.endOffset < range.startOffset ||
            range.endOffset > entry.source!.length ||
            ranges.length >= 100000
          ) {
            throw new TypeError('Invalid V8 coverage range');
          }
          ranges.push({
            functionIndex,
            rangeIndex,
            startOffset: range.startOffset,
            endOffset: range.endOffset,
            count: range.count,
            block: fn.isBlockCoverage,
          });
        }
      );
    });
    return {
      version: 1,
      format: 'v8-ranges',
      runtime: options.runtime,
      source,
      status: 'instrumented',
      sourceHash: createHash('sha256').update(entry.source).digest('hex'),
      ranges,
    };
  });
}
/** Validate supported V1 range provenance/counters before merging or summarizing; this is not source-map or line-coverage conversion.
 * @param {CoverageRecord} record - Previously normalized record, validated again at the public boundary.
 * @returns {void} Rejects incompatible shape/hash/status/ranges instead of inventing coverage.
 */
function validate(record: CoverageRecord) {
  if (
    !record ||
    record.version !== 1 ||
    record.format !== 'v8-ranges' ||
    !label(record.runtime) ||
    !label(record.source) ||
    !['instrumented', 'uninstrumented', 'unsupported'].includes(
      record.status
    ) ||
    !Array.isArray(record.ranges) ||
    record.ranges.length > 100000
  ) {
    throw new TypeError('Invalid normalized coverage');
  }
  if (
    record.status === 'instrumented' &&
    !/^[a-f0-9]{64}$/.test(record.sourceHash ?? '')
  ) {
    throw new TypeError('Coverage requires source hash');
  }
  if (record.status !== 'instrumented' && record.ranges.length) {
    throw new TypeError('Uninstrumented coverage cannot contain counters');
  }
  for (const range of record.ranges) {
    for (const key of [
      'functionIndex',
      'rangeIndex',
      'startOffset',
      'endOffset',
      'count',
    ] as const) {
      number(range[key]);
    }
    if (
      range.endOffset < range.startOffset ||
      typeof range.block !== 'boolean'
    ) {
      throw new TypeError('Invalid normalized range');
    }
  }
}
/** Sum only identical runtime/source/hash/status/reason and exact range topology; incompatible capture versions remain separate.
 * @param {readonly CoverageRecord[]} records - At most10000 supported explicit coverage records.
 * @returns {CoverageRecord[]} Detached summed records sorted by source label; original range counts remain unchanged.
 */
export function mergeCoverage(
  records: readonly CoverageRecord[]
): CoverageRecord[] {
  if (!Array.isArray(records) || records.length > 10000) {
    throw new TypeError('Invalid coverage records');
  }
  /** Per-call compatible source records copied before counter accumulation. */
  const merged = new Map<string, CoverageRecord>();
  for (const record of records) {
    validate(record);
    /** Prior copied compatible record for this exact source label. */
    const previous = merged.get(record.source);
    if (!previous) {
      merged.set(record.source, {
        ...record,
        ranges: record.ranges.map((range: CoverageRange) => ({ ...range })),
      });
      continue;
    }
    /** Serialize only native range structure, excluding counters that may legitimately differ across compatible captures.
     * @param {CoverageRecord} item Supported normalized coverage record.
     * @returns {string} Exact ordered native range topology for compatibility checks. */
    const topology = (item: CoverageRecord) =>
      JSON.stringify(item.ranges.map(({ count: _count, ...range }) => range));
    if (
      previous.runtime !== record.runtime ||
      previous.status !== record.status ||
      previous.reason !== record.reason ||
      previous.sourceHash !== record.sourceHash ||
      topology(previous) !== topology(record)
    ) {
      throw new Error('Incompatible coverage sources; keep separate reports');
    }
    previous.ranges = previous.ranges.map((range, index) => {
      /** Summed native execution counter, validated against safe-integer overflow before commit. */
      const count = range.count + record.ranges[index].count;
      number(count);
      return { ...range, count };
    });
  }
  return [...merged.values()].sort((a, b) => a.source.localeCompare(b.source));
}
/** Count actual V8 ranges and instrumentation states without equating overlapping ranges to lines, statements or covered byte percentages.
 * @param {readonly CoverageRecord[]} records - At most10000 supported explicit coverage records.
 * @returns {{ unit: "v8-ranges"; instrumentedSources: number; uninstrumentedSources: number; unsupportedSources: number; totalRanges: number; coveredRanges: number }} Range/source counts only; missing instrumentation never becomes100%coverage.
 */
export function summarizeCoverage(records: readonly CoverageRecord[]) {
  if (!Array.isArray(records) || records.length > 10000) {
    throw new TypeError('Invalid coverage records');
  }
  let instrumented = 0,
    uninstrumented = 0,
    unsupported = 0,
    totalRanges = 0,
    coveredRanges = 0;
  for (const record of records) {
    validate(record);
    if (record.status === 'uninstrumented') {
      uninstrumented++;
    } else if (record.status === 'unsupported') {
      unsupported++;
    } else {
      instrumented++;
      totalRanges += record.ranges.length;
      coveredRanges += record.ranges.filter(
        (range: CoverageRange) => range.count > 0
      ).length;
    }
  }
  return {
    unit: 'v8-ranges' as const,
    instrumentedSources: instrumented,
    uninstrumentedSources: uninstrumented,
    unsupportedSources: unsupported,
    totalRanges,
    coveredRanges,
  };
}
