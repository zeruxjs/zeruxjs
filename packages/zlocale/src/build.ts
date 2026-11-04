import ts from "typescript";
import { createHash } from "node:crypto";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { bounded, validateDomain } from "./validation.js";
import { serializeCatalogs } from "./snapshot.js";
import { validateMessagePlaceholders } from "./placeholders.js";
import type { Catalog } from "./types.js";
import type { SnapshotOptions } from "./snapshot.js";

export type TranslationFunction = "__" | "_x" | "_n" | "_nx";
export interface ExtractionOptions {
  fileName?: string; defaultDomain?: string;
  /** Explicit aliases to the supported call grammar; no import resolution/evaluation. */
  functions?: Readonly<Record<string, TranslationFunction>>;
  /** Approved direct identifier receivers, e.g. t.__(...). Nested/computed receivers diagnose. */
  receivers?: readonly string[];
  maxBytes?: number; maxMessages?: number;
}
export interface ExtractedMessage {
  readonly singular: string; readonly plural?: string; readonly context?: string;
  readonly domain: string; readonly line: number; readonly column: number;
}
export interface ExtractionDiagnostic {
  readonly code: "SYNTAX" | "DYNAMIC_KEY" | "INVALID_CALL";
  readonly line: number; readonly column: number;
}
export interface ExtractionResult {
  readonly messages: readonly ExtractedMessage[];
  readonly diagnostics: readonly ExtractionDiagnostic[];
}
/** Parse bounded JS/TS/JSX/TSX source as data; never imports or evaluates it.
 * Dynamic count expressions are allowed, but message/domain/context/plural must be literals.
 * Call names are a syntactic convention, not proof of symbol ownership.
 */
export function extractMessages(source: string, options: ExtractionOptions = {}): ExtractionResult {
  const maxBytes = bounded(options.maxBytes, 1024 * 1024, 8 * 1024 * 1024);
  const max = bounded(options.maxMessages, 20_000, 100_000);
  if (typeof source !== "string" || source.length > maxBytes || new TextEncoder().encode(source).length > maxBytes)
    throw new RangeError("zlocale: extraction source byte limit exceeded");
  const domain = validateDomain(options.defaultDomain ?? "default");
  const functions = new Map<string, TranslationFunction>([["__", "__"], ["_x", "_x"], ["_n", "_n"], ["_nx", "_nx"]]);
  for (const [alias, kind] of Object.entries(options.functions ?? {})) {
    if (!/^[A-Za-z_$][\w$]{0,127}$/.test(alias) || !["__", "_x", "_n", "_nx"].includes(kind)) throw new TypeError("zlocale: invalid extraction alias");
    functions.set(alias, kind);
  }
  const receivers = options.receivers ?? [];
  if (functions.size > 128 || !Array.isArray(receivers) || receivers.length > 128 || receivers.some(value => typeof value !== "string" || !/^[A-Za-z_$][\w$]{0,127}$/.test(value)))
    throw new TypeError("zlocale: invalid extraction receivers");
  const fileName = options.fileName ?? "source.tsx";
  if (typeof fileName !== "string" || fileName.length > 1024 || !/\.(?:[cm]?[jt]s|[jt]sx)$/i.test(fileName)) throw new TypeError("zlocale: unsupported extraction source extension");
  let file: ts.SourceFile;
  try { file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true); }
  catch { throw new TypeError("zlocale: source parser failed"); }
  const messages: ExtractedMessage[] = [], diagnostics: ExtractionDiagnostic[] = [];
  const location = (offset: number) => { const pos = file.getLineAndCharacterOfPosition(offset); return { line: pos.line + 1, column: pos.character + 1 }; };
  const report = (code: ExtractionDiagnostic["code"], offset: number) => {
    if (diagnostics.length >= max) throw new RangeError("zlocale: extraction diagnostic limit exceeded");
    diagnostics.push(Object.freeze({ code, ...location(offset) }));
  };
  const syntax = (file as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;
  if (syntax.length) {
    for (const diagnostic of syntax) report("SYNTAX", diagnostic.start ?? 0);
    return Object.freeze({ messages: Object.freeze(messages), diagnostics: Object.freeze(diagnostics) });
  }
  const stack: ts.Node[] = [file];
  let nodes = 0;
  while (stack.length) {
    const node = stack.pop()!;
    if (++nodes > 200_000) throw new RangeError("zlocale: extraction node limit exceeded");
    if (ts.isCallExpression(node)) {
      const call = node.expression;
      const name = ts.isIdentifier(call) ? call.text : ts.isPropertyAccessExpression(call) ? call.name.text :
        ts.isElementAccessExpression(call) && call.argumentExpression && ts.isStringLiteralLike(call.argumentExpression) ? call.argumentExpression.text : undefined;
      const kind = name ? functions.get(name) : undefined;
      if (kind) {
        const at = node.getStart(file);
        if (node.questionDotToken || (!ts.isIdentifier(call) && !(ts.isPropertyAccessExpression(call) && !call.questionDotToken && ts.isIdentifier(call.expression) && receivers.includes(call.expression.text)))) report("INVALID_CALL", at);
        else {
          const positions = kind === "__" ? [0] : kind === "_x" ? [0, 1] : kind === "_n" ? [0, 1] : [0, 1, 3];
          const domainAt = kind === "__" ? 1 : kind === "_x" ? 2 : kind === "_n" ? 3 : 4;
          const minimum = kind === "__" ? 1 : kind === "_x" ? 2 : kind === "_n" ? 3 : 4;
          const args = node.arguments;
          const literal = (index: number): string | undefined => {
            const arg = args[index]; return arg && ts.isStringLiteralLike(arg) ? arg.text : undefined;
          };
          if (args.length < minimum || args.length > domainAt + 1 || args.some(ts.isSpreadElement)) report("INVALID_CALL", at);
          else if (positions.some(index => literal(index) === undefined) || (args[domainAt] && literal(domainAt) === undefined)) report("DYNAMIC_KEY", at);
          else {
            try {
              const singular = literal(0)!;
              const plural = kind === "_n" || kind === "_nx" ? literal(1)! : undefined;
              const context = kind === "_x" ? literal(1)! : kind === "_nx" ? literal(3)! : undefined;
              if ([singular, plural, context].some(value => value !== undefined && (value.length > 16_384 || value.includes("\u0004")))) throw new TypeError();
              if (plural !== undefined) validateMessagePlaceholders(singular, plural);
              if (messages.length >= max) throw new RangeError("zlocale: extraction message limit exceeded");
              messages.push(Object.freeze({ singular, ...(plural === undefined ? {} : { plural }), ...(context === undefined ? {} : { context }), domain: validateDomain(literal(domainAt) ?? domain), ...location(at) }));
            } catch (error) { if (error instanceof RangeError) throw error; report("INVALID_CALL", at); }
          }
        }
      }
    }
    const children: ts.Node[] = [];
    ts.forEachChild(node, child => { children.push(child); });
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]!);
  }
  return Object.freeze({ messages: Object.freeze(messages), diagnostics: Object.freeze(diagnostics) });
}
/** Incremental per-owner extraction cache keyed by filename/content hash and fixed options.
 * Source watchers call invalidate(fileName) on removal; modified text automatically replaces its entry.
 */
