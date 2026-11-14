/** Streaming, replay-safe, server-side campaign audience ingestion.
 * Never put CSV data or recipients into BullMQ; only durable message IDs are queued. */
import type { MarketingRecipient } from './marketing.js';
import { StringDecoder } from 'node:string_decoder';

export interface CampaignAppendPort {
  /** Persist one authorized matching recipient batch without embedding private payloads in queue jobs.
   * @param {string} code - Host-authorized exact campaign reference; never an arbitrary endpoint or executable identifier.
   * @param {readonly (string | MarketingRecipient)[]} recipients - Explicit private strings/structured recipients for one service batch.
   * @param {boolean} enqueueNow - Optional explicit enqueue decision; import staging passes false.
   * @returns {Promise<{added: number, existing: number, recipientCount: number}>} Committed batch counts; matching replay uses existing identities rather than duplicate delivery.
   */
  appendRecipients(
    code: string,
    recipients: readonly (string | MarketingRecipient)[],
    enqueueNow?: boolean
  ): Promise<{
    /** Number of newly committed recipient identities in this operation. */
    added: number; /** Matching persisted identities recognized as replay; conflicting payloads remain service errors. */
    existing: number; /** Current service campaign recipient count, not consent or delivery evidence. */
    recipientCount: number;
  }>;
  /** Enqueue a bounded explicit campaign page through the host service ownership policy.
   * @param {string} code - Host-authorized exact campaign reference; never an arbitrary endpoint or executable identifier.
   * @param {{ cursor?: string | null; limit?: number }} page - Optional exclusive bounded service page controls; no raw query language.
   * @returns {Promise<{queued: number, nextCursor: string | null}>} Queue-reference counts and continuation; accepted enqueue is not SMTP delivery.
   */
  enqueue(
    code: string,
    page?: { cursor?: string | null; limit?: number }
  ): Promise<{
    /** Accepted reference enqueue count; may include previously pending campaign recipients. */
    queued: number; /** Exclusive service continuation; null terminates that scan. */
    nextCursor: string | null;
  }>;
}
export interface CampaignImportOptions {
  /** Import batch 1–1000, default 200. */
  batchSize?: number;
  /** Imported-record budget 1–1000000, default 100000; excludes preexisting campaign totals. */
  maxRecipients?: number;
  /** Explicit true enqueues pending campaign pages after import; default false. */
  enqueueAfter?: boolean;
  /** Optional cooperative cancellation checked between records/service calls. */
  signal?: AbortSignal;
  /** Awaited count-only callback after batch persistence; failure stops import without rollback. */
  onProgress?: (result: {
    /** Records in batches successfully acknowledged by append, including exact replays. */
    processed: number;
    /** Number of newly committed recipient identities in this operation. */
    added: number;
    /** Matching persisted identities recognized as replay; conflicting payloads remain service errors. */
    existing: number;
  }) => void | Promise<void>;
}
/** Consume explicit recipient records in finite batches; raw CSV must first pass through the separate parser.
 * @param {CampaignAppendPort} service - Borrowed authorized application append/enqueue port; no lifecycle transfer.
 * @param {string} code - Host-authorized exact campaign reference; never an arbitrary endpoint or executable identifier.
 * @param {| AsyncIterable<string | MarketingRecipient>
    | Iterable<string | MarketingRecipient>} source - Explicit record iterable or CSV text/byte iterable according to the owning API; never fetched by this helper.
 * @param {CampaignImportOptions} options - Explicit row/byte/batch/cancellation/progress policy; defaults are finite.
 * @returns {Promise<{campaignCode: string, processed: number, added: number, existing: number, queued: number}>} Committed import counts; progress failure does not roll back a batch and optional enqueue can include prior pending campaign recipients.
 */
