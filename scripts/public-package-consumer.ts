#!/usr/bin/env node
/** No-publish artifact acceptance: actual npm tarballs in an isolated consumer.
 * This is intentionally stricter than npm pack --dry-run and never synthesizes
 * missing dependencies or treats skipped packages as a full-matrix pass.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { npmCommand } from './npm-command.ts';
import { planPublicReleasesFromRoot } from './workspace-release-plan.ts';
import { discoverWorkspaces } from './workspace-graph.ts';
import {
  checkConsumerSelection,
  checkEntryTargets,
  assertCreatorCliOutput,
  createConsumerLock,
} from './workspace-public-consumer.ts';
/** Local value for root. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Local value for args. */
const args = process.argv.slice(2);
/** Local value for allowed. */
const allowed = /^--only=[@a-z0-9./,_-]+$/;
if (args.length > 1 || (args.length === 1 && !allowed.test(args[0]))) {
  console.error(
    'Usage: node --experimental-strip-types scripts/public-package-consumer.ts [--only=package-name[,package-name]]'
  );
  process.exit(2);
}
/** Local value for npm. */
const npm = 'npm';
/** Local value for entries. */
const entries = discoverWorkspaces(root);
/** Local value for plan. */
const plan = planPublicReleasesFromRoot(root);
if (!plan.ok) {
  console.error('[consumer] Release graph is not publishable');
  process.exit(1);
}
let selected;
try {
  selected = checkConsumerSelection(plan, args[0]?.slice('--only='.length));
} catch (err) {
  console.error(`[consumer] ${err.message}`);
  process.exit(2);
}
/** Local value for temp. */
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zerux-public-consumer-'));
/** Local value for consumer. */
const consumer = path.join(temp, 'consumer');
/**
 * Run a bounded offline subprocess and return its standard output.
 *
 * @param {string} name - Human-readable operation name for failure messages.
 * @param {string} bin - Executable path or npm command selector.
 * @param {string[]} callArgs - Arguments passed to the executable.
 * @param {string} cwd - Working directory for the subprocess.
 * @param {number} timeout - Maximum subprocess duration in milliseconds.
 * @returns {string} Captured standard output from the successful subprocess.
 * @throws {Error} If the subprocess exits unsuccessfully or exceeds its limits.
 */
