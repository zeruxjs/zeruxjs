import path from 'node:path';
import { builtinModules, createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import type * as TypeScript from 'typescript';
export interface BuildSource {
  /** Project-relative authored source identity. */
  relative: string;
  /** Explicit bounded source text; discovery never evaluates it. */
  source: string;
  /** Optional explicitly public entry path. */
  publicPath?: string;
  /** Host-authored role requiring server classification. */
  serverOnly?: boolean;
  /** Whether recognized route handler syntax implies a server role. */
  routeModule?: boolean;
}
export type ModuleEnvironment = 'server' | 'client' | 'shared';
export interface ClassifiedModule {
  /** Normalized graph module identity. */
  path: string;
  /** Explicit syntax/suffix role before graph reachability. */
  declared: 'server' | 'client' | 'neutral';
  /** Validated graph-derived server/client/shared environment. */
  environment: ModuleEnvironment;
  /** Resolved local graph import identities, not arbitrary package endpoints. */
  imports: string[];
  /** SHA-256 source-content identity; not authorship or authorization proof. */
  hash: string;
}
export interface ModuleClassification {
  /** Deterministically ordered classification records. */
  modules: ClassifiedModule[];
  /** Explicit client/public roots in deterministic order. */
  clientEntries: string[];
  /** Validated client-reachable module identities. */
  clientModules: Set<string>;
  /** Resolved graph-owned import targets. */
  edges: Map<string, Map<string, string>>;
}
export { ModuleBoundaryError } from './boundary-error.js';
import { ModuleBoundaryError } from './boundary-error.js';
/** Supported authored JavaScript/TypeScript source extensions for the closed graph. */
const SCRIPT = /\.[cm]?[jt]sx?$/i;
/** Native Node module names normalized to detect explicit browser boundary violations. */
const builtins = new Set(
  builtinModules.map((name) => name.replace(/^node:/, ''))
);
/** Conservative free server/dynamic-code identifiers disallowed in the closed client graph. */
const serverGlobals = new Set([
  'process',
  'Buffer',
  'global',
  '__dirname',
  '__filename',
  'require',
  'module',
  'exports',
  'eval',
  'Function',
]);
/** Normalize project-relative separators for stable graph identities.
 * @param {string} value - Project-relative source path.
 * @returns {string} Slash-separated graph path.
 */
const normalize = (value: string) => value.split(path.sep).join('/');
/** Load the host TypeScript parser for syntax inspection, without executing application source modules.
 * @param {string} root - Trusted project root used for normal package resolution.
 * @returns {Promise<typeof TypeScript>} Parser namespace, or an explicit missing-tool diagnostic.
 */
export async function loadBuildParser(
  root: string
): Promise<typeof TypeScript> {
  try {
    return createRequire(path.join(root, 'package.json'))('typescript');
  } catch {
    try {
      return await import('typescript');
    } catch {
      throw new ModuleBoundaryError('TYPESCRIPT_CLASSIFIER_REQUIRED', []);
    }
  }
}
/** Parse one explicitly supplied source document using its authored extension.
 * @param {typeof TypeScript} ts - Injected TypeScript parser namespace.
 * @param {BuildSource} file - Bounded authored source record.
 * @returns {TypeScript.SourceFile} Syntax tree only; no module evaluation occurs.
 */
function parsed(ts: typeof TypeScript, file: BuildSource) {
  let kind: TypeScript.ScriptKind;
  if (/\.tsx$/i.test(file.relative)) {
    kind = ts.ScriptKind.TSX;
  } else if (/\.jsx$/i.test(file.relative)) {
    kind = ts.ScriptKind.JSX;
  } else {
    kind = ts.ScriptKind.TS;
  }
  return ts.createSourceFile(
    file.relative,
    file.source,
    ts.ScriptTarget.Latest,
    true,
    kind
  );
}
/** Collect runtime import literals and conservative server/dynamic-code usage while excluding type-only syntax.
 * @param {typeof TypeScript} ts - Injected TypeScript parser namespace.
 * @param {TypeScript.SourceFile} source - Parsed authored source document.
 * @returns {object} Literal spans plus dynamic/server-use flags.
 */
function imports(ts: typeof TypeScript, source: TypeScript.SourceFile) {
  /** Actual runtime import literal spans found by syntax traversal, excluding type-only imports. */
  const found: {
    /** Actual parsed runtime import literal. */
    specifier: string; /** Start offset of the import string literal in its source. */
    start: number; /** Exclusive end offset of the parsed string literal. */
    end: number;
  }[] = [];
  let dynamic = false,
    serverUse = false;
  // Browser bundlers wrap compatible CommonJS modules in local {exports:{}} data.
  // Property names are not references to Node's free `exports` binding. Require
  // an actual local base; globalThis/window/self.exports remain server use.
  /** Syntactically declared local binding names used only for the narrow local exports-property exception. */
  const bindings = new Set<string>();
  /** Collect identifiers from explicit binding syntax, including destructuring.
   * @param {TypeScript.BindingName} name - Parsed variable/parameter binding.
   * @returns {void} Local binding-name collection completion.
   */
  const bind = (name: TypeScript.BindingName) => {
    if (ts.isIdentifier(name)) {
      bindings.add(name.text);
    } else {
      for (const item of name.elements) {
        if (ts.isBindingElement(item)) {
          bind(item.name);
        }
      }
    }
  };
  /** Collect local variable and parameter binding names without evaluating source.
   * @param {TypeScript.Node} node - Parsed syntax node.
   * @returns {void} Recursive binding collection completion.
   */
  const collect = (node: TypeScript.Node) => {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node)) {
      bind(node.name);
    }
    ts.forEachChild(node, collect);
  };
  collect(source);
  /** Recognize a syntactically local non-server base for harmless exports properties.
   * @param {TypeScript.Expression} input - Parsed property base expression.
   * @returns {boolean} Whether the expression is a known local binding, not a global object.
   */
  const localBase = (input: TypeScript.Expression): boolean => {
    let node = input;
    while (ts.isParenthesizedExpression(node)) {
      node = node.expression;
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      node = node.left;
    }
    return (
      ts.isIdentifier(node) &&
      bindings.has(node.text) &&
      !serverGlobals.has(node.text) &&
      !['globalThis', 'window', 'self'].includes(node.text)
    );
  };
  /** Allow only authored exports properties on syntactically local objects, never global exports access.
   * @param {TypeScript.Identifier} node - Parsed identifier candidate.
   * @returns {boolean} Whether this is the narrow local property-name case.
   */
  const localExportProperty = (node: TypeScript.Identifier) =>
    node.text === 'exports' &&
    ((ts.isPropertyAssignment(node.parent) && node.parent.name === node) ||
      (ts.isPropertyAccessExpression(node.parent) &&
        node.parent.name === node &&
        localBase(node.parent.expression)));
  /** Record an actual string import span; nonliteral specifiers mark unsupported dynamic resolution.
   * @param {TypeScript.Node} node - Parsed module specifier syntax.
   * @returns {void} Runtime import collection update.
   */
  const literal = (node: TypeScript.Node) => {
    if (ts.isStringLiteral(node)) {
      found.push({
        specifier: node.text,
        start: node.getStart(source),
        end: node.end,
      });
    } else {
      dynamic = true;
    }
  };
  /** Inspect runtime import and server-use syntax without executing source modules.
   * @param {TypeScript.Node} node - Parsed syntax node.
   * @returns {void} Conservative runtime boundary inspection completion.
   */
  const walk = (node: TypeScript.Node) => {
    if (ts.isTypeNode(node)) {
      return;
    }
    if (ts.isImportDeclaration(node)) {
      if (node.importClause?.isTypeOnly) {
        return;
      }
      /** Parsed import clause checked for entirely type-only bindings. */
      const clause = node.importClause;
      if (
        clause &&
        !clause.name &&
        clause.namedBindings &&
        ts.isNamedImports(clause.namedBindings) &&
        clause.namedBindings.elements.every((item) => item.isTypeOnly)
      ) {
        return;
      }
      literal(node.moduleSpecifier);
      return;
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      if (node.isTypeOnly) {
        return;
      }
      if (
        node.exportClause &&
        ts.isNamedExports(node.exportClause) &&
        node.exportClause.elements.every((item) => item.isTypeOnly)
      ) {
        return;
      }
      literal(node.moduleSpecifier);
      return;
    }
    if (ts.isImportEqualsDeclaration(node)) {
      if (node.isTypeOnly) {
        return;
      }
      if (
        ts.isExternalModuleReference(node.moduleReference) &&
        node.moduleReference.expression
      ) {
        literal(node.moduleReference.expression);
      } else {
        dynamic = true;
      }
      serverUse = true;
      return;
    }
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === 'require'))
    ) {
      if (node.arguments.length !== 1) {
        dynamic = true;
      } else {
        literal(node.arguments[0]!);
      }
    }
    if (
      ts.isIdentifier(node) &&
      serverGlobals.has(node.text) &&
      !localExportProperty(node)
    ) {
      serverUse = true;
    }
    if (
      ts.isElementAccessExpression(node) &&
      node.argumentExpression &&
      ts.isStringLiteral(node.argumentExpression) &&
      serverGlobals.has(node.argumentExpression.text)
    ) {
      serverUse = true;
    }
    if (ts.isMetaProperty(node)) {
      serverUse = true;
    } // import.meta/env has no declared public substitution policy.
    ts.forEachChild(node, walk);
  };
  walk(source);
  return { found, dynamic, serverUse };
}
/** Recognize exact initial directive prologues and authored client/server suffixes; conflicting declarations reject.
 * @param {typeof TypeScript} ts - Injected TypeScript parser namespace.
 * @param {TypeScript.SourceFile} source - Parsed authored source document.
 * @returns {'client' | 'server' | 'neutral'} Explicit declared role, independent of graph reachability.
 */
