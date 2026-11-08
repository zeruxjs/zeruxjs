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
export type ProjectLanguage = 'javascript' | 'typescript';
export interface TemplateCapability {
  mode: string;
  renderer: string;
  languages: readonly ProjectLanguage[];
}
export interface ProjectTemplate {
  id: string;
  capabilities: readonly TemplateCapability[];
  render(
    options: Readonly<ResolvedProjectOptions>,
  ): Readonly<Record<string, string>>;
}
export interface ProjectOptions {
  template?: string;
  name?: string;
  destination: string;
  language?: ProjectLanguage;
  port?: number;
  renderer?: string;
  mode?: string;
}
export interface ResolvedProjectOptions {
  template: string;
  name: string;
  packageName: string;
  destination: string;
  language: ProjectLanguage;
  port: number;
  renderer: string;
  mode: string;
}
export interface ProjectPlan {
  readonly schema: 1;
  readonly options: Readonly<ResolvedProjectOptions>;
  readonly files: Readonly<Record<string, string>>;
  readonly digest: string;
}
export interface ProjectWriteResult {
  directory: string;
  files: string[];
  created: boolean;
}
const plans = new WeakSet<object>();
const fail = (message: string) => new TypeError(message);
function object(
  input: unknown,
  keys?: readonly string[],
): asserts input is Record<string, unknown> {
  if (
    !input ||
    typeof input !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
    Reflect.ownKeys(input).some(
      (k) =>
        typeof k !== 'string' ||
        (keys && !keys.includes(k)) ||
        !('value' in Object.getOwnPropertyDescriptor(input, k)!),
    )
  )
    throw fail('Invalid generator object');
}
const identifier = (value: unknown) =>
  typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
