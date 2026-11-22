import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  configurePublisher,
  parseSelectedPublish,
  publishSelected,
  verifiedPublisher,
  matchesPublisher,
  TRUST_PERMISSIONS,
  TRUST_REPOSITORY,
  TRUST_WORKFLOW,
  type ReleaseOperations,
  type SelectedPackage,
  type RegistryIdentity,
} from './selected-publish.ts';
import { validateNpmChallenge } from './npm-publish-session.ts';
import { releaseProcess } from './publish-selected.ts';
import { npmCommand } from './npm-command.ts';

/** Synthetic identity never reaches the live npm registry. */
const item: SelectedPackage = {
  name: '@fixture/docs',
  version: '1.0.0',
  dir: '/synthetic/package',
};
/** Create virtual-clock dependencies that record every intended side effect.
 * @param {(number)=>RegistryIdentity|undefined|Promise<RegistryIdentity|undefined>} lookup - Synthetic response for each public metadata read.
 * @returns {object} Injected operations and observable effects; owns no network/socket.
 */
function operations(
  lookup: (
    count: number
  ) => RegistryIdentity | undefined | Promise<RegistryIdentity | undefined>
) {
  let clock = 0;
  let reads = 0;
  /** Operational effects allow assertions about order, replay and cleanup. */
  const effects: string[] = [];
  /** Millisecond intervals are recorded rather than sleeping in tests. */
  const waits: number[] = [];
  /** Host boundary simulation preserves the same async contract as real npm operations. */
  const ops: ReleaseOperations = {
    build: async () => {
      effects.push('build');
    },
    lookup: async () => {
      effects.push('lookup');
      return lookup(++reads);
    },
    pack: async () => {
      effects.push('pack');
      return { file: '/private/package.tgz', integrity: 'sha512-expected' };
    },
    publish: async () => {
      effects.push('publish');
      return true;
    },
    trust: async () => {
      effects.push('trust');
    },
    wait: async (milliseconds) => {
      waits.push(milliseconds);
      clock += milliseconds;
    },
    now: () => clock,
    log: () => {},
  };
  return { ops, effects, waits };
}

test('repeatable exact names deduplicate, deadlines bound and unknown selectors reject', () => {
  assert.deepEqual(
    parseSelectedPublish([
      '-p',
      '@fixture/docs',
      '-p',
      'zuixs',
      '--package',
      'zuixs',
    ]).names,
    ['@fixture/docs', 'zuixs']
  );
  assert.equal(parseSelectedPublish(['--help']).help, true);
  for (const args of [
    [],
    ['-p'],
    ['-p', '../escape'],
    ['-p', 'name@latest'],
    ['--all'],
    ['-p', 'name', '--timeout-ms', 'Infinity'],
    ['-p', 'name', '--timeout-ms', '0'],
  ]) {
    assert.throws(() => parseSelectedPublish(args));
  }
});

test('build precedes packing, one upload polls every 15 seconds and trust follows exact integrity', async () => {
  /** First read misses; two propagation reads miss before the exact archive appears. */
  const fixture = operations((count) =>
    count < 4
      ? undefined
      : { name: item.name, version: item.version, integrity: 'sha512-expected' }
  );
  await publishSelected(
    [item],
    fixture.ops,
    new AbortController().signal,
    60_000
  );
  assert.deepEqual(fixture.waits, [15_000, 15_000]);
  assert.deepEqual(fixture.effects, [
    'build',
    'lookup',
    'pack',
    'publish',
    'lookup',
    'lookup',
    'lookup',
    'trust',
  ]);
});

