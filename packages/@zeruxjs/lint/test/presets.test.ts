import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ESLint, Linter } from 'eslint';
import {
  createPackageConfig,
  createApplicationConfig,
} from '@zeruxjs/lint/presets';
import packagePreset from '@zeruxjs/lint/presets/package';
import strictPreset from '@zeruxjs/lint/presets/application';
/** Explicit strict browser preset; optional extraction dependencies must be installed. */
const strict = await createApplicationConfig({ environment: 'browser' });
/** Explicit light browser preset retaining the shared security/ownership rules. */
const light = createPackageConfig({ environment: 'browser' });
/** Filter static diagnostics to the package-owned rules for precise fixture assertions.
 * @param {string} text - Synthetic source text supplied to the isolated static checker.
 * @param {object[]} config - Explicit fixture configuration; no repository discovery is requested.
 * @param {string} filename - Trusted local file path or diagnostic label, relative to the selected project root.
 * @returns {object[]} Static diagnostics belonging to the ZeruxJS rules, preserving native message records.
 */
const verify = (text, config = strict, filename = 'fixture.ts') =>
  new Linter()
    .verify(text, config, { filename })
    .filter((item) => item.ruleId?.startsWith('zerux/'));
/** Project fixture diagnostics to rule IDs without running the source modules.
 * @param {string} text - Synthetic source text supplied to the isolated static checker.
 * @param {object[]} config - Explicit fixture configuration; no repository discovery is requested.
 * @param {string} filename - Trusted local file path or diagnostic label, relative to the selected project root.
 * @returns {string[]} Rule IDs projected from the isolated static diagnostic records.
 */
const rules = (text, config = strict, filename) =>
  verify(text, config, filename).map((item) => item.ruleId);
/** Allocate an owned temporary fixture root; callers remove it in finally.
 * @returns {string} New owned temporary fixture directory; the enclosing test must remove it in finally.
 */
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'zerux-lint-preset-'));

test('Queue ownership covers native/neutral services and webhook coordinators without owning borrowed publishers', () => {
  // These source-verified factories return close owners; selection and publisher adapters are inert.
  for (const [entry, name] of [
    ['@zeruxjs/queue', 'createQueueService'],
    ['@zeruxjs/queue-bullmq', 'createQueueService'],
    ['@zeruxjs/queue-rabbitmq', 'createRabbitMQ'],
    ['@zeruxjs/queue-rabbitmq', 'createRabbitMQWorker'],
    ['@zeruxjs/queue-rabbitmq/worker', 'createRabbitMQWorker'],
    ['@zeruxjs/queue-memcacheq', 'createMemcacheQ'],
    ['@zeruxjs/queue-memcacheq', 'createMemcacheQWorker'],
    ['@zeruxjs/queue-memcacheq/worker', 'createMemcacheQWorker'],
    ['@zeruxjs/queue', 'createQueueBackend'],
    ['@zeruxjs/queue/neutral', 'createQueueBackend'],
    ['@zeruxjs/queue/webhooks', 'createWebhookWorkflow'],
    ['@zeruxjs/queue/webhooks', 'createWebhookHttpsTransport'],
  ]) {
    assert.ok(
      rules(`import {${name}} from '${entry}'; ${name}(options);`).includes(
        'zerux/cleanup-ownership'
      )
    );
    assert.ok(
      !rules(
        `import {${name}} from '${entry}'; const owner = ${name}(options);`
      ).includes('zerux/cleanup-ownership')
    );
  }
  assert.ok(
    !rules(
      "import {selectQueueBackend} from '@zeruxjs/queue/neutral'; selectQueueBackend(factory, options);"
    ).includes('zerux/cleanup-ownership')
  );
  assert.ok(
    !rules(
      "import {createAcknowledgedWebhookPublisher,createBullMQWebhookPublisher,createWebhookProcessor} from '@zeruxjs/queue/webhooks'; createAcknowledgedWebhookPublisher(queue,name); createBullMQWebhookPublisher(service,name); createWebhookProcessor(workflow,principal);"
    ).includes('zerux/cleanup-ownership')
  );
});

test('Performance owners distinguish browser observation from borrowed Node response forwarding', () => {
  // The response contract imports Node types and delegates native stream ownership explicitly.
  assert.ok(
    rules("'use client'; import '@zeruxjs/performance/response';").includes(
      'zerux/client-server-import'
    )
  );
  for (const entry of ['navigation', 'analytics']) {
    assert.ok(
      !rules(`'use client'; import '@zeruxjs/performance/${entry}';`).includes(
        'zerux/client-server-import'
      )
    );
  }
  // Collectors and header builders are inert; observers/reporters/adapters own disposal.
  for (const [entry, name] of [
    ['@zeruxjs/performance', 'observePerformance'],
    ['@zeruxjs/performance', 'observeWebVitals'],
    ['@zeruxjs/performance', 'createVitalReporter'],
    ['@zeruxjs/performance/navigation', 'installNavigationPrefetch'],
    ['@zeruxjs/performance/analytics', 'createBrowserPerformanceAnalytics'],
    ['@zeruxjs/performance/analytics', 'createServerPerformanceAdapter'],
    ['@zeruxjs/performance/dist/rum.js', 'createVitalReporter'],
  ]) {
    assert.ok(
      rules(`import {${name}} from '${entry}'; ${name}(options);`).includes(
        'zerux/cleanup-ownership'
      )
    );
    assert.ok(
      !rules(
        `import {${name}} from '${entry}'; const owner = ${name}(options);`
      ).includes('zerux/cleanup-ownership')
    );
  }
  assert.ok(
    !rules(
      "import {createVitalCollector,createCacheHeaders} from '@zeruxjs/performance'; createVitalCollector(); createCacheHeaders();"
    ).includes('zerux/cleanup-ownership')
  );
});

test('Media browser entries and actual disposal owners remain distinct from inert storage facades', () => {
  // Both presets enforce Node boundaries without rejecting dedicated browser entries or erased types.
  for (const config of [light, strict]) {
    for (const entry of ['browser', 'playback']) {
      assert.ok(
        !rules(
          `'use client'; import '@zeruxjs/media/${entry}';`,
          config
        ).includes('zerux/client-server-import')
      );
    }
    for (const entry of [
      '',
      '/assets',
      '/resumable',
      '/transcode',
      '/unknown',
    ]) {
      assert.ok(
        rules(
          `'use client'; import '@zeruxjs/media${entry}';`,
          config
        ).includes('zerux/client-server-import')
      );
    }
    assert.ok(
      !rules(
        "'use client'; import type {StoredMedia} from '@zeruxjs/media';",
        config
      ).includes('zerux/client-server-import')
    );
  }
  // Only factories returning close/destroy owners require a retained handle.
  for (const [entry, name] of [
    ['assets', 'createMediaAssetService'],
    ['resumable', 'createMediaResumableHandler'],
    ['transcode', 'createMediaTranscoder'],
    ['browser', 'createMediaTransfers'],
    ['playback', 'createMediaPlayback'],
    ['playback', 'createMediaControls'],
  ]) {
    assert.ok(
      rules(
        `import {${name}} from '@zeruxjs/media/${entry}'; ${name}(options);`
      ).includes('zerux/cleanup-ownership')
    );
    assert.ok(
      !rules(
        `import {${name}} from '@zeruxjs/media/${entry}'; const owner = ${name}(options);`
      ).includes('zerux/cleanup-ownership')
    );
  }
  assert.ok(
    !rules(
      "import {createMediaStore, createMediaFilesService} from '@zeruxjs/media'; createMediaStore(options); createMediaFilesService(options);"
    ).includes('zerux/cleanup-ownership')
  );
});

test('server hook imports and actual request/registry disposal owners remain explicit', () => {
  // Every published Hooks entry uses Node async-local state or filesystem ownership.
  for (const entry of [
    '',
    '/state',
    '/context',
    '/paths',
    '/actions',
    '/lifecycle',
  ]) {
    assert.ok(
      rules(`'use client'; import '@zeruxjs/hooks${entry}';`).includes(
        'zerux/client-server-import'
      )
    );
    assert.ok(
      !rules(
        `'use client'; import type {Contract} from '@zeruxjs/hooks${entry}';`
      ).includes('zerux/client-server-import')
    );
  }
  // Check exact public factory imports; method/constructor disposal remains runtime ownership.
  for (const [entry, name] of [
    ['@zeruxjs/hooks', 'createRequestHookScope'],
    ['@zeruxjs/hooks/context', 'createRequestHookScope'],
    ['@zeruxjs/hooks/state', 'createServerStateScope'],
    ['@zeruxjs/hooks/actions', 'createServerActions'],
    ['@zeruxjs/hooks/actions', 'createAsyncServerActions'],
    ['@zeruxjs/hooks/actions', 'createServerFilters'],
    ['@zeruxjs/hooks/actions', 'createAsyncServerFilters'],
    ['@zeruxjs/hooks/lifecycle', 'createServerLifecycleHooks'],
  ]) {
    assert.ok(
      rules(`import {${name}} from '${entry}'; ${name}(options);`).includes(
        'zerux/cleanup-ownership'
      )
    );
    assert.ok(
      !rules(
        `import {${name}} from '${entry}'; const owner = ${name}(options);`
      ).includes('zerux/cleanup-ownership')
    );
  }
  assert.ok(
    !rules(
      "import {createContext, createPathRegistry} from '@zeruxjs/hooks'; createContext(); createPathRegistry();"
    ).includes('zerux/cleanup-ownership')
  );
});

