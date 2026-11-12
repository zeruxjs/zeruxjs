import type { AiProvider, AiCapabilities } from './types.js';
/**
 * Create an application-scoped selection registry over borrowed provider instances.
 * @param {number} maxProviders - Integer capacity, default 16, between 1 and 128.
 * @returns {object} Registry with registration leases, capability lookup and close.
 * @throws {TypeError} When the configured capacity is invalid.
 */
export function createAiProviderRegistry(maxProviders = 16) {
  if (
    !Number.isSafeInteger(maxProviders) ||
    maxProviders < 1 ||
    maxProviders > 128
  ) {
    throw new TypeError('Invalid registry budget');
  }
  /** Private name table; entries borrow providers and snapshot capability flags. */
  const providers = new Map<
    string,
    {
      provider: AiProvider;
      capabilities: Readonly<AiCapabilities>;
    }
  >();
  let closed = false;
  return {
    /**
     * Validate and register an explicitly supplied instance; never load packages.
     * @param {string} name - Unique lowercase identifier, at most 64 characters.
     * @param {AiProvider} provider - Borrowed instance with compatible declared methods.
     * @returns {object} Idempotent lease that removes only this registration.
     * @throws {TypeError} On closed/full registry, duplicate names or invalid capabilities.
     */
    register(name: string, provider: AiProvider) {
      if (
        closed ||
        typeof name !== 'string' ||
        !/^[a-z][a-z0-9-]{0,63}$/.test(name) ||
        providers.has(name) ||
        providers.size >= maxProviders ||
        !provider ||
        typeof provider.chat !== 'function' ||
        !provider.capabilities
      ) {
        throw new TypeError('Invalid/duplicate provider registration');
      }
      /** Admission checks use declared flags; model availability remains host-owned. */
      const c = provider.capabilities;
      if (
        ['chat', 'stream', 'tools', 'usage'].some(
          (k) => typeof c[k as keyof AiCapabilities] !== 'boolean'
        ) ||
        !c.chat ||
        (c.stream && typeof provider.stream !== 'function') ||
        (c.usage && typeof provider.chatResult !== 'function')
      ) {
        throw new TypeError('Invalid provider capabilities');
      }
      if (
        c.jsonOutput !== undefined &&
        (typeof c.jsonOutput !== 'boolean' ||
          (c.jsonOutput && typeof provider.chatContent !== 'function'))
      ) {
        throw new TypeError('Invalid JSON output capability');
      }
      if (
        c.singleAttempt !== undefined &&
        typeof c.singleAttempt !== 'boolean'
      ) {
        throw new TypeError('Invalid request attempt capability');
      }
      /** Identity token prevents an old lease from removing a later replacement. */
      const entry = { provider, capabilities: Object.freeze({ ...c }) };
      providers.set(name, entry);
      return Object.freeze({
        /**
         * Remove this name only while its original entry is still registered.
         * @returns {void} Does not close the borrowed provider or cancel existing calls.
         */
        dispose() {
          if (providers.get(name) === entry) {
            providers.delete(name);
          }
        },
      });
    },
    /**
     * Select an existing instance only when all requested flags are explicitly true.
     * @param {string} name - Registered provider identifier.
     * @param {readonly string[]} required - Up to six known capability names; defaults empty.
     * @returns {AiProvider} Borrowed instance; authorization still belongs to the host.
     * @throws {Error} When closed, missing or unable to satisfy the requested flags.
     */
    get(
      name: string,
      required: readonly (
        | 'chat'
        | 'stream'
        | 'tools'
        | 'usage'
        | 'jsonOutput'
        | 'singleAttempt'
      )[] = []
    ): AiProvider {
      if (closed) {
        throw new Error('Provider registry closed');
      }
      /** Identity token prevents an old lease from removing a later replacement. */
      /** Resolve only within this application registry, without automatic fallback. */
      const entry = providers.get(name);
      if (
        !entry ||
        !Array.isArray(required) ||
        required.length > 6 ||
        required.some(
          (k) =>
            ![
              'chat',
              'stream',
              'tools',
              'usage',
              'jsonOutput',
              'singleAttempt',
            ].includes(k) ||
            entry.capabilities[k as keyof AiCapabilities] !== true
        )
      ) {
        throw new Error('Provider/capability unavailable');
      }
      return entry.provider;
    },
    /**
     * Permanently stop selection and release registry references.
     * @returns {void} Already returned instances remain usable and host-owned.
     */
    close() {
      closed = true;
      providers.clear();
    },
  };
}
