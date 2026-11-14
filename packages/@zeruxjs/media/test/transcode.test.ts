import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createMediaTranscoder } from '../dist/transcode.js';
/** Synthetic explicit payload bytes; no real tenant content or remote files are used. */
const bytes = new Uint8Array([1, 2, 3]);
/** Expected synthetic payload SHA-256, not proof of permission. */
const sha256 = createHash('sha256').update(bytes).digest('hex');
/** Synthetic server-verified initiating tenant/subject used by the host policy. */
const identity = { tenant: 'tenant', subject: 'user' };
/** Explicit small fixture CPU/time/byte/file quotas; native enforcement is simulated. */
const quotas = {
  maxInputBytes: 100,
  maxOutputBytes: 100,
  maxCpuMs: 100,
  maxWallMs: 100,
  maxMemoryBytes: 1024,
  maxFiles: 2,
};
/** Create isolated synthetic dependency/DOM/job state; the caller or callback owns documented teardown.
 * @param {object} extra - Explicit injected fixture overrides; never untrusted executable source.
 * @returns {unknown} Fixture-owned result or explicit simulated failure; no live-provider guarantee.
 */
function fixture(extra = {}) {
  let creates = 0,
    disposed = 0,
    terminated = 0;
  /** Injected isolated-job fixture contract; no encoder/process isolation acceptance is claimed. */
  const executor = {
    isolation: 'process',
    network: 'disabled',
    filesystem: 'job-private',
    privilege: 'unprivileged',
    hardLimits: { cpu: true, memory: true, files: true },
    supportedPresets: ['webm-opus'],
    /** Create a simulated isolated job for one validated fixed preset; no real encoder executes.
     * @param {object} input - Frozen fixed-preset/quota fixture request.
     * @returns {Promise<unknown>} Fixture-owned result or explicit simulated failure; no live-provider guarantee.
     */
    async create(input) {
      creates++;
      assert.equal(input.preset, 'webm-opus');
      return {
        /** Simulate the declared encoder output/counters or held deadline behavior.
         * @returns {Promise<unknown>} Fixture-owned result or explicit simulated failure; no live-provider guarantee.
         */
        async run() {
          return {
            output: (async function* () {
              yield bytes;
            })(),
            cpuMs: 1,
            peakMemoryBytes: 100,
            filesCreated: 2,
          };
        },
        /** Record simulated native termination and release any held fixture work.
         * @returns {Promise<unknown>} Fixture-owned result or explicit simulated failure; no live-provider guarantee.
         */
        async terminate() {
          terminated++;
        },
        /** Record cleanup of simulated staged input/output artifacts.
         * @returns {Promise<unknown>} Fixture-owned result or explicit simulated failure; no live-provider guarantee.
         */
        async dispose() {
          disposed++;
        },
      };
    },
    ...extra,
  };
  return {
    executor,
    get creates() {
      return creates;
    },
    get disposed() {
      return disposed;
    },
    get terminated() {
      return terminated;
    },
  };
}
test('fixed preset transcoding validates identity/hash/quotas and disposes successful output without URLs or commands', async () => {
  /** Owned isolated fixture handles; teardown must release native/emulated resources. */
  const f = fixture();
  /** Fixture-local diagnostic/progress records; never shared between test cases. */
  const events = [];
  /** Owned coordinator drained after simulated job termination/disposal. */
  const transcoder = createMediaTranscoder({
    executor: f.executor,
    presets: ['webm-opus'],
    quotas,
    authorize: () => true,
    onEvent: (e) => events.push(e),
  });
  try {
    /** Observed bounded operation outcome compared with explicit fixture expectations. */
    const result = await transcoder.transcode(identity, {
      preset: 'webm-opus',
      bytes,
      sha256,
    });
    assert.equal(result.sha256, sha256);
    assert.equal(result.contentType, 'audio/webm; codecs="opus"');
    assert.equal(f.disposed, 1);
    assert.equal(f.terminated, 0);
    assert.deepEqual(events, [{ preset: 'webm-opus', status: 'complete' }]);
    await assert.rejects(
      transcoder.transcode(identity, {
        preset: 'arbitrary --command /path',
        bytes,
        sha256,
      })
    );
    assert.equal(events.length, 1);
    await assert.rejects(
      transcoder.transcode(identity, {
        preset: 'webm-opus',
        bytes,
        sha256: '0'.repeat(64),
      }),
      { code: 'TRANSCODE_INTEGRITY' }
    );
    assert.equal(f.creates, 1);
  } finally {
    await transcoder.close();
  }
});
test('denied/missing isolator, dependency failure and oversized output never expose partial bytes and clean jobs', async () => {
  /** Owned isolated fixture handles; teardown must release native/emulated resources. */
  const f = fixture();
  assert.throws(
    () =>
      createMediaTranscoder({
        executor: { ...f.executor, isolation: 'in-process' },
        presets: ['webm-opus'],
        quotas,
        authorize: () => true,
      }),
    /isolated/
  );
  /** Deliberately unauthorized fixture principal/client; denial must occur before exposure. */
  const denied = createMediaTranscoder({
    executor: f.executor,
    presets: ['webm-opus'],
    quotas,
    authorize: () => false,
  });
  try {
    await assert.rejects(
      denied.transcode(identity, { preset: 'webm-opus', bytes, sha256 }),
      { code: 'TRANSCODE_FORBIDDEN' }
    );
    assert.equal(f.creates, 0);
  } finally {
    await denied.close();
  }
  let disposed = 0,
    terminated = 0;
  // Exercise the fixed synthetic cases or release only handles owned by this fixture.
  for (const run of [
    async () => {
      throw new Error('PRIVATE_CODEC_STDERR');
    },
    async () => ({
      output: (async function* () {
        yield new Uint8Array(101);
      })(),
      cpuMs: 1,
      peakMemoryBytes: 1,
      filesCreated: 1,
    }),
  ]) {
    /** Injected isolated-job fixture contract; no encoder/process isolation acceptance is claimed. */
    const executor = {
      ...f.executor,
      create: async () => ({
        run,
        terminate: async () => {
          terminated++;
        },
        dispose: async () => {
          disposed++;
        },
      }),
    };
    /** Owned coordinator drained after simulated job termination/disposal. */
    const transcoder = createMediaTranscoder({
      executor,
      presets: ['webm-opus'],
      quotas,
      authorize: () => true,
    });
    try {
      await assert.rejects(
        transcoder.transcode(identity, { preset: 'webm-opus', bytes, sha256 }),
        (error) => !error.message.includes('PRIVATE')
      );
    } finally {
      await transcoder.close();
    }
  }
  assert.equal(disposed, 2);
  assert.equal(terminated, 2);
});
test('deadline/cancellation retains slots until process termination and disposal actually settle', async () => {
  /** Owned isolated fixture handles; teardown must release native/emulated resources. */
  const f = fixture();
  let finish,
    terminated = 0,
    disposed = 0;
  /** Injected isolated-job fixture contract; no encoder/process isolation acceptance is claimed. */
  const executor = {
    ...f.executor,
    create: async () => ({
      run: () =>
        new Promise((resolve) => {
          finish = () =>
            resolve({
              output: (async function* () {
                yield bytes;
              })(),
              cpuMs: 1,
              peakMemoryBytes: 1,
              filesCreated: 1,
            });
        }),
      terminate: async () => {
        terminated++;
        await new Promise((r) => setTimeout(r, 5));
        finish();
      },
      dispose: async () => {
        disposed++;
      },
    }),
  };
  /** Owned coordinator drained after simulated job termination/disposal. */
  const transcoder = createMediaTranscoder({
    executor,
    presets: ['webm-opus'],
    quotas: { ...quotas, maxWallMs: 10 },
    authorize: () => true,
  });
  /** Admitted fixture operation retained until its actual settlement is observed. */
  const work = transcoder.transcode(identity, {
    preset: 'webm-opus',
    bytes,
    sha256,
  });
  try {
    await assert.rejects(
      transcoder.transcode(identity, { preset: 'webm-opus', bytes, sha256 }),
      { code: 'TRANSCODER_BUSY' }
    );
    await assert.rejects(work, { code: 'TRANSCODE_DEADLINE' });
    assert.equal(terminated, 1);
    assert.equal(disposed, 1);
    await transcoder.close();
    await assert.rejects(
      transcoder.transcode(identity, { preset: 'webm-opus', bytes, sha256 }),
      { code: 'TRANSCODER_CLOSED' }
    );
  } finally {
    await transcoder.close();
    await Promise.allSettled([work]);
  }
});
test('cleanup failure is surfaced and never reports completed output; codec arguments/paths reject before execution', async () => {
  /** Owned isolated fixture handles; teardown must release native/emulated resources. */
  const f = fixture();
  /** Fixture-local diagnostic/progress records; never shared between test cases. */
  const events = [];
  /** Owned coordinator drained after simulated job termination/disposal. */
  const transcoder = createMediaTranscoder({
    executor: {
      ...f.executor,
      create: async () => ({
        run: async () => ({
          output: (async function* () {
            yield bytes;
          })(),
          cpuMs: 1,
          peakMemoryBytes: 1,
          filesCreated: 1,
        }),
        terminate: async () => {},
        dispose: async () => {
          throw new Error('private temporary path');
        },
      }),
    },
    presets: ['webm-opus'],
    quotas,
    authorize: () => true,
    onEvent: (e) => events.push(e),
  });
  try {
    await assert.rejects(
      transcoder.transcode(identity, { preset: 'webm-opus', bytes, sha256 }),
      { code: 'TRANSCODE_CLEANUP_FAILED' }
    );
    assert.equal(events[0].status, 'failed');
    await assert.rejects(
      transcoder.transcode(identity, {
        preset: 'webm-opus',
        bytes,
        sha256,
        path: '../outside',
        args: ['-anything'],
      }),
      { code: 'TRANSCODE_INPUT' }
    );
  } finally {
    await transcoder.close();
  }
});
