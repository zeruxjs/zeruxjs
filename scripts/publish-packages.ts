#!/usr/bin/env node
/** Version-bump publishing driver. Only --publish performs registry writes. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { discoverWorkspaces } from './workspace-graph.ts';
import {
  selectPublishCandidates,
  compareReleaseVersions,
  summarizePublication,
  waitForRegistryPublication,
  comparePublishedContract,
  isReservedVersionConflict,
  validateProvenanceRepository,
} from './workspace-publish.ts';
import { checkEntryTargets } from './workspace-public-consumer.ts';
import { npmCommand } from './npm-command.ts';

/** Data used for root. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Data used for output. */
const output = path.join(root, '.npm-release');
/** Data used for planFile. */
const planFile = path.join(output, 'plan.json');
/** Data used for registry. */
const registry = 'https://registry.npmjs.org/';
/** Data used for repository. */
const repository = process.env.GITHUB_REPOSITORY ?? 'zeruxjs/zeruxjs';
/** Data used for args. */
const args = process.argv.slice(2);
let publishingPlan, activePublication;
if (args.length !== 1 || !['--plan', '--pack', '--publish'].includes(args[0])) {
  console.error(
    'Usage: node --experimental-strip-types scripts/publish-packages.ts --plan|--pack|--publish'
  );
  process.exit(2);
}

/**
 * Run literal arguments without a shell; npm secrets stay in the inherited environment.
 * @param {unknown} command - Input value for command.
 * @param {unknown} callArgs - Input value for call args.
 * @param {unknown} cwd - Input value for cwd.
 * @param {unknown} inherit - Input value for inherit.
 * @param {unknown} streamStderr - Input value for stream stderr.
 * @returns {unknown} Result produced by run.
 * @throws {Error} If validation or the delegated operation fails.
 */
function run(
  command,
  callArgs,
  cwd = root,
  inherit = false,
  streamStderr = false
) {
  /** Local value for result. */
  const result = spawnSync(command, callArgs, {
    cwd,
    encoding: 'utf8',
    stdio: inherit
      ? 'inherit'
      : ['ignore', 'pipe', streamStderr ? 'inherit' : 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
    timeout: 600000,
  });
  if (result.error || result.status !== 0) {
    throw Error(
      `${command} ${callArgs[0]} failed${result.error ? `: ${result.error.message}` : ''}`
    );
  }
  return result.stdout?.trim();
}
/**
 * Invoke npm through its JavaScript CLI on every platform.
 * @param {unknown} callArgs - Input value for call args.
 * @param {unknown} cwd - Input value for cwd.
 * @param {unknown} inherit - Input value for inherit.
 * @returns {unknown} Result produced by npm.
 */
function npm(callArgs, cwd, inherit) {
  /** Local value for cmd. */
  const cmd = npmCommand(callArgs);
  return run(cmd.command, cmd.args, cwd, inherit, callArgs[0] === 'pack');
}
/**
 * Stream publish progress while retaining a bounded error tail for explicit reserved-version conflicts.
 * @param {unknown} callArgs - Input value for call args.
 * @param {unknown} cwd - Input value for cwd.
 * @returns {unknown} Result produced by upload archive.
 */
async function uploadArchive(callArgs, cwd) {
  /** Local value for command. */
  const command = npmCommand(callArgs);
  return new Promise((resolve, reject) => {
    /** Local value for child. */
    const child = spawn(command.command, command.args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 600000,
    });
    let tail = '';
    for (const [stream, destination] of [
      [child.stdout, process.stdout],
      [child.stderr, process.stderr],
    ]) {
      stream.on('data', (chunk) => {
        destination.write(chunk);
        tail = (tail + chunk.toString()).slice(-65536);
      });
    }
    child.on('error', reject);
    child.on('close', (status, signal) => resolve({ status, signal, tail }));
  });
}
/**
 * Read public registry metadata; only a confirmed 404 is considered unpublished.
 * @param {unknown} name - Input value for name.
 * @param {unknown} version - Input value for version.
 * @returns {unknown} Result produced by metadata.
 * @throws {Error} If validation or the delegated operation fails.
 */