export function createSourceExtractor(options: Omit<ExtractionOptions, "fileName"> & { maxEntries?: number; maxCacheBytes?: number } = {}) {
  const max = bounded(options.maxEntries, 128, 1024), maxBytes = bounded(options.maxCacheBytes, 8 * 1024 * 1024, 64 * 1024 * 1024);
  const settings = { ...options, functions: Object.freeze({ ...options.functions }), receivers: Object.freeze([...(options.receivers ?? [])]) };
  const cache = new Map<string, { hash: string; result: ExtractionResult; bytes: number }>();
  let bytes = 0;
  const drop = (key: string) => { const old = cache.get(key); if (old) { bytes -= old.bytes; cache.delete(key); } };
  return Object.freeze({
    extract(fileName: string, source: string): ExtractionResult {
      if (typeof source !== "string" || source.length > (settings.maxBytes ?? 1024 * 1024)) throw new RangeError("zlocale: extraction source byte limit exceeded");
      const hash = createHash("sha256").update(source).digest("hex");
      const old = cache.get(fileName);
      if (old?.hash === hash) { cache.delete(fileName); cache.set(fileName, old); return old.result; }
      const result = extractMessages(source, { ...settings, fileName });
      const size = Buffer.byteLength(JSON.stringify(result));
      if (size > maxBytes) throw new RangeError("zlocale: extraction cache byte limit exceeded");
      drop(fileName);
      while (cache.size >= max || bytes + size > maxBytes) drop(cache.keys().next().value!);
      cache.set(fileName, { hash, result, bytes: size }); bytes += size;
      return result;
    },
    invalidate(fileName: string) { drop(fileName); },
    clear() { cache.clear(); bytes = 0; },
  });
}
/** Explicit build-time gzip of the validated V1 snapshot. No filesystem or request-time compression.
 * Serve with Content-Encoding: gzip; decompress before the browser-safe parseCatalogs boundary.
 */
export async function compressCatalogs(catalogs: readonly Catalog[], options: SnapshotOptions = {}): Promise<Uint8Array> {
  return promisify(gzip)(serializeCatalogs(catalogs, options), { level: 9 });
}
