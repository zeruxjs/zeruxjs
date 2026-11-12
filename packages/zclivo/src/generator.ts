import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  copyFileSync,
  constants,
  unlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse,
  resolve,
  sep,
} from 'node:path';
import { createHash } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
/** Implemented authored source languages; no compiler is executed during planning. */
export type ProjectLanguage = 'javascript' | 'typescript';
/** Explicit supported output combination validated before rendering. */
export interface TemplateCapability {
  /** Explicit registered rendering mode. */
  mode: string;
  /** Explicit registered renderer; never auto-discovered from installed packages. */
  renderer: string;
  /** Nonempty supported language choices for this capability. */
  languages: readonly ProjectLanguage[];
}
/** Trusted explicit template callback and declared capability matrix; not a sandbox. */
export interface ProjectTemplate {
  /** Unique bounded template identifier. */
  id: string;
  /** Nonempty bounded supported combinations. */
  capabilities: readonly TemplateCapability[];
  /** Produce inert authored files from already validated project choices.
   * @param {Readonly<ResolvedProjectOptions>} options - Frozen supported selections supplied by this engine.
   * @returns {Readonly<Record<string, string>>} Bounded text file map, validated again before staging.
   */
  render(
    options: Readonly<ResolvedProjectOptions>
  ): Readonly<Record<string, string>>;
}
/** Caller project choices validated independently from writing. */
export interface ProjectOptions {
  /** Explicit/default registered template identifier. */
  template?: string;
  /** Validated display name; does not authorize an existing destination. */
  name?: string;
  /** New target path under a trusted existing canonical parent. */
  destination: string;
  /** Explicit supported source language. */
  language?: ProjectLanguage;
  /** Integer configured port; writing never binds it. */
  port?: number;
  /** Explicit registered renderer; never auto-discovered from installed packages. */
  renderer?: string;
  /** Explicit registered rendering mode. */
  mode?: string;
}
/** Frozen capability-validated inputs passed to trusted templates. */
export interface ResolvedProjectOptions {
  /** Explicit/default registered template identifier. */
  template: string;
  /** Validated display name; does not authorize an existing destination. */
  name: string;
  /** Validated lowercase npm package name derived from the display name. */
  packageName: string;
  /** New target path under a trusted existing canonical parent. */
  destination: string;
  /** Explicit supported source language. */
  language: ProjectLanguage;
  /** Integer configured port; writing never binds it. */
  port: number;
  /** Explicit registered renderer; never auto-discovered from installed packages. */
  renderer: string;
  /** Explicit registered rendering mode. */
  mode: string;
}
/** Bounded review document; digest identifies bytes, not authorship or write permission. */
export interface ProjectPlan {
  /** Plan document schema version; serialized copies cannot be written directly. */
  readonly schema: 1;
  /** Frozen validated resolved project choices. */
  readonly options: Readonly<ResolvedProjectOptions>;
  /** Bounded ordered UTF-8 text map or written relative paths for the receipt. */
  readonly files: Readonly<Record<string, string>>;
  /** SHA-256 content identity over the ordered file map; not a signature. */
  readonly digest: string;
}
/** Exclusive-write/dry-run receipt without installation or application execution. */
export interface ProjectWriteResult {
  /** Exclusive target directory associated with this receipt. */
  directory: string;
  /** Bounded ordered UTF-8 text map or written relative paths for the receipt. */
  files: string[];
  /** Whether files were actually written rather than merely planned. */
  created: boolean;
}
/** Package-instance plan identities; serialized JSON is review data, not write authorization. */
const plans = new WeakSet<object>();
/** Construct a fixed generator validation failure without interpreting input.
 * @param {string} message - Trusted diagnostic text.
 * @returns {TypeError} Explicit usage/configuration failure.
 */
const fail = (message: string) => new TypeError(message);
/** Inspect own data descriptors without evaluating saved configuration as code.
 * @param {unknown} input - Inert candidate or authored file map inspected before use.
 * @param {readonly string[]} keys - Optional explicit allowlist of own data-property names.
 * @returns {void} Validated result or an explicit failure; no generated module is executed.
 */