const log = (
  name: string,
  bin: string,
  callArgs: string[],
  cwd: string,
  timeout = 180000
): string => {
  /** Local value for invocation. */
  const invocation =
    bin === npm ? npmCommand(callArgs) : { command: bin, args: callArgs };
  /** Local value for run. */
  const run = spawnSync(invocation.command, invocation.args, {
    cwd,
    encoding: 'utf8',
    timeout,
    maxBuffer: 5 * 1024 * 1024,
    env: {
      ...process.env,
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      npm_config_ignore_scripts: 'true',
      npm_config_offline: 'true',
    },
  });
  if (run.error || run.status !== 0) {
    // Declaration acceptance may uncover multiple independent missing type
    // packages. Preserve a bounded diagnostic batch so they can be fixed in
    // one pass, while keeping other subprocess errors concise.
    /** Diagnostic byte limit preserving useful declaration failures without unbounded logs. */
    const detailLimit =
      name === 'isolated TypeScript declaration resolution' ? 32 * 1024 : 1000;
    /** Bounded subprocess diagnostic assembled without exposing unrelated output. */
    const detail = [run.error?.message, run.stderr?.trim(), run.stdout?.trim()]
      .filter(Boolean)
      .join('\n')
      .slice(0, detailLimit);
    throw Error(`${name} failed: ${detail}`);
  }
  return run.stdout;
};
try {
  fs.mkdirSync(consumer);
  fs.writeFileSync(
    path.join(consumer, 'package.json'),
    JSON.stringify({
      name: 'zerux-public-package-consumer',
      private: true,
      type: 'module',
    })
  );
  /** Local value for archives. */
  const archives = [];
  for (const name of selected) {
    /** Local value for destructured values. */
    const { dir, pkg } = entries.get(name);
    /** Local value for missing. */
    const missing = checkEntryTargets(dir, pkg);
    if (missing.length) {
      throw Error(
        `${name}: missing built entrypoint(s): ${missing.join(', ')}. Build all workspaces first.`
      );
    }
    /** Local value for report. */
    const report = JSON.parse(
      log(
        `${name} npm pack`,
        npm,
        [
          'pack',
          '--json',
          '--ignore-scripts',
          '--offline',
          '--pack-destination',
          temp,
        ],
        dir
      )
    );
    /** Local value for packed. */
    const packed = Array.isArray(report) ? report : Object.values(report);
    if (packed.length !== 1 || !packed[0].filename) {
      throw Error(`${name}: malformed pack report`);
    }
    /** Local value for tarball. */
    const tarball = path.join(temp, packed[0].filename);
    if (!fs.statSync(tarball, { throwIfNoEntry: false })?.isFile()) {
      throw Error(`${name}: tarball not produced`);
    }
    archives.push({
      pkg,
      relativeDir: path.relative(root, dir).split(path.sep).join('/'),
      tarball,
      integrity: packed[0].integrity,
    });
  }
  /** Local value for framework. */
  const framework = entries.get('zeruxjs');
  /** Local value for source lock. */
  const sourceLock = JSON.parse(
    fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8')
  );
  // Include the root's reviewed npm override policy in the isolated consumer.
  // The workspace lock alone does not record why a selected version differs
  // from the upstream dependency range, so dropping these rules breaks npm ci.
  /** Root manifest whose override policy must remain active in the consumer. */
  const rootManifest = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8')
  );
  /** Consumer lock produced from the packed archives and committed graph. */
  const locked = createConsumerLock(sourceLock, archives, {
    sourceRoot: root,
    rootManifest,
  });
  fs.writeFileSync(
    path.join(consumer, 'package.json'),
    JSON.stringify(locked.manifest, null, 2) + '\n'
  );
  fs.writeFileSync(
    path.join(consumer, 'package-lock.json'),
    JSON.stringify(locked.lock, null, 2) + '\n'
  );
  log(
    'isolated offline install',
    npm,
    ['ci', '--offline', '--no-audit', '--no-fund', '--ignore-scripts'],
    consumer,
    300000
  );
  // Placeholder creators are CLIs, so verify their installed executables instead of importing CLI side effects.
  /** Local value for creators. */
  const creators = selected.filter((name) => name.startsWith('create-'));
  /** Local value for runtime. */
  const runtime = selected.filter((name) => !creators.includes(name));
  for (const name of creators) {
    /** Local value for destructured values. */
    const { pkg } = entries.get(name);
    /** Local value for bin. */
    const bin = Object.values(pkg.bin ?? {})[0];
    if (!bin) {
      throw Error(`${name}: no declared CLI`);
    }
    for (const flag of ['--help', '--version']) {
      /** Local value for output. */
      const output = log(
        `${name} ${flag}`,
        process.execPath,
        [path.join(consumer, 'node_modules', name, bin), flag],
        consumer
      );
      // Help need not print the release version; version MUST match exactly.
      assertCreatorCliOutput(name, flag, output, pkg.version);
    }
    console.log(`PASS CLI ${name}`);
  }
  /** Local value for script. */
  const script =
    `const names=${JSON.stringify(runtime)};\n` +
    `import { createRequire } from 'node:module';const req=createRequire(import.meta.url);\n` +
    `for(const name of names){const esm=await import(name);if(!esm||typeof esm!=='object'||Object.keys(esm).length===0)throw Error(name+': empty ESM exports');console.log('PASS import '+name);}\n`;
  fs.writeFileSync(path.join(consumer, 'smoke.ts'), script);
  /** Local value for results. */
  const results = log(
    'public runtime imports',
    process.execPath,
    ['smoke.ts'],
    consumer
  );
  process.stdout.write(results);
  // No TypeScript dependency is installed implicitly. Use the workspace-pinned
  // compiler from the clean npm ci, and reject missing compiler artifacts.
  /** Local value for compiler require. */
  const compilerRequire = createRequire(
    path.join(framework?.dir ?? root, 'package.json')
  );
  /** Local value for tsc. */
  const tsc = compilerRequire.resolve('typescript/bin/tsc');
  if (!fs.existsSync(tsc)) {
    throw Error(
      'Workspace TypeScript compiler absent: clean npm ci required for declaration consumer check'
    );
  }
  fs.writeFileSync(
    path.join(consumer, 'types.mts'),
    runtime
      .map(
        (name, i) =>
          `import * as P${i} from ${JSON.stringify(name)};\nexport type Package${i} = typeof P${i};`
      )
      .join('\n') + '\n'
  );
  fs.writeFileSync(
    path.join(consumer, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        target: 'ES2022',
        strict: true,
        noEmit: true,
        skipLibCheck: false,
        types: ['node'],
      },
      files: ['types.mts'],
    })
  );
  log(
    'isolated TypeScript declaration resolution',
    process.execPath,
    [tsc, '-p', 'tsconfig.json'],
    consumer
  );
  console.log(
    `[consumer] PASS: ${selected.length}/${plan.publicPackages} actual packed package(s) installed; runtime imports/declarations and creator CLIs checked offline${selected.length === plan.publicPackages ? ' (FULL CANDIDATE MATRIX)' : ' (SCOPED; NOT A RELEASE CERTIFICATION)'}`
  );
} catch (err) {
  console.error(`[consumer] FAIL: ${err.message}`);
  process.exitCode = 1;
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
