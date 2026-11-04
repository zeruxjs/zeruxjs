export interface ChatMessage { role: 'system'|'user'|'assistant'|'tool'; content: string; name?: string }
export interface ChatOptions { signal?: AbortSignal; temperature?: number; maxTokens?: number; topP?: number;/** May narrow, never increase, the configured provider response bound. */ maxResponseBytes?:number }
export interface AiProvider {
  readonly capabilities?:Readonly<AiCapabilities>;
  chatResult?(messages:ChatMessage[],options?:ChatOptions):Promise<AiChatResult>;
  streamEvents?(messages:ChatMessage[],options?:ChatOptions):AsyncIterable<AiStreamEvent>;
  chatContent?(messages:AiContentMessage[],options?:AiContentOptions):Promise<AiChatResult>;
  streamContent?(messages:AiContentMessage[],options?:ChatOptions):AsyncIterable<AiStreamEvent>;
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;
  /** The provider must release its reader and network resources if iteration stops early. */
  stream?(messages: ChatMessage[], options?: ChatOptions): AsyncIterable<string>;
}
export interface ProviderConfig {
  apiKey: string; baseUrl: string; model: string; fetch?: typeof fetch;
  timeoutMs?: number; headers?: Record<string,string>; maxResponseBytes?: number; maxRequestBytes?:number;
}
export class AiProviderError extends Error {
  /** Private response details: non-enumerable; never log without host redaction. */
  readonly providerMetadata?:unknown;
  constructor(message: string, public readonly status?: number, public readonly retryable = false, public readonly retryAfterMs?: number, metadata?:unknown) {
    super(message); this.name = 'AiProviderError';if(metadata!==undefined)Object.defineProperty(this,'providerMetadata',{value:metadata,enumerable:false});
  }
}

export interface AiCapabilities { readonly chat:boolean; readonly stream:boolean; readonly tools:boolean; readonly usage:boolean;readonly inputs?:readonly AiInputKind[];readonly jsonOutput?:boolean;readonly singleAttempt?:boolean }
export interface AiUsage { inputTokens?:number; outputTokens?:number; totalTokens?:number }
export type AiFinishReason='stop'|'length'|'blocked'|'tool'|'unknown';
/** Provider metadata is bounded response data, private to the caller, never a telemetry record. */
export interface AiChatResult {text:string;usage:AiUsage;finishReason:AiFinishReason;providerMetadata:unknown;/** Present only after requested JSON parsing and host schema validation. */ data?:unknown}
export type AiStreamEvent={type:'text';text:string}|{type:'metadata';usage:AiUsage;finishReason:AiFinishReason;providerMetadata:unknown};
export interface ModelProviderConfig extends Omit<ProviderConfig,'baseUrl'> {baseUrl?:string;maxRequestBytes?:number;maxConcurrent?:number;maxQueued?:number;content?:{allowedInputs?:readonly AiInputKind[];maxMediaBytes?:number;maxParts?:number}}

export type AiInputKind='text'|'file'|'json'|'image'|'pdf'|'audio'|'video';
export type AiContentPart={type:'text';text:string}|{type:'file';filename:string;text:string;language?:string}|{type:'json';value:unknown}|{type:'image'|'pdf'|'audio'|'video';mimeType:string;data:Uint8Array};
export interface AiContentMessage {role:'system'|'user'|'assistant';content:string|readonly AiContentPart[]}
export interface AiValueSchema {readonly '~standard':{readonly version:1;validate(value:unknown):{value?:unknown;issues?:readonly unknown[]}|PromiseLike<{value?:unknown;issues?:readonly unknown[]}>}}
export interface AiContentOptions extends ChatOptions {output?:{type:'json';schema:Record<string,unknown>;validator:AiValueSchema}}
