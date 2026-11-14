import type { AiProvider } from '@zeruxjs/ai';
import {
  createStructuredClient,
  type VersionedAiPricing,
} from '@zeruxjs/ai/structured';
import { object, string } from '@zeruxjs/validator/schemas';
// Pass a host-authorized single-attempt provider, not a withRetry/tool-loop wrapper.
/**
 * Generate one independently validated answer under explicit request and pricing budgets.
 * @param {AiProvider} provider - Authorized single-attempt side-effect-free provider, borrowed.
 * @param {VersionedAiPricing} pricing - Host-selected model price version; no lookup occurs.
 * @param {AbortSignal | undefined} signal - Optional cooperative caller cancellation.
 * @returns {Promise<object>} Typed answer and redacted accounting; finally drains the client owner.
 */
export async function generateAnswer(
  provider: AiProvider,
  pricing: VersionedAiPricing,
  signal?: AbortSignal
) {
  /** Owned request-budget client; finally awaits close without closing the borrowed provider. */
  const client = createStructuredClient(provider, {
    pricing,
    budgets: {
      maxAttempts: 2,
      timeoutMs: 5000,
      maxOutputBytes: 65536,
      maxJsonDepth: 8,
      maxInputTokensPerAttempt: 2048,
      maxOutputTokensPerAttempt: 512,
      maxTotalTokens: 8192,
      maxCostMicros: 1000000,
    },
  });
  try {
    /** Independently validated result includes a redacted ledger with the supplied pricing version. */
    const result = await client.generate(
      [{ role: 'user', content: 'Return a short answer as JSON data.' }],
      {
        jsonSchema: {
          type: 'object',
          properties: { answer: { type: 'string' } },
          required: ['answer'],
          additionalProperties: false,
        },
        validator: object({ answer: string() }),
      },
      { signal }
    );
    /** Compile-time inference witness from the Standard Schema validator output. */
    const answer: string = result.data.answer; // inferred from the validator's Standard Schema output
    return { answer, ledger: result.ledger };
  } finally {
    await client.close();
  } // drains native work; borrowed provider stays host-owned
}