function directive(ts: typeof TypeScript, source: TypeScript.SourceFile) {
  let client = /\.client\.[cm]?[jt]sx?$/i.test(source.fileName),
    server = /\.server\.[cm]?[jt]sx?$/i.test(source.fileName);
  for (const statement of source.statements) {
    if (
      !ts.isExpressionStatement(statement) ||
      !ts.isStringLiteral(statement.expression)
    ) {
      break;
    }
    /** Exact directive source spelling; escaped strings and comments do not become directives. */
    const text = statement.expression.getText(source);
    if (text === '"use client"' || text === "'use client'") {
      client = true;
    }
    if (text === '"use server"' || text === "'use server'") {
      server = true;
    }
  }
  if (client && server) {
    throw new ModuleBoundaryError('CONFLICTING_MODULE_DIRECTIVES', [
      source.fileName,
    ]);
  }
  if (client) {
    return 'client';
  }
  if (server) {
    return 'server';
  }
  return 'neutral';
}
/** Resolve a relative import only within the explicitly provided source graph.
 * @param {string} from - Normalized importing graph identity.
 * @param {string} specifier - Parsed local import literal.
 * @param {Map<string, BuildSource>} files - Explicit normalized source graph.
 * @returns {string | undefined} Matching graph identity or undefined; no source is loaded or executed.
 */