function object(
  input: unknown,
  keys?: readonly string[]
): asserts input is Record<string, unknown> {
  if (
    !input ||
    typeof input !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
    Reflect.ownKeys(input).some(
      (k) =>
        typeof k !== 'string' ||
        (keys && !keys.includes(k)) ||
        !('value' in Object.getOwnPropertyDescriptor(input, k)!)
    )
  ) {
    throw fail('Invalid generator object');
  }
}
/** Validate a bounded template/mode/renderer identifier as inert configuration.
 * @param {unknown} value - Candidate identifier.
 * @returns {boolean} Whether the value matches the supported literal identifier syntax.
 */
const identifier = (value: unknown) =>
  typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
/** Identify portable device/package/directory names unsuitable for new targets.
 * @param {string} value - Inert name/path candidate.
 * @returns {boolean} Validated result or an explicit failure; no generated module is executed.
 */
function reserved(value: string) {
  return (
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value) ||
    ['node_modules', 'favicon.ico', 'package.json'].includes(
      value.toLowerCase()
    )
  );
}
/** Validate a portable display/package target name without shell interpolation.
 * @param {unknown} value - Untrusted name candidate.
 * @returns {string} Validated original spelling; lowercase package naming happens in planning.
 */
export function validateProjectName(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(value) ||
    value.endsWith('.') ||
    value.includes('..') ||
    reserved(value)
  ) {
    throw fail(
      'Project name must be a simple non-hidden, non-reserved directory/package name'
    );
  }
  return value;
}
/** Read lstat metadata while treating only a genuinely missing path as absent.
 * @param {string} path - Trusted filesystem path selected by this invocation.
 * @returns {import('node:fs').Stats | null} Validated result or an explicit failure; no generated module is executed.
 */
function stat(path: string) {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}
/** Pin a real directory identity and reject filesystem links.
 * @param {string} path - Trusted filesystem path selected by this invocation.
 * @returns {{dev: number, ino: number}} Validated result or an explicit failure; no generated module is executed.
 */
function identity(path: string) {
  /** Current filesystem metadata used only for directory ownership checks. */
  const s = lstatSync(path);
  if (s.isSymbolicLink() || !s.isDirectory()) {
    throw fail('Generator directories must not be symlinks');
  }
  return { dev: s.dev, ino: s.ino };
}
/** Check whether this invocation still owns the exact real directory.
 * @param {string} path - Trusted filesystem path selected by this invocation.
 * @param {{dev: number, ino: number}} expected - Pinned device/inode identity, never inferred from caller claims.
 * @param {number} expected.dev - Original directory device identifier.
 * @param {number} expected.ino - Original directory inode identifier.
 * @returns {boolean} Validated result or an explicit failure; no generated module is executed.
 */
function same(path: string, expected: { dev: number; ino: number }) {
  /** Current filesystem metadata used only for directory ownership checks. */
  const s = stat(path);
  return (
    !!s &&
    s.isDirectory() &&
    !s.isSymbolicLink() &&
    s.dev === expected.dev &&
    s.ino === expected.ino
  );
}
/** Reject symlink parents rather than treating a shortcut as filesystem authorization.
 * @param {string} directory - New absolute project destination.
 * @returns {{path: string, identity: {dev: number, ino: number}}} Canonical verified parent and its pinned identity.
 */
function parentOf(directory: string) {
  /** Canonical existing target parent or pinned parent ownership record. */
  const parent = dirname(directory);
  /** Filesystem root used to walk and reject linked parent components. */
  const root = parse(parent).root;
  let current = root;
  identity(root);
  for (const part of parent.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    identity(current);
  }
  if (realpathSync(parent) !== parent) {
    throw fail('Use a canonical generator parent path');
  }
  return { path: parent, identity: identity(parent) };
}
/** Reject occupied targets including dangling symlinks.
 * @param {string} directory - New destination checked without following an existing link.
 * @returns {void} Validated result or an explicit failure; no generated module is executed.
 */
function free(directory: string) {
  if (stat(directory)) {
    throw Error('Project target already exists; refusing to overwrite');
  }
}
/** Validate a portable bounded relative authored file path.
 * @param {string} value - Inert name/path candidate.
 * @returns {string} Validated result or an explicit failure; no generated module is executed.
 */