test('font boundaries distinguish browser load owners from inert registry/build configuration', () => {
  // The exact build/HTTP entries import Node; root/browser CSS helpers do not.
  for (const entry of ['build', 'http']) {
    assert.ok(
      rules(`'use client'; import '@zeruxjs/font/${entry}';`).includes(
        'zerux/client-server-import'
      )
    );
    assert.ok(
      !rules(
        `'use client'; import type {Options} from '@zeruxjs/font/${entry}';`
      ).includes('zerux/client-server-import')
    );
  }
  // These actual DOM owners return disposal handles; a static retained binding is only a hint.
  for (const entry of ['@zeruxjs/font', '@zeruxjs/font/browser']) {
    assert.ok(
      !rules(`'use client'; import '${entry}';`).includes(
        'zerux/client-server-import'
      )
    );
    for (const name of ['createFontLoadScope', 'injectFontStyles']) {
      assert.ok(
        rules(`import {${name}} from '${entry}'; ${name}(options);`).includes(
          'zerux/cleanup-ownership'
        )
      );
      assert.ok(
        !rules(
          `import {${name}} from '${entry}'; const owner = ${name}(options);`
        ).includes('zerux/cleanup-ownership')
      );
    }
  }
  assert.ok(
    !rules(
      "import {createFontRegistry} from '@zeruxjs/font/registry'; createFontRegistry();"
    ).includes('zerux/cleanup-ownership')
  );
  assert.ok(
    !rules(
      "import {createFontToolsTool} from '@zeruxjs/font/build'; createFontToolsTool(options);"
    ).includes('zerux/cleanup-ownership')
  );
});

test('Files browser entry stays separate from server storage exports', () => {
  // Both presets retain server boundaries while allowing the dedicated Fetch client.
  for (const config of [light, strict]) {
    assert.ok(
      !rules(
        "'use client'; import {createFilesClient} from '@zeruxjs/files/client'; createFilesClient({baseUrl:'https://example.test/files/'});",
        config
      ).includes('zerux/client-server-import')
    );
    assert.ok(
      rules(
        "'use client'; import {createFileManager} from '@zeruxjs/files';",
        config
      ).includes('zerux/client-server-import')
    );
    assert.ok(
      rules("'use client'; import '@zeruxjs/files/unknown';", config).includes(
        'zerux/client-server-import'
      )
    );
    assert.ok(
      !rules(
        "'use client'; import type {FileAddress} from '@zeruxjs/files';",
        config
      ).includes('zerux/client-server-import')
    );
  }
});

test('Files cleanup rules follow actual manager, S3 and resumable owners', () => {
  // These factories expose close handles; the rule only proves direct discarded ownership.
  for (const name of [
    'createFileManager',
    'createS3Storage',
    'createResumableUploads',
  ]) {
    assert.ok(
      rules(
        `import {${name}} from '@zeruxjs/files'; ${name}(options);`
      ).includes('zerux/cleanup-ownership')
    );
    assert.ok(
      !rules(
        `import {${name}} from '@zeruxjs/files'; const owner = ${name}(options);`
      ).includes('zerux/cleanup-ownership')
    );
  }
  // Local drivers retain no persistent handle; HTTP/auth/client factories borrow their owners.
  for (const name of [
    'createLocalStorage',
    'createS3LiteStorage',
    'createFileHttpHandler',
    'createFileTokenAuthorizer',
    'createFilesClient',
  ]) {
    assert.ok(
      !rules(
        `import {${name}} from '@zeruxjs/files'; ${name}(options);`
      ).includes('zerux/cleanup-ownership')
    );
  }
});

test('explicit flat entries share error-level security policy; importing presets performs no lint', () => {
  assert.ok(Array.isArray(packagePreset));
  assert.ok(Array.isArray(strictPreset));
  // config selects light or strict policy while preserving the same security error assertions.
  for (const config of [light, strict]) {
    /** Static fixture diagnostics inspected for the named rule and redacted error text. */
    const messages = rules(
      `'use client';import 'node:fs';import{defineService}from'zeruxjs';defineService({publicFields:['clientSecret']});`,
      config
    );
    assert.ok(messages.includes('zerux/client-server-import'));
    assert.ok(messages.includes('zerux/public-service-config'));
    assert.ok(
      verify(`'use client';import 'node:fs';`, config).every(
        (item) => item.severity === 2
      )
    );
  }
  assert.throws(
    () => createPackageConfig({ environment: 'anything' }),
    /preset options/
  );
});

test('client boundaries honor actual leading directives, type-only imports and shadowed require', () => {
  // source is synthetic syntax for a positive/negative static-analysis case; never execute it.
  for (const source of [
    `'use strict';'use client';import fs from 'fs';`,
    `'use client';export * from 'zlocale/node';`,
    `'use client';import('@zeruxjs/validator/http');`,
    `'use client';import fs = require('node:fs');`,
  ]) {
    assert.ok(rules(source).includes('zerux/client-server-import'));
  }
  assert.ok(
    rules(`import 'node:crypto';`, strict, 'component.client.ts').includes(
      'zerux/client-server-import'
    )
  );
  // source is synthetic syntax for a positive/negative static-analysis case; never execute it.
  for (const source of [
    `import 'node:fs';`,
    `const x=1;'use client';import 'node:fs';`,
    `'use client';import type {Stats} from 'node:fs';`,
    `'use client';import {type Stats} from 'node:fs';`,
    `'use client';import {escapeHtmlText} from '@zeruxjs/security/encoding';`,
    `'use client';function require(x){return x};require('node:fs');`,
  ]) {
    assert.ok(!rules(source).includes('zerux/client-server-import'), source);
  }
});

test('cleanup rule reports only discarded known handles, with scoped imports and native alternatives', () => {
  // source is synthetic syntax for a positive/negative static-analysis case; never execute it.
  for (const source of [
    `import{watchDirectory as watch}from'zlook';watch('.');`,
    `import*as look from'zlook';look.watchDirectory('.');`,
    `import{watchZuix}from'zuixs/node';void watchZuix('.');`,
    `import{zuixVite}from'zuixs/vite';zuixVite();`,
    `import{injectZuix}from'zuixs';void injectZuix(['block']);`,
    `setInterval(()=>{},1000);`,
  ]) {
    assert.ok(rules(source).includes('zerux/cleanup-ownership'), source);
  }
  // source is synthetic syntax for a positive/negative static-analysis case; never execute it.
  for (const source of [
    `import{watchDirectory}from'zlook';const handle=watchDirectory('.');handle.close();`,
    `import{watchDirectory}from'zlook';function create(){return watchDirectory('.')}`,
    `import{watchDirectory}from'zlook';own(watchDirectory('.'));`,
    `import{zuixVite}from'zuixs';own(zuixVite());`,
    `import{zuixVite}from'zuixs/vite';const plugin=zuixVite();plugin.closeBundle();`,
    `import{createZuix}from'zuixs';createZuix();`,
    `import{watchDirectory}from'zlook';function f(watchDirectory){watchDirectory('.')}`,
    `const id=setInterval(()=>{},1000);clearInterval(id);`,
    `function createI18n(){};createI18n();`,
  ]) {
    assert.ok(!rules(source).includes('zerux/cleanup-ownership'), source);
  }
});

test('public config rule inspects only proven framework roles, not private options or arbitrary object names', () => {
  // source is synthetic syntax for a positive/negative static-analysis case; never execute it.
  for (const source of [
    `import{createApplicationLifecycle as create}from'zeruxjs';create({config:{publicSettings:{password:'PRIVATE_SENTINEL'}}});`,
    `import{createServiceScope}from'zeruxjs/services';createServiceScope({safe(){}});`,
    `import{defineService}from'zeruxjs';defineService({publicFields:['apiKey']});`,
    `import{createApplicationLifecycle}from'zeruxjs';createApplicationLifecycle({config:{publicSettings:{data:new Map()}}});`,
  ]) {
    /** Static fixture diagnostics inspected for the named rule and redacted error text. */
    const messages = verify(source);
    assert.ok(
      messages.some((item) => item.ruleId === 'zerux/public-service-config')
    );
    assert.ok(
      messages.every((item) => !item.message.includes('PRIVATE_SENTINEL'))
    );
  }
  /** Synthetic valid framework configuration used to check narrow rule boundaries. */
  const good = `import{createApplicationLifecycle,defineService}from'zeruxjs';createApplicationLifecycle({config:{services:{x:{privateOptions:{password:'private'}}},publicSettings:{title:'Shop',enabled:true}}});defineService({publicFields:['title']});const unrelated={publicSettings:{password:'not framework config'}};`;
  assert.ok(!rules(good).includes('zerux/public-service-config'));
  assert.ok(
    rules(
      `export default{publicSettings:{credentials:{}}}`,
      strict,
      'zerux.config.mjs'
    ).includes('zerux/public-service-config')
  );
});

