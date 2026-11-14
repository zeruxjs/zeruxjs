import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ZeruxConfig } from '../index.js';
import { bootstrapApplication } from './runtime.js';
import { resolveStructure } from './config.js';
import { assertConfigReloadable, snapshotConfig } from './config-validation.js';
import { createRequestLifecycle } from './request-lifecycle.js';
import { createHotRuntime } from './hot-runtime.js';
import type { ServiceInitializers } from './services.js';
import type { RuntimeMode } from './types.js';
/** Own programmatic runtime generations and response drains without binding or restarting a host server.
 * @param {{ rootDir: string; mode?: RuntimeMode; config: ZeruxConfig; providers?: Partial<ServiceInitializers>; drainTimeoutMs?: number; }} options - Explicit trusted project/config/provider and drain policy.
 * @param {string} options.rootDir - Trusted project directory.
 * @param {RuntimeMode} [options.mode] - Development or production mode.
 * @param {ZeruxConfig} options.config - Explicit trusted application configuration.
 * @param {Partial<ServiceInitializers>} [options.providers] - Explicit host factory injection.
 * @param {number} [options.drainTimeoutMs] - Native response-drain deadline.
 * @returns {Promise<object>} Host-owned handle for requests, current runtime, staged reload and close.
 */
export async function createApplicationLifecycle(options: {
  rootDir: string;
  mode?: RuntimeMode;
  config: ZeruxConfig;
  providers?: Partial<ServiceInitializers>;
  drainTimeoutMs?: number;
}) {
  if (
    !options ||
    typeof options.rootDir !== 'string' ||
    !options.rootDir ||
    (options.mode !== undefined && !['dev', 'start'].includes(options.mode))
  ) {
    throw new TypeError('Invalid application lifecycle options');
  }
  if (
    options.drainTimeoutMs !== undefined &&
    (!Number.isFinite(options.drainTimeoutMs) || options.drainTimeoutMs < 0)
  ) {
    throw new TypeError('Invalid drain deadline');
  }
  /** Resolved trusted project root; this lifecycle never binds an HTTP listener. */
  const rootDir = path.resolve(options.rootDir);
  /** Explicit source/production runtime mode, default start. */
  const mode = options.mode ?? 'start';
  /** Stable bounded application correlation retained across generation replacement. */
  const applicationId =
    options.config.observability?.applicationId ??
    randomBytes(12).toString('hex');
  /** Build an independent candidate config/runtime and owned response-drain wrapper.
   * @param {ZeruxConfig} config - Trusted validated candidate settings.
   * @returns {Promise<object>} Prepared generation with private source config and handler.
   */
  const prepare = async (config: ZeruxConfig) => {
    /** Snapshot retained for future reload comparisons; services do not mutate the caller’s original config. */
    const saved = snapshotConfig(config);
    /** Separate mutable startup copy, receiving only the stable application correlation. */
    const working = snapshotConfig(saved);
    working.observability = { ...working.observability, applicationId };
    /** Prepared runtime whose services must close if handler-wrapper setup fails. */
    const app = await bootstrapApplication(
      rootDir,
      mode,
      working,
      resolveStructure(rootDir, working),
      options.providers,
      { deferActivation: true }
    );
    try {
      return {
        app,
        config: saved,
        handler: createRequestLifecycle(app.runtime.createHandler(), {
          drainTimeoutMs: options.drainTimeoutMs,
        }),
      };
    } catch (error) {
      await app.runtime.closeServices();
      throw error;
    }
  };
  let candidateConfig = snapshotConfig(options.config);
  /** Initial generation, activated before exposing the application handle. */
  const first = await prepare(candidateConfig);
  try {
    first.app.runtime.activateServices();
  } catch (error) {
    await first.app.runtime.closeServices();
    throw error;
  }
  /** Serialized replacement owner; every retired handler drains before dependent services close. */
  const generations = createHotRuntime(first, {
    prepare: () => prepare(candidateConfig),
    activate: (next) => next.app.runtime.activateServices(),
    dispose: async (old) => {
      await old.handler.drain();
      old.app.runtime.closeProtocols();
      await old.app.runtime.closeServices();
    },
  });
  let queue: Promise<unknown> = Promise.resolve();
  let closed = false;
  let closing: Promise<void> | undefined;
  return {
    handle: (req: IncomingMessage, res: ServerResponse) =>
      generations.current().handler.handle(req, res),
    runtime: () => generations.current().app.runtime,
    status: () => generations.status(),
    /** Serialize an explicit reload after checking which settings may change without a manual restart.
     * @param {ZeruxConfig} config - Trusted candidate application configuration.
     * @returns {Promise<unknown>} Replacement outcome; rejected preparation preserves the previous active generation.
     */
    reload(config: ZeruxConfig) {
      if (closed) {
        return Promise.reject(new Error('Application lifecycle closed'));
      }
      /** Snapshot retained for future reload comparisons; services do not mutate the caller’s original config. */
      const saved = snapshotConfig(config);
      /** Validate reloadability immediately before preparing the serialized replacement.
       * @returns {Promise<unknown>} Generation replacement result.
       */
      const execute = async () => {
        assertConfigReloadable(generations.current().config, saved);
        candidateConfig = saved;
        return generations.reload();
      };
      /** One serialized reload outcome; rejection is observed without breaking later queue admission. */
      const result = queue.then(execute, execute);
      queue = result.catch(() => {});
      return result;
    },
    /** Stop reload admission and drain queued replacements before disposing the active generation.
     * @returns {Promise<void>} Shared actual-settlement cleanup promise.
     */
    close() {
      closed = true;
      return (closing ??= (async () => {
        await queue;
        await generations.close();
      })());
    },
  };
}