function reserved(value: string) {
  return (
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value) ||
    ['node_modules', 'favicon.ico', 'package.json'].includes(
      value.toLowerCase(),
    )
  );
}
export function validateProjectName(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(value) ||
    value.endsWith('.') ||
    value.includes('..') ||
    reserved(value)
  )
    throw fail(
      'Project name must be a simple non-hidden, non-reserved directory/package name',
    );
  return value;
}
function stat(path: string) {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
function identity(path: string) {
  const s = lstatSync(path);
  if (s.isSymbolicLink() || !s.isDirectory())
    throw fail('Generator directories must not be symlinks');
  return { dev: s.dev, ino: s.ino };
}
function same(path: string, expected: { dev: number; ino: number }) {
  const s = stat(path);
  return (
    !!s &&
    s.isDirectory() &&
    !s.isSymbolicLink() &&
    s.dev === expected.dev &&
    s.ino === expected.ino
  );
}
/** Reject symlink parents rather than treating a shortcut as filesystem authorization. */
function parentOf(directory: string) {
  const parent = dirname(directory),
    root = parse(parent).root;
  let current = root;
  identity(root);
  for (const part of parent.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    identity(current);
  }
  if (realpathSync(parent) !== parent)
    throw fail('Use a canonical generator parent path');
  return { path: parent, identity: identity(parent) };
}
function free(directory: string) {
  if (stat(directory))
    throw Error('Project target already exists; refusing to overwrite');
}
function relativeFile(value: string) {
  if (
    !value ||
    value.length > 256 ||
    isAbsolute(value) ||
    value.includes('\\') ||
    value.includes(':') ||
    // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
    /[\x00-\x1f\x7f]/.test(value)
  )
    throw fail('Invalid template file path');
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
        s === '.git',
    )
  )
    throw fail('Invalid template file path');
  return value;
}
function files(input: Readonly<Record<string, string>>) {
  object(input);
  const entries = Object.entries(input).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  if (!entries.length || entries.length > 128)
    throw fail('Template file budget exceeded');
  let total = 0;
  const result: Record<string, string> = Object.create(null),
    seen = new Set<string>();
  for (const [path, body] of entries) {
    relativeFile(path);
    if (
      typeof body !== 'string' ||
      body.includes('\0') ||
      Buffer.byteLength(body) > 262144 ||
      (total += Buffer.byteLength(body)) > 2097152
    )
      throw fail('Template output budget exceeded');
    const folded = path.toLowerCase();
    if (
      seen.has(folded) ||
      [...seen].some(
        (other) =>
          other.startsWith(folded + '/') || folded.startsWith(other + '/'),
      )
    )
      throw fail('Template file/directory collision');
    seen.add(folded);
    result[path] = body;
  }
  return Object.freeze(result);
}
export function createProjectGenerator(templates: readonly ProjectTemplate[]) {
  if (!Array.isArray(templates) || !templates.length || templates.length > 16)
    throw fail('Explicit bounded templates required');
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
    )
      throw fail('Invalid template registration');
    const seen = new Set<string>();
    const capabilities = template.capabilities.map((c: TemplateCapability) => {
      if (
        !identifier(c.mode) ||
        !identifier(c.renderer) ||
        !Array.isArray(c.languages) ||
        !c.languages.length ||
        c.languages.length > 2 ||
        c.languages.some(
          (l: ProjectLanguage) => !['javascript', 'typescript'].includes(l),
        ) ||
        new Set(c.languages).size !== c.languages.length ||
        seen.has(c.mode + ':' + c.renderer)
      )
        throw fail('Invalid template capabilities');
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
          Object.freeze({ id, capabilities: t.capabilities }),
        ),
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
      ] as const)
        if (input[field] !== undefined && typeof input[field] !== 'string')
          throw fail('Invalid generator option');
      if (input.port !== undefined && typeof input.port !== 'number')
        throw fail('Invalid generator port');
      if (
        typeof input.destination !== 'string' ||
        !input.destination.trim() ||
        input.destination.length > 4096 ||
        // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
        /[\x00-\x1f\x7f]/.test(input.destination)
      )
        throw fail('Project destination is required');
      const destination = resolve(input.destination);
      validateProjectName(basename(destination));
      const name = validateProjectName(input.name ?? basename(destination)),
        template = input.template ?? registered.keys().next().value!;
      const t = registered.get(template);
      if (!t) throw fail('Unknown registered template');
      const mode = input.mode ?? t.capabilities[0].mode,
        renderer =
          input.renderer ??
          t.capabilities.find((c) => c.mode === mode)?.renderer,
        capability = t.capabilities.find(
          (c) => c.mode === mode && c.renderer === renderer,
        ),
        language =
          input.language ??
          (capability?.languages.includes('typescript')
            ? 'typescript'
            : (capability?.languages[0] ?? 'typescript')),
        port = input.port ?? 3000;
      if (!capability || !capability.languages.includes(language))
        throw fail('Unsupported template mode/renderer/language combination');
      if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
        throw fail('Port must be an integer in 1..65535');
      // Validate capability and render before inspecting/writing a destination.
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
      const output = files(t.render(options));
      parentOf(destination);
      free(destination);
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
function nested(root: string, relative: string) {
  let current = root;
  for (const part of relative.split('/').slice(0, -1)) {
    current = join(current, part);
    try {
      mkdirSync(current, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    identity(current);
  }
}
function* materialize(
  plan: ProjectPlan,
  signal?: AbortSignal,
): Generator<void, ProjectWriteResult> {
  if (
    !plans.has(plan) ||
    (signal !== undefined && !(signal instanceof AbortSignal))
  )
    throw fail('Validated generator plan and AbortSignal required');
  signal?.throwIfAborted();
  const directory = plan.options.destination,
    parent = parentOf(directory);
  free(directory);
  const staged = mkdtempSync(join(parent.path, '.zerux-starter-')),
    stageId = identity(staged);
  let targetId: { dev: number; ino: number } | undefined, failure: unknown;
  const check = () => {
    signal?.throwIfAborted();
    parentOf(directory);
    if (
      !same(parent.path, parent.identity) ||
      !same(staged, stageId) ||
      (targetId && !same(directory, targetId))
    )
      throw Error('Generator directory ownership changed');
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
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw Error('Project target appeared during generation');
      throw error;
    }
    for (const path of Object.keys(plan.files)) {
      check();
      nested(directory, path);
      if (stat(join(directory, path)))
        throw Error('Generated destination appeared during promotion');
      copyFileSync(
        join(staged, path),
        join(directory, path),
        constants.COPYFILE_EXCL,
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
    const errors: unknown[] = [];
    if (targetId && same(directory, targetId))
      try {
        rmSync(directory, { recursive: true, force: true });
      } catch (error) {
        errors.push(error);
      }
    if (same(staged, stageId))
      try {
        rmSync(staged, { recursive: true, force: true });
      } catch (error) {
        errors.push(error);
      }
    if (errors.length)
      // eslint-disable-next-line no-unsafe-finally -- Cleanup failure must propagate; this owner explicitly reports failed resource release.
      throw new AggregateError(
        [...(failure !== undefined ? [failure] : []), ...errors],
        'Generator rollback cleanup failed',
      );
  }
}
export function writeProjectPlan(
  plan: ProjectPlan,
  options: { signal?: AbortSignal } = {},
): ProjectWriteResult {
  const iterator = materialize(plan, options.signal);
  let next = iterator.next();
  while (!next.done) next = iterator.next();
  return next.value;
}
/** Yield between staged/promoted files so owned SIGINT/AbortSignal can cancel and rollback. */
export async function writeProjectPlanAsync(
  plan: ProjectPlan,
  options: { signal?: AbortSignal } = {},
): Promise<ProjectWriteResult> {
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
export type ProjectGenerator = ReturnType<typeof createProjectGenerator>;
