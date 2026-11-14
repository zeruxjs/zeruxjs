import {
  createAnthropicProvider,
  createGeminiProvider,
  createAiProviderRegistry,
  withRetry,
} from '@zeruxjs/ai';
// Host invokes explicitly with server credentials and model IDs enabled for its account.
/**
 * Register explicit borrowed model providers without starting requests or discovering code.
 * @param {object} options - Host-private credentials and enabled model identifiers.
 * @param {string} options.anthropicKey - Server-only Anthropic credential.
 * @param {string} options.anthropicModel - Model supporting the selected explicit wire version.
 * @param {string} options.geminiKey - Server-only Gemini credential.
 * @param {string} options.geminiModel - Enabled generateContent model.
 * @param {typeof fetch} options.fetch - Borrowed host-qualified transport.
 * @returns {ReturnType<import('@zeruxjs/ai').createAiProviderRegistry>} Registry the caller closes; requests retain host-owned signals.
 */
export function configureModels({
  anthropicKey,
  anthropicModel,
  geminiKey,
  geminiModel,
  fetch,
}) {
  /** Application-owned selection registry; callers must close it and own provider call signals. */
  const registry = createAiProviderRegistry();
  registry.register(
    'claude',
    withRetry(
      createAnthropicProvider({
        apiKey: anthropicKey,
        model: anthropicModel,
        apiVersion: '2026-10-21',
        fetch,
      }),
      { attempts: 2 }
    )
  );
  registry.register(
    'gemini',
    createGeminiProvider({ apiKey: geminiKey, model: geminiModel, fetch })
  );
  return registry;
}
// const registry=configureModels(hostPrivateConfig);
// const result=await registry.get('claude',['usage']).chatResult([{role:'user',content:'Summarize this public text'}],{signal:requestSignal,maxTokens:512});
// Consume result.text; providerMetadata is private response data, never telemetry.
// registry.close(); // unregisters borrowed providers, does not cancel calls: host owns their signals.
