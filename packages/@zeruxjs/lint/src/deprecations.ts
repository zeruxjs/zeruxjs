import type { Rule } from 'eslint';
import { imported, literal, variable, type Node } from './rule-ast.js';

/** An explicit API migration fact supplied by the package or trusted host config. */
export interface DeprecatedApi {
  /** Exact public module; no URLs, filesystem discovery or wildcard package loading. */
  module: string;
  /** Imported export name, default, or * to mark the entire selected module. */
  export: string;
  /** Human-reviewed explanation; never include private values or source bodies. */
  reason: string;
  /** Public replacement API/instructions; absence means no replacement is claimed. */
  replacement?: string;
  /** First deprecated release when known; omitted rather than guessed. */
  since?: string;
  /** Type aliases may be deprecated independently of runtime functions; defaults to runtime. */
  kind?: 'runtime' | 'type' | 'all';
}

/** Only source-verified aliases are seeded; no runtime function is presumed deprecated. */
export const builtInDeprecations: readonly Readonly<DeprecatedApi>[] =
  Object.freeze(
    [
      '@zeruxjs/validator',
      '@zeruxjs/validator/schemas',
      '@zeruxjs/validator/browser',
    ].flatMap((module) =>
      ['NanoIDIssue', 'NanoIDAction'].map((name) =>
        Object.freeze({
          module,
          export: name,
          kind: 'type' as const,
          reason:
            'Legacy Nano ID type spelling is explicitly deprecated by validator.',
          replacement: name.replace('NanoID', 'NanoId'),
        })
      )
    )
  );

/** Bound registry labels without coercion, executable getters or private content.
 * @param {unknown} value - Candidate inert string from trusted configuration.
 * @param {number} maximum - Maximum label length in UTF-16 code units.
 * @returns {boolean} Whether the label is nonblank, bounded and free of ASCII controls.
 */
function label(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= maximum &&
    !Array.from(value).some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
    )
  );
}

/** Snapshot explicit API deprecations; nothing is imported to discover annotations.
 * @param {readonly DeprecatedApi[]} entries - Host-owned declarations, at most 128; later mutation cannot change the result.
 * @param {{includeBuiltIns?: boolean}} options - Selection policy for verified package-owned aliases.
 * @param {boolean} [options.includeBuiltIns=true] - Include the documented built-in aliases before host declarations.
 * @returns {readonly Readonly<DeprecatedApi>[]} Frozen registry; host entries explicitly replace an identical builtin module/export/kind key.
 * @throws {TypeError} For malformed records, duplicate host keys, unknown fields or oversized labels.
 */
export function createDeprecationRegistry(
  entries: readonly DeprecatedApi[] = [],
  options: { includeBuiltIns?: boolean } = {}
): readonly Readonly<DeprecatedApi>[] {
  if (
    !Array.isArray(entries) ||
    entries.length > 128 ||
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    Object.keys(options).some((key) => key !== 'includeBuiltIns') ||
    (options.includeBuiltIns !== undefined &&
      typeof options.includeBuiltIns !== 'boolean')
  ) {
    throw new TypeError('lint: invalid deprecation registry options');
  }
  /** Invocation-owned registry keys; no process-global registration state is retained. */
  const records = new Map<string, Readonly<DeprecatedApi>>();
  /** Reject conflicting host entries rather than depending on silent input order. */
  const seen = new Set<string>();
  if (options.includeBuiltIns !== false) {
    // Each verified entry is already immutable; hosts can explicitly opt out or replace its exact key.
    for (const entry of builtInDeprecations) {
      records.set(`${entry.module}:${entry.export}:${entry.kind}`, entry);
    }
  }
  // Each entry is data; descriptors reject accessors before any field is read.
  for (const entry of entries) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      Array.isArray(entry) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(entry))
    ) {
      throw new TypeError('lint: invalid deprecation entry');
    }
    if (
      Reflect.ownKeys(entry).some(
        (key) =>
          typeof key !== 'string' ||
          ![
            'module',
            'export',
            'reason',
            'replacement',
            'since',
            'kind',
          ].includes(key) ||
          !Object.hasOwn(
            Object.getOwnPropertyDescriptor(entry, key) ?? {},
            'value'
          )
      )
    ) {
      throw new TypeError(
        'lint: deprecation entries must contain known data fields'
      );
    }
    if (
      !label(entry.module, 200) ||
      !/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9._-]+)*$/i.test(
        entry.module
      ) ||
      entry.module
        .split('/')
        .some((part: string) => part === '.' || part === '..') ||
      !label(entry.export, 100) ||
      !/^(?:[a-zA-Z_$][\w$]*|\*)$/.test(entry.export) ||
      !label(entry.reason, 240) ||
      (entry.replacement !== undefined && !label(entry.replacement, 240)) ||
      (entry.since !== undefined && !label(entry.since, 40)) ||
      (entry.kind !== undefined &&
        !['runtime', 'type', 'all'].includes(entry.kind))
    ) {
      throw new TypeError('lint: invalid deprecation fields');
    }
    /** Snapshot value; no application object references or callback code enter the registry. */
    const snapshot = Object.freeze({ ...entry, kind: entry.kind ?? 'runtime' });
    /** Exact key separates type-only aliases from runtime APIs with the same name. */
    const key = `${snapshot.module}:${snapshot.export}:${snapshot.kind}`;
    if (seen.has(key)) {
      throw new TypeError('lint: duplicate deprecation entry');
    }
    if (!records.has(key) && records.size >= 128) {
      throw new TypeError('lint: deprecation registry exceeds 128 facts');
    }
    seen.add(key);
    records.set(key, snapshot);
  }
  return Object.freeze([...records.values()]);
}

