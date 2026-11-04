import {createAnthropicProvider,createGeminiProvider,createAiProviderRegistry,withRetry} from '@zeruxjs/ai';
// Host invokes explicitly with server credentials and model IDs enabled for its account.
export function configureModels({anthropicKey,anthropicModel,geminiKey,geminiModel,fetch}) {
 const registry=createAiProviderRegistry();
 registry.register('claude',withRetry(createAnthropicProvider({apiKey:anthropicKey,model:anthropicModel,apiVersion:'2026-10-21',fetch}),{attempts:2}));
 registry.register('gemini',createGeminiProvider({apiKey:geminiKey,model:geminiModel,fetch}));
 return registry;
}
// const registry=configureModels(hostPrivateConfig);
// const result=await registry.get('claude',['usage']).chatResult([{role:'user',content:'Summarize this public text'}],{signal:requestSignal,maxTokens:512});
// Consume result.text; providerMetadata is private response data, never telemetry.
// registry.close(); // unregisters borrowed providers, does not cancel calls: host owns their signals.