export async function importMarketingRecipients(
  service: CampaignAppendPort,
  code: string,
  source:
    | AsyncIterable<string | MarketingRecipient>
    | Iterable<string | MarketingRecipient>,
  options: CampaignImportOptions = {}
) {
  if (
    !service ||
    typeof service.appendRecipients !== 'function' ||
    typeof service.enqueue !== 'function' ||
    !source ||
    !(
      Symbol.asyncIterator in Object(source) ||
      Symbol.iterator in Object(source)
    )
  ) {
    throw new TypeError('Invalid campaign import');
  }
  /** Validated import batch ceiling, default two hundred and maximum one thousand. */
  const size = options.batchSize ?? 200;
  /** Total explicit imported-record ceiling, separate from existing campaign recipients. */
  const max = options.maxRecipients ?? 100_000;
  if (
    !Number.isSafeInteger(size) ||
    size < 1 ||
    size > 1000 ||
    !Number.isSafeInteger(max) ||
    max < 1 ||
    max > 1_000_000 ||
    (options.enqueueAfter !== undefined &&
      typeof options.enqueueAfter !== 'boolean')
  ) {
    throw new RangeError('Invalid campaign import bounds');
  }
  // Only acknowledged append batches advance these counts; callbacks cannot roll them back.
  let processed = 0,
    added = 0,
    existing = 0,
    queued = 0;
  /** Private pending record references retained only until the borrowed append call settles. */
  const batch: (string | MarketingRecipient)[] = [];
  /** Honor cooperative import cancellation between records and service calls.

 * @returns {void} Throws host cancellation reason; cannot undo a committed batch or force-stop a callback. */
  const check = () => {
    if (options.signal?.aborted) {
      throw options.signal.reason ?? new Error('Campaign import aborted');
    }
  };
  /** Persist the current batch without enqueueing, verify count totals, then await count-only progress.

 * @returns {Promise<void>} Batch acknowledged and cleared; later progress failure does not roll back persistence. */
  const flush = async () => {
    if (!batch.length) {
      return;
    }
    check();
    /** Acknowledged append counts; safe integers and the exact batch-size sum are required. */
    const result = await service.appendRecipients(code, batch, false);
    if (
      !Number.isSafeInteger(result.added) ||
      !Number.isSafeInteger(result.existing) ||
      result.added + result.existing !== batch.length
    ) {
      throw new Error('Invalid import checkpoint');
    }
    processed += batch.length;
    added += result.added;
    existing += result.existing;
    batch.length = 0;
    await options.onProgress?.({ processed, added, existing });
  };
  // Honor total import capacity and cooperative cancellation before accepting every explicit source record.
  for await (const entry of source) {
    check();
    if (processed + batch.length >= max) {
      throw new RangeError('Import recipient limit exceeded');
    }
    batch.push(entry);
    if (batch.length === size) {
      await flush();
    }
  }
  await flush();
  if (options.enqueueAfter) {
    let cursor: string | null = null;
    // Page only the authorized service enqueue port; existing pending campaign recipients can also be queued.
    do {
      check();
      /** Borrowed campaign enqueue page; only opaque message references reach its queue. */
      const page = await service.enqueue(code, { cursor, limit: 200 });
      queued += page.queued;
      cursor = page.nextCursor;
    } while (cursor !== null);
  }
  return { campaignCode: code, processed, added, existing, queued };
}

/** Parse bounded strict quoted CSV as inert data without sending, subscribing or evaluating source modules.
 * @param {string | AsyncIterable<string | Uint8Array>} source - Explicit record iterable or CSV text/byte iterable according to the owning API; never fetched by this helper.
 * @param {{ maxRows?: number; maxBytes?: number }} options - Explicit row/byte/batch/cancellation/progress policy; defaults are finite.
 * @param {number} options.maxRows - Data rows 1–1000000, default 100000.
 * @param {number} options.maxBytes - Aggregate input bytes 1–500000000, default 50000000.
 * @returns {AsyncGenerator<MarketingRecipient>} Private parsed records; append service still validates mailbox/data schema and authorization.
 */