test('localization consumes actual extraction with owner domains, aliases, context/plural checks and no arbitrary JS rewriting', () => {
  // source is synthetic syntax for a positive/negative static-analysis case; never execute it.
  for (const source of [
    `import{createI18n}from'zlocale';const t=createI18n();t.__('Hello');`,
    `import{createI18n as make}from'zlocale/browser';const t=make();t._nx('%d item','%s items',n,'cart','shop');`,
    `import{createI18n}from'zlocale';const t=createI18n({domain:'shop'});t.__(dynamic);`,
    `import{createI18n}from'zlocale';const {__:translate}=createI18n();translate('Hello');`,
  ]) {
    assert.ok(rules(source).includes('zerux/locale-text-domain'), source);
  }
  // source is synthetic syntax for a positive/negative static-analysis case; never execute it.
  for (const source of [
    `import{createI18n}from'zlocale';const t=createI18n({domain:'shop'});t.__('Hello');`,
    `import{createI18n}from'zlocale';const t=createI18n();t._x('Open','button','shop');`,
    `import{createI18n}from'zlocale';const fr=createI18n({domain:'shop'}).forLocale('fr');fr._n('%d item','%d items',2);`,
    `import{createI18n}from'zlocale';const {__:translate}=createI18n({domain:'shop'});translate('Hello');`,
    `const t={__(x){return x}};t.__('Hello');`,
    `function createI18n(){return {__(x){return x}}};const t=createI18n();t.__('Hello');`,
  ]) {
    assert.ok(!rules(source).includes('zerux/locale-text-domain'), source);
  }
  assert.ok(
    !rules(
      `import{createI18n}from'zlocale';const t=createI18n();t.__('Hello');`,
      light
    ).includes('zerux/locale-text-domain')
  );
  /** Synthetic fixture source retained byte-for-byte to verify static diagnostics and no autofix. */
  const source = `import{createI18n}from'zlocale';const t=createI18n();t.__('Hello');`;
  /** Native autofix outcome checked to ensure custom rules do not rewrite application semantics. */
  const fixed = new Linter().verifyAndFix(source, strict, {
    filename: 'fixture.ts',
  });
  assert.equal(fixed.output, source);
  assert.equal(fixed.fixed, false);
});

