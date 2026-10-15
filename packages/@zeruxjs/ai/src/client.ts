import type { AiProvider, ChatMessage, ChatOptions } from './types.js';
import { AiProviderError } from './types.js';

export function createAiClient(provider: AiProvider) {
 return {
   complete: (prompt: string, options?: ChatOptions) => provider.chat([{role:'user',content:prompt}], options),
   chat: (messages: ChatMessage[], options?: ChatOptions) => provider.chat(messages, options),
   stream: (messages: ChatMessage[], options?: ChatOptions): AsyncIterable<string> => provider.stream ? provider.stream(messages, options) : (async function*() { yield await provider.chat(messages, options); })(),
   streamComplete: (prompt: string, options?: ChatOptions): AsyncIterable<string> => provider.stream ? provider.stream([{role:'user',content:prompt}], options) : (async function*() { yield await provider.chat([{role:'user',content:prompt}], options); })(),
 };
}
export function withFallback(primary: AiProvider, secondary: AiProvider): AiProvider {
 return {
   async chat(messages, options) { try { return await primary.chat(messages, options); } catch (error) { if (options?.signal?.aborted) throw error; return secondary.chat(messages,options); } },
   async *stream(messages,options) {
     if (!primary.stream) {
       // A provider without streaming still needs the same pre-output
       // failover as chat(). Never switch providers after bytes are emitted.
       try { yield await primary.chat(messages,options); }
       catch (error) {
         if (options?.signal?.aborted) throw error;
         if (secondary.stream) yield* secondary.stream(messages,options);
         else yield await secondary.chat(messages,options);
       }
       return;
     }
     let emitted = false;
     try { for await (const chunk of primary.stream(messages,options)) { emitted = true; yield chunk; } }
     catch (error) {
       // Never switch providers after output: this would duplicate parts of an answer.
       if (emitted || options?.signal?.aborted) throw error;
       if (secondary.stream) yield* secondary.stream(messages,options);
       else yield await secondary.chat(messages,options);
     }
   },
 };
}
export function withRetry(provider: AiProvider, config: {attempts?:number;delayMs?:number;maxDelayMs?:number} = {}): AiProvider {
 const attempts = config.attempts ?? 3, delay = config.delayMs ?? 200, cap = config.maxDelayMs ?? 10000;
 if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 10 || !Number.isFinite(delay) || delay < 0 || !Number.isFinite(cap) || cap < 0) throw new RangeError('Invalid retry configuration');
 return {
   async chat(messages,options) {
     for(let i=0;;i++) {
       try { return await provider.chat(messages,options); }
       catch(error) {
         if (i >= attempts - 1 || options?.signal?.aborted || !(error instanceof AiProviderError && error.retryable)) throw error;
         const time = Math.min(cap, Math.max(error.retryAfterMs ?? 0, delay * 2 ** i));
         await new Promise<void>((resolve,reject) => {
           const timer = setTimeout(() => { options?.signal?.removeEventListener('abort',abort); resolve(); },time);
           const abort = () => { clearTimeout(timer); reject(options?.signal?.reason ?? new Error('Aborted')); };
           if (options?.signal?.aborted) abort(); else options?.signal?.addEventListener('abort',abort,{once:true});
         });
       }
     }
   },
   ...(provider.stream ? { stream: (messages: ChatMessage[],options?: ChatOptions) => provider.stream!(messages,options) } : {}),
 };
}
