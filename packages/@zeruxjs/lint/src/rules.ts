import {
  createDeprecationRule,
  createDeprecationRegistry,
  type DeprecatedApi,
} from './deprecations.js';
import { builtinModules } from 'node:module';
import type { ESLint, Rule } from 'eslint';
import type { extractMessages } from 'zlocale/build';
import { deniedSubpath } from './contracts.js';
import type { PackageExportContract } from './contracts.js';
import {
  literal,
  key,
  unwrap,
  variable,
  imported,
  type Node,
} from './rule-ast.js';
import { packageUsageRule } from './rules-package-usage.js';
import { accessibilityRules } from './rules-accessibility.js';
/** Normalized Node builtin names for direct client-boundary checks. */
const coreModules = new Set(
  builtinModules.map((name) => name.replace(/^node:/, ''))
);
/** Build rule metadata with fixed schema and actionable redacted diagnostics.
 * @param {string} description - Human-readable purpose of this rule.
 * @param {Record<string, string>} messages - Fixed message templates; private source values must not be interpolated.
 * @returns {Rule.RuleMetaData} ESLint metadata containing the fixed messages and an empty option schema.
 */
const metadata = (
  description: string,
  messages: Record<string, string>
): Rule.RuleMetaData => ({
  type: 'problem',
  docs: { description },
  schema: [],
  messages,
});
/** Read a statically named literal object property without executing source.
 * @param {Node} node - Borrowed parser node; inspected without mutation or execution.
 * @param {string} name - Static property or diagnostic name, never evaluated as code.
 * @returns {Node} Matching literal object-property value, or undefined when absent or unproven.
 */
const property = (node: Node, name: string) =>
  node?.type === 'ObjectExpression'
    ? node.properties.find(
        (item: Node) => item.type === 'Property' && key(item) === name
      )?.value
    : undefined;
/** Credential-like field-name policy; raw field values never enter rule messages. */
const sensitive =
  /(password|secret|token|credential|authorization|private|salt|key|dsn|connectionstring)/i;
/** Classify the documented direct server module families; this is not transitive bundle analysis.
 * @param {string} specifier - Literal module specifier inspected as data only.
 * @returns {boolean} Whether the literal module belongs to the documented direct server-only set.
 */
