import { readStateFile } from './state-file.js';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Hostname sanitization
// ---------------------------------------------------------------------------

/** Maximum length of a single DNS label per RFC 1035. */
const MAX_DNS_LABEL_LENGTH = 63;

/** Bound one hostname label, appending a short deterministic hash when truncation is required; suffix collisions remain possible.
 * @param {string} label - Already sanitized label text.
 * @returns {string} Label within the 63-character budget; not a globally unique identity.
 */
export function truncateLabel(label: string): string {
  if (label.length <= MAX_DNS_LABEL_LENGTH) {
    return label;
  }

  // 6-char hex hash from the full label for uniqueness after truncation
  /** Short deterministic suffix reducing truncation collisions; never an authentication or uniqueness guarantee. */
  const hash = createHash('sha256').update(label).digest('hex').slice(0, 6);
  // Reserve space for "-" separator + 6-char hash = 7 chars
  /** Remaining label budget after the fixed separator/hash suffix. */
  const maxPrefixLength = MAX_DNS_LABEL_LENGTH - 7;
  /** Bounded sanitized project/branch prefix, with empty names excluded by its caller. */
  const prefix = label.slice(0, maxPrefixLength).replace(/-+$/, '');
  return `${prefix}-${hash}`;
}

/** Normalize an operator project/branch name to supported lowercase hostname characters and enforce the existing label limit.
 * @param {string} name - Local trusted project or branch label; this is not URL authorization.
 * @returns {string} Sanitized bounded label, possibly empty when no supported characters remain.
 */
export function sanitizeForHostname(name: string): string {
  /** Supported lowercase name candidate; an empty candidate falls through to another source. */
  const sanitized = name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return truncateLabel(sanitized);
}

// ---------------------------------------------------------------------------
// Project name inference
// ---------------------------------------------------------------------------

export interface InferredName {
  /** Sanitized inferred project label; not an authorization identity. */
  name: string;
  /** Human-readable local metadata source used for naming. */
  source: string;
}

/** Infer local project naming from inert package metadata, Git-root naming or the supplied directory basename, in that order.
 * @param {string} cwd - Trusted local project directory, defaulting to process.cwd().
 * @returns {InferredName} First nonempty sanitized name with its source label; no package modules are executed.
 */
export function inferProjectName(cwd: string = process.cwd()): InferredName {
  // 1. Walk up looking for package.json
  /** First inert package name found during trusted local parent traversal. */
  const pkgResult = findPackageJsonName(cwd);
  if (pkgResult) {
    /** Supported lowercase name candidate; an empty candidate falls through to another source. */
    const sanitized = sanitizeForHostname(pkgResult);
    if (sanitized) {
      return { name: sanitized, source: 'package.json' };
    }
  }

  // 2. Git repo root directory name
  /** Read-only local Git-root observation used only for naming. */
  const gitRoot = findGitRoot(cwd);
  if (gitRoot) {
    /** Supported lowercase name candidate; an empty candidate falls through to another source. */
    const sanitized = sanitizeForHostname(path.basename(gitRoot));
    if (sanitized) {
      return { name: sanitized, source: 'git root' };
    }
  }

  // 3. Current directory basename
  /** Supported lowercase name candidate; an empty candidate falls through to another source. */
  const sanitized = sanitizeForHostname(path.basename(cwd));
  if (sanitized) {
    return { name: sanitized, source: 'directory name' };
  }

  throw new Error(
    'Could not infer a project name from package.json, git root, or directory name'
  );
}

/** Walk parent paths looking only for an inert package.json name, ignoring unreadable or invalid files.
 * @param {string} startDir - Trusted local starting directory.
 * @returns {string | null} First nonempty package name with its scope prefix removed, or null.
 */