function target(
  from: string,
  specifier: string,
  files: Map<string, BuildSource>
) {
  /** Normalized relative import candidate before graph containment checks. */
  const base = path.posix.normalize(
    path.posix.join(path.posix.dirname(from), specifier)
  );
  if (base.startsWith('../') || path.posix.isAbsolute(base)) {
    return undefined;
  }
  /** JavaScript-extension-free candidate used for compatible authored source lookup. */
  const stem = base.replace(/\.[cm]?jsx?$/i, '');
  /** Finite explicit source/index candidates; package discovery is not attempted. */
  const candidates = [
    base,
    ...['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'].map(
      (ext) => stem + ext
    ),
    ...['.ts', '.tsx', '.js', '.mjs'].map((ext) => base + '/index' + ext),
  ];
  return candidates.find((file) => files.has(file) && SCRIPT.test(file));
}
/** Identify runtime route exports through syntax without importing the route module.
 * @param {typeof TypeScript} ts - Injected parser namespace.
 * @param {TypeScript.SourceFile} source - Parsed route source.
 * @param {boolean} client - Whether an exact client directive was declared.
 * @returns {boolean} Whether the authored route exposes recognized server handler exports.
 */
function serverRoute(
  ts: typeof TypeScript,
  source: TypeScript.SourceFile,
  client: boolean
) {
  for (const statement of source.statements) {
    if (ts.isExportAssignment(statement) && !client) {
      return true;
    }
    /** Actual declaration modifiers used to recognize server route exports. */
    const modifiers = ts.canHaveModifiers(statement)
      ? ts.getModifiers(statement)
      : undefined;
    if (!modifiers?.some((item) => item.kind === ts.SyntaxKind.ExportKeyword)) {
      continue;
    }
    if (
      !client &&
      modifiers.some((item) => item.kind === ts.SyntaxKind.DefaultKeyword)
    ) {
      return true;
    }
    if (
      ts.isFunctionDeclaration(statement) &&
      /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(
        statement.name?.text ?? ''
      )
    ) {
      return true;
    }
    if (
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some(
        (item) =>
          ts.isIdentifier(item.name) &&
          /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(item.name.text)
      )
    ) {
      return true;
    }
  }
  return false;
}
/** Validate a bounded closed local browser ESM graph and server/shared boundaries before compiling public assets.
 * @param {typeof TypeScript} ts - Injected host parser namespace.
 * @param {readonly BuildSource[]} sources - Explicit authored source allowlist with byte/document ceilings.
 * @returns {ModuleClassification} Deterministic module roles, client roots and resolved local graph edges.
 */