async function metadata(name, version) {
  if (
    typeof name !== 'string' ||
    name.length > 214 ||
    !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name) ||
    typeof version !== 'string' ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)
  ) {
    throw Error('Invalid public registry package identity');
  }
  /** Local value for response. */
  const response = await fetch(
    `${registry}${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
    { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30000) }
  );
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw Error(
      `Registry lookup failed for ${name}@${version}: HTTP ${response.status}`
    );
  }
  /** Local value for manifest. */
  const manifest = await response.json();
  // npm's temporary staged holding package is not a published application release.
  return manifest.stub === true || manifest.version === '0.0.0-stage'
    ? null
    : manifest;
}
/**
 * Persist the reviewable release plan, including packed archive integrity.
 * @param {unknown} plan - Input value for plan.
 * @returns {unknown} Result produced by save.
 */
function save(plan) {
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(planFile, JSON.stringify(plan, null, 2) + '\n');
}
/**
 * Hash the exact bytes that will be sent to npm.
 * @param {unknown} file - Input value for file.
 * @returns {unknown} Result produced by integrity.
 */
function integrity(file) {
  return (
    'sha512-' +
    crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64')
  );
}

try {
  /** Local value for commit. */
  const commit = run('git', ['rev-parse', 'HEAD']);
  /** Local value for entries. */
  const entries = discoverWorkspaces(root);
  if (args[0] === '--plan') {
    /** Local value for event. */
    const event = process.env.GITHUB_EVENT_PATH
      ? JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
      : {};
    /** Local value for previous. */
    const previous = new Map();
    /** Local value for changedSinceBase. */
    const changedSinceBase = new Map();
    // Git provides change context; registry availability selects releases, including failures from earlier commits.
    /** Local value for parent. */
    const parent = spawnSync('git', ['rev-parse', '--verify', 'HEAD^'], {
      cwd: root,
      encoding: 'utf8',
    });
    /** Local value for base. */
    let base = null;
    if (
      /^[a-f0-9]{40}$/.test(event.before ?? '') &&
      !/^0+$/.test(event.before)
    ) {
      base = event.before;
    } else if (parent.status === 0) {
      base = parent.stdout.trim();
    }
    if (base) {
      run('git', ['cat-file', '-e', `${base}^{commit}`]);
      for (const entry of entries.values()) {
        /** Local value for directory. */
        const directory = path
          .relative(root, entry.dir)
          .split(path.sep)
          .join('/');
        /** Local value for result. */
        const result = spawnSync(
          'git',
          ['show', `${base}:${directory}/package.json`],
          { cwd: root, encoding: 'utf8' }
        );
        if (result.status === 0) {
          previous.set(directory, JSON.parse(result.stdout));
        } else if (
          result.error ||
          !/does not exist in|exists on disk, but not in/.test(
            result.stderr ?? ''
          )
        ) {
          throw Error(`Cannot read previous manifest: ${directory}`);
        }
        /** Local value for changed. */
        const changed = spawnSync(
          'git',
          ['diff', '--quiet', base, commit, '--', directory],
          { cwd: root, encoding: 'utf8' }
        );
        if (changed.error || ![0, 1].includes(changed.status)) {
          throw Error(`Cannot compare Git changes: ${directory}`);
        }
        changedSinceBase.set(directory, changed.status === 1);
      }
    }
    /** Local value for candidates. */
    const candidates = selectPublishCandidates(root, entries, previous, true);
    for (const item of candidates) {
      validateProvenanceRepository(entries.get(item.name).pkg, repository);
    }
    /** Local value for packages. */
    const packages = [],
      skipped = [],
      issues = [],
      comparisons = [];
    // Independent public metadata reads are bounded and parallel; retain dependency order in the result.
    for (let offset = 0; offset < candidates.length; offset += 6) {
      /** Local value for checked. */
      const checked = await Promise.all(
        candidates.slice(offset, offset + 6).map(async (item) => ({
          item,
          published: await metadata(item.name, item.version),
          latest: await metadata(item.name, 'latest'),
        }))
      );
      for (const { item, published, latest } of checked) {
        /** Local value for available. */
        const available =
          published ?? (latest?.version === item.version ? latest : null);
        /** Local value for old. */
        const old = previous.get(item.directory);
        /** Local value for contractDifferences. */
        const contractDifferences = available
          ? comparePublishedContract(entries.get(item.name).pkg, available)
          : [];
        let reason = 'new-or-bumped-version';
        if (available) {
          reason = 'already-published';
        } else if (old?.name === item.name && old.version === item.version) {
          reason = 'retry-unpublished-version';
        }
        comparisons.push({
          name: item.name,
          localVersion: item.version,
          publishedExactVersion: available?.version ?? null,
          registryLatest: latest?.version ?? null,
          previousGitVersion: old?.version ?? null,
          changedSinceGitBase: changedSinceBase.get(item.directory) ?? null,
          contractDifferences,
          reason,
        });
        if (available) {
          skipped.push(`${item.name}@${item.version}`);
          if (contractDifferences.length) {
            issues.push(
              `${item.name}@${item.version}: published contract differs in ${contractDifferences.join(', ')}; bump the version instead of overwriting npm`
            );
          }
        } else if (
          latest &&
          compareReleaseVersions(latest.version, item.version) >= 0
        ) {
          issues.push(
            `${item.name}: refusing to move latest backwards; bump above ${latest.version} if you own it, otherwise choose another name`
          );
        } else {
          packages.push(item);
        }
      }
    }
    /** Local value for selected. */
    const selected = new Set(packages.map((item) => item.name));
    // Missing required local dependency releases must be included or already exist on npm.
    for (const item of packages) {
      for (const dependency of item.dependencies) {
        if (
          !selected.has(dependency) &&
          !(await metadata(dependency, entries.get(dependency).pkg.version))
        ) {
          issues.push(
            `${item.name}: ${dependency} must be published first; use the manual publish-unpublished run`
          );
        }
      }
    }
    /** Local value for plan. */
    const plan = {
      schemaVersion: 1,
      commit,
      gitBase: base,
      comparisons,
      packages,
      skipped,
      issues,
      releaseTargets: candidates.map(({ name, version }) => ({
        name,
        version,
      })),
    };
    save(plan);
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(
        process.env.GITHUB_OUTPUT,
        `has_releases=${packages.length > 0 && issues.length === 0}\n`
      );
    }
    console.log(
      JSON.stringify(
        {
          comparisonSource: 'npm registry (authoritative), Git base (context)',
          gitBase: base,
          comparisons,
          packages,
          skipped,
          issues,
        },
        null,
        2
      )
    );
    if (issues.length) {
      throw Error('Release plan blocked: ' + issues.join('; '));
    }
    if (!packages.length && candidates.length) {
      /** Local value for summary. */
      const summary = summarizePublication(plan);
      fs.writeFileSync(
        path.join(output, 'publication-summary.md'),
        summary.markdown
      );
      if (process.env.GITHUB_STEP_SUMMARY) {
        fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.markdown);
      }
      console.log(
        `[publish] COMPLETE: ${summary.confirmed}/${summary.total} selected package versions already verified on npm.`
      );
    }
  } else {
    /** Local value for plan. */
    const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
    if (
      plan.schemaVersion !== 1 ||
      plan.commit !== commit ||
      plan.issues?.length
    ) {
      throw Error('Release plan is blocked or does not match this commit');
    }
    if (args[0] === '--publish') {
      publishingPlan = plan;
      plan.publicationResults = plan.packages.map(({ name, version }) => ({
        name,
        version,
        status: 'pending',
      }));
      save(plan);
    }
    for (const item of plan.packages) {
      if (publishingPlan) {
        activePublication = plan.publicationResults.find(
          (result) => result.name === item.name
        );
      }
      /** Local value for entry. */
      const entry = entries.get(item.name);
      if (
        !entry ||
        entry.pkg.private ||
        entry.pkg.version !== item.version ||
        path.relative(root, entry.dir).split(path.sep).join('/') !==
          item.directory ||
        item.directory.split('/').some((part) => part.startsWith('sample'))
      ) {
        throw Error('Release plan no longer matches public package manifests');
      }
      validateProvenanceRepository(entry.pkg, repository);
      if (args[0] === '--pack') {
        /** Local value for position. */
        const position = plan.packages.indexOf(item) + 1;
        /** Local value for started. */
        const started = Date.now();
        console.log(
          `[pack] ${position}/${plan.packages.length} START: ${item.name}@${item.version}`
        );
        /** Local value for missing. */
        const missing = checkEntryTargets(entry.dir, entry.pkg);
        if (missing.length) {
          throw Error(
            `${item.name}: missing entrypoints: ${missing.join(', ')}`
          );
        }
        /** Local value for report. */
        const report = JSON.parse(
          npm(['pack', '--json', '--pack-destination', output], entry.dir)
        );
        /** Local value for packed. */
        const packed = Array.isArray(report) ? report : Object.values(report);
        if (packed.length !== 1 || !/^[\w.-]+\.tgz$/.test(packed[0].filename)) {
          throw Error('Unexpected npm archive report');
        }
        item.archive = packed[0].filename;
        item.integrity = integrity(path.join(output, item.archive));
        save(plan);
        console.log(
          `[pack] ${position}/${plan.packages.length} READY: ${item.archive} (${Math.ceil(fs.statSync(path.join(output, item.archive)).size / 1024)} KiB, ${((Date.now() - started) / 1000).toFixed(1)}s); integrity recorded.`
        );
      } else {
        if (
          process.env.GITHUB_ACTIONS !== 'true' ||
          process.env.GITHUB_REF !== 'refs/heads/master'
        ) {
          throw Error(
            'Registry writes are restricted to GitHub Actions on master'
          );
        }
        if (
          !/^[\w.-]+\.tgz$/.test(item.archive ?? '') ||
          integrity(path.join(output, item.archive)) !== item.integrity
        ) {
          throw Error('Release archive missing or changed');
        }
        /** Local value for position. */
        const position = plan.packages.indexOf(item) + 1;
        console.log(
          `[publish] ${position}/${plan.packages.length}: ${item.name}@${item.version}`
        );
        let current = await metadata(item.name, item.version);
        /** Local value for latest. */
        const latest = current ? null : await metadata(item.name, 'latest');
        if (!current && latest?.version === item.version) {
          current = latest;
        }
        if (current) {
          /** Local value for differences. */
          const differences = comparePublishedContract(entry.pkg, current);
          if (differences.length) {
            throw Error(
              `${item.name}@${item.version}: published contract changed in ${differences.join(', ')}; a new version is required`
            );
          }
          activePublication.status = 'already-published';
          save(plan);
          console.log(
            `[publish] ${position}/${plan.packages.length} ALREADY PUBLISHED: ${item.name}@${item.version}`
          );
          continue;
        }
        if (
          latest &&
          compareReleaseVersions(latest.version, item.version) >= 0
        ) {
          throw Error(`${item.name}: refusing a stale release`);
        }
        /** Local value for upload. */
        const upload = await uploadArchive(
          [
            'publish',
            path.join(output, item.archive),
            '--access',
            'public',
            '--tag',
            'latest',
            '--provenance',
            '--ignore-scripts',
            '--registry',
            registry,
          ],
          entry.dir
        );
        /** Local value for reserved. */
        const reserved = isReservedVersionConflict(upload.tail, item.version);
        if (upload.signal || (upload.status !== 0 && !reserved)) {
          throw Error(
            `${item.name}: npm publish failed${upload.signal ? ` (${upload.signal})` : ''}`
          );
        }
        activePublication.status = 'processing';
        save(plan);
        console.log(
          `[publish] ${position}/${plan.packages.length} ${reserved ? 'VERSION ALREADY RESERVED ON NPM' : 'UPLOAD ACCEPTED'}: ${item.name}@${item.version}; public registry verification will follow without another upload.`
        );
      }
    }
    if (publishingPlan) {
      activePublication = null;
      /** Local value for pending. */
      const pending = await waitForRegistryPublication(
        plan.publicationResults.filter((item) => item.status === 'processing'),
        {
          lookup: async (name, version) => {
            /** Local value for manifest. */
            const manifest = await metadata(name, version);
            if (manifest) {
              /** Local value for differences. */
              const differences = comparePublishedContract(
                entries.get(name).pkg,
                manifest
              );
              if (differences.length) {
                throw Error(
                  `${name}@${version}: published contract differs in ${differences.join(', ')}`
                );
              }
            }
            return manifest;
          },
          onConfirmed: (item) => {
            plan.publicationResults.find(
              (result) => result.name === item.name
            ).status = 'published';
            save(plan);
            /** Local value for summary. */
            const summary = summarizePublication(plan);
            console.log(
              `[publish] ${summary.confirmed}/${summary.total} VERIFIED ON NPM: ${item.name}@${item.version}`
            );
          },
          onWaiting: (items, remaining) =>
            console.log(
              `[publish] Waiting for npm registry processing: ${items.length} accepted upload(s), up to ${Math.ceil(remaining / 60000)} minute(s) remaining.`
            ),
        }
      );
      if (pending.length) {
        throw Error(
          `npm accepted these uploads but they are not public after 15 minutes: ${pending.map((item) => `${item.name}@${item.version}`).join(', ')}. Check npm processing status before retrying; this alone does not imply a staged release.`
        );
      }
    }
  }
} catch (error) {
  if (activePublication) {
    activePublication.status = 'failed';
  }
  console.error(`[publish] ${error.message}`);
  process.exitCode = 1;
} finally {
  if (publishingPlan) {
    save(publishingPlan);
    /** Local value for summary. */
    const summary = summarizePublication(publishingPlan);
    fs.writeFileSync(
      path.join(output, 'publication-summary.md'),
      summary.markdown
    );
    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.markdown);
    }
    console.log(
      `[publish] ${summary.complete ? 'COMPLETE' : 'INCOMPLETE'}: ${summary.confirmed}/${summary.total} selected package versions verified on npm (${summary.published} newly published; ${summary.alreadyPublished} already available).`
    );
    if (!summary.complete) {
      process.exitCode = 1;
    }
  }
}