test('uncertain upload and transient reads never replay uploads; wrong archive blocks trust', async () => {
  /** Lost confirmation does not mean the registry rejected the immutable archive. */
  const fixture = operations((count) => {
    if (count === 2) {
      throw new Error('temporary outage');
    }
    return count < 3
      ? undefined
      : {
          name: item.name,
          version: item.version,
          integrity: 'sha512-expected',
        };
  });
  fixture.ops.publish = async () => {
    fixture.effects.push('publish');
    return false;
  };
  await publishSelected(
    [item],
    fixture.ops,
    new AbortController().signal,
    60_000
  );
  assert.equal(
    fixture.effects.filter((effect) => effect === 'publish').length,
    1
  );
  assert.equal(fixture.effects.at(-1), 'trust');
  /** An existing archive from another publisher cannot be mistaken for this upload. */
  const mismatch = operations((count) =>
    count === 1
      ? undefined
      : { name: item.name, version: item.version, integrity: 'sha512-wrong' }
  );
  await assert.rejects(
    publishSelected([item], mismatch.ops, new AbortController().signal, 60_000),
    /integrity mismatch/
  );
  assert.ok(!mismatch.effects.includes('trust'));
});

test('existing versions skip upload; build failure and initial registry outage prevent writes', async () => {
  /** Immutable existing versions can still acquire verified future trusted publishing. */
  const fixture = operations(() => ({
    name: item.name,
    version: item.version,
  }));
  await publishSelected(
    [item],
    fixture.ops,
    new AbortController().signal,
    30_000
  );
  assert.deepEqual(fixture.effects, ['build', 'lookup', 'trust']);
  /** No publication follows an unqualified build. */
  const failed = operations(() => undefined);
  failed.ops.build = async () => {
    throw new Error('build failed');
  };
  await assert.rejects(
    publishSelected([item], failed.ops, new AbortController().signal, 30_000),
    /build failed/
  );
  assert.deepEqual(failed.effects, []);
  /** A network error must never be interpreted as an unreserved version. */
  const outage = operations(() => {
    throw new Error('registry offline');
  });
  await assert.rejects(
    publishSelected([item], outage.ops, new AbortController().signal, 30_000),
    /offline/
  );
  assert.deepEqual(outage.effects, ['build', 'lookup']);
});

test('finite propagation timeout, cancelled waits and trust failure stop later packages', async () => {
  /** Permanent missing visibility is bounded and must not create a publisher. */
  const timeout = operations(() => undefined);
  await assert.rejects(
    publishSelected([item], timeout.ops, new AbortController().signal, 30_000),
    /unconfirmed/
  );
  assert.equal(
    timeout.effects.filter((effect) => effect === 'publish').length,
    1
  );
  assert.ok(!timeout.effects.includes('trust'));
  /** Cancellation interrupts polling without another upload or trust write. */
  const controller = new AbortController();
  /** Virtual work aborts at the first waiting boundary. */
  const cancelled = operations(() => undefined);
  cancelled.ops.wait = async () => {
    controller.abort(new Error('operator interrupted'));
  };
  await assert.rejects(
    publishSelected([item], cancelled.ops, controller.signal, 30_000),
    /interrupted/
  );
  assert.ok(!cancelled.effects.includes('trust'));
  /** A trust error reports partial completion rather than silently continuing. */
  const denied = operations(() => ({ name: item.name, version: item.version }));
  denied.ops.trust = async () => {
    throw new Error('permission denied');
  };
  await assert.rejects(
    publishSelected(
      [item, { ...item, name: 'second' }],
      denied.ops,
      new AbortController().signal,
      30_000
    ),
    /permission denied/
  );
  assert.equal(
    denied.effects.filter((effect) => effect === 'lookup').length,
    1
  );
});