export async function* parseMarketingRecipientCSV(
  source: string | AsyncIterable<string | Uint8Array>,
  options: {
    /** CSV data-row ceiling 1–1000000, default 100000; header/blank rows do not count. */
    maxRows?: number; /** Aggregate CSV input-byte ceiling 1–500000000, default 50000000. */
    maxBytes?: number;
  } = {}
): AsyncGenerator<MarketingRecipient> {
  /** Validated CSV data-row ceiling, excluding header/blank records. */
  const maxRows = options.maxRows ?? 100_000;
  /** Validated aggregate raw CSV byte ceiling, independent of field/record size limits. */
  const maxBytes = options.maxBytes ?? 50_000_000;
  if (
    !Number.isSafeInteger(maxRows) ||
    maxRows < 1 ||
    maxRows > 1_000_000 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > 500_000_000
  ) {
    throw new RangeError('Invalid CSV limits');
  }
  /** Local UTF-8 fragment decoder; no file, remote transport or source module is opened. */
  const decoder = new StringDecoder('utf8');
  /** Explicit CSV text/byte source; the helper never fetches a URL or opens a filename. */
  const sourceChunks: AsyncIterable<string | Uint8Array> =
    typeof source === 'string'
      ? (async function* () {
          yield source;
        })()
      : source;
  if (
    !sourceChunks ||
    typeof sourceChunks[Symbol.asyncIterator] !== 'function'
  ) {
    throw new TypeError('CSV input must be text or an async stream');
  }
  // Persist quote/cell/CRLF state across chunks without buffering the complete CSV source.
  let headers: string[] | null = null,
    rows = 0,
    bytes = 0,
    field = '',
    cells: string[] = [],
    quoted = false,
    afterQuote = false,
    started = false,
    firstChar = true,
    skipLF = false,
    recordLength = 0;
  /** Finish one bounded CSV cell and enforce the column ceiling before advancing parser state.
   * @returns {void} Cell appended; field/quote state reset without evaluating its contents.
   */
  function finishField() {
    if (field.length > 16_384) {
      throw new RangeError('CSV field exceeds limit');
    }
    cells.push(field);
    field = '';
    if (cells.length > 64) {
      throw new RangeError('Too many CSV columns');
    }
    afterQuote = false;
  }
  /** Convert one completed strict CSV row into inert private recipient data.

 * @returns {MarketingRecipient | null} Parsed row, or null for header/blank record; downstream service owns mailbox/nested-data validation. */
  const parseRecord = (): MarketingRecipient | null => {
    finishField();
    /** Completed private row cells detached from the parser state before header/data validation. */
    const values = cells;
    cells = [];
    recordLength = 0;
    if (values.length === 1 && values[0] !== undefined && !values[0].trim()) {
      return null;
    }
    if (!headers) {
      headers = values.map((v) => v.trim().replace(/^\uFEFF/, ''));
      if (
        headers[0] !== 'email' ||
        headers.some((v, i) => headers!.indexOf(v) !== i) ||
        headers.some(
          (v) =>
            v !== 'email' &&
            v !== 'name' &&
            v !== 'data' &&
            !/^data\.[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(v)
        ) ||
        headers.some((v) =>
          v
            .split('.')
            .some((x) => ['constructor', 'prototype', '__proto__'].includes(x))
        )
      ) {
        throw new TypeError(
          'CSV headers must start with email and use safe names'
        );
      }
      return null;
    }
    if (values.length !== headers.length) {
      throw new TypeError('CSV row does not match header');
    }
    /** First CSV field normalized as the imported recipient address. */
    const email = values[0];
    if (email === undefined) {
      throw new TypeError('CSV email field is missing');
    }
    if (++rows > maxRows) {
      throw new RangeError('CSV row limit exceeded');
    }
    /** Private parsed recipient or completed-row result; never executed as a command/module. */
    const record: MarketingRecipient = { email: email.trim() };
    /** Private inert per-recipient JSON/scalar data; nested schema checks remain with append. */
    const data: Record<string, unknown> = {};
    // Interpret only validated named columns; literal values remain inert private recipient data.
    for (let i = 1; i < headers.length; i++) {
      /** Validated explicit header identity; prototype-related names are rejected. */
      const key = headers[i];
      /** Literal decoded text/cell data, not a raw query or executable expression. */
      const value = values[i];
      if (key === undefined || value === undefined) {
        throw new TypeError('CSV row cell is missing');
      }
      if (key === 'name') {
        record.name = value;
      } else if (key === 'data' && value.trim()) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(value);
        } catch {
          throw new TypeError('Invalid CSV JSON data');
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new TypeError('CSV data must be a JSON object');
        }
        // Copy only permitted top-level JSON keys; nested application schema validation remains downstream.
        for (const [name, v] of Object.entries(parsed)) {
          if (['constructor', 'prototype', '__proto__'].includes(name)) {
            throw new TypeError('Unsafe CSV JSON key');
          }
          data[name] = v;
        }
      } else if (key.startsWith('data.')) {
        data[key.slice(5)] = value;
      }
    }
    if (Object.keys(data).length) {
      record.data = data;
    }
    return record;
  };
  // Generator yield is performed outside the record parser to keep state deterministic.
  /** Advance one bounded deterministic CSV character state without yielding inside the record parser.
   * @param {string} character - One decoded string-iterator character, treated only as CSV syntax/data.
   * @returns {MarketingRecipient | null} Completed inert row, or null until a record boundary. */
  const consume = (character: string): MarketingRecipient | null => {
    if (firstChar) {
      firstChar = false;
      if (character === '\uFEFF') {
        return null;
      }
    }
    if (skipLF) {
      skipLF = false;
      if (character === '\n') {
        return null;
      }
    }
    if (++recordLength > 64_000) {
      throw new RangeError('CSV record exceeds limit');
    }
    if (quoted) {
      if (character === '"') {
        quoted = false;
        afterQuote = true;
      } else {
        field += character;
      }
      return null;
    }
    if (afterQuote) {
      if (character === '"') {
        field += '"';
        quoted = true;
        afterQuote = false;
        return null;
      }
      if (character !== ',' && character !== '\n' && character !== '\r') {
        throw new TypeError('Malformed CSV quote');
      }
    } else if (character === '"') {
      if (field.length) {
        throw new TypeError('Unexpected CSV quote');
      }
      quoted = true;
      started = true;
      return null;
    }
    if (character === ',') {
      finishField();
      started = true;
      return null;
    }
    if (character === '\n' || character === '\r') {
      if (character === '\r') {
        skipLF = true;
      }
      started = false;
      return parseRecord();
    }
    if (!afterQuote) {
      field += character;
    }
    started = true;
    return null;
  };
  // Count original source bytes before decoding any fragment or retaining CSV field text.
  for await (const chunk of sourceChunks) {
    bytes +=
      typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.byteLength;
    if (bytes > maxBytes) {
      throw new RangeError('CSV input exceeds limit');
    }
    /** Literal decoded text/cell data, not a raw query or executable expression. */
    const value =
      typeof chunk === 'string' ? chunk : decoder.write(Buffer.from(chunk));
    // Advance deterministic parser state on decoded characters; completed rows are yielded outside the parser.
    for (const char of value) {
      /** Private parsed recipient or completed-row result; never executed as a command/module. */
      const record = consume(char);
      if (record) {
        yield record;
      }
    }
  }
  // Flush a remaining UTF-8 decoder fragment under the same strict CSV state machine.
  for (const char of decoder.end()) {
    /** Private parsed recipient or completed-row result; never executed as a command/module. */
    const record = consume(char);
    if (record) {
      yield record;
    }
  }
  if (quoted) {
    throw new TypeError('Unterminated CSV quoted field');
  }
  if (started || cells.length || field.length) {
    /** Private parsed recipient or completed-row result; never executed as a command/module. */
    const record = parseRecord();
    if (record) {
      yield record;
    }
  }
  if (!headers) {
    throw new TypeError('Missing CSV header');
  }
}
