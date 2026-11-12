import { createHash } from 'node:crypto';
/** Fixed codec/container metadata; actual playback depends on client support and a qualified encoder. */
export const mediaTranscodePresets = Object.freeze({
  'mp4-h264-aac': Object.freeze({
    contentType: 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',
    extension: 'mp4',
  }),
  'webm-vp9-opus': Object.freeze({
    contentType: 'video/webm; codecs="vp9, opus"',
    extension: 'webm',
  }),
  'webm-opus': Object.freeze({
    contentType: 'audio/webm; codecs="opus"',
    extension: 'webm',
  }),
});
export type MediaTranscodePreset = keyof typeof mediaTranscodePresets;
export interface TranscodeQuotas {
  /** Positive input ceiling, at most 64 MiB; explicit host policy required. */
  maxInputBytes: number;
  /** Positive buffered output ceiling, at most 64 MiB. */
  maxOutputBytes: number;
  /** Positive executor CPU ceiling, at most 120000 ms; host hard enforcement required. */
  maxCpuMs: number;
  /** Positive elapsed deadline, at most 300000 ms; cancellation initiates executor termination. */
  maxWallMs: number;
  /** Positive native memory ceiling, at most 2 GiB; host hard enforcement required. */
  maxMemoryBytes: number;
  /** Positive staged-file ceiling, at most 16; host hard enforcement required. */
  maxFiles: number;
}
export interface IsolatedMediaJob {
  /** Execute/reap the fixed-preset isolated job and expose its completed staged output. The host executor must enforce hard quotas, no network and private paths.
   * @param {Uint8Array} bytes - Verified bounded input bytes; never executable command text.
   * @param {AbortSignal} signal - Cooperative cancellation signal; executor termination must settle native work.
   * @returns {Promise<object>} Output iterator and measured resource counters after encoder settlement.
   */
  run(
    bytes: Uint8Array,
    signal: AbortSignal
  ): Promise<{
    /** Completed staged byte iterator; never a path, URL or codec command. */
    output: AsyncIterable<Uint8Array>;
    /** Measured completed CPU milliseconds, checked against configured quota. */
    cpuMs: number;
    /** Measured native peak memory bytes, checked against configured quota. */
    peakMemoryBytes: number;
    /** Measured created file count, checked against configured quota. */
    filesCreated: number;
  }>;
  /** Terminate and reap only this owned isolated job, settling run/output work.
   * @returns {Promise<void>} Resolves after native termination; failure remains explicit.
   */
  terminate(): Promise<void>;
  /** Remove all owned temporary inputs/outputs, including failed artifacts. The coordinator calls this exactly once for a created valid job.
   * @returns {Promise<void>} Resolves after cleanup; failure prevents successful output exposure.
   */
  dispose(): Promise<void>;
}
export interface IsolatedMediaExecutor {
  /** Host-qualified native isolation boundary; declaration alone does not implement it. */
  readonly isolation: 'process' | 'container';
  /** Executor must deny network access. */
  readonly network: 'disabled';
  /** Executor must isolate all files to the owned job namespace. */
  readonly filesystem: 'job-private';
  /** Executor must run with unprivileged credentials. */
  readonly privilege: 'unprivileged';
  /** Required native hard enforcement declarations; the host qualifies their implementation. */
  readonly hardLimits: { cpu: true; memory: true; files: true };
  /** Explicit executor-supported subset of the fixed registered presets. */
  readonly supportedPresets: readonly MediaTranscodePreset[];
  /** Create an isolated job for an allowlisted preset and fixed quotas. No caller paths, codec flags or shell commands are accepted.
   * @param {object} input - Frozen preset/quota snapshot from the coordinator.
   * @param {MediaTranscodePreset} input.preset - Allowlisted fixed preset.
   * @param {Readonly<TranscodeQuotas>} input.quotas - Frozen explicit native quotas.
   * @returns {Promise<IsolatedMediaJob>} Owned isolated job whose termination/disposal remain mandatory.
   */
  create(
    input: Readonly<{
      /** One allowlisted fixed preset; no arbitrary codec arguments. */
      preset: MediaTranscodePreset;
      /** Frozen explicit resource quotas for this job. */
      quotas: Readonly<TranscodeQuotas>;
    }>
  ): Promise<IsolatedMediaJob>;
}
export interface MediaTranscoderOptions {
  /** Borrowed host-qualified executor; individual jobs are owned by the coordinator. */
  executor: IsolatedMediaExecutor;
  /** Nonempty unique configured preset subset, maximum three. */
  presets: readonly MediaTranscodePreset[];
  /** Frozen explicit resource quotas for this job. */
  quotas: TranscodeQuotas;
  /** Process-local active job ceiling, default one and at most four. */
  maxPending?: number;
  /** Required fresh host permission callback; only literal true permits execution. */
  authorize: (
    identity: {
      /** Server-verified tenant identifier, never trusted directly from a browser. */
      tenant: string;
      /** Server-verified initiating principal identifier. */
      subject: string;
    },
    preset: MediaTranscodePreset
  ) => boolean | Promise<boolean>;
  /** Fixed status/preset labels only; never input bytes, URLs, paths or codec stderr. */
  onEvent?: (
    event: Readonly<{
      /** One allowlisted fixed preset; no arbitrary codec arguments. */
      preset: MediaTranscodePreset;
      /** Fixed terminal label without private content. */
      status: 'complete' | 'failed' | 'cancelled';
    }>
  ) => void;
}
/** Fixed public failure code with an optional private cause retained through ErrorOptions. */
export class MediaTranscodeError extends Error {
  /** Retain a fixed public failure code with an optional private cause; diagnostics must not serialize codec stderr, paths or bytes.
   * @param {string} code - Stable failure code without user content.
   * @param {ErrorOptions} options - Optional internal error cause; host logging must redact it.
   */
  constructor(
    readonly code: string,
    options?: ErrorOptions
  ) {
    super(code.toLowerCase().replaceAll('_', ' '), options);
    this.name = 'MediaTranscodeError';
  }
}
/** Construct a stable public failure with an optional private underlying cause.
 * @param {string} code - Fixed public failure code.
 * @param {unknown} [cause] - Private original cause, never safe to serialize indiscriminately.
 * @returns {MediaTranscodeError} Error retaining the internal cause separately.
 */