function relativeFile(value: string) {
  if (
    !value ||
    value.length > 256 ||
    isAbsolute(value) ||
    value.includes('\\') ||
    value.includes(':') ||
    // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
    /[\x00-\x1f\x7f]/.test(value)
  ) {
    throw fail('Invalid template file path');
  }
  /** Bounded relative path components checked before any staged file write. */
  const segments = value.split('/');
  if (
    segments.length > 16 ||
    segments.some(
      (s) =>
        !s ||
        s === '.' ||
        s === '..' ||
        s.length > 100 ||
        !/^\.?[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/.test(s) ||
        s.endsWith('.') ||
        (reserved(s) && s !== 'package.json') ||
        s === 'node_modules' ||
        s === '.git'
    )
  ) {
    throw fail('Invalid template file path');
  }
  return value;
}
/** Stage-validate the complete file map before touching the filesystem.
 * @param {Readonly<Record<string, string>>} input - Inert candidate or authored file map inspected before use.
 * @returns {Readonly<Record<string, string>>} Validated result or an explicit failure; no generated module is executed.
 */
function files(input: Readonly<Record<string, string>>) {
  object(input);
  /** Own authored file entries sorted deterministically before validation and hashing. */
  const entries = Object.entries(input).sort(([a], [b]) => {
    if (a < b) {
      return -1;
    }
    if (a > b) {
      return 1;
    }
    return 0;
  });
  if (!entries.length || entries.length > 128) {
    throw fail('Template file budget exceeded');
  }
  let total = 0;
  /** Prototype-free validated file map returned frozen for planning. */
  const result: Record<string, string> = Object.create(null);
  /** Registration/file identities used to reject duplicates and case-folded collisions. */
  const seen = new Set<string>();
  for (const [path, body] of entries) {
    relativeFile(path);
    if (
      typeof body !== 'string' ||
      body.includes('\0') ||
      Buffer.byteLength(body) > 262144 ||
      (total += Buffer.byteLength(body)) > 2097152
    ) {
      throw fail('Template output budget exceeded');
    }
    /** Case-folded relative file identity used to prevent file/directory collisions. */
    const folded = path.toLowerCase();
    if (
      seen.has(folded) ||
      [...seen].some(
        (other) =>
          other.startsWith(folded + '/') || folded.startsWith(other + '/')
      )
    ) {
      throw fail('Template file/directory collision');
    }
    seen.add(folded);
    result[path] = body;
  }
  return Object.freeze(result);
}
/** Register only explicit trusted template callbacks with nonempty validated capabilities.
 * @param {readonly ProjectTemplate[]} templates - At most 16 host-authored registrations; no package scan or remote loading.
 * @returns {object} Inert capabilities/plan engine; explicit writers separately own filesystem changes.
 */
export function createProjectGenerator(templates: readonly ProjectTemplate[]) {
  if (!Array.isArray(templates) || !templates.length || templates.length > 16) {
    throw fail('Explicit bounded templates required');
  }
  /** Explicit validated template registry; no filesystem package discovery occurs. */
  const registered = new Map<
    string,
    {
      capabilities: readonly TemplateCapability[];
      render: ProjectTemplate['render'];
    }
  >();
  for (const template of templates) {
    if (
      !template ||
      !identifier(template.id) ||
      registered.has(template.id) ||
      typeof template.render !== 'function' ||
      !Array.isArray(template.capabilities) ||
      !template.capabilities.length ||
      template.capabilities.length > 16
    ) {
      throw fail('Invalid template registration');
    }
    /** Registration/file identities used to reject duplicates and case-folded collisions. */
    const seen = new Set<string>();
    /** Immutable validated template mode/renderer/language combinations. */
    const capabilities = template.capabilities.map((c: TemplateCapability) => {
      if (
        !identifier(c.mode) ||
        !identifier(c.renderer) ||
        !Array.isArray(c.languages) ||
        !c.languages.length ||
        c.languages.length > 2 ||
        c.languages.some(
          (l: ProjectLanguage) => !['javascript', 'typescript'].includes(l)
        ) ||
        new Set(c.languages).size !== c.languages.length ||
        seen.has(c.mode + ':' + c.renderer)
      ) {
        throw fail('Invalid template capabilities');
      }
      seen.add(c.mode + ':' + c.renderer);
      return Object.freeze({
        mode: c.mode,
        renderer: c.renderer,
        languages: Object.freeze([...c.languages]),
      });
    });
    registered.set(template.id, {
      capabilities: Object.freeze(capabilities),
      render: template.render.bind(template),
    });
  }
  return Object.freeze({
    capabilities: () =>
      Object.freeze(
        [...registered].map(([id, t]) =>
          Object.freeze({ id, capabilities: t.capabilities })
        )
      ),
    plan(input: ProjectOptions): ProjectPlan {
      object(input, [
        'template',
        'name',
        'destination',
        'language',
        'port',
        'renderer',
        'mode',
      ]);
      for (const field of [
        'template',
        'name',
        'language',
        'renderer',
        'mode',
      ] as const) {
        if (input[field] !== undefined && typeof input[field] !== 'string') {
          throw fail('Invalid generator option');
        }
      }
      if (input.port !== undefined && typeof input.port !== 'number') {
        throw fail('Invalid generator port');
      }
      if (
        typeof input.destination !== 'string' ||
        !input.destination.trim() ||
        input.destination.length > 4096 ||
        // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
        /[\x00-\x1f\x7f]/.test(input.destination)
      ) {
        throw fail('Project destination is required');
      }
      /** Absolute validated new destination; no directory is created during planning. */
      const destination = resolve(input.destination);
      validateProjectName(basename(destination));
      /** Validated display name retained separately from lowercase package naming. */
      const name = validateProjectName(input.name ?? basename(destination));
      /** Explicit/default registered template ID selected without runtime module imports. */
      const template = input.template ?? registered.keys().next().value!;
      /** Trusted registered template record; missing selection rejects before rendering. */
      const t = registered.get(template);
      if (!t) {
        throw fail('Unknown registered template');
      }
      // Template registration validates at least one capability before storing it.
      /** Explicit/default supported mode selected from nonempty registered capabilities. */
      const mode = input.mode ?? t.capabilities[0]!.mode;
      /** Explicit or mode-matched registered renderer; unsupported combinations reject. */
      const renderer =
        input.renderer ?? t.capabilities.find((c) => c.mode === mode)?.renderer;
      /** Exact supported mode/renderer combination authorizing this template shape. */
      const capability = t.capabilities.find(
        (c) => c.mode === mode && c.renderer === renderer
      );
      /** Supported explicit/default language selected from that combination. */
      const language =
        input.language ??
        (capability?.languages.includes('typescript')
          ? 'typescript'
          : (capability?.languages[0] ?? 'typescript'));
      /** Validated integer port configuration; never probed or reserved during generation. */
      const port = input.port ?? 3000;
      if (!capability || !capability.languages.includes(language)) {
        throw fail('Unsupported template mode/renderer/language combination');
      }
      if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
        throw fail('Port must be an integer in 1..65535');
      }
      // Validate capability and render before inspecting/writing a destination.
      /** Frozen resolved project choices passed only to the trusted registered template. */
      const options = Object.freeze({
        template,
        name,
        packageName: name.toLowerCase(),
        destination,
        language,
        port,
        renderer: renderer!,
        mode,
      });
      /** Validated bounded file map; template functions remain trusted executable host code. */
      const output = files(t.render(options));
      parentOf(destination);
      free(destination);
      /** Frozen reviewable file map and content hash enrolled in this package-instance WeakSet. */
      const plan = Object.freeze({
        schema: 1 as const,
        options,
        files: output,
        digest: createHash('sha256')
          .update(JSON.stringify(output))
          .digest('hex'),
      });
      plans.add(plan);
      return plan;
    },
  });
}
/** Create only private nested directories inside an owned root.
 * @param {string} root - Owned stage/target root already validated by the caller.
 * @param {string} relative - Validated authored relative file path.
 * @returns {void} Validated result or an explicit failure; no generated module is executed.
 */
