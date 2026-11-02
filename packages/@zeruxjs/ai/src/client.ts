import type { AiProvider, ChatMessage, ChatOptions,AiContentMessage,AiContentOptions } from './types.js';
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
   capabilities:Object.freeze({chat:true,stream:true,tools:primary.capabilities?.tools===true||secondary.capabilities?.tools===true,usage:false,jsonOutput:false,singleAttempt:false}),
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
 const retry=async<T>(run:()=>Promise<T>,options?:ChatOptions):Promise<T>=>{
   for(let i=0;;i++) {
     try{return await run();}catch(error){
       if(i>=attempts-1||options?.signal?.aborted||!(error instanceof AiProviderError&&error.retryable))throw error;
       const time=Math.min(cap,Math.max(error.retryAfterMs??0,delay*2**i));
       await new Promise<void>((resolve,reject)=>{
         const abort=()=>{clearTimeout(timer);reject(options?.signal?.reason??new Error('Aborted'));};
         const timer=setTimeout(()=>{options?.signal?.removeEventListener('abort',abort);resolve();},time);
         if(options?.signal?.aborted)abort();else options?.signal?.addEventListener('abort',abort,{once:true});
       });
     }
   }
 };
 return {
   capabilities:provider.capabilities?Object.freeze({...provider.capabilities,singleAttempt:attempts===1?provider.capabilities.singleAttempt:false}):undefined,
   ...(provider.chatContent?{chatContent:(messages:AiContentMessage[],options?:AiContentOptions)=>retry(()=>provider.chatContent!(messages,options),options)}:{}),
   ...(provider.streamContent?{streamContent:(messages:AiContentMessage[],options?:ChatOptions)=>provider.streamContent!(messages,options)}:{}),
   chat:(messages,options)=>retry(()=>provider.chat(messages,options),options),
   ...(provider.chatResult?{chatResult:(messages:ChatMessage[],options?:ChatOptions)=>retry(()=>provider.chatResult!(messages,options),options)}:{}),
   ...(provider.stream?{stream:(messages:ChatMessage[],options?:ChatOptions)=>provider.stream!(messages,options)}:{}),
   ...(provider.streamEvents?{streamEvents:(messages:ChatMessage[],options?:ChatOptions)=>provider.streamEvents!(messages,options)}:{}),
 };
}