test('publisher identity and each permission are checked independently from browser approvals', () => {
  /** Public registry data contains only fixed source identity and capabilities. */
  const valid = {
    type: 'github',
    claims: {
      repository: TRUST_REPOSITORY,
      workflow_ref: { file: TRUST_WORKFLOW },
    },
    permissions: [...TRUST_PERMISSIONS],
  };
  assert.ok(verifiedPublisher(valid));
  for (const permission of TRUST_PERMISSIONS) {
    assert.equal(
      verifiedPublisher({
        ...valid,
        permissions: valid.permissions.filter((value) => value !== permission),
      }),
      false
    );
  }
  assert.equal(
    verifiedPublisher({
      ...valid,
      claims: { ...valid.claims, environment: 'production' },
    }),
    false
  );
  assert.equal(
    matchesPublisher({
      ...valid,
      claims: { ...valid.claims, repository: 'attacker/repository' },
    }),
    false
  );
  assert.equal(
    matchesPublisher({
      ...valid,
      claims: { ...valid.claims, workflow_ref: { file: 'other.yml' } },
    }),
    false
  );
});

test('browser challenges require both official npm origins and completion paths', () => {
  validateNpmChallenge({
    body: {
      authUrl: 'https://www.npmjs.com/auth/cli/approved',
      doneUrl: 'https://registry.npmjs.org/-/v1/done?authId=fixture',
    },
  });
  for (const body of [
    {
      authUrl: 'https://attacker.test/auth/cli/a',
      doneUrl: 'https://registry.npmjs.org/-/v1/done',
    },
    {
      authUrl: 'https://www.npmjs.com/auth/cli/a',
      doneUrl: 'http://registry.npmjs.org/-/v1/done',
    },
    {
      authUrl: 'https://www.npmjs.com/auth/cli/a',
      doneUrl: 'https://registry.npmjs.org/private',
    },
  ]) {
    assert.throws(() => validateNpmChallenge({ body }));
  }
});