test('installed export maps handle exact, wildcard and blocked subpaths without executing modules', () => {
  /** Owned synthetic fixture directory or resolved package root used by the following checks. */
  const root = temp();
  try {
    /** Synthetic installed package root with an inert export map fixture. */
    const pkg = path.join(root, 'node_modules/fixture-package');
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(
      path.join(pkg, 'package.json'),
      JSON.stringify({
        name: 'fixture-package',
        exports: {
          '.': './index.js',
          './browser': './browser.js',
          './features/*': './*.js',
          './features/private': null,
        },
      })
    );
    fs.writeFileSync(
      path.join(pkg, 'index.js'),
      `throw new Error('must not execute');`
    );
    /** Explicit isolated consumer configuration; importing it does not lint the repository. */
    const config = createPackageConfig({
      cwd: root,
      packages: ['fixture-package'],
    });
    // source is synthetic syntax for a positive/negative static-analysis case; never execute it.
    for (const source of [
      `import 'fixture-package/src/private.js';`,
      `import 'fixture-package/features/private';`,
      `import item = require('fixture-package/private');`,
      `type Item=import('fixture-package/private').Item;`,
    ]) {
      assert.ok(rules(source, config).includes('zerux/package-exports'));
    }
    // source is synthetic syntax for a positive/negative static-analysis case; never execute it.
    for (const source of [
      `import 'fixture-package/browser';`,
      `import 'fixture-package/features/ok';`,
      `import 'unknown-package/private';`,
    ]) {
      assert.ok(!rules(source, config).includes('zerux/package-exports'));
    }
    assert.throws(
      () => createPackageConfig({ cwd: root, packages: ['missing-package'] }),
      /not installed/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('file fixture stays unchanged unless fix is explicit, scoped suppressions work and engines release file ownership', async () => {
  /** Owned synthetic fixture directory or resolved package root used by the following checks. */
  const root = temp();
  try {
    /** Owned synthetic input path used for bounded source and no-write checks. Synthetic fixture source retained byte-for-byte to verify static diagnostics and no autofix. */
    const file = path.join(root, 'test.js'),
      source = `'use client';import 'node:fs';\n`;
    fs.writeFileSync(file, source);
    /** Isolated ESLint instance using only the explicitly supplied fixture config. */
    const engine = new ESLint({
      cwd: root,
      overrideConfigFile: true,
      overrideConfig: light,
      fix: false,
    });
    /** Actual fixture read/lint result checked for expected behavior and resource cleanup. */
    const result = await engine.lintFiles([file]);
    assert.ok(
      result[0].messages.some(
        (item) => item.ruleId === 'zerux/client-server-import'
      )
    );
    assert.equal(fs.readFileSync(file, 'utf8'), source);
    assert.equal(result[0].output, undefined);
    assert.deepEqual(
      rules(
        `'use client';\n// eslint-disable-next-line zerux/client-server-import -- reviewed test-only fixture\nimport 'node:fs';`,
        light
      ),
      []
    );
    fs.unlinkSync(file);
    assert.equal(fs.existsSync(file), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CMS server subpaths follow their explicit browser-denied export contract', () => {
  // entry is a Node-only public subpath; root metadata and erased imports remain portable.
  for (const entry of ['cms', 'types']) {
    assert.ok(
      rules(`'use client'; import '@zenixjs/core/${entry}';`).includes(
        'zerux/client-server-import'
      )
    );
  }
  assert.ok(
    !rules(`'use client'; import {version} from '@zenixjs/core';`).includes(
      'zerux/client-server-import'
    )
  );
  assert.ok(
    !rules(
      `'use client'; import type {Cms} from '@zenixjs/core/cms';`
    ).includes('zerux/client-server-import')
  );
});

test('accessibility preference/speech/media listeners need explicit resource ownership', () => {
  // name selects a verified public factory returning a disposer or destroyable owner.
  for (const name of [
    'createPreferenceState',
    'bindPreferenceStyles',
    'createPreferencePanel',
    'createSpeechController',
    'observeReducedMotion',
    'onEscape',
  ]) {
    assert.ok(
      rules(
        `import {${name}} from '@zeruxjs/accessibility'; ${name}();`
      ).includes('zerux/cleanup-ownership')
    );
    assert.ok(
      !rules(
        `import {${name}} from '@zeruxjs/accessibility'; const owned = ${name}();`
      ).includes('zerux/cleanup-ownership')
    );
  }
});

test('AI registries and request executors require retained lifecycle owners', () => {
  // Each entry is a verified public factory with a close operation, not a borrowed provider.
  for (const [source, name] of [
    ['@zeruxjs/ai', 'createAiProviderRegistry'],
    ['@zeruxjs/ai/structured', 'createStructuredClient'],
    ['@zeruxjs/ai/tools', 'createToolExecutor'],
  ]) {
    assert.ok(
      rules(`import {${name} as create} from '${source}'; create();`).includes(
        'zerux/cleanup-ownership'
      )
    );
    assert.ok(
      !rules(
        `import {${name}} from '${source}'; const owner = ${name}();`
      ).includes('zerux/cleanup-ownership')
    );
    assert.ok(
      !rules(
        `import {${name}} from '${source}'; function own(${name}) { ${name}(); }`
      ).includes('zerux/cleanup-ownership')
    );
  }
  assert.ok(
    !rules(
      "import {createAiClient} from '@zeruxjs/ai'; createAiClient(provider);"
    ).includes('zerux/cleanup-ownership')
  );
});

test('AI executable tools remain server-only while erased type imports stay allowed', () => {
  assert.ok(
    rules(
      "'use client'; import {createToolExecutor} from '@zeruxjs/ai/tools';"
    ).includes('zerux/client-server-import')
  );
  assert.ok(
    !rules(
      "'use client'; import type {ToolContext} from '@zeruxjs/ai/tools';"
    ).includes('zerux/client-server-import')
  );
  assert.ok(
    !rules(
      "'use client'; import {createAiClient} from '@zeruxjs/ai';"
    ).includes('zerux/client-server-import')
  );
});

test('AI-model server entries and owned retrieval handles retain explicit boundaries', () => {
  // Node filesystem/crypto dependencies are eager on exactly these public entry points.
  for (const [source, runtime, typeName] of [
    ['@zeruxjs/ai-model', 'createKnowledgeBase', 'KnowledgeDocument'],
    ['@zeruxjs/ai-model/corpus', 'createCorpusReader', 'CorpusSnapshot'],
    ['@zeruxjs/ai-model/evidence', 'createEvidenceRetriever', 'EvidenceResult'],
  ]) {
    assert.ok(
      rules(`'use client'; import {${runtime}} from '${source}';`).includes(
        'zerux/client-server-import'
      )
    );
    assert.ok(
      !rules(
        `'use client'; import type {${typeName}} from '${source}';`
      ).includes('zerux/client-server-import')
    );
  }
  // These factories own closeable copied corpora or unsettled adapter jobs, unlike borrowed assistants.
  for (const [source, name] of [
    ['@zeruxjs/ai-model/corpus', 'createCorpusReader'],
    ['@zeruxjs/ai-model/evidence', 'createEvidenceRetriever'],
  ]) {
    assert.ok(
      rules(
        `import {${name} as acquire} from '${source}'; acquire();`
      ).includes('zerux/cleanup-ownership')
    );
    assert.ok(
      !rules(
        `import {${name}} from '${source}'; const owner = ${name}();`
      ).includes('zerux/cleanup-ownership')
    );
  }
  assert.ok(
    !rules(
      "import {createEvidenceAssistant} from '@zeruxjs/ai-model/evidence'; createEvidenceAssistant(retriever, provider);"
    ).includes('zerux/cleanup-ownership')
  );
});

test('analytics collector stays server-only while its explicit browser entry remains usable', () => {
  // These exact public imports eagerly load crypto/server collection; erased types do not.
  for (const [source, runtime, typeName] of [
    ['@zeruxjs/analytics', 'createAnalytics', 'AnalyticsEventInput'],
    ['@zeruxjs/analytics/http', 'createAnalyticsCollector', 'CollectorOptions'],
    [
      '@zeruxjs/analytics/email',
      'createEmailTrackingService',
      'EmailTrackingOptions',
    ],
    [
      '@zeruxjs/analytics/durable',
      'createDurableAnalytics',
      'DurableAnalyticsOptions',
    ],
  ]) {
    assert.ok(
      rules(`'use client'; import {${runtime}} from '${source}';`).includes(
        'zerux/client-server-import'
      )
    );
    assert.ok(
      !rules(
        `'use client'; import type {${typeName}} from '${source}';`
      ).includes('zerux/client-server-import')
    );
  }
  assert.ok(
    !rules(
      "'use client'; import {createEventClient} from '@zeruxjs/analytics/browser';"
    ).includes('zerux/client-server-import')
  );
  assert.ok(
    !rules(
      "import {createEventClient} from '@zeruxjs/analytics/browser'; createEventClient(config);"
    ).includes('zerux/cleanup-ownership')
  );
});

test('analytics native read and durable owners require retained handles; borrowed managers do not', () => {
  // These exact public factories expose close; the manager/registry/store conveniences do not.
  for (const [source, name] of [
    ['@zeruxjs/analytics', 'createAnalyticsAnalysis'],
    ['@zeruxjs/analytics/durable', 'createDurableAnalytics'],
  ]) {
    assert.ok(
      rules(
        `import {${name} as acquire} from '${source}'; acquire(options);`
      ).includes('zerux/cleanup-ownership')
    );
    assert.ok(
      !rules(
        `import {${name}} from '${source}'; const owner = ${name}(options);`
      ).includes('zerux/cleanup-ownership')
    );
  }
  assert.ok(
    !rules(
      "import {createAnalytics} from '@zeruxjs/analytics'; createAnalytics(options);"
    ).includes('zerux/cleanup-ownership')
  );
});

test('asset public entries load server owners and retain only actual closeable adapters', () => {
  // Root eagerly exports filesystem persistence; optional workflows eagerly import Node crypto.
  for (const [source, name, typeName] of [
    ['@zeruxjs/asset-manager', 'createAssetManager', 'Asset'],
    ['@zeruxjs/asset-manager/storage', 'createAssetStorage', 'AssetIdentity'],
    ['@zeruxjs/asset-manager/brand', 'createBrandCatalog', 'BrandActor'],
  ]) {
    assert.ok(
      rules(`'use client'; import {${name}} from '${source}';`).includes(
        'zerux/client-server-import'
      )
    );
    assert.ok(
      !rules(
        `'use client'; import type {${typeName}} from '${source}';`
      ).includes('zerux/client-server-import')
    );
    if (name !== 'createAssetManager') {
      assert.ok(
        rules(`import {${name}} from '${source}'; ${name}(options);`).includes(
          'zerux/cleanup-ownership'
        )
      );
      assert.ok(
        !rules(
          `import {${name}} from '${source}'; const owner = ${name}(options);`
        ).includes('zerux/cleanup-ownership')
      );
    }
  }
  assert.ok(
    !rules(
      "import {createAssetManager} from '@zeruxjs/asset-manager'; createAssetManager();"
    ).includes('zerux/cleanup-ownership')
  );
});

test('auth managers retain owned work/key cleanup while reference stores stay ordinary values', () => {
  // Exact root factories expose close; detecting a retained handle does not prove eventual drain.
  for (const name of [
    'createSharedAuth',
    'createPasskeyManager',
    'createProviderLogin',
  ]) {
    assert.ok(
      rules(
        `import {${name} as acquire} from '@zeruxjs/auth'; acquire(options);`
      ).includes('zerux/cleanup-ownership')
    );
    assert.ok(
      !rules(
        `import {${name}} from '@zeruxjs/auth'; const owner = ${name}(options);`
      ).includes('zerux/cleanup-ownership')
    );
  }
  for (const name of [
    'createTokenStore',
    'createMemoryAuthPersistence',
    'createMemoryPasskeyStore',
    'createMemoryProviderLoginStore',
  ]) {
    assert.ok(
      !rules(`import {${name}} from '@zeruxjs/auth'; ${name}();`).includes(
        'zerux/cleanup-ownership'
      )
    );
  }
});

test('cache owners require retained handles while policy values remain ordinary data', () => {
  // Only verified factories return close owners; retaining one is not proof of eventual disposal.
  for (const name of [
    'createCacheManager',
    'createCacheManagerWithHelper',
    'createMemoryCacheHelper',
    'configureCacheManager',
  ]) {
    assert.ok(
      rules(
        `import {${name}} from '@zeruxjs/cache'; ${name}(options);`
      ).includes('zerux/cleanup-ownership')
    );
    assert.ok(
      !rules(
        `import {${name}} from '@zeruxjs/cache'; const owner = ${name}(options);`
      ).includes('zerux/cleanup-ownership')
    );
  }
  assert.ok(
    rules(
      "'use client'; import {cachePolicy} from '@zeruxjs/cache/policy';"
    ).includes('zerux/client-server-import')
  );
  assert.ok(
    !rules(
      "'use client'; import type {CacheManager} from '@zeruxjs/cache';"
    ).includes('zerux/client-server-import')
  );
  assert.ok(
    !rules(
      "import {cachePolicy} from '@zeruxjs/cache/policy'; cachePolicy(options);"
    ).includes('zerux/cleanup-ownership')
  );
});

test('Memcached runtime is server-only and direct helpers retain their socket owner', () => {
  // These explicit factories close sockets; key validation has no resource lifetime.
  for (const name of ['createMemcacheHelper', 'createCacheHelper']) {
    assert.ok(
      rules(
        `import {${name}} from '@zeruxjs/cache-memcache'; ${name}(options);`
      ).includes('zerux/cleanup-ownership')
    );
    assert.ok(
      !rules(
        `import {${name}} from '@zeruxjs/cache-memcache'; const helper = ${name}(options);`
      ).includes('zerux/cleanup-ownership')
    );
  }
  assert.ok(
    rules(
      "'use client'; import {MemcacheTextClient} from '@zeruxjs/cache-memcache/protocol';"
    ).includes('zerux/client-server-import')
  );
  assert.ok(
    !rules(
      "'use client'; import type {TextRequestOptions} from '@zeruxjs/cache-memcache/protocol';"
    ).includes('zerux/client-server-import')
  );
  assert.ok(
    !rules(
      "import {validateKey} from '@zeruxjs/cache-memcache/protocol'; validateKey('safe');"
    ).includes('zerux/cleanup-ownership')
  );
});

test('Redis owners retain close or connection-pair cleanup while option builders stay inert', () => {
  // The Cluster pair owns two quit handles; structural adaptation and option construction acquire nothing.
  for (const name of [
    'createCacheHelper',
    'createRedisCacheHelper',
    'createIORedisCacheHelper',
    'createRedisRateLimitStore',
    'createBullMQRedisClusterConnections',
  ]) {
    assert.ok(
      rules(
        `import {${name}} from '@zeruxjs/cache-redis'; ${name}(options);`
      ).includes('zerux/cleanup-ownership')
    );
    assert.ok(
      !rules(
        `import {${name}} from '@zeruxjs/cache-redis'; const owner = ${name}(options);`
      ).includes('zerux/cleanup-ownership')
    );
  }
  assert.ok(
    rules(
      "'use client'; import {createCacheHelper} from '@zeruxjs/cache-redis';"
    ).includes('zerux/client-server-import')
  );
  assert.ok(
    !rules(
      "'use client'; import type {RedisCacheClient} from '@zeruxjs/cache-redis';"
    ).includes('zerux/client-server-import')
  );
  for (const name of ['createBullMQRedisOptions', 'adaptIORedis']) {
    assert.ok(
      !rules(
        `import {${name}} from '@zeruxjs/cache-redis'; ${name}(options);`
      ).includes('zerux/cleanup-ownership')
    );
  }
});

test('Valkey direct factories retain cleanup ownership and runtime imports stay server-side', () => {
  // Constructors and injected native lifetimes still require host review beyond direct factory syntax.
  for (const name of ['createCacheHelper', 'createValkeyCacheHelper']) {
    assert.ok(
      rules(
        `import {${name}} from '@zeruxjs/cache-valkey'; ${name}(options);`
      ).includes('zerux/cleanup-ownership')
    );
    assert.ok(
      !rules(
        `import {${name}} from '@zeruxjs/cache-valkey'; const owner = ${name}(options);`
      ).includes('zerux/cleanup-ownership')
    );
  }
  assert.ok(
    rules(
      "'use client'; import {createCacheHelper} from '@zeruxjs/cache-valkey';"
    ).includes('zerux/client-server-import')
  );
  assert.ok(
    !rules(
      "'use client'; import type {ValkeyClient} from '@zeruxjs/cache-valkey';"
    ).includes('zerux/client-server-import')
  );
});

test('database manager acquisitions retain disconnect ownership while inert runners and projections stay ordinary values', () => {
  // A retained manager must still be disconnected; native transaction runners acquire only when invoked.
  for (const name of ['createDatabaseManager', 'configureDatabaseManager']) {
    assert.ok(
      rules(`import {${name}} from '@zeruxjs/db'; ${name}(config);`).includes(
        'zerux/cleanup-ownership'
      )
    );
    assert.ok(
      !rules(
        `import {${name}} from '@zeruxjs/db'; const manager = ${name}(config);`
      ).includes('zerux/cleanup-ownership')
    );
  }
  for (const name of [
    'createPinnedTransaction',
    'createPinnedMigrationTransaction',
    'createDatabaseMigrationRunner',
    'createTenantDatabaseFacade',
    'createKeysetPage',
  ]) {
    assert.ok(
      !rules(`import {${name}} from '@zeruxjs/db'; ${name}(options);`).includes(
        'zerux/cleanup-ownership'
      )
    );
  }
  assert.ok(
    !rules(
      "'use client'; import type {DatabaseResult} from '@zeruxjs/db';"
    ).includes('zerux/client-server-import')
  );
});

test('Mongo connector wrappers retain disconnect ownership while query builders stay inert', () => {
  assert.ok(
    rules(
      "import {createConnector} from '@zeruxjs/db-mongo'; createConnector(options);"
    ).includes('zerux/cleanup-ownership')
  );
  assert.ok(
    !rules(
      "import {createConnector} from '@zeruxjs/db-mongo'; const connector = createConnector(options);"
    ).includes('zerux/cleanup-ownership')
  );
  assert.ok(
    rules(
      "'use client'; import {createConnector} from '@zeruxjs/db-mongo';"
    ).includes('zerux/client-server-import')
  );
  assert.ok(
    !rules(
      "'use client'; import type {MongoClientLike} from '@zeruxjs/db-mongo';"
    ).includes('zerux/client-server-import')
  );
  // Building a structured predicate owns no native transport or session.
  assert.ok(
    !rules(
      "import {buildWhere} from '@zeruxjs/db-mongo'; buildWhere(predicate);"
    ).includes('zerux/cleanup-ownership')
  );
});

test('MySQL connector wrappers retain disconnect owners without prohibiting erased native contracts', () => {
  assert.ok(
    rules(
      "import {createConnector} from '@zeruxjs/db-mysql'; createConnector(options);"
    ).includes('zerux/cleanup-ownership')
  );
  assert.ok(
    !rules(
      "import {createConnector} from '@zeruxjs/db-mysql'; const connector = createConnector(options);"
    ).includes('zerux/cleanup-ownership')
  );
  assert.ok(
    rules(
      "'use client'; import {createConnector} from '@zeruxjs/db-mysql';"
    ).includes('zerux/client-server-import')
  );
  assert.ok(
    !rules(
      "'use client'; import type {MySqlPoolLike} from '@zeruxjs/db-mysql';"
    ).includes('zerux/client-server-import')
  );
});

test('PostgreSQL connector wrappers retain cleanup owners and erased pool contracts stay allowed', () => {
  assert.ok(
    rules(
      "import {createConnector} from '@zeruxjs/db-pg'; createConnector(options);"
    ).includes('zerux/cleanup-ownership')
  );
  assert.ok(
    !rules(
      "import {createConnector} from '@zeruxjs/db-pg'; const connector = createConnector(options);"
    ).includes('zerux/cleanup-ownership')
  );
  assert.ok(
    rules(
      "'use client'; import {createConnector} from '@zeruxjs/db-pg';"
    ).includes('zerux/client-server-import')
  );
  assert.ok(
    !rules(
      "'use client'; import type {PgPoolLike} from '@zeruxjs/db-pg';"
    ).includes('zerux/client-server-import')
  );
});

test('SQL compiler facades acquire no native resources but runtime imports remain Node-only', () => {
  // The compiler borrows executors and has no disconnect; never invent cleanup ownership.
  for (const name of ['compileSql', 'createSqlConnector']) {
    assert.ok(
      !rules(
        `import {${name}} from '@zeruxjs/db-sql-core'; ${name}(dialect, options);`
      ).includes('zerux/cleanup-ownership')
    );
  }
  assert.ok(
    rules(
      "'use client'; import {compileSql} from '@zeruxjs/db-sql-core';"
    ).includes('zerux/client-server-import')
  );
  assert.ok(
    !rules(
      "'use client'; import type {SqlCompilation} from '@zeruxjs/db-sql-core';"
    ).includes('zerux/client-server-import')
  );
});

test('SQLite native openings retain owners while borrowed executors and completed backups acquire no handle', () => {
  // Both public opening APIs return a handle requiring explicit disconnect/close ownership.
  for (const name of ['createConnector', 'openSqlite']) {
    assert.ok(
      rules(
        `import {${name}} from '@zeruxjs/db-sqlite'; ${name}(options);`
      ).includes('zerux/cleanup-ownership')
    );
    assert.ok(
      !rules(
        `import {${name}} from '@zeruxjs/db-sqlite'; const owner = ${name}(options);`
      ).includes('zerux/cleanup-ownership')
    );
  }
  // Borrowing execution or awaiting a completed snapshot does not acquire a persistent handle.
  for (const name of ['createSqliteExecutor', 'createSqliteConsistentBackup']) {
    assert.ok(
      !rules(
        `import {${name}} from '@zeruxjs/db-sqlite'; ${name}(database, options);`
      ).includes('zerux/cleanup-ownership')
    );
  }
  assert.ok(
    rules(
      "'use client'; import {openSqlite} from '@zeruxjs/db-sqlite';"
    ).includes('zerux/client-server-import')
  );
  assert.ok(
    !rules(
      "'use client'; import type {SqliteOptions} from '@zeruxjs/db-sqlite';"
    ).includes('zerux/client-server-import')
  );
});

test('email transport, retry queue and attachment scopes retain owners without inventing template disposal', () => {
  // These actual public owners expose close or dispose, including lazy attachment resources.
  for (const name of [
    'createEmailManager',
    'createEmailReceiver',
    'createEmailQueue',
    'resolveAttachmentScope',
  ]) {
    assert.ok(
      rules(
        `import {${name}} from '@zeruxjs/email'; ${name}(options);`
      ).includes('zerux/cleanup-ownership')
    );
    assert.ok(
      !rules(
        `import {${name}} from '@zeruxjs/email'; const owner = ${name}(options);`
      ).includes('zerux/cleanup-ownership')
    );
  }
  // Catalogs and pure projections create no native handles or disposal contract.
  for (const name of [
    'createTemplateRegistry',
    'createRecipientFilter',
    'classifySmtpRecipients',
    'convertHtmlToEmail',
    'createEmailPreferenceService',
    'createMarketingSuppressionService',
    'createEmailReputationService',
    'createCampaignAnalyticsReporter',
  ]) {
    assert.ok(
      !rules(
        `import {${name}} from '@zeruxjs/email'; ${name}(options);`
      ).includes('zerux/cleanup-ownership')
    );
  }
  assert.ok(
    rules(
      "'use client'; import {createEmailManager} from '@zeruxjs/email';"
    ).includes('zerux/client-server-import')
  );
  assert.ok(
    !rules(
      "'use client'; import type {EmailMessage} from '@zeruxjs/email';"
    ).includes('zerux/client-server-import')
  );
});

test('feed Fetch owners retain cleanup and Node runtime boundaries without inventing generator disposal', () => {
  assert.ok(
    rules(
      "import {createFeedFetchHandler} from '@zeruxjs/feed/fetch'; createFeedFetchHandler(options);"
    ).includes('zerux/cleanup-ownership')
  );
  assert.ok(
    !rules(
      "import {createFeedFetchHandler} from '@zeruxjs/feed/fetch'; const handler = createFeedFetchHandler(options);"
    ).includes('zerux/cleanup-ownership')
  );
  // Pure serialization/validation returns values, never an owned subscription or network handle.
  for (const name of [
    'createRssFeed',
    'createAtomFeed',
    'createJsonFeed',
    'createFeedResponse',
    'normalizeFeed',
    'escapeXml',
  ]) {
    assert.ok(
      !rules(
        `import {${name}} from '@zeruxjs/feed'; ${name}(options);`
      ).includes('zerux/cleanup-ownership')
    );
  }
  assert.ok(
    rules(
      "'use client'; import {createRssFeed} from '@zeruxjs/feed';"
    ).includes('zerux/client-server-import')
  );
  assert.ok(
    rules(
      "'use client'; import {createFeedFetchHandler} from '@zeruxjs/feed/fetch';"
    ).includes('zerux/client-server-import')
  );
  assert.ok(
    !rules(
      "'use client'; import type {FeedOptions} from '@zeruxjs/feed';"
    ).includes('zerux/client-server-import')
  );
  assert.ok(
    !rules(
      "'use client'; import type {FeedFetchOptions} from '@zeruxjs/feed/fetch';"
    ).includes('zerux/client-server-import')
  );
});

test('React owner factories and the native server boundary remain distinct from borrowed bindings', () => {
  // Only source-verified destroy/unmount/dispose owners require an acquired handle.
  for (const [entry, name] of [
    ['@zeruxjs/react', 'createReactStore'],
    ['@zeruxjs/react/browser', 'mountReact'],
    ['@zeruxjs/react/browser', 'hydrateReact'],
    ['@zeruxjs/react/hydration', 'createReactHydrationState'],
    ['@zeruxjs/react/hydration', 'readReactHydrationState'],
  ]) {
    assert.ok(
      rules(`import {${name}} from '${entry}'; ${name}(options);`).includes(
        'zerux/cleanup-ownership'
      )
    );
    assert.ok(
      !rules(
        `import {${name}} from '${entry}'; const owner = ${name}(options);`
      ).includes('zerux/cleanup-ownership')
    );
  }
  assert.ok(
    !rules(
      "import {createReactBindings,selectReactStore,observableToReactStore} from '@zeruxjs/react'; createReactBindings(runtime); selectReactStore(source, select); observableToReactStore(source);"
    ).includes('zerux/cleanup-ownership')
  );
  assert.ok(
    rules(
      '"use client"; import {renderReactToString} from "@zeruxjs/react/server";'
    ).includes('zerux/client-server-import')
  );
  assert.ok(
    !rules(
      '"use client"; import {createReactStore} from "@zeruxjs/react"; import {mountReact} from "@zeruxjs/react/browser"; import {readReactHydrationState} from "@zeruxjs/react/hydration";'
    ).includes('zerux/client-server-import')
  );
});

test('Reports lifecycle owners and server sources remain separate from inert browser definitions', () => {
  // Source registrations own accepted adapters; invalid registration leaves cleanup with the host.
  for (const [entry, name] of [
    ['@zeruxjs/reports/sources', 'createReportSourceRegistry'],
    ['@zeruxjs/reports/ga4', 'createGa4ReportSource'],
    ['@zeruxjs/reports/ga4', 'createGoogleReportCredentials'],
    ['@zeruxjs/reports/adsense', 'createAdSenseReportSource'],
    ['@zeruxjs/reports/adsense', 'createGoogleReportCredentials'],
    ['@zeruxjs/reports/view', 'mountReportChart'],
  ]) {
    assert.ok(
      rules(`import {${name}} from '${entry}'; ${name}(options);`).includes(
        'zerux/cleanup-ownership'
      )
    );
    assert.ok(
      !rules(
        `import {${name}} from '${entry}'; const owner = ${name}(options);`
      ).includes('zerux/cleanup-ownership')
    );
  }
  assert.ok(
    !rules(
      "import {createReports,createMemoryReportsStore} from '@zeruxjs/reports'; createReports(options); createMemoryReportsStore();"
    ).includes('zerux/cleanup-ownership')
  );
  assert.ok(
    !rules(
      "import {createReportSourceHandler} from '@zeruxjs/reports/sources'; createReportSourceHandler(options);"
    ).includes('zerux/cleanup-ownership')
  );
  for (const entry of [
    '@zeruxjs/reports',
    '@zeruxjs/reports/sources',
    '@zeruxjs/reports/ga4',
    '@zeruxjs/reports/adsense',
  ]) {
    assert.ok(
      rules(`"use client"; import * as reports from '${entry}';`).includes(
        'zerux/client-server-import'
      )
    );
  }
  assert.ok(
    !rules(
      '"use client"; import {importReportDefinition} from "@zeruxjs/reports/definitions"; import {mountReportChart} from "@zeruxjs/reports/view";'
    ).includes('zerux/client-server-import')
  );
});

test('Search flags owned service lifetimes and Node subpaths without rejecting the standalone index', () => {
  assert.ok(
    rules(
      "import {createSearchServices} from '@zeruxjs/search/adapters'; createSearchServices(options);"
    ).includes('zerux/cleanup-ownership')
  );
  assert.ok(
    !rules(
      "import {createSearchServices} from '@zeruxjs/search/adapters'; const owner = createSearchServices(options);"
    ).includes('zerux/cleanup-ownership')
  );
  assert.ok(
    !rules(
      "import {createSearchIndex} from '@zeruxjs/search'; import {registerSearchService,createLocalSearchFactory} from '@zeruxjs/search/adapters'; createSearchIndex(); registerSearchService(options); createLocalSearchFactory();"
    ).includes('zerux/cleanup-ownership')
  );
  // These two entries import Node crypto/filesystem; core and inert adapter registrations do not.
  for (const entry of ['@zeruxjs/search/http', '@zeruxjs/search/persistence']) {
    assert.ok(
      rules(`"use client"; import * as search from '${entry}';`).includes(
        'zerux/client-server-import'
      )
    );
  }
  assert.ok(
    !rules(
      '"use client"; import {createSearchIndex} from "@zeruxjs/search";'
    ).includes('zerux/client-server-import')
  );
});

test('Elasticsearch marks Node adapters and acquired wrappers without inventing factory ownership', () => {
  assert.ok(
    rules(
      "import {createElasticSearchAdapter} from '@zeruxjs/search-elastic'; createElasticSearchAdapter(options);"
    ).includes('zerux/cleanup-ownership')
  );
  assert.ok(
    !rules(
      "import {createElasticSearchAdapter} from '@zeruxjs/search-elastic'; const owner = createElasticSearchAdapter(options);"
    ).includes('zerux/cleanup-ownership')
  );
  assert.ok(
    !rules(
      "import {createElasticSearchFactory} from '@zeruxjs/search-elastic'; createElasticSearchFactory(options);"
    ).includes('zerux/cleanup-ownership')
  );
  assert.ok(
    rules(
      '"use client"; import {createElasticSearchAdapter} from "@zeruxjs/search-elastic";'
    ).includes('zerux/client-server-import')
  );
});

test('Meilisearch marks Node wrapper ownership while its registration factory stays inert', () => {
  assert.ok(
    rules(
      "import {createMilleSearchAdapter} from '@zeruxjs/search-mille'; createMilleSearchAdapter(options);"
    ).includes('zerux/cleanup-ownership')
  );
  assert.ok(
    !rules(
      "import {createMilleSearchAdapter} from '@zeruxjs/search-mille'; const owner = createMilleSearchAdapter(options);"
    ).includes('zerux/cleanup-ownership')
  );
  assert.ok(
    !rules(
      "import {createMilleSearchFactory} from '@zeruxjs/search-mille'; createMilleSearchFactory(options);"
    ).includes('zerux/cleanup-ownership')
  );
  assert.ok(
    rules(
      '"use client"; import {createMilleSearchAdapter} from "@zeruxjs/search-mille";'
    ).includes('zerux/client-server-import')
  );
});

test('Security tracks copied-key/native-work owners without inventing CSRF or policy disposal', () => {
  // Each factory owns copied key material, unsettled work or a closeable reference store.
  for (const [entry, names] of [
    [
      '@zeruxjs/security',
      [
        'createEncryptionKeyring',
        'createMessageAuthenticator',
        'createJwtSigner',
        'createJwtVerifier',
        'createJwtJwks',
        'createMemoryRateLimitStore',
        'createDistributedRateLimiter',
      ],
    ],
    [
      '@zeruxjs/security/crypto',
      ['createEncryptionKeyring', 'createMessageAuthenticator'],
    ],
    [
      '@zeruxjs/security/jwt',
      ['createJwtSigner', 'createJwtVerifier', 'createJwtJwks'],
    ],
  ]) {
    for (const name of names) {
      assert.ok(
        rules(`import {${name}} from '${entry}'; ${name}(options);`).includes(
          'zerux/cleanup-ownership'
        )
      );
      assert.ok(
        !rules(
          `import {${name}} from '${entry}'; const owner = ${name}(options);`
        ).includes('zerux/cleanup-ownership')
      );
    }
  }
  assert.ok(
    !rules(
      "import {createCsrfProtection,createSecurityPolicy,createSecurityHeaders,createRateLimiter} from '@zeruxjs/security'; createCsrfProtection(options); createSecurityPolicy(options); createSecurityHeaders(options); createRateLimiter(options);"
    ).includes('zerux/cleanup-ownership')
  );
  assert.ok(
    !rules(
      '"use client"; import {escapeHtmlText,validateNavigationUrl} from "@zeruxjs/security/encoding";'
    ).includes('zerux/client-server-import')
  );
});

test('SEO distinguishes drainable public crawlers/filter owners from inert and legacy serializers', () => {
  // These exact factories own actual asynchronous work; neither inert redirects nor legacy cache controllers expose this lifecycle.
  for (const [entry, name] of [
    ['@zeruxjs/seo/public', 'createPublicCrawlerService'],
    ['@zeruxjs/seo/composition', 'createMetadataHooks'],
  ]) {
    assert.ok(
      rules(`import {${name}} from '${entry}'; ${name}(options);`).includes(
        'zerux/cleanup-ownership'
      )
    );
    assert.ok(
      !rules(
        `import {${name}} from '${entry}'; const owner = ${name}(options);`
      ).includes('zerux/cleanup-ownership')
    );
  }
  assert.ok(
    !rules(
      "import {createPublicRedirects,renderHtmlSitemap} from '@zeruxjs/seo/public'; createPublicRedirects(options); renderHtmlSitemap(site, items);"
    ).includes('zerux/cleanup-ownership')
  );
  assert.ok(
    !rules(
      "import {createCrawlerService,createCrawlerRoutes} from '@zeruxjs/seo/fetch'; createCrawlerService(options); createCrawlerRoutes(options);"
    ).includes('zerux/cleanup-ownership')
  );
  for (const entry of [
    '@zeruxjs/seo/fetch',
    '@zeruxjs/seo/public',
    '@zeruxjs/seo/composition',
  ]) {
    assert.ok(
      rules(`"use client"; import * as seo from '${entry}';`).includes(
        'zerux/client-server-import'
      )
    );
  }
});

test('Share keeps browser helpers independent of server owners and borrowed SQLite adapters', () => {
  assert.ok(
    rules(
      "import {createShortLinkService} from '@zeruxjs/share/server'; createShortLinkService(options);"
    ).includes('zerux/cleanup-ownership')
  );
  assert.ok(
    !rules(
      "import {createShortLinkService} from '@zeruxjs/share/server'; const links = createShortLinkService(options);"
    ).includes('zerux/cleanup-ownership')
  );
  assert.ok(
    !rules(
      "import {createSqliteShortLinkStore} from '@zeruxjs/share/sqlite'; createSqliteShortLinkStore(options);"
    ).includes('zerux/cleanup-ownership')
  );
  assert.ok(
    !rules(
      '"use client"; import {createShareController,shareOrCopy} from "@zeruxjs/share"; createShareController(options);'
    ).includes('zerux/client-server-import')
  );
  // Only explicit server entries import crypto/native storage; browser helpers own no disposal handle.
  for (const entry of ['@zeruxjs/share/server', '@zeruxjs/share/sqlite']) {
    assert.ok(
      rules(`"use client"; import * as links from '${entry}';`).includes(
        'zerux/client-server-import'
      )
    );
  }
});

test('Tags distinguishes owned manager, registry and UI from inert definitions and borrowed memory state', () => {
  // These exact APIs own asynchronous drain, provider disposal or removable DOM resources.
  for (const [entry, name] of [
    ['@zeruxjs/tags', 'createTagManager'],
    ['@zeruxjs/tags', 'createTagProviderRegistry'],
    ['@zeruxjs/tags/admin-client', 'createTagAdminClient'],
    ['@zeruxjs/tags/admin-view', 'mountTagAdmin'],
  ]) {
    assert.ok(
      rules(`import {${name}} from '${entry}'; ${name}(options);`).includes(
        'zerux/cleanup-ownership'
      )
    );
    assert.ok(
      !rules(
        `import {${name}} from '${entry}'; const owner = ${name}(options);`
      ).includes('zerux/cleanup-ownership')
    );
  }
  assert.ok(
    !rules(
      "import {createMemoryTagStore,emptyTagContainer,importTagDefinition} from '@zeruxjs/tags'; createMemoryTagStore(definition); emptyTagContainer(); importTagDefinition(text);"
    ).includes('zerux/cleanup-ownership')
  );
  assert.ok(
    rules(
      '"use client"; import {createTagManager} from "@zeruxjs/tags";'
    ).includes('zerux/client-server-import')
  );
  // Browser subpaths use type-only server contracts and do not acquire native Node dependencies.
  for (const entry of [
    '@zeruxjs/tags/admin-client',
    '@zeruxjs/tags/admin-view',
  ]) {
    assert.ok(
      !rules(`"use client"; import * as tags from '${entry}';`).includes(
        'zerux/client-server-import'
      )
    );
  }
});

test('Validator HTTP scopes and handler wrappers expose real close ownership without forcing standalone parse disposal', () => {
  // Both factory and handler retain per-instance asynchronous reader scopes; standalone calls own only their operation.
  for (const entry of ['@zeruxjs/validator', '@zeruxjs/validator/http']) {
    for (const name of ['createHttpInputAdapter', 'validatedJsonHandler']) {
      assert.ok(
        rules(`import {${name}} from '${entry}'; ${name}(options);`).includes(
          'zerux/cleanup-ownership'
        )
      );
      assert.ok(
        !rules(
          `import {${name}} from '${entry}'; const owner = ${name}(options);`
        ).includes('zerux/cleanup-ownership')
      );
    }
  }
  assert.ok(
    !rules(
      "import {parseQuery,readJsonBody} from '@zeruxjs/validator/http'; parseQuery(schema, url); readJsonBody(request);"
    ).includes('zerux/cleanup-ownership')
  );
  assert.ok(
    !rules(
      '"use client"; import {string,object} from "@zeruxjs/validator/schemas";'
    ).includes('zerux/client-server-import')
  );
});

test('Vue server boundaries and subscription owners preserve inert root factories', () => {
  for (const config of [light, strict]) {
    assert.ok(
      rules("'use client'; import '@zeruxjs/vue/server';", config).includes(
        'zerux/client-server-import'
      )
    );
    for (const entry of [
      '@zeruxjs/vue',
      '@zeruxjs/vue/browser',
      '@zeruxjs/vue/rendering',
    ]) {
      assert.ok(
        !rules(`'use client'; import '${entry}';`, config).includes(
          'zerux/client-server-import'
        )
      );
    }
  }
  // Function disposers and object stop/unmount handles all require a retained binding.
  for (const [entry, names] of [
    [
      '@zeruxjs/vue',
      [
        'toVueReadable',
        'mapVueRef',
        'combineVueRefs',
        'observableToVueRef',
        'bindVueRef',
        'syncVueRef',
      ],
    ],
    ['@zeruxjs/vue/browser', ['mountVue', 'hydrateVue']],
  ]) {
    for (const name of names) {
      assert.ok(
        rules(`import {${name}} from '${entry}'; ${name}(options);`).includes(
          'zerux/cleanup-ownership'
        )
      );
      assert.ok(
        !rules(
          `import {${name}} from '${entry}'; const owner = ${name}(options);`
        ).includes('zerux/cleanup-ownership')
      );
    }
  }
  assert.ok(
    !rules(
      "import {createVueRef, createVueBindings, fromVueRef} from '@zeruxjs/vue'; createVueRef(0); createVueBindings(runtime); fromVueRef(ref);"
    ).includes('zerux/cleanup-ownership')
  );
});

test('Zyro owned sources and manual bridges differ from borrowed projections and scoped bridges', () => {
  for (const [entry, names] of [
    [
      '@zeruxjs/zyro',
      [
        'createObservable',
        'createAsyncObservable',
        'createZyroSubscriptionScope',
      ],
    ],
    ['@zeruxjs/zyro/renderer', ['createZyroRendererBridge']],
  ]) {
    for (const name of names) {
      assert.ok(
        rules(`import {${name}} from '${entry}'; ${name}(options);`).includes(
          'zerux/cleanup-ownership'
        )
      );
      assert.ok(
        !rules(
          `import {${name}} from '${entry}'; const owner = ${name}(options);`
        ).includes('zerux/cleanup-ownership')
      );
    }
  }
  // Projections allocate no eager subscription; the use helper delegates its owner to a native scope.
  assert.ok(
    !rules(
      "import {mapObservable, combineObservables, toExternalStore, fromExternalStore} from '@zeruxjs/zyro'; mapObservable(source, project); combineObservables(sources); toExternalStore(source); fromExternalStore(store);"
    ).includes('zerux/cleanup-ownership')
  );
  assert.ok(
    !rules(
      "import {useZyroRendererBridge} from '@zeruxjs/zyro/renderer'; useZyroRendererBridge(runtime);"
    ).includes('zerux/cleanup-ownership')
  );
});

test('CLI imports stay server-side and plugin/prompt owners differ from inert generator plans', () => {
  for (const config of [light, strict]) {
    for (const entry of ['zclivo', 'zclivo/generator']) {
      assert.ok(
        rules(`'use client'; import '${entry}';`, config).includes(
          'zerux/client-server-import'
        )
      );
    }
    assert.ok(
      !rules(
        "'use client'; import type {ProjectPlan} from 'zclivo';",
        config
      ).includes('zerux/client-server-import')
    );
  }
  for (const name of [
    'createTerminalGeneratorPrompt',
    'loadPlugins',
    'loadConfiguredPlugins',
  ]) {
    assert.ok(
      rules(`import {${name}} from 'zclivo'; ${name}(options);`).includes(
        'zerux/cleanup-ownership'
      )
    );
    assert.ok(
      !rules(
        `import {${name}} from 'zclivo'; const owner = ${name}(options);`
      ).includes('zerux/cleanup-ownership')
    );
  }
  assert.ok(
    !rules(
      "import {createProjectGenerator, registerGeneratorCommand, parseArguments} from 'zclivo'; createProjectGenerator(templates); registerGeneratorCommand(commands); parseArguments(argv);"
    ).includes('zerux/cleanup-ownership')
  );
});

test('CMS metadata stays inert while native application ownership and server entries remain explicit', () => {
  for (const config of [light, strict]) {
    for (const entry of ['zenixjs/application', 'zenixjs/setup-store']) {
      assert.ok(
        rules(`'use client'; import '${entry}';`, config).includes(
          'zerux/client-server-import'
        )
      );
    }
    assert.ok(
      !rules("'use client'; import {version} from 'zenixjs';", config).includes(
        'zerux/client-server-import'
      )
    );
    assert.ok(
      !rules(
        "'use client'; import type {ZenixOptions} from 'zenixjs/application';",
        config
      ).includes('zerux/client-server-import')
    );
  }
  assert.ok(
    rules(
      "import {createZenixApplication} from 'zenixjs/application'; createZenixApplication(options);"
    ).includes('zerux/cleanup-ownership')
  );
  assert.ok(
    !rules(
      "import {createZenixApplication} from 'zenixjs/application'; const owner = createZenixApplication(options);"
    ).includes('zerux/cleanup-ownership')
  );
  // Setup stores borrow the connector; they do not expose an invented close/disconnect method.
  assert.ok(
    !rules(
      "import {createSqliteSetupStore} from 'zenixjs/setup-store'; createSqliteSetupStore(options);"
    ).includes('zerux/cleanup-ownership')
  );
});

test('reactive locale subscriptions retain disposal while translator values and build caches stay inert', () => {
  assert.ok(
    rules(
      "import {createZyroI18n} from 'zlocale/zyro'; createZyroI18n(i18n, signal);"
    ).includes('zerux/cleanup-ownership')
  );
  assert.ok(
    !rules(
      "import {createZyroI18n} from 'zlocale/zyro'; const owner = createZyroI18n(i18n, signal);"
    ).includes('zerux/cleanup-ownership')
  );
  assert.ok(
    !rules(
      "import {createI18n, defineCatalog} from 'zlocale'; createI18n(options); defineCatalog(data);"
    ).includes('zerux/cleanup-ownership')
  );
  for (const config of [light, strict]) {
    assert.ok(
      !rules("'use client'; import 'zlocale/zyro';", config).includes(
        'zerux/client-server-import'
      )
    );
  }
});

test('framework ownership and server subpaths follow implemented lifecycle boundaries', () => {
  // These registrations install cleanup on the explicit generation owner.
  for (const [entry, registration] of [
    ['zeruxjs', 'registerModule'],
    ['zeruxjs', 'registerServiceEndpoints'],
    ['zeruxjs/modules', 'registerModule'],
    ['zeruxjs/service-endpoints', 'registerServiceEndpoints'],
    ['zeruxjs/graphql', 'registerGraphQL'],
  ]) {
    assert.ok(
      !rules(
        `import {${registration}} from '${entry}'; await ${registration}(api, options);`
      ).includes('zerux/cleanup-ownership')
    );
  }
  for (const [entry, factory] of [
    ['zeruxjs', 'createApplicationLifecycle'],
    ['zeruxjs/services', 'initializeRuntimeServices'],
    ['zeruxjs/service-endpoints', 'createServiceClient'],
    ['zeruxjs/renderers', 'createRendererRegistry'],
    ['zeruxjs/protocols', 'createZeruxProtocols'],
    ['zeruxjs/actions', 'createActionRegistry'],
    ['zeruxjs/action-form', 'enhanceActionForm'],
    ['zeruxjs/browser-navigation', 'createBrowserRouter'],
    ['zeruxjs/route-data-cache', 'createRouteDataCache'],
    ['zeruxjs/privacy', 'createPrivacyCoordinator'],
    ['zeruxjs/accessibility', 'bindAccessibleTabs'],
  ]) {
    assert.ok(
      rules(
        `import {${factory}} from '${entry}'; ${factory}(options);`
      ).includes('zerux/cleanup-ownership')
    );
    assert.ok(
      !rules(
        `import {${factory}} from '${entry}'; own(${factory}(options));`
      ).includes('zerux/cleanup-ownership')
    );
  }
  for (const entry of [
    'zeruxjs/privacy',
    'zeruxjs/route-data-cache',
    'zeruxjs/renderers',
    'zeruxjs/protocols',
    'zeruxjs/response',
    'zeruxjs/fetch-route',
    'zeruxjs/cache',
    'zeruxjs/loader',
  ]) {
    assert.ok(
      rules(`'use client'; import '${entry}';`).includes(
        'zerux/client-server-import'
      )
    );
  }
  for (const entry of [
    'zeruxjs/action-form',
    'zeruxjs/browser-navigation',
    'zeruxjs/navigation-manifest',
    'zeruxjs/navigation',
    'zeruxjs/theme',
    'zeruxjs/variables',
    'zeruxjs/accessibility',
  ]) {
    assert.ok(
      !rules(`'use client'; import '${entry}';`).includes(
        'zerux/client-server-import'
      )
    );
  }
  assert.ok(
    !rules(
      "import {createTransactionalOutbox} from 'zeruxjs/service-endpoints'; createTransactionalOutbox(db, writer);"
    ).includes('zerux/cleanup-ownership')
  );
  assert.ok(
    !rules(
      "import {createRenderAssets,createZyroRenderer} from 'zeruxjs/renderers'; createRenderAssets(manifest); createZyroRenderer(render);"
    ).includes('zerux/cleanup-ownership')
  );
});

test('devtools scopes own cleanup while inert module definitions and legacy registration stay distinct', () => {
  for (const [entry, factory] of [
    ['zforge/modules', 'createDevtoolsModuleHost'],
    ['zforge/diagnostics', 'createRequestDiagnostics'],
  ]) {
    assert.ok(
      rules(
        `import {${factory}} from '${entry}'; ${factory}(options);`
      ).includes('zerux/cleanup-ownership')
    );
    assert.ok(
      !rules(
        `import {${factory}} from '${entry}'; own(${factory}(options));`
      ).includes('zerux/cleanup-ownership')
    );
  }
  for (const entry of [
    'zforge',
    'zforge/modules',
    'zforge/diagnostics',
    'zforge/experiments',
  ]) {
    assert.ok(
      rules(`'use client'; import '${entry}';`).includes(
        'zerux/client-server-import'
      )
    );
  }
  for (const source of [
    "import {defineTransportDevtoolsModule} from 'zforge/modules'; defineTransportDevtoolsModule(definition);",
    "import {createExperimentInspectionModule} from 'zforge/experiments'; createExperimentInspectionModule(options);",
    "import {registerSharedDevApp,createDevtoolsApiClient} from 'zforge'; await registerSharedDevApp(options); createDevtoolsApiClient(options);",
  ]) {
    assert.ok(!rules(source).includes('zerux/cleanup-ownership'));
  }
});

test('hosting child scopes require retained handles while inert registries do not acquire transports', () => {
  for (const factory of [
    'launchSupervisedCommand',
    'launchManagedApplication',
    'launchRollingApplication',
    'launchInstanceFleet',
  ]) {
    assert.ok(
      rules(
        `import {${factory}} from 'zhost'; ${factory}(command, options);`
      ).includes('zerux/cleanup-ownership')
    );
    assert.ok(
      !rules(
        `import {${factory}} from 'zhost'; const owned = await ${factory}(command, options);`
      ).includes('zerux/cleanup-ownership')
    );
  }
  for (const source of [
    "import {createDevelopmentWatchIgnore, createRuntimeStatusWriter} from 'zhost'; createDevelopmentWatchIgnore(paths); createRuntimeStatusWriter(directory, name);",
    "import {createJsonRpcRouter, createConnectRouter, createTrpcRouter, createConnectStreamRouter, createWebTransportRouter} from 'zhost/protocols'; createJsonRpcRouter(); createConnectRouter(); createTrpcRouter(); createConnectStreamRouter(); createWebTransportRouter();",
    "import {createSseHub} from 'zhost/protocols'; createSseHub();",
    "import {createCompressionOwner} from 'zhost/compression'; createCompressionOwner();",
  ]) {
    assert.ok(!rules(source).includes('zerux/cleanup-ownership'));
  }
  for (const entry of ['zhost', 'zhost/protocols', 'zhost/compression']) {
    assert.ok(
      rules(`'use client'; import '${entry}';`).includes(
        'zerux/client-server-import'
      )
    );
  }
});

test('test fixture resource owners retain handles while self-scoped runners and exporters stay inert', () => {
  for (const [entry, factory] of [
    ['ztrial', 'createHttpFake'],
    ['ztrial/http', 'createHttpFake'],
    ['ztrial/jsdom', 'createJsdomEnvironment'],
    ['ztrial/experiments', 'createExperimentEvaluator'],
  ]) {
    assert.ok(
      rules(
        `import {${factory}} from '${entry}'; ${factory}(options);`
      ).includes('zerux/cleanup-ownership')
    );
    assert.ok(
      !rules(
        `import {${factory}} from '${entry}'; const owned = await ${factory}(options);`
      ).includes('zerux/cleanup-ownership')
    );
  }
  for (const source of [
    "import {createRunner,createTestClock,withHttpFake} from 'ztrial'; createRunner(); createTestClock(); await withHttpFake(options, run);",
    "import {createBrowserRunner} from 'ztrial/playwright'; createBrowserRunner(options);",
    "import {createReportExporters,createPdfExporter} from 'ztrial/reports'; createReportExporters(); createPdfExporter(options);",
  ]) {
    assert.ok(!rules(source).includes('zerux/cleanup-ownership'));
  }
  for (const entry of [
    'ztrial',
    'ztrial/http',
    'ztrial/reports',
    'ztrial/experiments',
    'ztrial/playwright',
    'ztrial/vitest',
  ]) {
    assert.ok(
      rules(`'use client'; import '${entry}';`).includes(
        'zerux/client-server-import'
      )
    );
  }
  assert.ok(
    !rules("'use client'; import {requireDom} from 'ztrial/jsdom';").includes(
      'zerux/client-server-import'
    )
  );
});
