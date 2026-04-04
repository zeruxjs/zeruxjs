// Simple logger used across ZeruxJS.
//
// Features:
//  - Configurable log file path (ENV `ZERUX_LOG_PATH` or default `./logs/app.log`)
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
 * Formats a log entry.
 */
function format(level: LogLevel, message: string, ...args: unknown[]): string {
  const timestamp = new Date().toISOString();
  const extra = args.length ? ` ${JSON.stringify(args)}` : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${extra}\n`;
}

/**
 * Core logger class.
 */
export class Logger {
  private readonly filePath: string;
  private readonly fileLevel: LogLevel;
  private readonly stream: WriteStream | null;

  constructor(options: LoggerOptions = {}) {
    // Resolve log file location
    const defaultPath = join(process.cwd(), 'logs', 'app.log');
    this.filePath = options.filePath ?? process.env.ZERUX_LOG_PATH ?? defaultPath;
    this.fileLevel = options.fileLevel ?? 'debug';

    // Ensure directory exists
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Create a write stream (append mode)
    this.stream = createWriteStream(this.filePath, { flags: 'a' });
  }

  /** Write a log entry to both console and file (if level >= fileLevel). */
  private write(level: LogLevel, message: string, ...args: unknown[]): void {
    const entry = format(level, message, ...args);

    // Console – colour‑coded for readability
    // eslint-disable-next-line no-console
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
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    if (this.stream && levels.indexOf(level) >= levels.indexOf(this.fileLevel)) {
      this.stream.write(entry);
    }
  }

  /** Log a debug message. */
  debug(message: string, ...args: unknown[]): void {
    this.write('debug', message, ...args);
  }

  /** Log an informational message. */
  info(message: string, ...args: unknown[]): void {
    this.write('info', message, ...args);
  }

  /** Log a warning. */
  warn(message: string, ...args: unknown[]): void {
    this.write('warn', message, ...args);
  }

  /** Log an error. */
  error(message: string, ...args: unknown[]): void {
    this.write('error', message, ...args);
  }

  /** Gracefully close the underlying file stream. */
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