function nested(root: string, relative: string) {
  let current = root;
  for (const part of relative.split('/').slice(0, -1)) {
    current = join(current, part);
    try {
      mkdirSync(current, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }
    identity(current);
  }
}
/** Own exclusive staging/promotion and clean only paths whose identities still match.
 * @param {ProjectPlan} plan - Actual plan object enrolled by this package instance.
 * @param {AbortSignal} signal - Optional borrowed cooperative cancellation signal.
 * @returns {Generator<void, ProjectWriteResult>} Stepwise writer; closing it executes owned rollback.
 */
function* materialize(
  plan: ProjectPlan,
  signal?: AbortSignal
): Generator<void, ProjectWriteResult> {
  if (
    !plans.has(plan) ||
    (signal !== undefined && !(signal instanceof AbortSignal))
  ) {
    throw fail('Validated generator plan and AbortSignal required');
  }
  signal?.throwIfAborted();
  /** Exclusive target destination from a package-instance validated plan. */
  const directory = plan.options.destination;
  /** Canonical existing target parent or pinned parent ownership record. */
  const parent = parentOf(directory);
  free(directory);
  /** Owned private staging directory under the canonical verified parent. */
  const staged = mkdtempSync(join(parent.path, '.zerux-starter-'));
  /** Pinned staging directory identity used before every write/promotion/cleanup. */
  const stageId = identity(staged);
  let targetId: { dev: number; ino: number } | undefined, failure: unknown;
  /** Recheck cooperative cancellation and owned parent/stage/target identities before each step.
   * @returns {void} Returns only while this invocation still owns its filesystem paths.
   */
  const check = () => {
    signal?.throwIfAborted();
    parentOf(directory);
    if (
      !same(parent.path, parent.identity) ||
      !same(staged, stageId) ||
      (targetId && !same(directory, targetId))
    ) {
      throw Error('Generator directory ownership changed');
    }
  };
  try {
    for (const [path, body] of Object.entries(plan.files)) {
      check();
      nested(staged, path);
      writeFileSync(join(staged, path), body, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o644,
      });
      yield;
    }
    check();
    try {
      mkdirSync(directory, { mode: 0o700 });
      targetId = identity(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw Error('Project target appeared during generation');
      }
      throw error;
    }
    for (const path of Object.keys(plan.files)) {
      check();
      nested(directory, path);
      if (stat(join(directory, path))) {
        throw Error('Generated destination appeared during promotion');
      }
      copyFileSync(
        join(staged, path),
        join(directory, path),
        constants.COPYFILE_EXCL
      );
      unlinkSync(join(staged, path));
      yield;
    }
    check();
    targetId = undefined;
    return { directory, files: Object.keys(plan.files), created: true };
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    /** Private rollback failures collected while attempting both owned directory cleanups. */
    const errors: unknown[] = [];
    if (targetId && same(directory, targetId)) {
      try {
        rmSync(directory, { recursive: true, force: true });
      } catch (error) {
        errors.push(error);
      }
    }
    if (same(staged, stageId)) {
      try {
        rmSync(staged, { recursive: true, force: true });
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) {
      // eslint-disable-next-line no-unsafe-finally -- Cleanup failure must propagate; this owner explicitly reports failed resource release.
      throw new AggregateError(
        [...(failure !== undefined ? [failure] : []), ...errors],
        'Generator rollback cleanup failed'
      );
    }
  }
}
/** Write a validated plan synchronously without installing or executing its files.
 * @param {ProjectPlan} plan - Actual plan produced by this package instance.
 * @param {{signal?: AbortSignal}} options - Explicit cooperative cancellation policy.
 * @param {AbortSignal} options.signal - Already observed aborts reject; synchronous work cannot process OS signals mid-turn.
 * @returns {ProjectWriteResult} Exclusive-write receipt after cleanup settles.
 */
export function writeProjectPlan(
  plan: ProjectPlan,
  options: { signal?: AbortSignal } = {}
): ProjectWriteResult {
  /** Owned materialization iterator; async writer closes it in finally to trigger rollback. */
  const iterator = materialize(plan, options.signal);
  let next = iterator.next();
  while (!next.done) {
    next = iterator.next();
  }
  return next.value;
}
/** Yield between staged/promoted files so owned SIGINT/AbortSignal can cancel and rollback.
 * @param {ProjectPlan} plan - Actual plan object produced by this package instance.
 * @param {{signal?: AbortSignal}} options - Explicit cooperative write policy.
 * @param {AbortSignal} options.signal - Borrowed lifetime checked before each staged/promoted file.
 * @returns {Promise<ProjectWriteResult>} Actual write receipt after owned iterator cleanup; no forced cancellation is claimed.
 */
export async function writeProjectPlanAsync(
  plan: ProjectPlan,
  options: { signal?: AbortSignal } = {}
): Promise<ProjectWriteResult> {
  /** Owned materialization iterator; async writer closes it in finally to trigger rollback. */
  const iterator = materialize(plan, options.signal);
  try {
    let next = iterator.next();
    while (!next.done) {
      await setImmediate();
      next = iterator.next();
    }
    return next.value;
  } finally {
    iterator.return?.({
      directory: '',
      files: [],
      created: false,
    });
  }
}
/** Public engine shape inferred from the explicit validated generator factory. */
export type ProjectGenerator = ReturnType<typeof createProjectGenerator>;