export function classifyModules(
  ts: typeof TypeScript,
  sources: readonly BuildSource[]
): ModuleClassification {
  if (
    sources.length > 5000 ||
    sources.reduce((sum, item) => sum + Buffer.byteLength(item.source), 0) >
      64 * 1024 * 1024 ||
    sources.some((item) => Buffer.byteLength(item.source) > 1048576)
  ) {
    throw new ModuleBoundaryError('MODULE_GRAPH_LIMIT', []);
  }
  /** Explicit bounded authored-source graph, excluding declarations. */
  const files = new Map(
    sources
      .filter(
        (file) => SCRIPT.test(file.relative) && !file.relative.endsWith('.d.ts')
      )
      .map((file) => [normalize(file.relative), file])
  );
  /** Per-module syntax facts and declared environment, retained only during classification. */
  const data = new Map<
    string,
    {
      /** Borrowed explicit source record. */
      file: BuildSource;
      /** Explicit syntax/suffix role before graph reachability. */
      declared: 'server' | 'client' | 'neutral';
      /** Syntax-derived runtime import and server-use flags. */
      info: ReturnType<typeof imports>;
    }
  >();
  /** Resolved local import edges keyed by source and original literal specifier. */
  const edges = new Map<string, Map<string, string>>();
  for (const [file, item] of files) {
    /** Parsed syntax tree; source evaluation is never used to discover imports/directives. */
    const tree = parsed(ts, item);
    let declared: 'server' | 'client' | 'neutral' = directive(ts, tree);
    if (
      item.serverOnly ||
      (item.routeModule && serverRoute(ts, tree, declared === 'client'))
    ) {
      if (declared === 'client') {
        throw new ModuleBoundaryError('CLIENT_MODULE_IN_SERVER_ROLE', [file]);
      }
      declared = 'server';
    }
    /** Collected runtime imports and conservative dynamic/server-use flags. */
    const info = imports(ts, tree);
    data.set(file, { file: item, declared, info });
    /** Resolved local edges for this explicit source module. */
    const links = new Map<string, string>();
    for (const { specifier } of info.found) {
      if (specifier.startsWith('.')) {
        /** Local graph-owned import target; missing nodes never trigger filesystem/package execution. */
        const resolved = target(file, specifier, files);
        if (resolved) {
          links.set(specifier, resolved);
        }
      }
    }
    edges.set(file, links);
  }
  /** Deterministically ordered explicitly client/public entry roots. */
  const clientEntries = [...data]
    .filter(
      ([, item]) =>
        item.declared === 'client' || item.file.publicPath !== undefined
    )
    .map(([file]) => file)
    .sort();
  /** Modules reached by the validated closed client graph. */
  const clientModules = new Set<string>();
  /** Traverse client imports with bounded depth, rejecting server roles and unsupported dependency resolution.
   * @param {string} file - Graph-owned source identity.
   * @param {string[]} chain - Private import trace for trusted diagnostics.
   * @returns {void} Client boundary validation and reachability update.
   */
  const visit = (file: string, chain: string[]) => {
    /** Graph-owned module syntax facts for the current traversal. */
    const item = data.get(file)!;
    /** Private import chain retained only in trusted build diagnostics. */
    const trace = [...chain, file];
    if (chain.length >= 64) {
      throw new ModuleBoundaryError('MODULE_IMPORT_DEPTH_LIMIT', trace);
    }
    if (item.declared === 'server') {
      throw new ModuleBoundaryError('CLIENT_IMPORTS_SERVER_MODULE', trace);
    }
    if (item.info.serverUse) {
      throw new ModuleBoundaryError('CLIENT_USES_SERVER_GLOBAL', trace);
    }
    if (item.info.dynamic) {
      throw new ModuleBoundaryError('CLIENT_DYNAMIC_IMPORT_UNSUPPORTED', trace);
    }
    if (clientModules.has(file)) {
      return;
    }
    clientModules.add(file);
    for (const { specifier } of item.info.found) {
      if (specifier.startsWith('.')) {
        /** Local graph-owned import target; missing nodes never trigger filesystem/package execution. */
        const resolved = edges.get(file)!.get(specifier);
        if (!resolved) {
          throw new ModuleBoundaryError('CLIENT_LOCAL_IMPORT_NOT_IN_BUILD', [
            ...trace,
            '<unresolved local import>',
          ]);
        }
        visit(resolved, trace);
      } else {
        /** Restricted external import label; arbitrary specifier content is not copied into diagnostics. */
        const safe = /^(?:node:)?[@\w./:-]{1,128}$/.test(specifier)
          ? specifier
          : '<external import>';
        /** Whether this external import names a native or known server-only service. */
        const denied =
          specifier.startsWith('node:') ||
          builtins.has(specifier) ||
          /^(?:db(?::|$)|@zeruxjs\/(?:db|auth|cache|security|files|email|queue)|zeruxjs(?:\/|$)|server-only$)/.test(
            specifier
          );
        throw new ModuleBoundaryError(
          denied
            ? 'CLIENT_IMPORTS_SERVER_SERVICE'
            : 'CLIENT_EXTERNAL_BUNDLER_REQUIRED',
          [...trace, safe]
        );
      }
    }
  };
  for (const entry of clientEntries) {
    visit(entry, []);
  }
  // Follow shared helpers too: a server import must not smuggle in a browser entry.
  /** Visited server/shared graph nodes used to prevent repeated traversal. */
  const checked = new Set<string>();
  /** Traverse server/shared helpers while rejecting direct or transitive browser entry imports.
   * @param {string} file - Graph-owned module identity.
   * @param {string[]} chain - Private import chain bounded by the depth policy.
   * @returns {void} Server boundary validation and reachability update.
   */
  const serverVisit = (file: string, chain: string[]) => {
    if (chain.length >= 64) {
      throw new ModuleBoundaryError('MODULE_IMPORT_DEPTH_LIMIT', [
        ...chain,
        file,
      ]);
    }
    if (data.get(file)?.declared === 'client') {
      throw new ModuleBoundaryError('SERVER_IMPORTS_CLIENT_ENTRY_UNSUPPORTED', [
        ...chain,
        file,
      ]);
    }
    if (checked.has(file)) {
      return;
    }
    checked.add(file);
    for (const resolved of edges.get(file)!.values()) {
      serverVisit(resolved, [...chain, file]);
    }
  };
  for (const [file] of data) {
    if (!clientModules.has(file)) {
      serverVisit(file, []);
    }
  }
  /** Deterministic classification records with source hashes and graph-owned import targets. */
  const modules = [...data]
    .sort(([a], [b]) => {
      if (a < b) {
        return -1;
      }
      if (a > b) {
        return 1;
      }
      return 0;
    })
    .map(([file, item]) => {
      let environment: ModuleEnvironment;
      if (clientModules.has(file)) {
        if (checked.has(file)) {
          environment = 'shared';
        } else {
          environment = 'client';
        }
      } else {
        environment = 'server';
      }
      return {
        path: file,
        declared: item.declared,
        environment,
        imports: [...edges.get(file)!.values()].sort(),
        hash: createHash('sha256').update(item.file.source).digest('hex'),
      };
    });
  return { modules, clientEntries, clientModules, edges };
}
/** Recheck emitted runtime syntax and replace only actual local import literals with graph-owned asset IDs.
 * @param {typeof TypeScript} ts - Injected parser namespace.
 * @param {string} relative - Normalized emitted source identity.
 * @param {string} source - Compiler-emitted source text, never evaluated here.
 * @param {readonly BuildSource[]} files - Explicit authored source graph.
 * @param {ReadonlyMap<string, string>} ids - Host builder-assigned public asset IDs.
 * @param {string} prefix - Trusted generated relative asset prefix.
 * @returns {string} Rewritten emitted source with non-overlapping spans replaced from right to left.
 */