function serverImport(specifier: string): boolean {
  // Dedicated Fetch/playback entries exclude their Node storage roots.
  // Keep exceptions exact so unrecognized server subpaths remain conservative.
  if (
    specifier === '@zeruxjs/files/client' ||
    specifier === '@zeruxjs/media/browser' ||
    specifier === '@zeruxjs/media/playback'
  ) {
    return false;
  }
  return (
    specifier.startsWith('node:') ||
    coreModules.has(specifier) ||
    specifier === 'server-only' ||
    specifier === '@zeruxjs/font/build' ||
    specifier === '@zeruxjs/font/http' ||
    specifier === '@zeruxjs/performance/response' ||
    specifier === '@zeruxjs/react/server' ||
    specifier === '@zeruxjs/vue/server' ||
    specifier === 'zclivo' ||
    specifier === 'zclivo/generator' ||
    specifier === 'zenixjs/application' ||
    specifier === 'zenixjs/setup-store' ||
    /^(?:@zeruxjs\/reports(?:$|\/(?:sources|ga4|adsense)$))/.test(specifier) ||
    /^@zeruxjs\/search\/(?:http|persistence)$/.test(specifier) ||
    specifier === '@zeruxjs/search-elastic' ||
    specifier === '@zeruxjs/search-mille' ||
    specifier === '@zeruxjs/tags' ||
    /^@zeruxjs\/share\/(?:server|sqlite)$/.test(specifier) ||
    /^@zeruxjs\/seo\/(?:fetch|public|composition)$/.test(specifier) ||
    specifier === '@zeruxjs/media' ||
    specifier.startsWith('@zeruxjs/media/') ||
    specifier === '@zeruxjs/hooks' ||
    specifier.startsWith('@zeruxjs/hooks/') ||
    /(?:^|\/)\w[^/]*\.server(?:\.[cm]?[jt]sx?)?$/.test(specifier) ||
    /^(?:@zeruxjs\/(?:db(?:-[\w-]+)?|auth|files|email|queue(?:-[\w-]+)?)(?:\/|$)|@zenixjs\/core\/(?:cms|types)$|@zeruxjs\/feed(?:$|\/fetch$)|@zeruxjs\/cache(?:$|\/policy$)|@zeruxjs\/cache-memcache(?:$|\/protocol$)|@zeruxjs\/cache-redis$|@zeruxjs\/cache-valkey$|@zeruxjs\/asset-manager(?:$|\/(?:storage|brand)$)|@zeruxjs\/analytics(?:$|\/(?:http|email|durable)$)|@zeruxjs\/ai-model(?:$|\/(?:corpus|evidence)$)|@zeruxjs\/ai\/tools$|@zeruxjs\/validator\/http$|zlocale\/(?:node|build)$|zuixs\/node$|zhost(?:\/|$)|zeruxjs(?:$|\/(?:services|database|cache-runtime|actions|action-stores|modules|service-endpoints|graphql|build|static-export)(?:\/|$))|@zeruxjs\/security(?:$|\/(?:crypto|jwt|policy)$))/.test(
      specifier
    )
  );
}
/** Known disposer-producing public APIs; retaining a handle does not prove eventual disposal. */
const acquisitions: Record<string, readonly string[]> = {
  zclivo: [
    'createTerminalGeneratorPrompt',
    'loadPlugins',
    'loadConfiguredPlugins',
  ],
  'zenixjs/application': ['createZenixApplication'],
  '@zeruxjs/tags': ['createTagManager', 'createTagProviderRegistry'],
  '@zeruxjs/tags/admin-client': ['createTagAdminClient'],
  '@zeruxjs/tags/admin-view': ['mountTagAdmin'],
  '@zeruxjs/share/server': ['createShortLinkService'],
  '@zeruxjs/seo/public': ['createPublicCrawlerService'],
  '@zeruxjs/seo/composition': ['createMetadataHooks'],
  '@zeruxjs/security': [
    'createEncryptionKeyring',
    'createMessageAuthenticator',
    'createJwtSigner',
    'createJwtVerifier',
    'createJwtJwks',
    'createMemoryRateLimitStore',
    'createDistributedRateLimiter',
  ],
  '@zeruxjs/security/crypto': [
    'createEncryptionKeyring',
    'createMessageAuthenticator',
  ],
  '@zeruxjs/security/jwt': [
    'createJwtSigner',
    'createJwtVerifier',
    'createJwtJwks',
  ],
  '@zeruxjs/reports/sources': ['createReportSourceRegistry'],
  '@zeruxjs/reports/ga4': [
    'createGa4ReportSource',
    'createGoogleReportCredentials',
  ],
  '@zeruxjs/reports/adsense': [
    'createAdSenseReportSource',
    'createGoogleReportCredentials',
  ],
  '@zeruxjs/reports/view': ['mountReportChart'],
  '@zeruxjs/search/adapters': ['createSearchServices'],
  '@zeruxjs/search-elastic': ['createElasticSearchAdapter'],
  '@zeruxjs/search-mille': ['createMilleSearchAdapter'],
  '@zeruxjs/react': ['createReactStore'],
  '@zeruxjs/react/browser': ['mountReact', 'hydrateReact'],
  '@zeruxjs/vue': [
    'toVueReadable',
    'mapVueRef',
    'combineVueRefs',
    'observableToVueRef',
    'bindVueRef',
    'syncVueRef',
  ],
  '@zeruxjs/vue/browser': ['mountVue', 'hydrateVue'],
  '@zeruxjs/zyro': [
    'createObservable',
    'createAsyncObservable',
    'createZyroSubscriptionScope',
  ],
  '@zeruxjs/zyro/renderer': ['createZyroRendererBridge'],
  '@zeruxjs/react/hydration': [
    'createReactHydrationState',
    'readReactHydrationState',
  ],
  '@zeruxjs/queue': ['createQueueService', 'createQueueBackend'],
  '@zeruxjs/queue-bullmq': ['createQueueService'],
  '@zeruxjs/queue-rabbitmq': ['createRabbitMQ', 'createRabbitMQWorker'],
  '@zeruxjs/queue-rabbitmq/worker': ['createRabbitMQWorker'],
  '@zeruxjs/queue-memcacheq': ['createMemcacheQ', 'createMemcacheQWorker'],
  '@zeruxjs/queue-memcacheq/worker': ['createMemcacheQWorker'],
  '@zeruxjs/queue/neutral': ['createQueueBackend'],
  '@zeruxjs/queue/webhooks': [
    'createWebhookWorkflow',
    'createWebhookHttpsTransport',
  ],
  '@zeruxjs/performance': [
    'observePerformance',
    'observeWebVitals',
    'createVitalReporter',
    'installNavigationPrefetch',
  ],
  '@zeruxjs/performance/navigation': ['installNavigationPrefetch'],
  '@zeruxjs/performance/analytics': [
    'createBrowserPerformanceAnalytics',
    'createServerPerformanceAdapter',
  ],
  '@zeruxjs/performance/dist/timing.js': ['observePerformance'],
  '@zeruxjs/performance/dist/rum.js': ['createVitalReporter'],
  '@zeruxjs/performance/dist/navigation.js': ['installNavigationPrefetch'],
  '@zeruxjs/performance/dist/utils/webVitals.js': ['observeWebVitals'],
  '@zeruxjs/media/assets': ['createMediaAssetService'],
  '@zeruxjs/media/resumable': ['createMediaResumableHandler'],
  '@zeruxjs/media/transcode': ['createMediaTranscoder'],
  '@zeruxjs/media/browser': ['createMediaTransfers'],
  '@zeruxjs/media/playback': ['createMediaPlayback', 'createMediaControls'],
  '@zeruxjs/hooks': [
    'createRequestHookScope',
    'createServerStateScope',
    'createServerActions',
    'createAsyncServerActions',
    'createServerFilters',
    'createAsyncServerFilters',
    'createServerLifecycleHooks',
  ],
  '@zeruxjs/hooks/context': ['createRequestHookScope'],
  '@zeruxjs/hooks/state': ['createServerStateScope'],
  '@zeruxjs/hooks/actions': [
    'createServerActions',
    'createAsyncServerActions',
    'createServerFilters',
    'createAsyncServerFilters',
  ],
  '@zeruxjs/hooks/lifecycle': ['createServerLifecycleHooks'],
  '@zeruxjs/font': ['createFontLoadScope', 'injectFontStyles'],
  '@zeruxjs/font/browser': ['createFontLoadScope', 'injectFontStyles'],
  '@zeruxjs/files': [
    'createFileManager',
    'createS3Storage',
    'createResumableUploads',
  ],
  '@zeruxjs/feed/fetch': ['createFeedFetchHandler'],
  '@zeruxjs/email': [
    'createEmailManager',
    'createEmailReceiver',
    'createEmailQueue',
    'resolveAttachmentScope',
  ],
  '@zeruxjs/db-sqlite': ['createConnector', 'openSqlite'],
  '@zeruxjs/db-pg': ['createConnector'],
  '@zeruxjs/db-mysql': ['createConnector'],
  '@zeruxjs/db-mongo': ['createConnector'],
  '@zeruxjs/db': ['createDatabaseManager', 'configureDatabaseManager'],
  '@zeruxjs/cache-valkey': ['createCacheHelper', 'createValkeyCacheHelper'],
  '@zeruxjs/cache-redis': [
    'createCacheHelper',
    'createRedisCacheHelper',
    'createIORedisCacheHelper',
    'createRedisRateLimitStore',
    'createBullMQRedisClusterConnections',
  ],
  '@zeruxjs/cache-memcache': ['createMemcacheHelper', 'createCacheHelper'],
  '@zeruxjs/cache': [
    'createCacheManager',
    'createCacheManagerWithHelper',
    'createMemoryCacheHelper',
    'configureCacheManager',
  ],
  '@zeruxjs/auth': [
    'createSharedAuth',
    'createPasskeyManager',
    'createProviderLogin',
  ],
  '@zeruxjs/asset-manager/storage': ['createAssetStorage'],
  '@zeruxjs/asset-manager/brand': ['createBrandCatalog'],
  '@zeruxjs/analytics': ['createAnalyticsAnalysis'],
  '@zeruxjs/analytics/durable': ['createDurableAnalytics'],
  '@zeruxjs/ai': ['createAiProviderRegistry'],
  '@zeruxjs/ai-model/corpus': ['createCorpusReader'],
  '@zeruxjs/ai-model/evidence': ['createEvidenceRetriever'],
  '@zeruxjs/ai/structured': ['createStructuredClient'],
  '@zeruxjs/ai/tools': ['createToolExecutor'],
  '@zeruxjs/accessibility': [
    'createFocusTrap',
    'createAccessibleDialog',
    'createLiveAnnouncer',
    'createRovingTabIndex',
    'applyComponentProps',
    'applyLabelledComponentProps',
    'createPreferenceState',
    'bindPreferenceStyles',
    'createPreferencePanel',
    'createSpeechController',
    'observeReducedMotion',
    'onEscape',
  ],
  zlook: ['startWatcher', 'watchDirectory'],
  zlocale: ['createCatalogLoader', 'createLocaleController'],
  'zlocale/browser': ['createCatalogLoader', 'createLocaleController'],
  'zlocale/node': ['createRequestI18n'],
  'zlocale/zyro': ['createZyroI18n'],
  zuixs: ['injectZuix', 'zuixVite'],
  'zuixs/vite': ['zuixVite'],
  'zuixs/node': ['watchZuix'],
  '@zeruxjs/validator': ['createHttpInputAdapter', 'validatedJsonHandler'],
  '@zeruxjs/validator/http': ['createHttpInputAdapter', 'validatedJsonHandler'],
  '@zeruxjs/validator/browser': ['createFormFeedback'],
};