test('owned subprocesses close on cancellation and do not interpret shell arguments', async () => {
  /** Private fixture owns no package or registry credentials. */
  const directory = await mkdtemp(path.join(tmpdir(), 'zerux-publish-test-'));
  try {
    /** Literal metacharacters must be returned as data by a native Node child. */
    const result = await releaseProcess(
      process.execPath,
      ['-e', 'process.stdout.write(process.argv[1])', '$(not-a-command)'],
      directory,
      new AbortController().signal,
      true,
      5000
    );
    assert.equal(result.code, 0);
    assert.equal(result.output, '$(not-a-command)');
    /** Signal cancellation closes the actual child and clears its deadline. */
    const controller = new AbortController();
    /** Native child has no external side effects beyond an owned idle timer. */
    const pending = releaseProcess(
      process.execPath,
      ['-e', 'setInterval(()=>{},1000)'],
      directory,
      controller.signal,
      true,
      5000
    );
    controller.abort(new Error('cancel child'));
    await assert.rejects(pending, /cancel child/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('publisher creation is read back and existing insufficient connections are never revoked', async () => {
  /** Fixed trusted-publisher record returned by the synthetic registry only. */
  const valid = {
    type: 'github',
    claims: {
      repository: TRUST_REPOSITORY,
      workflow_ref: { file: TRUST_WORKFLOW },
    },
    permissions: [...TRUST_PERMISSIONS],
  };
  /** Record request methods to prove there is no delete or automatic replay. */
  const methods: string[] = [];
  await configurePublisher(async (method, body) => {
    methods.push(method);
    if (method === 'POST') {
      assert.deepEqual(body, [valid]);
      return [valid];
    }
    return methods.length === 1 ? [] : [valid];
  });
  assert.deepEqual(methods, ['GET', 'POST', 'GET']);
  methods.length = 0;
  await configurePublisher(async (method) => {
    methods.push(method);
    return [valid];
  });
  assert.deepEqual(methods, ['GET']);
  methods.length = 0;
  await assert.rejects(
    configurePublisher(async (method) => {
      methods.push(method);
      return [{ ...valid, permissions: ['createPackage'] }];
    }),
    /No existing publisher was revoked/
  );
  assert.deepEqual(methods, ['GET']);
  /** Even a 200 POST response cannot replace a subsequent independent permission read. */
  let reads = 0;
  await assert.rejects(
    configurePublisher(async (method) => {
      if (method === 'POST') {
        return [valid];
      }
      return ++reads === 1
        ? []
        : [{ ...valid, permissions: ['createPackage'] }];
    }),
    /verification failed/
  );
  methods.length = 0;
  await assert.rejects(
    configurePublisher(async (method) => {
      methods.push(method);
      if (method === 'POST') {
        throw new Error('lost acknowledgement');
      }
      return [];
    }),
    /lost acknowledgement/
  );
  assert.deepEqual(methods, ['GET', 'POST']);
});

test('actual CLI dry-run resolves npm names without building and noninteractive writes reject', async () => {
  /** Repository source root; the CLI owns no temporary files in dry-run/help mode. */
  const root = fileURLToPath(new URL('../', import.meta.url));
  /** Actual command entry exercises npm-name versus filesystem-name compatibility. */
  const script = fileURLToPath(
    new URL('./publish-selected.ts', import.meta.url)
  );
  /** Public selections remain a plan; the real builder/publisher are never invoked. */
  const plan = await releaseProcess(
    process.execPath,
    [
      '--experimental-strip-types',
      script,
      '-p',
      '@zeruxjs/docs',
      '-p',
      '@zeruxjs/db-sqlite',
      '--dry-run',
    ],
    root,
    new AbortController().signal,
    true,
    10_000
  );
  assert.equal(plan.code, 0);
  assert.match(plan.output, /Plan: build [0-9]+ packages/);
  assert.match(plan.output, /@zeruxjs\/db-sqlite@/);
  /** Captured stdout is intentionally not a TTY; release writes must fail before build/authentication. */
  const denied = await releaseProcess(
    process.execPath,
    ['--experimental-strip-types', script, '-p', '@zeruxjs/docs'],
    root,
    new AbortController().signal,
    true,
    10_000
  );
  assert.equal(denied.code, 1);
});

test('installed npm browser-OTP helper resumes the challenged operation with a synthetic receipt', async () => {
  /** npm's installed bundle is the sole dependency owner for this isolated child. */
  const cli = npmCommand([]).args[0];
  assert.ok(cli);
  /** All authentication transport/opening is replaced before the native helper loads. No registry request occurs. */
  const source = `
    const assert = require('node:assert/strict');
    const path = require('node:path');
    const {createRequire} = require('node:module');
    const npmRequire = createRequire(process.argv[1]);
    const root = path.dirname(path.dirname(process.argv[1]));
    const profile = npmRequire('npm-profile');
    let prompts = 0;
    profile.webAuthOpener = async () => {
      prompts++;
      return {token: 'synthetic-proof'};
    };
    Object.defineProperty(process.stdin, 'isTTY', {value: true});
    Object.defineProperty(process.stdout, 'isTTY', {value: true});
    const {otplease} = npmRequire(path.join(root, 'lib/utils/auth.js'));
    let attempts = 0;
    otplease({}, {}, async options => {
      attempts++;
      if (!options.otp) {
        throw Object.assign(new Error('synthetic challenge'), {
          code: 'EOTP',
          body: {
            authUrl: 'https://www.npmjs.com/auth/cli/synthetic',
            doneUrl: 'https://registry.npmjs.org/-/v1/done?authId=synthetic'
          }
        });
      }
      assert.equal(options.otp, 'synthetic-proof');
      return 'verified';
    }).then(result => {
      assert.equal(result, 'verified');
      assert.equal(prompts, 1);
      assert.equal(attempts, 2);
      process.stdout.write('native browser challenge branch: PASS');
    }).catch(() => {process.exitCode = 1;});
  `;
  /** Real child execution validates native callback ownership without reading account credentials. */
  const result = await releaseProcess(
    process.execPath,
    ['-e', source, cli],
    fileURLToPath(new URL('../', import.meta.url)),
    new AbortController().signal,
    true,
    10_000
  );
  assert.equal(result.code, 0);
  assert.match(result.output, /native browser challenge branch: PASS/);
});