/** Create an isolated static deprecation checker; no API call or replacement is executed.
 * @param {readonly Readonly<DeprecatedApi>[]} registry - Validated immutable snapshot owned by this config.
 * @returns {Rule.RuleModule} Reporting-only rule; severity is controlled by the selected preset/host.
 */
export function createDeprecationRule(
  registry: readonly Readonly<DeprecatedApi>[]
): Rule.RuleModule {
  return {
    meta: {
      type: 'suggestion',
      schema: [],
      docs: {
        description: 'Report explicitly registered deprecated public APIs',
      },
      messages: {
        deprecated: '{{api}} is deprecated{{since}}. {{reason}}{{replacement}}',
      },
    },
    create(context) {
      /** Match the registered phase without guessing whether an unmarked import is erased.
       * @param {Node} node - Borrowed node associated with the diagnostic.
       * @param {string} source - Exact proven module name.
       * @param {string} name - Original exported name, before any local alias.
       * @param {boolean} typeOnly - Explicit erased type import/reexport.
       * @returns {void} Reports a single matching exact or module-wide registry entry.
       */
      const report = (
        node: Node,
        source: string,
        name: string,
        typeOnly = false
      ): void => {
        /** Exact exports take priority over a module-wide deprecation declaration. */
        const candidates = registry.filter(
          (entry) =>
            entry.module === source &&
            (entry.kind === 'all' ||
              entry.kind === (typeOnly ? 'type' : 'runtime'))
        );
        /** Registered message data, not arguments or user document contents. */
        const entry =
          candidates.find((item) => item.export === name) ??
          candidates.find((item) => item.export === '*');
        if (!entry) {
          return;
        }
        context.report({
          node,
          messageId: 'deprecated',
          data: {
            api: `${source}#${name}`,
            since: entry.since ? ` since ${entry.since}` : '',
            reason: entry.reason,
            replacement: entry.replacement ? ` Use ${entry.replacement}.` : '',
          },
        });
      };
      /** Read only an unshadowed literal CommonJS import.
       * @param {Node} node - Candidate call, inspected without running it.
       * @returns {string | undefined} Exact module source, or undefined for computed/shadowed calls.
       */
      const required = (node: Node): string | undefined =>
        node?.type === 'CallExpression' &&
        node.callee.type === 'Identifier' &&
        node.callee.name === 'require' &&
        !variable(context, node.callee)?.defs.length
          ? literal(node.arguments[0])
          : undefined;
      return {
        ImportDeclaration(node: Node) {
          /** Static module source; parser-owned nodes are never mutated. */
          const source = literal(node.source);
          if (!source) {
            return;
          }
          if (!node.specifiers.length) {
            report(node, source, '*');
          }
          // Named/default bindings report at declaration; namespace bindings report at a proven member use.
          for (const item of node.specifiers) {
            if (item.type === 'ImportNamespaceSpecifier') {
              continue;
            }
            report(
              item,
              source,
              item.type === 'ImportDefaultSpecifier'
                ? 'default'
                : (item.imported.name ?? item.imported.value),
              node.importKind === 'type' || item.importKind === 'type'
            );
          }
        },
        ExportNamedDeclaration(node: Node) {
          /** Exact reexport origin; local exports without a source are not guessed. */
          const source = literal(node.source);
          if (!source) {
            return;
          }
          // local is the original name in a source-bearing reexport, before its public alias.
          for (const item of node.specifiers) {
            report(
              item,
              source,
              item.local.name ?? item.local.value,
              node.exportKind === 'type' || item.exportKind === 'type'
            );
          }
        },
        ExportAllDeclaration(node: Node) {
          /** Module-wide facts can be checked without resolving a wildcard export graph. */
          const source = literal(node.source);
          if (source) {
            report(node, source, '*', node.exportKind === 'type');
          }
        },
        ImportExpression(node: Node) {
          /** Dynamic literal imports reveal a module, but not which individual API will be used. */
          const source = literal(node.source);
          if (source) {
            report(node, source, '*');
          }
        },
        MemberExpression(node: Node) {
          /** Static property only; computed expressions are never evaluated by the checker. */
          const name = node.computed
            ? literal(node.property)
            : node.property.name;
          if (!name) {
            return;
          }
          /** ESM namespace origin, honoring lexical shadowing. */
          const binding = imported(context, node.object);
          if (binding?.name === '*') {
            report(node, binding.source, name);
            return;
          }
          /** Direct require(...).api, or a locally bound literal require result. */
          const source =
            required(node.object) ??
            (node.object.type === 'Identifier'
              ? required(variable(context, node.object)?.defs[0]?.node?.init)
              : undefined);
          if (source) {
            report(node, source, name);
          }
        },
        CallExpression(node: Node) {
          /** CommonJS module source; unproven calls are left to runtime/other analysis. */
          const source = required(node);
          if (!source) {
            return;
          }
          report(node, source, '*');
          /** Object-pattern imports preserve their original exported keys despite local aliases. */
          const pattern =
            node.parent?.type === 'VariableDeclarator'
              ? node.parent.id
              : undefined;
          if (pattern?.type === 'ObjectPattern') {
            // Rest/computed properties do not prove a specific deprecated export.
            for (const item of pattern.properties) {
              if (item.type === 'Property' && !item.computed) {
                report(item, source, item.key.name ?? item.key.value);
              }
            }
          }
        },
      };
    },
  };
}
