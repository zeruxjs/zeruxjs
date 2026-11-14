import ts from 'typescript';
import { createHash } from 'node:crypto';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { bounded, validateDomain } from './validation.js';
import { serializeCatalogs } from './snapshot.js';
import { validateMessagePlaceholders } from './placeholders.js';
import type { Catalog } from './types.js';
import type { SnapshotOptions } from './snapshot.js';

export type TranslationFunction = '__' | '_x' | '_n' | '_nx';
export interface ExtractionOptions {
  /** Bounded supported source label used for syntax locations, never imported. */
  fileName?: string;
  /** Explicit default domain when the literal call omits one. */
  defaultDomain?: string;
  /** Explicit aliases to the supported call grammar; no import resolution/evaluation. */
  functions?: Readonly<Record<string, TranslationFunction>>;
  /** Approved direct identifier receivers, e.g. t.__(...). Nested/computed receivers diagnose. */
  receivers?: readonly string[];
  /** Explicit bounded UTF-8 source/retained/wire budget for this owner. */
  maxBytes?: number;
  /** Explicit bounded occurrence/diagnostic or catalog message capacity. */
  maxMessages?: number;
}
export interface ExtractedMessage {
  /** Extracted static source singular key; no translation is invented. */
  readonly singular: string;
  /** Optional static source plural with matching supported placeholders. */
  readonly plural?: string;
  /** Optional literal disambiguation text, distinct from host execution context. */
  readonly context?: string;
  /** Explicit exact text domain; domains never fall back into each other. */
  readonly domain: string;
  /** One-based source line; diagnostics retain no source snippets. */
  readonly line: number;
  /** One-based source column. */
  readonly column: number;
}
export interface ExtractionDiagnostic {
  /** Fixed extraction failure category; never a private source snippet. */
  readonly code: 'SYNTAX' | 'DYNAMIC_KEY' | 'INVALID_CALL';
  /** One-based source line; diagnostics retain no source snippets. */
  readonly line: number;
  /** One-based source column. */
  readonly column: number;
}
export interface ExtractionResult {
  /** Immutable inert translation map or extracted occurrence list according to this record. */
  readonly messages: readonly ExtractedMessage[];
  /** Immutable bounded fixed-code source locations requiring host review. */
  readonly diagnostics: readonly ExtractionDiagnostic[];
}
/** Parse bounded source text as syntax only; never import or evaluate the module. Call spellings do not prove symbol ownership.
 * @param {string} source - Inert JS/TS/JSX/TSX source text with bounded UTF-8 bytes.
 * @param {ExtractionOptions} options - Explicit literal grammar, receiver/domain policy and resource bounds.
 * @returns {ExtractionResult} Frozen occurrence-ordered messages and value-redacted diagnostics; hosts must reject diagnostics before publishing.
 */
