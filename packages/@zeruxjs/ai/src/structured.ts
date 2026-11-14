/** Request-scoped JSON generation budgets. No automatic tool execution or logging. */
import type {
  AiProvider,
  AiValueSchema,
  ChatMessage,
  AiUsage,
  AiChatResult,
} from './types.js';
import { AiProviderError } from './types.js';
import { snapshotAiJson } from './safe-json.js';
import { prepareJsonOutput } from './content.js';
/** Infer a Standard Schema output witness; absence remains unknown instead of unsafe any. */
export type StructuredOutput<S extends AiValueSchema> = S extends {
  /** Standard Schema protocol used only for static output inference here. */
  readonly '~standard': {
    /** Optional Standard Schema type witness; no runtime validation is inferred from it. */
    readonly types?: {
      /** Inferred validator output type, or unknown when the witness is absent. */
      readonly output: infer T;
    };
  };
}
  ? T
  : unknown;
/** Host-supplied immutable price identity and integer rates; no automatic network pricing. */
export interface VersionedAiPricing {
  /** Host price-table identifier; no secret or endpoint belongs in this label. */
  id: string;
  /** Pinned price revision used for reproducible estimates, never fetched automatically. */
  version: string;
  /** Three-letter uppercase currency code; estimates are not invoices. */
  currency: string;
  /** Nonnegative integer input price in micro-currency units per million tokens. */
  inputMicrosPerMillionTokens: number;
  /** Nonnegative integer output price in micro-currency units per million tokens. */
  outputMicrosPerMillionTokens: number;
}
/** Finite per-request reservations and execution limits; independent of provider billing guarantees. */
export interface StructuredBudgets {
  /** Total generation attempts, default 1, maximum 4; repairs require an explicit increase. */
  maxAttempts?: number;
  /** Whole-request deadline in milliseconds, default 5000, maximum 60000. */
  timeoutMs?: number;
  /** Accumulated output UTF-8 bytes across attempts, default 262144, maximum 1048576. */
  maxOutputBytes?: number;
  /** Maximum JSON container nesting, default 16, maximum 32. */
  maxJsonDepth?: number;
  /** Maximum serialized input bytes, default 1048576, maximum 4194304. */
  maxInputBytes?: number;
  /** Reserved input-token ceiling per attempt, default 4096, maximum 1000000. */
  maxInputTokensPerAttempt?: number;
  /** Reserved output-token ceiling forwarded to provider, default 1024, maximum 1000000. */
  maxOutputTokensPerAttempt?: number;
  /** Cumulative accounted-token ceiling, default 16384, maximum 10000000. */
  maxTotalTokens?: number;
  /** Optional total accounted micro-currency ceiling, maximum 1000000000; requires pricing. */
  maxCostMicros?: number;
  /** Default stop denies repairs with incomplete usage; reserve retains full reservations explicitly. */
  unknownUsage?: 'stop' | 'reserve';
}
/** Explicit native/fallback selection, admission and host-owned price/estimator policy. */
export interface StructuredClientOptions {
  /** Default reject requires native JSON; text-json explicitly permits independently validated text fallback. */
  fallback?: 'reject' | 'text-json';
  /** Maximum unsettled requests, default 4, maximum 32; no waiting queue is added. */
  maxConcurrent?: number;
  /** Optional host-owned versioned rate table; missing pricing means unknown cost. */
  pricing?: VersionedAiPricing;
  /** Per-request accounting and execution policy; no cross-request billing journal is implied. */
  budgets?: StructuredBudgets;
  /** Pure host estimator over serialized request; defaults to conservative UTF-8 byte length. */
  estimateInputTokens?: (serializedRequest: string) => number;
  /** Public versioned estimator label; custom estimators must provide one. */
  estimatorId?: string;
  /** Explicit host assertion for a legacy provider; known retry/fallback wrappers still reject. */
  qualifiedProvider?: {
    /** Host assertion that a call makes only one transport attempt. */
    singleAttempt: true;
    /** Only side-effect-free providers can enter validation/repair execution. */
    sideEffects: 'none';
  };
}
/** Redacted request receipt separates reported usage from conservative in-flight reservations. */
export interface StructuredLedger {
  /** Actual transport attempts admitted under this request ledger. */
  attempts: number;
  /** Cumulative received output-byte count, including independently rejected output. */
  outputBytes: number;
  /** Provider-reported counters when available; missing values do not imply no usage. */
  usage: {
    /** Whether complete usage or cost information is available for this receipt. */
    state: 'reported' | 'unknown';
    /** Sum of validated provider input counts that were actually supplied. */
    reportedInputTokens: number;
    /** Sum of validated provider output counts that were actually supplied. */
    reportedOutputTokens: number;
    /** Sum of supplied totals or complete input/output pairs, without inventing partial totals. */
    reportedTotalTokens: number;
    /** Reported usage plus retained upper reservations for incomplete/in-flight attempts. */
    accountedTokens: number;
  };
  /** Host-priced estimate and admission reservations; excludes vendor-specific fees unless modeled by host. */
  cost: {
    /** Whether complete usage or cost information is available for this receipt. */
    state: 'estimated' | 'unknown';
    /** Estimated micro-currency amount, or null when pricing/usage is unknown. */
    micros: number | null;
    /** Conservative reserved/charged micro-currency amount, or null without pricing. */
    accountedMicros: number | null;
    /** Optional host-owned versioned rate table; missing pricing means unknown cost. */
    pricing?: VersionedAiPricing;
  };
  /** Public versioned estimator label; custom estimators must provide one. */
  estimatorId: string;
}
/** Fixed-code failure with a redacted per-request ledger; never contains prompts or response bodies. */
export class StructuredResponseError extends Error {
  /**
   * Create a fixed-code structured failure with a redacted request receipt.
   * @param {'unsupported' | 'invalid-output' | 'attempt-budget' | 'token-budget' | 'cost-budget' | 'output-budget' | 'unknown-usage' | 'provider' | 'cancelled' | 'timeout' | 'overloaded' | 'closed'} code - Fixed public failure category, never raw transport error text.
   * @param {StructuredLedger} ledger - Detached redacted cumulative accounting receipt at the failure boundary.
   */
  constructor(
    readonly code:
      | 'unsupported'
      | 'invalid-output'
      | 'attempt-budget'
      | 'token-budget'
      | 'cost-budget'
      | 'output-budget'
      | 'unknown-usage'
      | 'provider'
      | 'cancelled'
      | 'timeout'
      | 'overloaded'
      | 'closed',
    readonly ledger: StructuredLedger
  ) {
    super('Structured response failed (' + code + ')');
    this.name = 'StructuredResponseError';
  }
}
/**
 * Validate an integer budget before any request resources are created.
 * @param {number} value - Candidate value; validation failures do not echo private content.
 * @param {number} max - Inclusive configured ceiling.
 * @param {unknown} min - Inclusive lower bound, default one.
 * @returns {number} Validated budget, unchanged; invalid values throw TypeError.
 */