export function rewriteClientModule(
  ts: typeof TypeScript,
  relative: string,
  source: string,
  files: readonly BuildSource[],
  ids: ReadonlyMap<string, string>,
  prefix = './'
): string {
  /** Parsed syntax tree; source evaluation is never used to discover imports/directives. */
  const tree = parsed(ts, { relative, source });
  /** Collected runtime imports and conservative dynamic/server-use flags. */
  const info = imports(ts, tree);
  if (info.dynamic || info.serverUse) {
    throw new ModuleBoundaryError('CLIENT_COMPILED_BOUNDARY_VIOLATION', [
      relative,
    ]);
  }
  /** Explicit normalized authored sources used to resolve compiler-emitted local imports. */
  const lookup = new Map(files.map((file) => [normalize(file.relative), file]));
  /** Parsed import literal spans and JSON-encoded generated asset references. */
  const replacements: {
    /** Start offset of the import string literal in its source. */
    start: number; /** Exclusive end offset of the parsed string literal. */
    end: number; /** JSON-encoded public asset import replacement. */
    value: string;
  }[] = [];
  for (const entry of info.found) {
    if (!entry.specifier.startsWith('.')) {
      throw new ModuleBoundaryError('CLIENT_COMPILED_EXTERNAL_IMPORT', [
        relative,
        /^(?:node:)?[@\w./:-]{1,128}$/.test(entry.specifier)
          ? entry.specifier
          : '<external import>',
      ]);
    }
    /** Local graph-owned import target; missing nodes never trigger filesystem/package execution. */
    const resolved = target(relative, entry.specifier, lookup);
    /** Graph-assigned public asset ID, required before rewriting a local import. */
    const id = resolved && ids.get(resolved);
    if (!id) {
      throw new ModuleBoundaryError('CLIENT_COMPILED_IMPORT_UNRESOLVED', [
        relative,
      ]);
    }
    replacements.push({ ...entry, value: JSON.stringify(prefix + id + '.js') });
  }
  let output = source;
  for (const entry of replacements.sort((a, b) => b.start - a.start)) {
    output =
      output.slice(0, entry.start) + entry.value + output.slice(entry.end);
  }
  return output;
}

/** Apply the exact shared directive policy for route discovery without executing the module.
 * @param {typeof TypeScript} ts - Injected host parser namespace.
 * @param {string} relative - Authored source identity.
 * @param {string} source - Authored source text.
 * @returns {boolean} Whether exact syntax/suffix policy declares a client module.
 */
export function isClientModuleSource(
  ts: typeof TypeScript,
  relative: string,
  source: string
): boolean {
  return directive(ts, parsed(ts, { relative, source })) === 'client';
}
