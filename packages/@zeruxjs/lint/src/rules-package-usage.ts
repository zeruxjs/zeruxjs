import type { Rule } from 'eslint';
import { imported, literal, variable, type Node } from './rule-ast.js';

/** Verified public entry points; recommendations are not drop-in equivalence claims. */
const alternatives: Readonly<Record<string, string>> = Object.freeze({
  nodemailer:
    '@zeruxjs/email: createEmailManager for managed sending and consent boundaries',
  esbuild:
    '@zeruxjs/typescript/build: buildTypescript for supported build options',
  typescript:
    '@zeruxjs/typescript: transformTypescript/checkTypes for supported tooling',
  ioredis:
    '@zeruxjs/cache-redis: createCacheHelper for managed cache operations',
  redis: '@zeruxjs/cache-redis: createCacheHelper for managed cache operations',
  pg: '@zeruxjs/db-pg: createConnector for managed PostgreSQL operations',
  mysql2: '@zeruxjs/db-mysql: createConnector for managed MySQL operations',
  'better-sqlite3':
    '@zeruxjs/db-sqlite: createConnector for supported SQLite operations',
  bullmq: '@zeruxjs/queue-bullmq: createQueueService for managed BullMQ queues',
  amqplib:
    '@zeruxjs/queue-rabbitmq: createRabbitMQ for supported RabbitMQ operations',
});

/** Builtin module spellings containing watch; other filesystem APIs remain valid. */
const filesystemModules = new Set([
  'fs',
  'node:fs',
  'fs/promises',
  'node:fs/promises',
]);

/** Read literal import source and recognize erased TypeScript-only bindings.
 * @param {Node} node - Borrowed parser node; inspected without mutation or execution.
 * @returns {boolean} True only for declarations whose bindings are all erased by TypeScript.
 */
function typeOnly(node: Node): boolean {
  return (
    node.importKind === 'type' ||
    node.exportKind === 'type' ||
    (node.specifiers?.length > 0 &&
      node.specifiers.every(
        (item: Node) => item.importKind === 'type' || item.exportKind === 'type'
      ))
  );
}

/** Package policy uses only static allowlisted mappings, never filesystem discovery.
 * @param {string} source - Synthetic text or parser expression inspected without execution.
 * @returns {string | undefined} Supported managed alternative, or undefined for an unregistered SDK.
 */
function recommendation(source: string): string | undefined {
  return alternatives[source.split('/')[0] ?? ''];
}

/** Application policy; the light package preset leaves it off for native backend implementations.
 * No autofix: SDK/native and managed APIs have different ownership and option contracts.
 */
export const packageUsageRule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Require supported ZeruxJS entry points for managed application capabilities',
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          allow: {
            type: 'array',
            maxItems: 64,
            uniqueItems: true,
            items: { type: 'string', minLength: 1, maxLength: 200 },
          },
        },
      },
    ],
    messages: {
      managed:
        'Use {{alternative}} instead of a direct {{source}} runtime integration. These APIs are not drop-in equivalents. If native/provider-specific access is required, declare this exact module in the package-usage allowlist and document ownership.',
      watch:
        'Use zlook startWatcher/watchDirectory for managed watching and retain its disposer. Native watch semantics differ; explicitly allow this filesystem module when a native integration is required.',
    },
  },
  create(context) {
    /** Explicit module exceptions owned by the host; no path-based implicit bypass. */
    const allowed = new Set<string>(
      (context.options[0] as { allow?: string[] } | undefined)?.allow ?? []
    );
    /** Report only known managed capability families; never import the candidate module.
     * @param {Node} node - Borrowed parser node; inspected without mutation or execution.
     * @param {Node} sourceNode - Candidate literal import source, inspected without evaluating expressions.
     * @returns {void} Reports a known managed SDK alternative without evaluating the imported module.
     */
    const checkSource = (node: Node, sourceNode: Node): void => {
      /** Inert literal specifier; computed expressions are outside this rule's proof. */
      const source = literal(sourceNode);
      if (!source || allowed.has(source)) {
        return;
      }
      /** Public managed alternative for this SDK family, if supported. */
      const alternative = recommendation(source);
      if (alternative) {
        context.report({
          node,
          messageId: 'managed',
          data: { source, alternative },
        });
      }
    };
    return {
      ImportDeclaration(node: Node) {
        if (typeOnly(node)) {
          return;
        }
        checkSource(node, node.source);
        /** Native imports are rejected only when an actual watch binding is requested. */
        const source = literal(node.source);
        if (
          source &&
          filesystemModules.has(source) &&
          !allowed.has(source) &&
          node.specifiers.some(
            (item: Node) =>
              item.importKind !== 'type' &&
              item.type === 'ImportSpecifier' &&
              (item.imported.name ?? item.imported.value) === 'watch'
          )
        ) {
          context.report({ node, messageId: 'watch' });
        }
      },
      ExportNamedDeclaration(node: Node) {
        if (node.source && !typeOnly(node)) {
          checkSource(node, node.source);
        }
      },
      ExportAllDeclaration(node: Node) {
        if (!typeOnly(node)) {
          checkSource(node, node.source);
        }
      },
      ImportExpression(node: Node) {
        checkSource(node, node.source);
      },
      TSImportEqualsDeclaration(node: Node) {
        if (
          !typeOnly(node) &&
          node.moduleReference?.type === 'TSExternalModuleReference'
        ) {
          checkSource(node, node.moduleReference.expression);
        }
      },
      CallExpression(node: Node) {
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'require' &&
          !variable(context, node.callee)?.defs.length
        ) {
          checkSource(node, node.arguments[0]);
        }
        if (
          node.callee.type !== 'MemberExpression' ||
          node.callee.computed ||
          node.callee.property.name !== 'watch'
        ) {
          return;
        }
        /** Namespace/default import owner; local shadowing is resolved by the shared AST helper. */
        const binding = imported(context, node.callee.object);
        if (
          binding &&
          filesystemModules.has(binding.source) &&
          !allowed.has(binding.source)
        ) {
          context.report({ node, messageId: 'watch' });
        }
      },
    };
  },
};
