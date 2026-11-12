import { open, lstat, rename, rm, mkdir } from 'node:fs/promises';
import { dirname, basename, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import type { EmailTemplate, RecipientRule } from './types.js';
import type { EmailTemplateRegistry } from './templates.js';
import type { RecipientFilter } from './filters.js';
/** Persistence is intentionally limited to non-secret templates and recipient rules. */
export interface SavedEmailState {
  /** Fixed persisted schema version one; other versions reject. */
  version: 1;
  /** Authored template copies; no SMTP account/password material is included. */
  templates: EmailTemplate[];
  /** Private recipient rules in authored order. */
  rules: RecipientRule[];
  /** Private canonical mailbox values; not anonymized by this snapshot. */
  suppressions: string[];
}
/** Resolve a trusted host path, create its private parent and reject final/parent symlink shapes.
 * @param {string} path - Trusted host state filename; never arbitrary HTTP input.
 * @param {boolean} checkExisting - Check an existing final file shape when true; default true.
 * @returns {Promise<string>} Absolute checked host path; ancestry/replacement races remain host responsibilities.
 */
async function safePath(path: string, checkExisting = true) {
  /** Resolved trusted host filename; path checks are not a filesystem sandbox. */
  const full = resolve(path);
  if (basename(full) === '.' || basename(full) === '..') {
    throw new TypeError('Invalid state path');
  }
  await mkdir(dirname(full), { recursive: true, mode: 0o700 });
  /** Immediate parent metadata checked against symlink substitution. */
  const parent = await lstat(dirname(full));
  if (parent.isSymbolicLink()) {
    throw new Error('State parent cannot be a symlink');
  }
  if (!checkExisting) {
    return full;
  }
  try {
    /** Existing final path metadata; nonregular files and final symlinks reject. */
    const current = await lstat(full);
    if (!current.isFile() || current.isSymbolicLink()) {
      throw new Error('Unsafe email state file');
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw e;
    }
  }
  return full;
}
/** Write bounded non-credential registry state through an exclusive private temporary file and rename.
 * @param {string} path - Trusted host state filename; never arbitrary HTTP input.
 * @param {EmailTemplateRegistry} templates - Borrowed template registry; load merges validated stored templates.
 * @param {RecipientFilter} filter - Borrowed recipient policy registry; rules replace and stored suppressions merge.
 * @returns {Promise<void>} State published; host owns directory trust, privacy and durable backup policy.
 */
export async function saveEmailState(
  path: string,
  templates: EmailTemplateRegistry,
  filter: RecipientFilter
): Promise<void> {
  /** Resolved trusted host filename; path checks are not a filesystem sandbox. */
  const full = await safePath(path);
  /** Versioned private templates/rules/suppressions only, never SMTP credentials. */
  const data: SavedEmailState = {
    version: 1,
    templates: templates.list(),
    rules: filter.listRules(),
    suppressions: filter.listSuppressions(),
  };
  /** Serialized state checked against the two-MiB UTF-8 ceiling. */
  const json = JSON.stringify(data);
  if (Buffer.byteLength(json) > 2 * 1024 * 1024) {
    throw new RangeError('Email state too large');
  }
  /** Random exclusive sibling path owned by this save invocation. */
  const temp = `${full}.${randomBytes(8).toString('hex')}.tmp`;
  let handle;
  try {
    handle = await open(temp, 'wx', 0o600);
    await handle.writeFile(json);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await safePath(path);
    await rename(temp, full);
  } finally {
    await handle?.close();
    await rm(temp, { force: true }).catch(() => {});
  }
}
/** Bound and stage-validate version-one state before merging into existing local registries.
 * @param {string} path - Trusted host state filename; never arbitrary HTTP input.
 * @param {EmailTemplateRegistry} templates - Borrowed template registry; load merges validated stored templates.
 * @param {RecipientFilter} filter - Borrowed recipient policy registry; rules replace and stored suppressions merge.
 * @returns {Promise<boolean>} False only for absent file; malformed/private-file errors reject. Existing unmatched entries remain.
 */
export async function loadEmailState(
  path: string,
  templates: EmailTemplateRegistry,
  filter: RecipientFilter
): Promise<boolean> {
  /** Resolved trusted host filename; path checks are not a filesystem sandbox. */
  const full = await safePath(path, false);
  let value: string;
  try {
    /** Owned no-follow read handle; closed in finally on every parse/read failure. */
    const handle = await open(
      full,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      0o600
    );
    try {
      /** Native file metadata checked before allocating the bounded read buffer. */
      const stats = await handle.stat();
      if (!stats.isFile() || stats.size > 2 * 1024 * 1024) {
        throw new RangeError('Email state too large');
      }
      /** One-byte overflow probe beyond the recorded file size to detect concurrent growth. */
      const bytes = Buffer.alloc(stats.size + 1);
      let size = 0;
      // Read at most the recorded size plus one byte, detecting concurrent file growth.
      while (size < bytes.length) {
        /** One native bounded read result; zero bytes end the scan. */
        const chunk = await handle.read(bytes, size, bytes.length - size, null);
        if (!chunk.bytesRead) {
          break;
        }
        size += chunk.bytesRead;
      }
      if (size > stats.size) {
        throw new Error('Email state changed during read');
      }
      value = bytes.subarray(0, size).toString('utf8');
    } finally {
      await handle.close();
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw e;
  }
  let decoded: SavedEmailState;
  try {
    decoded = JSON.parse(value);
  } catch {
    throw new TypeError('Corrupt email state JSON');
  }
  if (
    decoded?.version !== 1 ||
    !Array.isArray(decoded.templates) ||
    !Array.isArray(decoded.rules) ||
    !Array.isArray(decoded.suppressions)
  ) {
    throw new TypeError('Invalid email state');
  }
  // Validate all values before changing live state.
  /** Lazy local template validator used for staging before live mutation. */
  const { createTemplateRegistry } = await import('./templates.js');
  /** Lazy local policy validator used for staging before live mutation. */
  const { createRecipientFilter } = await import('./filters.js');
  /** Fully validated detached imported catalog; later merge preserves unmatched existing templates. */
  const stagedTemplates = createTemplateRegistry(decoded.templates);
  /** Fully validated imported rules/suppressions before any live registry mutation. */
  const stagedFilter = createRecipientFilter(
    decoded.rules,
    decoded.suppressions
  );
  // Merge validated templates; absent imported IDs do not delete existing live entries.
  for (const template of stagedTemplates.list()) {
    templates.set(template);
  }
  filter.setRules(stagedFilter.listRules());
  // Merge imported suppressions so an absent record never silently unsuppresses a recipient.
  for (const address of stagedFilter.listSuppressions()) {
    filter.suppress(address);
  }
  return true;
}