const fail = (code: string, cause?: unknown) =>
  new MediaTranscodeError(code, cause === undefined ? undefined : { cause });
/** Own bounded fixed-preset coordination over a host-qualified isolated executor. Capability declarations are required contracts, not proof of OS isolation; no encoder is bundled.
 * @param {MediaTranscoderOptions} options - Explicit executor, allowlisted presets, quotas and verified-identity authorization.
 * @returns {object} Transcode/capability operations and an awaited close that aborts then drains actual settlement.
 */
export function createMediaTranscoder(options: MediaTranscoderOptions) {
  if (
    !options ||
    !options.executor ||
    !['process', 'container'].includes(options.executor.isolation) ||
    options.executor.network !== 'disabled' ||
    options.executor.filesystem !== 'job-private' ||
    options.executor.privilege !== 'unprivileged' ||
    options.executor.hardLimits?.cpu !== true ||
    options.executor.hardLimits.memory !== true ||
    options.executor.hardLimits.files !== true ||
    typeof options.executor.create !== 'function' ||
    !Array.isArray(options.executor.supportedPresets) ||
    options.executor.supportedPresets.length > 3 ||
    typeof options.authorize !== 'function' ||
    !Array.isArray(options.presets) ||
    !options.presets.length ||
    options.presets.length > 3 ||
    new Set(options.presets).size !== options.presets.length ||
    options.presets.some(
      (p) =>
        !Object.hasOwn(mediaTranscodePresets, p) ||
        !options.executor.supportedPresets.includes(p)
    )
  ) {
    throw new TypeError(
      'Configured isolated executor and fixed presets required'
    );
  }
  /** Copied explicit host quotas, validated against hard coordinator ceilings. */
  const quotas = { ...options.quotas };
  /** Copied allowlist of unique presets supported by both registry and executor. */
  const presets = [...options.presets];
  /** Validated process-local admitted-job ceiling, default one and maximum four. */
  const maxPending = options.maxPending ?? 1;
  /** Coordinator maximum quota values; native resource enforcement still belongs to the executor. */
  const caps: TranscodeQuotas = {
    maxInputBytes: 64 * 1024 * 1024,
    maxOutputBytes: 64 * 1024 * 1024,
    maxCpuMs: 120000,
    maxWallMs: 300000,
    maxMemoryBytes: 2 * 1024 * 1024 * 1024,
    maxFiles: 16,
  };
  if (
    Object.keys(quotas).length !== 6 ||
    Object.entries(caps).some(([key, max]) => {
      /** One host-supplied quota checked as a positive safe integer against its ceiling. */
      const value = quotas[key as keyof TranscodeQuotas];
      return !Number.isSafeInteger(value) || value < 1 || value > max;
    }) ||
    !Number.isSafeInteger(maxPending) ||
    maxPending < 1 ||
    maxPending > 4
  ) {
    throw new TypeError('Explicit bounded transcoding quotas required');
  }
  /** Actually unsettled job promises, retained through termination and artifact disposal. */
  const pending = new Set<Promise<unknown>>();
  /** Owned admitted-job cancellation controllers, removed after cleanup settles. */
  const controllers = new Set<AbortController>();
  let closed = false,
    closing: Promise<void> | undefined;
  return {
    /** Snapshot declared isolation, configured presets and quotas without exposing executor internals.
     * @returns {object} Frozen descriptive capability snapshot, not a native isolation certification.
     */
    capabilities() {
      return Object.freeze({
        isolation: options.executor.isolation,
        presets: Object.freeze([...presets]),
        quotas: Object.freeze({ ...quotas }),
      });
    },
    /** Authorize a verified tenant/subject, verify input bytes, then run one fixed preset under finite resource budgets. Never automatically replay an encoder or publish its output.
     * @param {object} identity - Server-verified tenant and initiating subject; syntax alone does not authenticate.
     * @param {string} identity.tenant - Verified tenant identity.
     * @param {string} identity.subject - Verified initiating principal.
     * @param {object} input - Fixed preset, bounded bytes and expected SHA-256.
     * @param {MediaTranscodePreset} input.preset - Allowlisted fixed preset.
     * @param {Uint8Array} input.bytes - Bounded input copied before use.
     * @param {string} input.sha256 - Expected lowercase input digest.
     * @param {AbortSignal} signal - Optional cooperative cancellation; owned executor termination enforces native stop.
     * @returns {Promise<object>} Complete bounded bytes/hash after job cleanup; failure/cancellation retains private causes.
     */
    transcode(
      identity: {
        /** Server-verified tenant identifier, never trusted directly from a browser. */
        tenant: string;
        /** Server-verified initiating principal identifier. */
        subject: string;
      },
      input: {
        /** One allowlisted fixed preset; no arbitrary codec arguments. */
        preset: MediaTranscodePreset;
        /** Bounded input bytes copied before executor use; no source code is evaluated. */
        bytes: Uint8Array;
        /** Expected lowercase SHA-256 checked before encoder invocation; not proof of permission. */
        sha256: string;
      },
      signal?: AbortSignal
    ) {
      if (closed) {
        return Promise.reject(fail('TRANSCODER_CLOSED'));
      }
      if (pending.size >= maxPending) {
        return Promise.reject(fail('TRANSCODER_BUSY'));
      }
      /** Per-job cancellation owner; signals do not prove native work has stopped. */
      const controller = new AbortController();
      controllers.add(controller);
      /** Forward initiating caller cancellation without automatically replaying work.
       * @returns {void} Signals cancellation; native settlement remains independently awaited.
       */
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) {
        abort();
      }
      /** Single admitted job promise, including its final resource cleanup. */
      const work = (async () => {
        let started = 0;
        let job: IsolatedMediaJob | undefined,
          termination: Promise<void> | undefined,
          timedOut = false,
          outputComplete = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        /** Start native termination at most once and observe rejection until awaited cleanup.
         * @returns {void} Starts or reuses termination without releasing the admitted job slot.
         */
        const terminate = () => {
          if (job && !termination) {
            termination = Promise.resolve().then(() => job!.terminate());
          }
          void termination?.catch(() => {});
        };
        controller.signal.addEventListener('abort', terminate, { once: true });
        /** Requested fixed preset, checked before authorization and executor invocation. */
        const preset = input?.preset;
        try {
          if (controller.signal.aborted) {
            throw fail('TRANSCODE_CANCELLED');
          }
          if (
            !identity ||
            [identity.tenant, identity.subject].some(
              (v) =>
                typeof v !== 'string' || !/^[A-Za-z0-9_.:@-]{1,128}$/.test(v)
            )
          ) {
            throw fail('TRANSCODE_IDENTITY');
          }
          if (
            !input ||
            Object.keys(input).some(
              (key) => !['preset', 'bytes', 'sha256'].includes(key)
            ) ||
            !presets.includes(input.preset) ||
            !(input.bytes instanceof Uint8Array) ||
            input.bytes.byteLength > quotas.maxInputBytes ||
            !input.bytes.byteLength ||
            !/^[a-f0-9]{64}$/.test(input.sha256)
          ) {
            throw fail('TRANSCODE_INPUT');
          }
          /** Copied server-verified identity passed to the host authorization callback. */
          const who = { ...identity };
          /** Trusted expected input SHA-256 checked against the copied bytes. */
          const expected = input.sha256;
          /** Private copied input bytes, bounded and hashed before the executor sees them. */
          const bytes = new Uint8Array(input.bytes);
          if ((await options.authorize(who, preset)) !== true) {
            throw fail('TRANSCODE_FORBIDDEN');
          }
          if (controller.signal.aborted) {
            throw fail('TRANSCODE_CANCELLED');
          }
          if (createHash('sha256').update(bytes).digest('hex') !== expected) {
            throw fail('TRANSCODE_INTEGRITY');
          }
          started = performance.now();
          timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, quotas.maxWallMs);
          job = await options.executor.create(
            Object.freeze({ preset, quotas: Object.freeze({ ...quotas }) })
          );
          if (
            !job ||
            typeof job.run !== 'function' ||
            typeof job.terminate !== 'function' ||
            typeof job.dispose !== 'function'
          ) {
            throw fail('TRANSCODE_EXECUTOR');
          }
          if (controller.signal.aborted) {
            terminate();
            throw fail(timedOut ? 'TRANSCODE_DEADLINE' : 'TRANSCODE_CANCELLED');
          }
          /** Completed encoder counters and staged output iterator; all quotas remain checked. */
          const result = await job.run(bytes, controller.signal);
          if (performance.now() - started > quotas.maxWallMs) {
            timedOut = true;
            controller.abort();
            throw fail('TRANSCODE_DEADLINE');
          }
          if (
            !result ||
            !Number.isFinite(result.cpuMs) ||
            result.cpuMs < 0 ||
            result.cpuMs > quotas.maxCpuMs ||
            !Number.isSafeInteger(result.peakMemoryBytes) ||
            result.peakMemoryBytes < 0 ||
            result.peakMemoryBytes > quotas.maxMemoryBytes ||
            !Number.isSafeInteger(result.filesCreated) ||
            result.filesCreated < 0 ||
            result.filesCreated > quotas.maxFiles
          ) {
            throw fail('TRANSCODE_QUOTA');
          }
          /** Incremental digest of actual output bytes, returned only after complete cleanup. */
          const hash = createHash('sha256');
          /** Bounded copied output chunks, never exposed before job completion and cleanup. */
          const parts: Uint8Array[] = [];
          let size = 0,
            count = 0;
          // Enforce both byte and chunk ceilings before retaining or exposing staged output.
          for await (const chunk of result.output) {
            if (controller.signal.aborted) {
              throw fail(
                timedOut ? 'TRANSCODE_DEADLINE' : 'TRANSCODE_CANCELLED'
              );
            }
            if (!(chunk instanceof Uint8Array)) {
              throw fail('TRANSCODE_OUTPUT');
            }
            size += chunk.byteLength;
            if (size > quotas.maxOutputBytes || ++count > 65536) {
              throw fail('TRANSCODE_QUOTA');
            }
            hash.update(chunk);
            parts.push(new Uint8Array(chunk));
          }
          if (performance.now() - started > quotas.maxWallMs) {
            timedOut = true;
            controller.abort();
          }
          if (controller.signal.aborted) {
            throw fail(timedOut ? 'TRANSCODE_DEADLINE' : 'TRANSCODE_CANCELLED');
          }
          if (!size) {
            throw fail('TRANSCODE_OUTPUT');
          }
          /** Final exact-sized output allocation after all counted chunks satisfy quotas. */
          const data = new Uint8Array(size);
          let offset = 0;
          // Assemble only the already bounded copied chunks, preserving their emitted order.
          for (const part of parts) {
            data.set(part, offset);
            offset += part.length;
          }
          outputComplete = true;
          return {
            preset,
            contentType: mediaTranscodePresets[preset].contentType,
            extension: mediaTranscodePresets[preset].extension,
            bytes: data,
            sha256: hash.digest('hex'),
          };
        } catch (cause) {
          if (controller.signal.aborted) {
            throw fail(
              timedOut ? 'TRANSCODE_DEADLINE' : 'TRANSCODE_CANCELLED',
              cause
            );
          }
          if (cause instanceof MediaTranscodeError) {
            throw cause;
          }
          throw fail('TRANSCODE_FAILED', cause);
        } finally {
          if (timer !== undefined) {
            clearTimeout(timer);
          }
          controller.signal.removeEventListener('abort', terminate);
          signal?.removeEventListener('abort', abort);
          let cleanupFailed = false;
          try {
            if (job) {
              if (!outputComplete) {
                terminate();
              }
              try {
                await termination;
              } finally {
                await job.dispose();
              }
            }
          } catch (cause) {
            cleanupFailed = true;
            // eslint-disable-next-line no-unsafe-finally -- Explicitly report failed owned job cleanup instead of returning output.
            throw fail('TRANSCODE_CLEANUP_FAILED', cause);
          } finally {
            controllers.delete(controller);
            try {
              if (presets.includes(preset)) {
                options.onEvent?.(
                  Object.freeze({
                    preset,
                    status: (() => {
                      if (outputComplete && !cleanupFailed) {
                        return 'complete';
                      }
                      return controller.signal.aborted ? 'cancelled' : 'failed';
                    })(),
                  })
                );
              }
            } catch {
              /* Diagnostics cannot change resource ownership. */
            }
          }
        }
      })();
      pending.add(work);
      work.then(
        () => pending.delete(work),
        () => pending.delete(work)
      );
      return work;
    },
    /** Stop new jobs, signal every admitted job and drain actual work/termination/disposal. Arbitrary uncooperative JavaScript cannot be force-cancelled.
     * @returns {Promise<void>} Shared close promise; borrowed executor configuration remains host-owned.
     */
    close() {
      closed = true;
      // Stop all admitted native jobs before waiting for their actual cleanup settlement.
      for (const controller of controllers) {
        controller.abort();
      }
      return (closing ??= Promise.allSettled([...pending]).then(() => {}));
    },
  };
}