function integer(value: number, max: number, min = 1) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError('Invalid structured budget');
  }
  return value;
}
/**
 * Validate a bounded public accounting label without retaining private input.
 * @param {unknown} value - Candidate value; validation failures do not echo private content.
 * @returns {void} No value; invalid labels throw TypeError.
 */
function label(value: unknown) {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value)
  ) {
    throw new TypeError('Invalid structured label');
  }
}
/**
 * Scan JSON container nesting while honoring quoted strings and escape sequences.
 * @param {string} text - Untrusted text inspected as data, never evaluated.
 * @param {number} max - Inclusive configured ceiling.
 * @returns {void} No value; excessive nesting throws before JSON.parse.
 */
function depth(text: string, max: number) {
  let nesting = 0,
    quoted = false,
    escape = false;
  // Only unquoted container characters affect depth; escaped quotes remain inert text.
  for (const char of text) {
    if (quoted) {
      if (escape) {
        escape = false;
      } else if (char === '\\') {
        escape = true;
      } else if (char === '"') {
        quoted = false;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === '{' || char === '[') {
      if (++nesting > max) {
        throw new Error('depth');
      }
    } else if (char === '}' || char === ']') {
      nesting--;
    }
  }
}
/** Internal native parse pass-through; final validation always uses the separate host validator. */
const identityValidator: AiValueSchema = {
  '~standard': { version: 1, validate: (value) => ({ value }) },
};
/**
 * Own finite structured generation and independent validation over a borrowed provider.
 * @param {AiProvider} provider - Borrowed explicitly selected provider; the host owns its transport lifecycle.
 * @param {StructuredClientOptions} options - Host-owned validated settings; see the associated option contract for limits and ownership.
 * @returns {object} Generation owner with independent ledgers, pending counters and abort/drain close.
 * @throws {TypeError} On invalid policy/input or the documented fixed failure/budget state.
 */
export function createStructuredClient(
  provider: AiProvider,
  options: StructuredClientOptions = {}
) {
  if (
    !provider ||
    typeof provider.chat !== 'function' ||
    provider.capabilities?.tools === true ||
    provider.capabilities?.singleAttempt === false ||
    (provider.capabilities?.singleAttempt !== true &&
      (options.qualifiedProvider?.singleAttempt !== true ||
        options.qualifiedProvider.sideEffects !== 'none'))
  ) {
    throw new TypeError(
      'Qualified single-attempt side-effect-free provider required'
    );
  }
  if (
    (options.fallback !== undefined &&
      !['reject', 'text-json'].includes(options.fallback)) ||
    (options.estimateInputTokens !== undefined &&
      (typeof options.estimateInputTokens !== 'function' ||
        !options.estimatorId))
  ) {
    throw new TypeError('Invalid structured options');
  }
  /** Native mode requires both the declared JSON capability and its implementation method. */
  const native =
    provider.capabilities?.jsonOutput === true &&
    typeof provider.chatContent === 'function';
  /** Explicit host choice for unsupported native JSON; no prompt-only guarantee is inferred. */
  const fallback = options.fallback ?? 'reject';
  /** Maximum unsettled generation jobs; cancellation alone does not free a slot. */
  const maxConcurrent = integer(options.maxConcurrent ?? 4, 32);
  /** Selected request budget settings; validated defaults below remain independent per request. */
  const b = options.budgets ?? {};
  /** Finite total generation attempts, including the first response and any explicit repairs. */
  const attempts = integer(b.maxAttempts ?? 1, 4);
  /** Whole-request lifetime in milliseconds, starting before input preparation. */
  const timeout = integer(b.timeoutMs ?? 5000, 60000);
  /** Accumulated output-byte ceiling across failed responses and successful repairs. */
  const maxBytes = integer(b.maxOutputBytes ?? 262144, 1048576);
  /** Maximum JSON container nesting checked before JSON.parse. */
  const maxDepth = integer(b.maxJsonDepth ?? 16, 32);
  /** Serialized request/snapshot byte ceiling, including schema and repair instructions. */
  const maxInputBytes = integer(b.maxInputBytes ?? 1048576, 4194304);
  /** Input-token reservation charged before every remote attempt. */
  const inputCap = integer(b.maxInputTokensPerAttempt ?? 4096, 1000000);
  /** Output-token reservation forwarded as the provider maxTokens setting. */
  const outputCap = integer(b.maxOutputTokensPerAttempt ?? 1024, 1000000);
  /** Cumulative accounted-token limit; incomplete usage retains conservative reservations. */
  const totalCap = integer(b.maxTotalTokens ?? 16384, 10000000);
  /** Optional micro-currency ceiling; enabling it requires explicit versioned host pricing. */
  const maxCost =
    b.maxCostMicros === undefined
      ? undefined
      : integer(b.maxCostMicros, 1000000000, 0);
  /** Repair policy for incomplete usage: stop by default, or retain upper reservations explicitly. */
  const unknown = b.unknownUsage ?? 'stop';
  if (!['stop', 'reserve'].includes(unknown)) {
    throw new TypeError('Invalid unknown usage policy');
  }
  /**
   * Estimate input tokens using the host callback or conservative UTF-8-byte fallback.
   * @param {string} text - Serialized request; private data is never logged.
   * @returns {number} Accounting estimate, not proof of a vendor tokenizer or billing cap.
   */
  const estimator =
    options.estimateInputTokens ?? ((text: string) => Buffer.byteLength(text));
  /** Public versioned estimator label included in receipts without prompt content. */
  const estimatorId = options.estimatorId ?? 'utf8-bytes-v1';
  label(estimatorId);
  /** Frozen host price snapshot; no remote pricing lookup or refresh occurs. */
  const pricing = options.pricing
    ? Object.freeze({ ...options.pricing })
    : undefined;
  if (pricing) {
    label(pricing.id);
    label(pricing.version);
    if (!/^[A-Z]{3}$/.test(pricing.currency)) {
      throw new TypeError('Invalid pricing currency');
    }
    integer(pricing.inputMicrosPerMillionTokens, 1000000000, 0);
    integer(pricing.outputMicrosPerMillionTokens, 1000000000, 0);
  }
  if (maxCost !== undefined && !pricing) {
    throw new TypeError('Cost budget requires host versioned pricing');
  }
  /**
   * Estimate micro-currency charges with exact upward integer rounding for each category.
   * @param {number} input - Input token count used by this accounting step.
   * @param {number} output - Output token count used by this accounting step.
   * @returns {number} Upward-rounded micro-currency estimate, or zero for internal accounting without prices.
   */
  const money = (input: number, output: number) =>
    pricing
      ? Number(
          (BigInt(input) * BigInt(pricing.inputMicrosPerMillionTokens) +
            999999n) /
            1000000n +
            (BigInt(output) * BigInt(pricing.outputMicrosPerMillionTokens) +
              999999n) /
              1000000n
        )
      : 0;
  /** Client lifetime signal aborts owned requests without closing the borrowed provider. */
  const shutdown = new AbortController();
  /** Native settlement set; timeout can end caller waiting while this set retains capacity. */
  const jobs = new Set<Promise<unknown>>();
  let closed = false,
    closing: Promise<void> | undefined;
  return {
    /**
     * Generate and independently validate JSON under one cumulative request ledger.
     * @template S
     * @param {ChatMessage[]} messages - Authorized conversation data, snapshotted and bounded before dispatch.
     * @param {object} schema - Bounded declarative schema plus trusted independent validator.
     * @param {Record<string, unknown>} schema.jsonSchema - Inert native schema without remote references.
     * @param {S} schema.validator - Borrowed trusted validator; transformations must return inert JSON.
     * @param {object} control - Optional caller cancellation; it cannot force native work to stop.
     * @param {AbortSignal} [control.signal] - Optional cooperative initiating cancellation.
     * @returns {Promise<{data: StructuredOutput<S>, mode: "native" | "text-json", ledger: StructuredLedger}>} Validated inert data, actual native/text mode and redacted cumulative accounting.
     * @throws {StructuredResponseError | TypeError} On invalid policy/input or the documented fixed failure/budget state.
     */
    async generate<S extends AiValueSchema>(
      messages: ChatMessage[],
      schema: {
        /** Bounded inert provider-facing schema; no executable callback or remote references. */
        jsonSchema: Record<string, unknown>;
        /** Borrowed trusted Standard Schema V1 validator for independent output validation. */
        validator: S;
      },
      control: {
        /** Optional caller cancellation; native slots remain until actual settlement. */
        signal?: AbortSignal;
      } = {}
    ): Promise<{
      /** Detached independently validated JSON output, still untrusted at rendering boundaries. */
      data: StructuredOutput<S>;
      /** Actual native or explicitly allowed text-json request mode. */
      mode: 'native' | 'text-json';
      /** Redacted cumulative request receipt with no prompts, response bodies or raw issues. */
      ledger: StructuredLedger;
    }> {
      /** Clock origin for the whole generation deadline, including validation/repair work. */
      const startedAt = Date.now();
      let count = 0,
        bytes = 0,
        reportedInput = 0,
        reportedOutput = 0,
        reportedTotal = 0,
        accounted = 0,
        accountedCost = 0,
        estimatedCost = 0,
        allKnown = true;
      /**
       * Snapshot redacted cumulative usage, reservations and host-priced estimates.
       * @returns {StructuredLedger} Fresh receipt with counters/reservations only; no prompts, values or raw errors.
       */
      const ledger = (): StructuredLedger => ({
        attempts: count,
        outputBytes: bytes,
        usage: {
          state: allKnown ? 'reported' : 'unknown',
          reportedInputTokens: reportedInput,
          reportedOutputTokens: reportedOutput,
          reportedTotalTokens: reportedTotal,
          accountedTokens: accounted,
        },
        cost: {
          state: pricing && allKnown ? 'estimated' : 'unknown',
          micros: pricing && allKnown ? estimatedCost : null,
          accountedMicros: pricing ? accountedCost : null,
          pricing: pricing ? { ...pricing } : undefined,
        },
        estimatorId,
      });
      /**
       * Attach current accounting to a fixed public failure code without raw provider data.
       * @param {StructuredResponseError['code']} code - Fixed public failure category, never raw transport error text.
       * @returns {StructuredResponseError} Fixed-code failure with the current detached accounting receipt.
       */
      const fail = (code: StructuredResponseError['code']) =>
        new StructuredResponseError(code, ledger());
      if (closed) {
        throw fail('closed');
      }
      if (jobs.size >= maxConcurrent) {
        throw fail('overloaded');
      }
      if (!native && fallback !== 'text-json') {
        throw fail('unsupported');
      }
      if (
        control.signal !== undefined &&
        !(control.signal instanceof AbortSignal)
      ) {
        throw new TypeError('Invalid structured signal');
      }
      control.signal?.throwIfAborted();
      if (
        !schema ||
        schema.validator?.['~standard']?.version !== 1 ||
        typeof schema.validator['~standard'].validate !== 'function'
      ) {
        throw new TypeError('Host schema validator required');
      }
      /** Borrowed trusted validator; must be pure and cooperative, never authorization by itself. */
      const validator = schema.validator;
      /** Detached bounded schema validated independently of the model-facing protocol. */
      const jsonSchema = prepareJsonOutput(
        {
          type: 'json',
          schema: schema.jsonSchema,
          validator: identityValidator,
        },
        false
      )!.schema as Record<string, unknown>;
      /** Authorized text-only conversation snapshot, isolating later caller mutation. */
      const copied = snapshotAiJson(messages, maxInputBytes) as ChatMessage[];
      if (
        !Array.isArray(copied) ||
        !copied.length ||
        copied.length > 256 ||
        copied.some(
          (m) =>
            !m ||
            !['system', 'user', 'assistant'].includes(m.role) ||
            typeof m.content !== 'string' ||
            m.name !== undefined
        )
      ) {
        throw new TypeError('Text-only structured messages required');
      }
      /**
       * Request cooperative cancellation without releasing native settlement ownership.
       * @returns {void} Completes without returning private input; validation/cancellation failures remain observable.
       */
      /** Per-request cancellation owner joining caller, deadline and client shutdown. */
      const controller = new AbortController();
      /**
       * Request cooperative cancellation without releasing native settlement ownership.
       * @returns {void} No value; only requests cancellation and never forces native settlement.
       */
      const abort = () => controller.abort();
      /** Absolute request deadline; checks fence work before each further attempt. */
      const deadline = startedAt + timeout;
      shutdown.signal.addEventListener('abort', abort, { once: true });
      control.signal?.addEventListener('abort', abort, { once: true });
      /** Owned deadline timer, removed only when the native job actually settles. */
      const timer = setTimeout(abort, Math.max(0, deadline - Date.now()));
      /**
       * Stop further work at cancellation/deadline boundaries before another dispatch.
       * @returns {void} No value; abort/deadline failures stop further work.
       */
      const check = () => {
        if (Date.now() >= deadline) {
          controller.abort();
        }
        if (controller.signal.aborted) {
          throw fail(Date.now() >= deadline ? 'timeout' : 'cancelled');
        }
      };
      /**
       * Replace one attempt reservation with validated counts, retaining unknown upper bounds.
       * @param {AiUsage | undefined} value - Candidate value; validation failures do not echo private content.
       * @param {boolean} priorKnown - Whether every earlier attempt had complete consistent usage.
       * @returns {boolean} Whether this attempt supplied complete consistent input/output counts.
       */
      function usage(value: AiUsage | undefined, priorKnown: boolean) {
        /** Provider-reported input count; missing values stay unknown rather than zero usage. */
        const input = value?.inputTokens;
        /** Provider-reported output count; validated before replacing reserved usage. */
        const output = value?.outputTokens;
        /** Optional reported total, checked for safe integer bounds and consistency. */
        const total = value?.totalTokens;
        // Validate every supplied count before replacing any reservation with reported usage.
        for (const item of [input, output, total]) {
          if (
            item !== undefined &&
            (!Number.isSafeInteger(item) || item < 0 || item > 100000000)
          ) {
            throw fail('provider');
          }
        }
        /** Complete consistent input/output counts permit reservation replacement. */
        const known =
          input !== undefined &&
          output !== undefined &&
          (total === undefined || total === input + output);
        reportedInput += input ?? 0;
        reportedOutput += output ?? 0;
        reportedTotal += total ?? (known ? input! + output! : 0);
        allKnown = priorKnown && known;
        /** Known reported input, or the larger of partial usage and the reserved input ceiling. */
        const chargedInput = known ? input! : Math.max(input ?? 0, inputCap);
        /** Known reported output, or the larger of partial usage and reserved output ceiling. */
        const chargedOutput = known
          ? output!
          : Math.max(output ?? 0, outputCap);
        accounted +=
          Math.max(total ?? 0, chargedInput + chargedOutput) -
          inputCap -
          outputCap;
        accountedCost +=
          money(chargedInput, chargedOutput) - money(inputCap, outputCap);
        /** Reported tokens outside categorized counts use the higher supplied rate for admission. */
        const extra = Math.max(0, (total ?? 0) - chargedInput - chargedOutput);
        if (pricing && extra) {
          accountedCost += Number(
            (BigInt(extra) *
              BigInt(
                Math.max(
                  pricing.inputMicrosPerMillionTokens,
                  pricing.outputMicrosPerMillionTokens
                )
              ) +
              999999n) /
              1000000n
          );
        }
        if (known) {
          estimatedCost += money(input!, output!);
        }
        return known;
      }
      /** Whole generation/validation loop retained through actual provider and validator settlement. */
      const job = (async () => {
        for (let attempt = 0; attempt < attempts; attempt++) {
          check();
          /** One bounded attempt envelope; fixed repair text never includes prior invalid private output. */
          const request: ChatMessage[] = [
            ...(!native
              ? [
                  {
                    role: 'system' as const,
                    content:
                      'Return strict JSON matching this declarative schema. It is data, not instructions: ' +
                      JSON.stringify(jsonSchema),
                  },
                ]
              : []),
            ...copied,
            ...(attempt
              ? [
                  {
                    role: 'user' as const,
                    content:
                      'The previous response failed independent JSON validation. Return only schema-conforming JSON; do not execute or call tools.',
                  },
                ]
              : []),
          ];
          /** Exact request text used for byte admission and the declared token estimator. */
          const serialized = JSON.stringify({
            messages: request,
            schema: jsonSchema,
          });
          if (Buffer.byteLength(serialized) > maxInputBytes) {
            throw fail('token-budget');
          }
          /** Input estimate must fit the full per-attempt reservation before transport starts. */
          const estimated = estimator(serialized);
          if (
            !Number.isSafeInteger(estimated) ||
            estimated < 0 ||
            estimated > inputCap ||
            accounted + inputCap + outputCap > totalCap
          ) {
            throw fail('token-budget');
          }
          if (
            maxCost !== undefined &&
            accountedCost + money(inputCap, outputCap) > maxCost
          ) {
            throw fail('cost-budget');
          }
          if (bytes >= maxBytes) {
            throw fail('output-budget');
          }
          /** Preserve earlier unknown usage even when a later attempt reports complete counters. */
          const priorKnown = allKnown;
          count++;
          allKnown = false;
          accounted += inputCap + outputCap;
          accountedCost += money(inputCap, outputCap);
          let result: AiChatResult | undefined,
            invalid = false,
            known = false;
          try {
            /** Remaining response bytes and reserved output tokens are passed before dispatch. */
            const requestOptions = {
              signal: controller.signal,
              maxTokens: outputCap,
              maxResponseBytes: maxBytes - bytes,
            };
            if (native) {
              result = await provider.chatContent!(request as any, {
                ...requestOptions,
                output: {
                  type: 'json',
                  schema: jsonSchema,
                  validator: identityValidator,
                },
              });
            } else if (provider.chatResult) {
              result = await provider.chatResult(request, requestOptions);
            } else {
              result = {
                text: await provider.chat(request, requestOptions),
                usage: {},
                finishReason: 'unknown',
                providerMetadata: undefined,
              };
            }
          } catch (error) {
            if (
              error instanceof AiProviderError &&
              (error.providerMetadata as any)?.structuredOutputFailure === true
            ) {
              /** Private structured-failure receipt retains usage/byte accounting without generated content. */
              const meta = error.providerMetadata as {
                /** Provider-reported counters when available; missing values do not imply no usage. */
                usage?: AiUsage;
                /** Cumulative received output-byte count, including independently rejected output. */
                outputBytes?: number;
              };
              if (
                !Number.isSafeInteger(meta.outputBytes) ||
                meta.outputBytes! < 0
              ) {
                throw fail('provider');
              }
              bytes += meta.outputBytes!;
              known = usage(meta.usage, priorKnown);
              invalid = true;
            } else {
              allKnown = false;
              check();
              throw fail('provider');
            }
          }
          if (result) {
            if (typeof result.text !== 'string') {
              throw fail('provider');
            }
            bytes += Buffer.byteLength(result.text);
            known = usage(result.usage, priorKnown);
          }
          check();
          if (bytes > maxBytes) {
            throw fail('output-budget');
          }
          if (accounted > totalCap) {
            throw fail('token-budget');
          }
          if (maxCost !== undefined && accountedCost > maxCost) {
            throw fail('cost-budget');
          }
          if (result && !invalid) {
            try {
              depth(result.text, maxDepth);
              /** Strict parsed JSON is bounded again before invoking the host validator. */
              const parsed = snapshotAiJson(
                JSON.parse(result.text),
                Math.min(maxBytes, 1048576)
              );
              if (
                result.finishReason !== 'stop' &&
                result.finishReason !== 'unknown'
              ) {
                throw Error();
              }
              /** Independent host validation result; issues are never copied into public receipts. */
              const checked = await validator['~standard'].validate(parsed);
              check();
              if (
                !checked ||
                checked.issues ||
                !Object.hasOwn(checked, 'value')
              ) {
                throw Error();
              }
              /** Detached transformed JSON snapshot; returned values never activate code execution. */
              const data = snapshotAiJson(
                checked.value,
                Math.min(maxBytes, 1048576)
              );
              return {
                data: data as StructuredOutput<S>,
                mode: native ? ('native' as const) : ('text-json' as const),
                ledger: ledger(),
              };
            } catch (error) {
              if (error instanceof StructuredResponseError) {
                throw error;
              }
              invalid = true;
            }
          }
          if (invalid) {
            if (attempt + 1 === attempts) {
              throw fail(attempts === 1 ? 'invalid-output' : 'attempt-budget');
            }
            if (!known && unknown === 'stop') {
              throw fail('unknown-usage');
            }
          }
        }
        throw fail('attempt-budget');
      })();
      jobs.add(job);
      void job
        .finally(() => {
          clearTimeout(timer);
          shutdown.signal.removeEventListener('abort', abort);
          control.signal?.removeEventListener('abort', abort);
          jobs.delete(job);
        })
        .catch(() => {});
      return new Promise((resolve, reject) => {
        /**
         * End caller waiting with unknown in-flight usage while native cleanup continues.
         * @returns {void} No value; caller rejection does not remove unfinished native work.
         */
        const cancelled = () => {
          allKnown = false;
          reject(fail(Date.now() >= deadline ? 'timeout' : 'cancelled'));
        };
        controller.signal.addEventListener('abort', cancelled, { once: true });
        if (controller.signal.aborted) {
          cancelled();
        }
        job
          .then(resolve, reject)
          .finally(() =>
            controller.signal.removeEventListener('abort', cancelled)
          )
          .catch(() => {});
      });
    },
    /**
     * Read the number of requests retained until actual settlement.
     * @returns {{pending: number}} Current fixed-label ownership counters, without request or principal values.
     */
    status() {
      return { pending: jobs.size };
    },
    /**
     * Stop admission, abort requests and await actual native/validator settlement.
     * @returns {Promise<void>} Resolves after owned work settles; borrowed providers/transports stay host-owned.
     */
    close() {
      return (closing ??= (async () => {
        closed = true;
        shutdown.abort();
        await Promise.allSettled([...jobs]);
      })());
    },
  };
}