export function extractMessages(
  source: string,
  options: ExtractionOptions = {}
): ExtractionResult {
  /** Owner-selected UTF-8 source/cache budget validated before allocation. */
  const maxBytes = bounded(options.maxBytes, 1024 * 1024, 8 * 1024 * 1024);
  /** Owner-selected bounded message/cache entry capacity. */
  const max = bounded(options.maxMessages, 20_000, 100_000);
  if (
    typeof source !== 'string' ||
    source.length > maxBytes ||
    new TextEncoder().encode(source).length > maxBytes
  ) {
    throw new RangeError('zlocale: extraction source byte limit exceeded');
  }
  /** Validated fixed default text domain for literal extraction. */
  const domain = validateDomain(options.defaultDomain ?? 'default');
  /** Explicit syntactic translation call names and trusted aliases; no symbol execution. */
  const functions = new Map<string, TranslationFunction>([
    ['__', '__'],
    ['_x', '_x'],
    ['_n', '_n'],
    ['_nx', '_nx'],
  ]);
  for (const [alias, kind] of Object.entries(options.functions ?? {})) {
    if (
      !/^[A-Za-z_$][\w$]{0,127}$/.test(alias) ||
      !['__', '_x', '_n', '_nx'].includes(kind)
    ) {
      throw new TypeError('zlocale: invalid extraction alias');
    }
    functions.set(alias, kind);
  }
  /** Explicit approved direct identifier receivers; no nested/computed runtime resolution. */
  const receivers = options.receivers ?? [];
  if (
    functions.size > 128 ||
    !Array.isArray(receivers) ||
    receivers.length > 128 ||
    receivers.some(
      (value) =>
        typeof value !== 'string' || !/^[A-Za-z_$][\w$]{0,127}$/.test(value)
    )
  ) {
    throw new TypeError('zlocale: invalid extraction receivers');
  }
  /** Bounded supported source label used only by the parser and cache key. */
  const fileName = options.fileName ?? 'source.tsx';
  if (
    typeof fileName !== 'string' ||
    fileName.length > 1024 ||
    !/\.(?:[cm]?[jt]s|[jt]sx)$/i.test(fileName)
  ) {
    throw new TypeError('zlocale: unsupported extraction source extension');
  }
  let file: ts.SourceFile;
  try {
    file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  } catch {
    throw new TypeError('zlocale: source parser failed');
  }
  /** Immutable extracted literal occurrences in source order, not deduplicated translations. */
  const messages: ExtractedMessage[] = [];
  /** Bounded fixed-code/location failures without source snippets. */
  const diagnostics: ExtractionDiagnostic[] = [];
  /** Convert one parser offset into a one-based source address.
   * @param {number} offset - Bounded parser offset.
   * @returns {{line: number, column: number}} Source address without source text.
   */
  const location = (offset: number) => {
    /** Native parser line/character position before one-based conversion. */
    const pos = file.getLineAndCharacterOfPosition(offset);
    return { line: pos.line + 1, column: pos.character + 1 };
  };
  /** Retain one fixed extraction diagnostic within the configured count.
   * @param {ExtractionDiagnostic["code"]} code - Fixed supported diagnostic category.
   * @param {number} offset - Source offset supplied by the parser.
   * @returns {void} Records immutable code/location data or throws on budget exhaustion.
   */
  const report = (code: ExtractionDiagnostic['code'], offset: number) => {
    if (diagnostics.length >= max) {
      throw new RangeError('zlocale: extraction diagnostic limit exceeded');
    }
    diagnostics.push(Object.freeze({ code, ...location(offset) }));
  };
  /** Native parse diagnostics; syntax errors return no extracted messages. */
  const syntax = (
    file as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  if (syntax.length) {
    for (const diagnostic of syntax) {
      report('SYNTAX', diagnostic.start ?? 0);
    }
    return Object.freeze({
      messages: Object.freeze(messages),
      diagnostics: Object.freeze(diagnostics),
    });
  }
  /** Explicit bounded AST traversal stack; modules are never imported to discover strings. */
  const stack: ts.Node[] = [file];
  let nodes = 0;
  while (stack.length) {
    /** Current parser node; node budget bounds traversal complexity. */
    const node = stack.pop()!;
    if (++nodes > 200_000) {
      throw new RangeError('zlocale: extraction node limit exceeded');
    }
    if (ts.isCallExpression(node)) {
      /** Syntactic call target inspected as data only. */
      const call = node.expression;
      /** Static identifier/property spelling; this is not symbol ownership or authorization. */
      let name;
      if (ts.isIdentifier(call)) {
        name = call.text;
      } else if (ts.isPropertyAccessExpression(call)) {
        name = call.name.text;
      } else if (
        ts.isElementAccessExpression(call) &&
        call.argumentExpression &&
        ts.isStringLiteralLike(call.argumentExpression)
      ) {
        name = call.argumentExpression.text;
      } else {
        name = undefined;
      }
      /** Explicit supported gettext argument grammar for the recognized spelling. */
      const kind = name ? functions.get(name) : undefined;
      if (kind) {
        /** Call source offset retained for actionable value-redacted diagnostics. */
        const at = node.getStart(file);
        if (
          node.questionDotToken ||
          (!ts.isIdentifier(call) &&
            !(
              ts.isPropertyAccessExpression(call) &&
              !call.questionDotToken &&
              ts.isIdentifier(call.expression) &&
              receivers.includes(call.expression.text)
            ))
        ) {
          report('INVALID_CALL', at);
        } else {
          /** Required literal singular/plural/context argument positions for this grammar. */
          let positions;
          if (kind === '__') {
            positions = [0];
          } else if (kind === '_x') {
            positions = [0, 1];
          } else if (kind === '_n') {
            positions = [0, 1];
          } else {
            positions = [0, 1, 3];
          }
          /** Optional literal text-domain argument index for this exact grammar. */
          let domainAt;
          if (kind === '__') {
            domainAt = 1;
          } else if (kind === '_x') {
            domainAt = 2;
          } else if (kind === '_n') {
            domainAt = 3;
          } else {
            domainAt = 4;
          }
          /** Minimum arity including dynamic count where supported. */
          let minimum;
          if (kind === '__') {
            minimum = 1;
          } else if (kind === '_x') {
            minimum = 2;
          } else if (kind === '_n') {
            minimum = 3;
          } else {
            minimum = 4;
          }
          /** Borrowed parser argument nodes, never evaluated. */
          const args = node.arguments;
          /** Read a static string literal only; expressions remain diagnostics.
           * @param {number} index - Reviewed grammar argument index.
           * @returns {string | undefined} Literal content, or undefined for absent/dynamic input.
           */
          const literal = (index: number): string | undefined => {
            /** Borrowed parser node at the requested argument position. */
            const arg = args[index];
            return arg && ts.isStringLiteralLike(arg) ? arg.text : undefined;
          };
          if (
            args.length < minimum ||
            args.length > domainAt + 1 ||
            args.some(ts.isSpreadElement)
          ) {
            report('INVALID_CALL', at);
          } else if (
            positions.some((index) => literal(index) === undefined) ||
            (args[domainAt] && literal(domainAt) === undefined)
          ) {
            report('DYNAMIC_KEY', at);
          } else {
            try {
              /** Validated static source singular key; no translation is invented. */
              const singular = literal(0)!;
              /** Optional static source plural with matching placeholder identities. */
              const plural =
                kind === '_n' || kind === '_nx' ? literal(1)! : undefined;
              /** Optional static disambiguation text, separate from runtime execution context. */
              let context;
              if (kind === '_x') {
                context = literal(1)!;
              } else if (kind === '_nx') {
                context = literal(3)!;
              } else {
                context = undefined;
              }
              if (
                [singular, plural, context].some(
                  (value) =>
                    value !== undefined &&
                    (value.length > 16_384 || value.includes('\u0004'))
                )
              ) {
                throw new TypeError();
              }
              if (plural !== undefined) {
                validateMessagePlaceholders(singular, plural);
              }
              if (messages.length >= max) {
                throw new RangeError(
                  'zlocale: extraction message limit exceeded'
                );
              }
              messages.push(
                Object.freeze({
                  singular,
                  ...(plural === undefined ? {} : { plural }),
                  ...(context === undefined ? {} : { context }),
                  domain: validateDomain(literal(domainAt) ?? domain),
                  ...location(at),
                })
              );
            } catch (error) {
              if (error instanceof RangeError) {
                throw error;
              }
              report('INVALID_CALL', at);
            }
          }
        }
      }
    }
    /** One node's parser children pushed in reverse to preserve occurrence order. */
    const children: ts.Node[] = [];
    ts.forEachChild(node, (child) => {
      children.push(child);
    });
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push(children[i]!);
    }
  }
  return Object.freeze({
    messages: Object.freeze(messages),
    diagnostics: Object.freeze(diagnostics),
  });
}
/** Create an opt-in bounded incremental result cache; no watcher or module execution is started.
 * @param {Omit<ExtractionOptions, 'fileName'> & {
    maxEntries?: number;
    maxCacheBytes?: number;
  }} options - Fixed grammar and memory limits copied for this owner.
 * @returns {object} Explicit extract/invalidate/clear operations; source text is not retained.
 */