function findPackageJsonName(startDir: string): string | null {
  let dir = startDir;
  for (;;) {
    /** Fixed package.json leaf beneath the current trusted ancestor. */
    const pkgPath = path.join(dir, 'package.json');
    try {
      /** Local manifest text parsed as JSON, never loaded as an executable module. */
      const raw = fs.readFileSync(pkgPath, 'utf-8');
      /** Parsed metadata inspected only for a nonempty string name. */
      const pkg = JSON.parse(raw);
      if (typeof pkg.name === 'string' && pkg.name) {
        // Strip scoped prefix: @org/myapp → myapp
        return pkg.name.replace(/^@[^/]+\//, '');
      }
    } catch {
      // No package.json here or invalid JSON; keep walking
    }
    /** Next local ancestor; equality stops traversal at the root. */
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return null;
}

/** Try fixed read-only Git arguments with a finite native timeout, then inspect parent .git entries without shell interpolation.
 * @param {string} startDir - Trusted local working directory; executable/environment trust remains host-owned.
 * @returns {string | null} Observed repository-root directory or filesystem fallback, or null.
 */
function findGitRoot(startDir: string): string | null {
  // Try git CLI
  try {
    /** Trimmed output from a fixed read-only Git command with a finite timeout. */
    const toplevel = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: startDir,
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (toplevel) {
      return toplevel;
    }
  } catch {
    // git binary unavailable or not a git repo
  }

  // Fallback: walk up looking for .git directory
  let dir = startDir;
  for (;;) {
    /** Fixed .git candidate beneath the current trusted ancestor. */
    const gitPath = path.join(dir, '.git');
    try {
      /** Local .git entry metadata used only to distinguish a directory from pointer file. */
      const stat = fs.statSync(gitPath);
      if (stat.isDirectory()) {
        return dir;
      }
      // .git file (worktree or submodule) — the actual repo root is elsewhere,
      // but this directory is inside a git repo so it's a reasonable fallback
      if (stat.isFile()) {
        return dir;
      }
    } catch {
      // No .git here; keep walking
    }
    /** Next local ancestor; equality stops traversal at the root. */
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Worktree detection
// ---------------------------------------------------------------------------

export interface WorktreePrefix {
  /** Sanitized linked-worktree branch suffix; finite naming collisions remain possible. */
  prefix: string;
  /** Human-readable local metadata source used for naming. */
  source: string;
}

/** Branch names that represent the default/primary checkout — no prefix needed. */
const DEFAULT_BRANCHES = new Set(['main', 'master']);

/** Use the last branch segment as a sanitized worktree prefix, excluding detached/default branches.
 * @param {string} branch - Local Git branch metadata, not a role or permission claim.
 * @returns {string | null} Sanitized nonempty prefix, or null when no prefix should be applied.
 */
function branchToPrefix(branch: string): string | null {
  if (!branch || branch === 'HEAD' || DEFAULT_BRANCHES.has(branch)) {
    return null;
  }
  /** Final slash-separated branch segment; splitting always supplies one element. */
  const lastSegment = branch.split('/').pop()!;
  /** Bounded sanitized project/branch prefix, with empty names excluded by its caller. */
  const prefix = sanitizeForHostname(lastSegment);
  return prefix || null;
}

/** Distinguish a linked nondefault-branch worktree using fixed Git commands, with a local-file fallback only when CLI inspection fails.
 * @param {string} cwd - Trusted local project directory, defaulting to process.cwd().
 * @returns {WorktreePrefix | null} Observed naming prefix/source, or null for primary/default/detached/unknown state.
 */
export function detectWorktreePrefix(
  cwd: string = process.cwd()
): WorktreePrefix | null {
  // Primary: git CLI
  /** CLI observation distinguishing explicit no-prefix from failed CLI inspection. */
  const cliResult = detectWorktreeViaCli(cwd);
  if (cliResult !== undefined) {
    return cliResult;
  }

  // Fallback: parse .git file and HEAD when git binary is unavailable
  return detectWorktreeViaFilesystem(cwd);
}

/** Read fixed worktree/branch metadata, distinguishing the main checkout from a linked worktree before naming it.
 * @param {string} cwd - Trusted local Git working directory.
 * @returns {WorktreePrefix | null | undefined} Prefix, explicit no-prefix result, or undefined when the local CLI path cannot be inspected.
 */
function detectWorktreeViaCli(cwd: string): WorktreePrefix | null | undefined {
  try {
    /** Fixed Git worktree-list output, bounded by the native exec helper defaults and timeout. */
    const listOutput = execFileSync(
      'git',
      ['worktree', 'list', '--porcelain'],
      {
        cwd,
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }
    );

    // Count worktrees — each block starts with "worktree "
    /** Observed checkout blocks; a single checkout needs no disambiguating prefix. */
    const worktreeCount = listOutput
      .split('\n')
      .filter((l) => l.startsWith('worktree ')).length;
    if (worktreeCount <= 1) {
      return null;
    }

    // Multiple worktrees exist, but only add a prefix if the current
    // directory is a *linked* worktree (created via `git worktree add`),
    // not the root/main worktree. Developers frequently work on feature
    // branches in their main clone and don't want branch prefixes there.
    //
    // In a linked worktree, --git-dir points to .git/worktrees/<name>
    // while --git-common-dir points to the shared .git directory. In the
    // root worktree they resolve to the same path.
    /** Resolved current checkout metadata directory from fixed Git arguments. */
    const gitDir = path.resolve(
      cwd,
      execFileSync('git', ['rev-parse', '--git-dir'], {
        cwd,
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
    );

    /** Resolved shared metadata directory used to distinguish a linked worktree. */
    const gitCommonDir = path.resolve(
      cwd,
      execFileSync('git', ['rev-parse', '--git-common-dir'], {
        cwd,
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
    );

    if (gitDir === gitCommonDir) {
      return null;
    }

    /** Observed local branch name or parsed HEAD reference, never an executable command. */
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

    /** Bounded sanitized project/branch prefix, with empty names excluded by its caller. */
    const prefix = branchToPrefix(branch);
    if (!prefix) {
      return null;
    }

    return { prefix, source: 'git branch' };
  } catch {
    return undefined;
  }
}

/** Inspect local .git pointer/HEAD metadata without evaluating repository contents; submodule pointers do not become worktree prefixes.
 * @param {string} startDir - Trusted local starting directory; parent traversal stops at a stable root.
 * @returns {WorktreePrefix | null} Linked-worktree naming metadata, or null when unavailable/unsupported.
 */
function detectWorktreeViaFilesystem(startDir: string): WorktreePrefix | null {
  let dir = startDir;
  for (;;) {
    /** Fixed .git candidate beneath the current trusted ancestor. */
    const gitPath = path.join(dir, '.git');
    try {
      /** Local .git entry metadata used only to distinguish a directory from pointer file. */
      const stat = fs.statSync(gitPath);
      if (stat.isDirectory()) {
        // Regular .git directory — not a worktree
        return null;
      }
      if (stat.isFile()) {
        /** Bounded inert .git pointer-file text from the opened inode. */
        const content = readStateFile(gitPath, 65536)
          .bytes.toString('utf8')
          .trim();
        /** Anchored gitdir-pointer match whose required first capture exists on success. */
        const match = content.match(/^gitdir:\s*(.+)$/);
        if (!match) {
          return null;
        }

        /** Required validated-position pointer capture, resolved as local metadata by the existing heuristic. */
        const gitdir = match[1]!;
        // Only treat as a worktree if gitdir points into a /worktrees/ path.
        // Submodules point to /modules/ instead.
        if (!gitdir.match(/[/\\]worktrees[/\\][^/\\]+$/)) {
          return null;
        }

        // Read the branch name from the worktree's HEAD file
        /** Observed local branch name or parsed HEAD reference, never an executable command. */
        const branch = readBranchFromHead(path.resolve(dir, gitdir));
        /** Bounded sanitized project/branch prefix, with empty names excluded by its caller. */
        const prefix = branchToPrefix(branch ?? '');
        if (!prefix) {
          return null;
        }

        return { prefix, source: 'git branch' };
      }
    } catch {
      // No .git here; keep walking
    }
    /** Next local ancestor; equality stops traversal at the root. */
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return null;
}

/** Read an inert local HEAD reference, retaining detached/unreadable state as unavailable.
 * @param {string} gitdir - Trusted resolved Git metadata directory.
 * @returns {string | null} Required branch-name capture from a symbolic HEAD, or null.
 */
function readBranchFromHead(gitdir: string): string | null {
  try {
    /** Trimmed inert local HEAD text; no source files or hooks are loaded. */
    const head = fs.readFileSync(path.join(gitdir, 'HEAD'), 'utf-8').trim();
    /** Anchored symbolic-HEAD match whose required branch capture exists on success. */
    const refMatch = head.match(/^ref: refs\/heads\/(.+)$/);
    return refMatch ? refMatch[1]! : null;
  } catch {
    return null;
  }
}