/** Create isolated rule closures with optional localization extraction and explicit export contracts.
 * @param {readonly PackageExportContract[]} contracts - Explicit installed export-map snapshots, owned by the configured host.
 * @param {typeof extractMessages} extract - Optional actual localization extractor; absence leaves localization checks unregistered.
 * @param {readonly Readonly<DeprecatedApi>[]} deprecations - Validated host-owned deprecation snapshot; defaults to verified builtins.
 * @returns {ESLint.Plugin} Fresh rule definitions with invocation-owned state; no network, watchers or global registration.
 */
export function createZeruxPlugin(
  contracts: readonly PackageExportContract[],
  extract?: typeof extractMessages,
  deprecations: readonly Readonly<DeprecatedApi>[] = createDeprecationRegistry()
): ESLint.Plugin {
  /** Fresh plugin rule table; optional localization is added only with an actual extractor. */
  const rules: Record<string, Rule.RuleModule> = {
    ...accessibilityRules,
    'package-usage': packageUsageRule,
    'deprecated-api': createDeprecationRule(deprecations),
    'client-server-import': {
      meta: metadata(
        'Reject direct server imports in explicit client modules',
        {
          denied:
            'This explicit client module imports a server-only module. Move the work behind a server handler or select a documented browser entry.',
        }
      ),
      create(context) {
        let client = false;
        /** Check a statically proven module source or discovered file before reporting diagnostics.
         * @param {Node} node - Borrowed parser node; inspected without mutation or execution.
         * @param {Node} source - Synthetic text or parser expression inspected without execution.
         * @param {boolean} typeOnly - Whether the import is erased by TypeScript and should not count as runtime use.
         * @returns {void} Reports a proven import violation through the borrowed rule context.
         */
        const check = (node: Node, source: Node, typeOnly = false) => {
          /** Inert literal module source; computed imports are outside this proof. */
          const text = literal(source);
          if (client && !typeOnly && text && serverImport(text)) {
            context.report({ node, messageId: 'denied' });
          }
        };
        return {
          Program(node: Node) {
            client = /\.client\.[cm]?[jt]sx?$/.test(context.filename);
            // statement must remain in the initial directive prologue to classify use client.
            for (const statement of node.body) {
              if (
                statement.type !== 'ExpressionStatement' ||
                typeof statement.directive !== 'string'
              ) {
                break;
              }
              if (statement.directive === 'use client') {
                client = true;
              }
            }
          },
          ImportDeclaration(node: Node) {
            check(
              node,
              node.source,
              node.importKind === 'type' ||
                (node.specifiers.length > 0 &&
                  node.specifiers.every(
                    (item: Node) => item.importKind === 'type'
                  ))
            );
          },
          ExportNamedDeclaration(node: Node) {
            if (node.source) {
              check(
                node,
                node.source,
                node.exportKind === 'type' ||
                  (node.specifiers.length > 0 &&
                    node.specifiers.every(
                      (item: Node) => item.exportKind === 'type'
                    ))
              );
            }
          },
          ExportAllDeclaration(node: Node) {
            check(node, node.source, node.exportKind === 'type');
          },
          ImportExpression(node: Node) {
            check(node, node.source);
          },
          TSImportEqualsDeclaration(node: Node) {
            if (node.moduleReference?.type === 'TSExternalModuleReference') {
              check(
                node,
                node.moduleReference.expression,
                node.importKind === 'type'
              );
            }
          },
          CallExpression(node: Node) {
            if (
              node.callee.type === 'Identifier' &&
              node.callee.name === 'require' &&
              !variable(context, node.callee)?.defs.length
            ) {
              check(node, node.arguments[0]);
            }
          },
        };
      },
    },
    'cleanup-ownership': {
      meta: metadata(
        'Reject immediately discarded owned resource/disposal handles',
        {
          dropped:
            'Retain or return this resource/disposal handle and close/dispose it at its owner lifecycle. Passing it to an explicit owner is also supported.',
        }
      ),
      create(context) {
        return {
          ExpressionStatement(node: Node) {
            let call = unwrap(node.expression);
            if (call?.type === 'UnaryExpression' && call.operator === 'void') {
              call = unwrap(call.argument);
            }
            if (call?.type !== 'CallExpression') {
              return;
            }
            /** Lexically proven public import used to distinguish package calls from local names. */
            const binding = imported(context, call.callee);
            /** Whether this imported call is a known resource acquisition. */
            const factory =
              binding && acquisitions[binding.source]?.includes(binding.name);
            /** Whether an unshadowed global interval handle was immediately discarded. */
            const timer =
              call.callee.type === 'Identifier' &&
              call.callee.name === 'setInterval' &&
              !variable(context, call.callee)?.defs.length;
            if (factory || timer) {
              context.report({ node: call, messageId: 'dropped' });
            }
          },
        };
      },
    },
    'public-service-config': {
      meta: metadata(
        'Reject statically visible non-public configuration data',
        {
          private:
            'Credential-like fields do not belong in public settings/publicFields. Keep them in privateOptions and expose an explicit safe projection.',
          executable:
            'Public settings must contain serializable data, not functions, accessors or class instances.',
          limit:
            'Public settings exceed the framework public configuration depth budget.',
        }
      ),
      create(context) {
        /** Inspect proven public data recursively; executable or sensitive fields are rejected.
         * @param {Node} node - Borrowed parser node; inspected without mutation or execution.
         * @param {number} depth - Current bounded traversal depth, incremented only through known AST ownership.
         * @returns {void} Reports proven public-data violations through the context; does not mutate source.
         */
        const inspect = (node: Node, depth = 0) => {
          node = unwrap(node);
          if (!node) {
            return;
          }
          if (depth > 12) {
            context.report({ node, messageId: 'limit' });
            return;
          }
          if (
            [
              'ArrowFunctionExpression',
              'FunctionExpression',
              'NewExpression',
            ].includes(node.type) ||
            (node.type === 'Literal' &&
              (typeof node.value === 'bigint' || node.regex)) ||
            (node.type === 'Identifier' &&
              ['undefined', 'NaN', 'Infinity'].includes(node.name) &&
              !variable(context, node)?.defs.length)
          ) {
            context.report({ node, messageId: 'executable' });
            return;
          }
          if (node.type === 'ArrayExpression') {
            // item is a parser-owned public-data child; inspect it without executing expressions.
            for (const item of node.elements) {
              inspect(item, depth + 1);
            }
          }
          if (node.type === 'ObjectExpression') {
            // item is a parser-owned public-data child; inspect it without executing expressions.
            for (const item of node.properties) {
              if (item.type !== 'Property') {
                continue;
              }
              /** Static property or module name used for the current narrow policy decision. */
              const name = key(item);
              if (name && sensitive.test(name)) {
                context.report({ node: item, messageId: 'private' });
              }
              if (item.method || item.kind === 'get' || item.kind === 'set') {
                context.report({ node: item, messageId: 'executable' });
              } else {
                inspect(item.value, depth + 1);
              }
            }
          }
        };
        /** Inspect only proven framework publicSettings rather than similarly named unrelated objects.
         * @param {Node} node - Borrowed parser node; inspected without mutation or execution.
         * @returns {void} Reports proven public configuration violations without mutating source.
         */
        const config = (node: Node) => {
          /** Literal public configuration or localization value, never executed by the rule. */
          const value = property(node, 'publicSettings');
          if (value) {
            inspect(value);
          }
        };
        return {
          CallExpression(node: Node) {
            /** Lexically proven public import used to distinguish package calls from local names. */
            const binding = imported(context, node.callee);
            if (
              !binding ||
              !['zeruxjs', 'zeruxjs/services'].includes(binding.source)
            ) {
              return;
            }
            if (binding.name === 'createApplicationLifecycle') {
              config(property(node.arguments[0], 'config'));
            }
            if (binding.name === 'createServiceScope') {
              inspect(node.arguments[0]);
            }
            if (binding.name === 'defineService') {
              /** Literal publicFields array inspected for credential-like names. */
              const fields = property(node.arguments[0], 'publicFields');
              if (fields?.type === 'ArrayExpression') {
                // field is a literal publicFields declaration; report names without echoing private values.
                for (const field of fields.elements) {
                  /** Literal public configuration or localization value, never executed by the rule. */
                  const value = literal(field);
                  if (value && sensitive.test(value)) {
                    context.report({ node: field, messageId: 'private' });
                  }
                }
              }
            }
          },
          ExportDefaultDeclaration(node: Node) {
            if (
              /(?:^|[/\\])zerux\.config\.[cm]?[jt]s$/.test(context.filename)
            ) {
              config(node.declaration);
            }
          },
        };
      },
    },
    'package-exports': {
      meta: metadata(
        'Reject imports absent or explicitly denied in selected installed export maps',
        {
          unsupported:
            'This subpath is not public in the selected installed package export map. Use a documented public entry; source-only paths are not a consumer contract.',
        }
      ),
      create(context) {
        /** Check a statically proven module source or discovered file before reporting diagnostics.
         * @param {Node} node - Borrowed parser node; inspected without mutation or execution.
         * @param {Node} source - Synthetic text or parser expression inspected without execution.
         * @returns {void} Reports a proven import violation through the borrowed rule context.
         */
        const check = (node: Node, source: Node) => {
          /** Static property or module name used for the current narrow policy decision. */
          const name = literal(source);
          if (name && deniedSubpath(name, contracts)) {
            context.report({ node, messageId: 'unsupported' });
          }
        };
        return {
          TSImportEqualsDeclaration(node: Node) {
            if (node.moduleReference?.type === 'TSExternalModuleReference') {
              check(node, node.moduleReference.expression);
            }
          },
          TSImportType(node: Node) {
            check(
              node,
              node.argument?.type === 'TSLiteralType'
                ? node.argument.literal
                : node.argument
            );
          },
          ImportDeclaration(node: Node) {
            check(node, node.source);
          },
          ExportNamedDeclaration(node: Node) {
            if (node.source) {
              check(node, node.source);
            }
          },
          ExportAllDeclaration(node: Node) {
            check(node, node.source);
          },
          ImportExpression(node: Node) {
            check(node, node.source);
          },
          CallExpression(node: Node) {
            if (
              node.callee.type === 'Identifier' &&
              node.callee.name === 'require' &&
              !variable(context, node.callee)?.defs.length
            ) {
              check(node, node.arguments[0]);
            }
          },
        };
      },
    },
  };
  if (extract) {
    rules['locale-text-domain'] = {
      meta: metadata(
        'Require extractable zlocale messages and an explicit literal text domain',
        {
          domain:
            'Declare a non-empty literal text domain on this call or on its createI18n owner.',
          message:
            'This zlocale call cannot be safely extracted. Use supported literal singular/context/plural/domain arguments; do not build keys dynamically.',
          limit:
            'Localization extraction exceeded its source budget; split this call/source before extraction.',
        }
      ),
      create(context) {
        /** Resolve a translator owner through bounded lexical aliases and supported factory calls.
         * @param {Node} node - Borrowed parser node; inspected without mutation or execution.
         * @param {number} depth - Current bounded traversal depth, incremented only through known AST ownership.
         * @returns {{ domain?: string } | undefined} Bound translator domain metadata, or undefined when ownership cannot be statically proven.
         */
        const owner = (
          node: Node,
          depth = 0
        ): { domain?: string } | undefined => {
          if (depth > 8) {
            return;
          }
          node = unwrap(node);
          if (node?.type === 'Identifier') {
            /** Nearest lexical definition; unproven or shadowed bindings are not treated as framework calls. */
            const definition = variable(context, node)?.defs[0];
            if (definition?.type === 'Variable') {
              return owner(definition.node.init, depth + 1);
            }
          }
          if (node?.type === 'CallExpression') {
            /** Lexically proven public import used to distinguish package calls from local names. */
            const binding = imported(context, node.callee);
            if (
              binding &&
              ['zlocale', 'zlocale/browser'].includes(binding.source) &&
              binding.name === 'createI18n'
            ) {
              /** Literal translator text domain read from its owned options, if extractable. */
              const domain = literal(property(node.arguments[0], 'domain'));
              return domain ? { domain } : {};
            }
            if (
              node.callee.type === 'MemberExpression' &&
              !node.callee.computed &&
              node.callee.property.name === 'forLocale'
            ) {
              return owner(node.callee.object, depth + 1);
            }
          }
        };
        return {
          CallExpression(node: Node) {
            /** Borrowed call target used to identify supported translator methods. */
            const callee = node.callee;
            let method: string | undefined,
              domain: string | undefined,
              receivers: string[] = [];
            if (
              callee.type === 'MemberExpression' &&
              !callee.computed &&
              callee.object.type === 'Identifier'
            ) {
              /** Proven translator owner with any statically declared default domain. */
              const bound = owner(callee.object);
              if (!bound) {
                return;
              }
              method = callee.property.name;
              domain = bound.domain;
              receivers = [callee.object.name];
            } else if (callee.type === 'Identifier') {
              /** Nearest lexical definition; unproven or shadowed bindings are not treated as framework calls. */
              const definition = variable(context, callee)?.defs[0];
              if (
                definition?.type !== 'Variable' ||
                definition.node.id.type !== 'ObjectPattern'
              ) {
                return;
              }
              /** Lexically proven public import used to distinguish package calls from local names. */
              const binding = definition.node.id.properties.find(
                (item: Node) =>
                  item.type === 'Property' &&
                  item.value.type === 'Identifier' &&
                  item.value.name === callee.name
              );
              /** Proven translator owner with any statically declared default domain. */
              const bound = owner(definition.node.init);
              if (!binding || !bound) {
                return;
              }
              method = key(binding);
              domain = bound.domain;
            }
            if (!method || !['__', '_x', '_n', '_nx'].includes(method)) {
              return;
            }
            /** Supported translator method arities mapped to explicit domain argument positions. */
            const domainIndexes = { __: 1, _x: 2, _n: 3, _nx: 4 };
            /** Domain argument position for the selected supported translation method. */
            const index = domainIndexes[method as keyof typeof domainIndexes];
            /** Explicit domain argument; when supplied it replaces the owner default. */
            const supplied = node.arguments[index];
            if (supplied) {
              domain = literal(supplied);
            }
            if (!domain?.trim()) {
              context.report({ node, messageId: 'domain' });
            }
            try {
              /** Aliased translation functions passed to the real extractor as inert syntax metadata. */
              const functions =
                callee.type === 'Identifier'
                  ? { [callee.name]: method as '__' | '_x' | '_n' | '_nx' }
                  : {};
              /** Actual extractor outcome; diagnostics report non-extractable source without rewriting it. */
              const result = extract(context.sourceCode.getText(node), {
                fileName: 'lint.tsx',
                receivers,
                functions,
                ...(domain ? { defaultDomain: domain } : {}),
              });
              if (result.diagnostics.length) {
                context.report({ node, messageId: 'message' });
              }
            } catch (error) {
              context.report({
                node,
                messageId: error instanceof RangeError ? 'limit' : 'message',
              });
            }
          },
        };
      },
    };
  }
  return { meta: { name: '@zeruxjs/lint' }, rules };
}