export function createSourceExtractor(
  options: Omit<ExtractionOptions, 'fileName'> & {
    maxEntries?: number;
    maxCacheBytes?: number;
  } = {}
) {
  /** Owner-selected bounded message/cache entry capacity. */
  const max = bounded(options.maxEntries, 128, 1024);
  /** Owner-selected UTF-8 source/cache budget validated before allocation. */
  const maxBytes = bounded(
    options.maxCacheBytes,
    8 * 1024 * 1024,
    64 * 1024 * 1024
  );
  /** Snapshot of fixed extractor options; callbacks/source modules are not loaded. */
  const settings = {
    ...options,
    functions: Object.freeze({ ...options.functions }),
    receivers: Object.freeze([...(options.receivers ?? [])]),
  };
  /** Per-owner bounded filename/content-hash result cache; source text is not retained. */
  const cache = new Map<
    string,
    { hash: string; result: ExtractionResult; bytes: number }
  >();
  let bytes = 0;
  /** Evict only this cached result and adjust retained-byte accounting.
   * @param {string} key - Explicit source label.
   * @returns {void} Releases local retained metadata, not files or external resources.
   */
  const drop = (key: string) => {
    /** Previously retained cache entry used for byte accounting or same-content reuse. */
    const old = cache.get(key);
    if (old) {
      bytes -= old.bytes;
      cache.delete(key);
    }
  };
  return Object.freeze({
    extract(fileName: string, source: string): ExtractionResult {
      if (
        typeof source !== 'string' ||
        source.length > (settings.maxBytes ?? 1024 * 1024)
      ) {
        throw new RangeError('zlocale: extraction source byte limit exceeded');
      }
      /** SHA-256 source identity used for incremental reuse, not authorship. */
      const hash = createHash('sha256').update(source).digest('hex');
      /** Previously retained cache entry used for byte accounting or same-content reuse. */
      const old = cache.get(fileName);
      if (old?.hash === hash) {
        cache.delete(fileName);
        cache.set(fileName, old);
        return old.result;
      }
      /** Validated bounded literal/diagnostic result retained without executable source. */
      const result = extractMessages(source, { ...settings, fileName });
      /** Serialized UTF-8 result bytes checked before cache insertion. */
      const size = Buffer.byteLength(JSON.stringify(result));
      if (size > maxBytes) {
        throw new RangeError('zlocale: extraction cache byte limit exceeded');
      }
      drop(fileName);
      while (cache.size >= max || bytes + size > maxBytes) {
        drop(cache.keys().next().value!);
      }
      cache.set(fileName, { hash, result, bytes: size });
      bytes += size;
      return result;
    },
    invalidate(fileName: string) {
      drop(fileName);
    },
    clear() {
      cache.clear();
      bytes = 0;
    },
  });
}
/** Asynchronously gzip an explicitly validated public V1 snapshot during a build, never synchronous request handling.
 * @param {readonly Catalog[]} catalogs - Explicit public translation data selected by the host.
 * @param {SnapshotOptions} options - Snapshot count/UTF-8/catalog validation budgets.
 * @returns {Promise<Uint8Array>} Gzip bytes; transport must declare encoding and bound decompression before runtime parsing.
 */
export async function compressCatalogs(
  catalogs: readonly Catalog[],
  options: SnapshotOptions = {}
): Promise<Uint8Array> {
  return promisify(gzip)(serializeCatalogs(catalogs, options), { level: 9 });
}
