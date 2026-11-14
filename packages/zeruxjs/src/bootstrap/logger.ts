import { getRequestCorrelation } from '../observability.js';
// Simple logger used across ZeruxJS.
//
// Features:
//  - Configurable log file path (ENV `ZERUX_LOG_PATH` or `.zerux/log/app.log`)
//  - Automatic creation of the log directory
//  - Console output (info/warn/error/debug) with timestamps
//  - File output (same format) using a single write stream
//
// The logger is deliberately lightweight – no external dependencies – to keep the
// core bundle small. It can be extended or replaced by the consumer if a more
// sophisticated logger (e.g., winston, pino) is required.

import { existsSync, mkdirSync, createWriteStream, WriteStream } from 'node:fs';
import { join, dirname } from 'node:path';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LoggerOptions {
  /** Path to the log file. */
  filePath?: string;
  /** Minimum level that will be written to the file. */
  fileLevel?: LogLevel;
}

/**
 * Format one bounded entry with request correlation and redacted supplemental values.
 * @param {LogLevel} level - Fixed severity label.
 * @param {string} message - Message scrubbed for control characters, URLs and bearer tokens.
 * @param {unknown[]} args - Supplemental values; only numeric and Boolean values survive.
 * @returns {string} Newline-terminated entry for the console and append stream.
 */
function format(level: LogLevel, message: string, ...args: unknown[]): string {
  /** Wall-clock timestamp for this emission, independent of request start time. */
  const timestamp = new Date().toISOString();
  message = String(message)
    .slice(0, 4096)
    // eslint-disable-next-line no-control-regex -- Intentionally remove control characters from the log message.
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/https?:\/\/[^\s]+/gi, '[url redacted]')
    .replace(/(bearer\s+)[^\s]+/gi, '$1[redacted]');
  /** Borrowed request-scoped correlation fields, without request bodies or headers. */
  const context = getRequestCorrelation();
  /** Bounded supplemental projection that never serializes caller objects or errors. */
  const safe = args.slice(0, 16).map((value) => {
    if (value instanceof Error) {
      return { name: 'Error' };
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }
    return '[redacted]';
  });
  /** Fixed structured suffix; missing request context contributes no fields. */
  const extra =
    ' ' +
    JSON.stringify({
      ...(context ?? {}),
      ...(safe.length ? { details: safe } : {}),
    });
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${extra}\n`;
}

/**
 * Core logger class.
 */
export class Logger {
  /** Current append destination; relocation preserves the legacy public contract. */
  private readonly filePath: string;
  /** Minimum file severity; console output remains unconditional. */
  private readonly fileLevel: LogLevel;
  /** Owned append stream, ended on close or before relocation. */
  private stream: WriteStream | null;

  /** Create the log directory and an owned append stream immediately.
   * @param {LoggerOptions} options - Optional file path and minimum file severity.
   */
  constructor(options: LoggerOptions = {}) {
    // Resolve log file location
    /** Process-relative compatibility destination used when no path is configured. */
    const defaultPath = join(process.cwd(), '.zerux', 'log', 'app.log');
    this.filePath =
      options.filePath ?? process.env.ZERUX_LOG_PATH ?? defaultPath;
    this.fileLevel = options.fileLevel ?? 'debug';

    // Ensure directory exists
    /** Parent directory required before opening the owned append stream. */
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Create a write stream (append mode)
    this.stream = createWriteStream(this.filePath, { flags: 'a' });
  }

  /** Write to the console and, when severity permits, the owned file stream.
   * @param {LogLevel} level - Fixed severity used for routing and file filtering.
   * @param {string} message - Message sanitized by the shared formatter.
   * @param {unknown[]} args - Supplemental values passed through redaction.
   * @returns {void} Writes are scheduled; this method does not await stream flush.
   */
  private write(level: LogLevel, message: string, ...args: unknown[]): void {
    /** Single sanitized entry reused for console and file output. */
    const entry = format(level, message, ...args);

    // Console – colour‑coded for readability

    switch (level) {
      case 'debug':
        console.debug(entry.trim());
        break;
      case 'info':
        console.info(entry.trim());
        break;
      case 'warn':
        console.warn(entry.trim());
        break;
      case 'error':
        console.error(entry.trim());
        break;
    }

    // File – respect the configured minimum level
    /** Stable severity order used only for the file threshold. */
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    if (
      this.stream &&
      levels.indexOf(level) >= levels.indexOf(this.fileLevel)
    ) {
      this.stream.write(entry);
    }
  }

  /** Log a debug message through the shared redaction boundary.
   * @param {string} message - Caller message, scrubbed before output.
   * @param {unknown[]} args - Supplemental values, never serialized as arbitrary objects.
   * @returns {void} Console emission and optional append scheduling completion.
   */
  debug(message: string, ...args: unknown[]): void {
    this.write('debug', message, ...args);
  }

  /** Log a informational message through the shared redaction boundary.
   * @param {string} message - Caller message, scrubbed before output.
   * @param {unknown[]} args - Supplemental values, never serialized as arbitrary objects.
   * @returns {void} Console emission and optional append scheduling completion.
   */
  info(message: string, ...args: unknown[]): void {
    this.write('info', message, ...args);
  }

  /** Log a warning message through the shared redaction boundary.
   * @param {string} message - Caller message, scrubbed before output.
   * @param {unknown[]} args - Supplemental values, never serialized as arbitrary objects.
   * @returns {void} Console emission and optional append scheduling completion.
   */
  warn(message: string, ...args: unknown[]): void {
    this.write('warn', message, ...args);
  }

  /** Log a error message through the shared redaction boundary.
   * @param {string} message - Caller message, scrubbed before output.
   * @param {unknown[]} args - Supplemental values, never serialized as arbitrary objects.
   * @returns {void} Console emission and optional append scheduling completion.
   */
  error(message: string, ...args: unknown[]): void {
    this.write('error', message, ...args);
  }

  /** End the current stream and open the conventional file under a host directory.
   * @param {string} directory - Trusted host-owned runtime directory.
   * @returns {void} Replacement stream installation; old-stream flush is not awaited.
   */
  relocate(directory: string): void {
    /** New host-selected directory with the conventional log file suffix. */
    const newPath = join(directory, 'log', 'app.log');
    if (this.filePath === newPath) {
      return;
    }

    // Close current stream
    if (this.stream) {
      this.stream.end();
    }

    // Update path
    (this as any).filePath = newPath;

    // Ensure directory exists
    /** Parent directory required before opening the owned append stream. */
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Open new stream
    this.stream = createWriteStream(this.filePath, { flags: 'a' });
  }

  /** Read the active destination for host diagnostics; do not expose it publicly.
   * @returns {string} Current local log path.
   */
  getFilePath(): string {
    return this.filePath;
  }

  /** Request an orderly end of the owned append stream.
   * @returns {void} End request completion, not a promise that bytes have flushed.
   */
  close(): void {
    if (this.stream) {
      this.stream.end();
    }
  }
}

/**
 * Export a singleton that can be imported throughout the project.
 * Consumers may also instantiate their own Logger with custom options.
 */
export const logger = new Logger();
