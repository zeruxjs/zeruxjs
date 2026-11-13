import * as fs from 'node:fs';
import * as dns from 'node:dns';
import * as path from 'node:path';

/** Platform selector for the system hosts-file location. */
const isWindows = process.platform === 'win32';

/** Platform hosts file; only explicit management calls write it. */
const HOSTS_PATH = isWindows
  ? path.join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32',
      'drivers',
      'etc',
      'hosts'
    )
  : '/etc/hosts';
/** Exact beginning marker for the library-managed block. */
const MARKER_START = '# portless-start';
/** Exact ending marker for the library-managed block. */
const MARKER_END = '# portless-end';

/** Read the platform hosts file; read errors propagate so synchronization cannot overwrite unread entries.
 * @returns {string} Current UTF-8 hosts content.
 */
function readHostsFile(): string {
  return fs.readFileSync(HOSTS_PATH, 'utf-8');
}

/** Extract trimmed nonempty lines between the first ordered managed markers, without reading the filesystem.
 * @param {string} content - Host-file text supplied by the caller.
 * @returns {string[]} Managed lines, or an empty list when no ordered marker pair exists.
 */
export function extractManagedBlock(content: string): string[] {
  /** First opening marker position used to locate or validate the managed block. */
  const startIdx = content.indexOf(MARKER_START);
  /** First closing marker position, required to follow its opening marker. */
  const endIdx = content.indexOf(MARKER_END);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    return [];
  }
  /** Managed block text selected or generated independently of unrelated hosts entries. */
  const block = content.slice(startIdx + MARKER_START.length, endIdx);
  return block
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Remove one managed marker pair, rejecting malformed or repeated markers before returning replacement text.
 * @param {string} content - Original host-file text; unmanaged content is retained.
 * @returns {string} Text with the managed block removed and trailing newlines normalized.
 */
export function removeBlock(content: string): string {
  /** First opening marker position used to locate or validate the managed block. */
  const startIdx = content.indexOf(MARKER_START);
  /** First closing marker position, required to follow its opening marker. */
  const endIdx = content.indexOf(MARKER_END);
  if (startIdx === -1 && endIdx === -1) {
    return content;
  }
  if (
    startIdx === -1 ||
    endIdx === -1 ||
    endIdx <= startIdx ||
    content.indexOf(MARKER_START, startIdx + MARKER_START.length) !== -1 ||
    content.indexOf(MARKER_END, endIdx + MARKER_END.length) !== -1
  ) {
    throw new Error('Malformed portless managed hosts block');
  }
  /** Unmanaged content preceding the removed block. */
  const before = content.slice(0, startIdx);
  /** Unmanaged content following the removed block. */
  const after = content.slice(endIdx + MARKER_END.length);
  return (before + after).replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/** Render distinct validated lowercase DNS hostnames as loopback entries; performs no filesystem or DNS work.
 * @param {string[]} hostnames - Explicit hostnames to include, with no newline or address syntax allowed.
 * @returns {string} Managed block text, or an empty string for an empty list.
 */
export function buildBlock(hostnames: string[]): string {
  if (hostnames.length === 0) {
    return '';
  }
  /** Validated hostnames already rendered, preventing ambiguous duplicate entries. */
  const seen = new Set<string>();
  /** Detached hostname list after strict label and duplicate validation. */
  const validated = hostnames.map((host) => {
    if (
      typeof host !== 'string' ||
      host.length > 253 ||
      !host
        .split('.')
        .every(
          (label) =>
            label.length > 0 &&
            label.length <= 63 &&
            /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
        )
    ) {
      throw new TypeError('Invalid managed hostname');
    }
    if (seen.has(host)) {
      throw new TypeError('Duplicate managed hostname');
    }
    seen.add(host);
    return host;
  });
  /** Loopback mappings separated by newlines; validated names cannot inject extra records. */
  const entries = validated.map((h) => `127.0.0.1 ${h}`).join('\n');
  return `${MARKER_START}\n${entries}\n${MARKER_END}`;
}

/** Explicitly replace the platform hosts managed block after a successful read; requires host filesystem privileges.
 * @param {string[]} hostnames - Validated through buildBlock when nonempty.
 * @returns {boolean} True after writing; false on read, validation or write failure. This is not a transactional hosts editor.
 */
export function syncHostsFile(hostnames: string[]): boolean {
  try {
    /** Original hosts content read before attempting any replacement. */
    const content = readHostsFile();
    /** Replacement candidate retaining unmanaged content after marker validation. */
    const cleaned = removeBlock(content);

    if (hostnames.length === 0) {
      fs.writeFileSync(HOSTS_PATH, cleaned);
    } else {
      /** Managed block text selected or generated independently of unrelated hosts entries. */
      const block = buildBlock(hostnames);
      fs.writeFileSync(HOSTS_PATH, cleaned.trimEnd() + '\n\n' + block + '\n');
    }
    return true;
  } catch {
    return false;
  }
}

/** Explicitly remove the platform hosts managed block, leaving unrelated entries intact.
 * @returns {boolean} True when absent or successfully removed; false on filesystem or malformed-marker failure.
 */
export function cleanHostsFile(): boolean {
  try {
    /** Original hosts content read before attempting any replacement. */
    const content = readHostsFile();
    if (!content.includes(MARKER_START)) {
      return true;
    }
    fs.writeFileSync(HOSTS_PATH, removeBlock(content));
    return true;
  } catch {
    return false;
  }
}

/** Read hostnames from the current managed block without resolving or authorizing them.
 * @returns {string[]} Parsed second columns, or an empty list on read failure.
 */
export function getManagedHostnames(): string[] {
  let content: string;
  try {
    content = readHostsFile();
  } catch {
    return [];
  }
  return extractManagedBlock(content)
    .map((line) => {
      /** Whitespace-separated managed line columns; the length guard proves a hostname column exists. */
      const parts = line.split(/\s+/);
      return parts.length >= 2 ? parts[1]! : '';
    })
    .filter(Boolean);
}

/** Ask the system IPv4 resolver whether a hostname maps to loopback, without changing DNS or hosts files.
 * @param {string} hostname - Hostname to resolve; callers own policy and invocation timing.
 * @returns {Promise<boolean>} True only for 127.0.0.1, false for resolution failure or another address.
 */
export function checkHostResolution(hostname: string): Promise<boolean> {
  return new Promise((resolve) => {
    dns.lookup(hostname, { family: 4 }, (err, address) => {
      if (err) {
        resolve(false);
        return;
      }
      resolve(address === '127.0.0.1');
    });
  });
}
