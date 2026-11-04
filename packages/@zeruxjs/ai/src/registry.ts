import type { AiProvider, AiCapabilities } from './types.js';
/** Explicit application-scoped borrowed instances; no discovery, global registry or credential serialization. */
export function createAiProviderRegistry(maxProviders = 16) {
    if (!Number.isSafeInteger(maxProviders) || maxProviders < 1 || maxProviders > 128)
        throw new TypeError('Invalid registry budget');
    const providers = new Map<string, {
        provider: AiProvider;
        capabilities: Readonly<AiCapabilities>;
    }>();
    let closed = false;
    return {
        register(name: string, provider: AiProvider) { if (closed || typeof name !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(name) || providers.has(name) || providers.size >= maxProviders || !provider || typeof provider.chat !== 'function' || !provider.capabilities)
            throw new TypeError('Invalid/duplicate provider registration'); const c = provider.capabilities; if (['chat', 'stream', 'tools', 'usage'].some(k => typeof c[k as keyof AiCapabilities] !== 'boolean') || !c.chat || c.stream && typeof provider.stream !== 'function' || c.usage && typeof provider.chatResult !== 'function')
            throw new TypeError('Invalid provider capabilities'); if(c.jsonOutput!==undefined&&(typeof c.jsonOutput!=='boolean'||c.jsonOutput&&typeof provider.chatContent!=='function'))throw new TypeError('Invalid JSON output capability');if(c.singleAttempt!==undefined&&typeof c.singleAttempt!=='boolean')throw new TypeError('Invalid request attempt capability');const entry = { provider, capabilities: Object.freeze({ ...c }) }; providers.set(name, entry); return Object.freeze({ dispose() { if (providers.get(name) === entry)
                providers.delete(name); } }); },
        get(name: string, required: readonly ('chat'|'stream'|'tools'|'usage'|'jsonOutput'|'singleAttempt')[] = []): AiProvider { if (closed)
            throw new Error('Provider registry closed'); const entry = providers.get(name); if (!entry || !Array.isArray(required) || required.length > 6 || required.some(k => !['chat', 'stream', 'tools', 'usage','jsonOutput','singleAttempt'].includes(k) || entry.capabilities[k as keyof AiCapabilities] !== true))
            throw new Error('Provider/capability unavailable'); return entry.provider; },
        close() { closed = true; providers.clear(); }
    };
}
