export interface ChatMessage { role: 'system'|'user'|'assistant'|'tool'; content: string; name?: string }
export interface ChatOptions { signal?: AbortSignal; temperature?: number; maxTokens?: number; topP?: number }
export interface AiProvider {
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;
  /** The provider must release its reader and network resources if iteration stops early. */
  stream?(messages: ChatMessage[], options?: ChatOptions): AsyncIterable<string>;
}
export interface ProviderConfig {
  apiKey: string; baseUrl: string; model: string; fetch?: typeof fetch;
  timeoutMs?: number; headers?: Record<string,string>; maxResponseBytes?: number;
}
export class AiProviderError extends Error {
  constructor(message: string, public readonly status?: number, public readonly retryable = false, public readonly retryAfterMs?: number) {
    super(message); this.name = 'AiProviderError';
  }
}
