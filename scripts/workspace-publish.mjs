import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { planPublicReleases } from './workspace-release-plan.mjs';

/** Verify each release identifies the GitHub source repository used for provenance; reads no globals. */
/** Perform the validate provenance repository operation.
 * @param {unknown} pkg - Input value for pkg.
 * @param {unknown} repository - Input value for repository.
 * @returns {unknown} Result produced by validate provenance repository.
 */
export function validateProvenanceRepository(pkg, repository) {
  /** Local value for raw. */
  const raw =
    typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  let url;
  try {
    url = new URL((raw ?? '').replace(/^git\+/, ''));
  } catch {
    throw Error(
      `${pkg.name}: missing or invalid repository.url required for npm provenance`
    );
  }
  /** Local value for source. */
  const source = url.pathname
    .replace(/\.git\/?$/, '')
    .replace(/\/$/, '')
    .slice(1);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    source.toLowerCase() !== repository.toLowerCase()
  ) {
    throw Error(
      `${pkg.name}: repository.url must identify https://github.com/${repository} for npm provenance`
    );
  }
}

/**
 * Summarize confirmed registry publication, keeping failures and unattempted packages visible.
 * @param plan Selected releases and their recorded publication statuses; reads no globals.
 * @returns Counts and Markdown for the GitHub Actions job summary.
 */
/** Perform the summarize publication operation.
 * @param {unknown} plan - Input value for plan.
 * @returns {unknown} Result produced by summarize publication.
 */
export function summarizePublication(plan) {
  /** Local value for rows. */
  const rows = (plan.releaseTargets ?? plan.packages).map((item) => ({
    name: item.name,
    version: item.version,
    status:
      plan.publicationResults?.find(
        (result) => result.name === item.name && result.version === item.version
      )?.status ??
      (plan.skipped?.includes(`${item.name}@${item.version}`)
        ? 'already-published'
        : 'pending'),
  }));
  /**
   * Run the count callback.
   * @param {unknown} status - Input value for status.
   * @returns {unknown} Result produced by count.
   */
  const count = (status) => rows.filter((row) => row.status === status).length;
  /** Local value for published. */
  const published = count('published'),
    alreadyPublished = count('already-published');
  /** Local value for confirmed. */
  const confirmed = published + alreadyPublished,
    total = rows.length;
  /** Local value for complete. */
  const complete = total > 0 && confirmed === total;
  /** Local value for markdown. */
  const markdown =
    `## npm publication: ${complete ? 'complete' : 'incomplete'}\n\n` +
    `**${confirmed}/${total} selected package versions confirmed on npm.**\n\n` +
    `Newly published: ${published}. Already published: ${alreadyPublished}. Failed: ${count('failed')}. Registry processing: ${count('processing')}. Pending: ${count('pending')}.\n\n` +
    '| Package | Version | Result |\n| --- | --- | --- |\n' +
    rows
      .map(
        (row) =>
          `| [${row.name}](https://www.npmjs.com/package/${row.name}/v/${row.version}) | ${row.version} | ${row.status} |`
      )
      .join('\n') +
    '\n';
  return { complete, total, confirmed, published, alreadyPublished, markdown };
}

/**
 * Poll accepted uploads until their exact versions are visible in the public registry.
 * @param packages Accepted releases to verify, without further registry writes.
 * @param options Injected registry lookup, progress hooks, clock and waiting function.
 * @returns Unconfirmed packages at the deadline; an empty list means all were confirmed.
 * @global Date.now and setTimeout supply default timing; no environment values are read.
 */
/** Perform the wait for registry publication operation.
 * @param {unknown} packages - Input value for packages.
 * @param {unknown} root1 - Input value for root1.
 * @param {unknown} root1.lookup - Input value for lookup.
 * @param {unknown} root1.onConfirmed - Input value for on confirmed.
 * @param {unknown} root1.onWaiting - Input value for on waiting.
 * @param {unknown} root1.now - Input value for now.
 * @param {unknown} root1.wait - Input value for wait.
 * @param {unknown} root1.timeoutMs - Input value for timeout ms.
 * @param {unknown} root1.intervalMs - Input value for interval ms.
 * @returns {unknown} Result produced by wait for registry publication.
 */
export async function waitForRegistryPublication(
  packages,
  {
    lookup,
    onConfirmed = () => {},
    onWaiting = () => {},
    now = Date.now,
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    timeoutMs = 900000,
    intervalMs = 10000,
  } = {}
) {
  if (
    typeof lookup !== 'function' ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs < 0 ||
    !Number.isFinite(intervalMs) ||
    intervalMs <= 0
  ) {
    throw Error('Invalid registry verification options');
  }
  /** Local value for pending. */
  const pending = new Map(
    packages.map((item) => [`${item.name}@${item.version}`, item])
  );
  /** Local value for deadline. */
  const deadline = now() + timeoutMs;
  while (pending.size) {
    /** Local value for batch. */
    const batch = [...pending.values()];
    for (let offset = 0; offset < batch.length; offset += 6) {
      /** Local value for checked. */
      const checked = await Promise.all(
        batch.slice(offset, offset + 6).map(async (item) => ({
          item,
          available: await lookup(item.name, item.version),
        }))
      );
      for (const { item, available } of checked) {
        if (available) {
          pending.delete(`${item.name}@${item.version}`);
          await onConfirmed(item);
        }
      }
    }
    if (!pending.size) {
      break;
    }
    /** Local value for remaining. */
    const remaining = deadline - now();
    if (remaining <= 0) {
      break;
    }
    await onWaiting([...pending.values()], remaining);
    await wait(Math.min(intervalMs, remaining));
  }
  return [...pending.values()];
}

/** Compare stable release versions without numeric precision loss; reads no globals. */
/** Perform the compare release versions operation.
 * @param {unknown} before - Input value for before.
 * @param {unknown} after - Input value for after.
 * @returns {unknown} Result produced by compare release versions.
 */
export function compareReleaseVersions(before, after) {
  /** Local value for stable. */
  const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  if (!stable.test(before) || !stable.test(after)) {
    throw Error('Publishing requires stable major.minor.patch versions');
  }
  /** Local value for a. */
  const a = before.split('.').map(BigInt),
    b = after.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) {
      return a[i] < b[i] ? -1 : 1;
    }
  }
  return 0;
}

/** Compare consumer-facing manifest fields with a published version, ignoring object key order and npm bin-path normalization. */
/** Perform the compare published contract operation.
 * @param {unknown} local - Input value for local.
 * @param {unknown} published - Input value for published.
 * @returns {unknown} Result produced by compare published contract.
 */
export function comparePublishedContract(local, published) {
  /** Local value for fields. */
  const fields = [
    'dependencies',
    'optionalDependencies',
    'peerDependencies',
    'peerDependenciesMeta',
    'exports',
    'main',
    'types',
    'module',
    'bin',
    'engines',
  ];
  /**
   * Run the value callback.
   * @param {unknown} manifest - Input value for manifest.
   * @param {unknown} key - Input value for key.
   * @returns {unknown} Result produced by value.
   */
  const value = (manifest, key) => {
    if (key === 'bin') {
      /** Local value for bins. */
      const bins =
        typeof manifest.bin === 'string'
          ? { [manifest.name.split('/').pop()]: manifest.bin }
          : (manifest.bin ?? {});
      return Object.fromEntries(
        Object.entries(bins).map(([name, file]) => [
          name,
          file.replace(/^\.\//, ''),
        ])
      );
    }
    return (
      manifest[key] ?? (['main', 'types', 'module'].includes(key) ? null : {})
    );
  };
  return fields.filter(
    (key) => !isDeepStrictEqual(value(local, key), value(published, key))
  );
}

/** Only npm's explicit reserved-version conflict can be treated as waiting for prior processing; other publish failures remain fatal. */
/** Perform the is reserved version conflict operation.
 * @param {unknown} output - Input value for output.
 * @param {unknown} version - Input value for version.
 * @returns {unknown} Result produced by is reserved version conflict.
 */
export function isReservedVersionConflict(output, version) {
  return (
    /E409|409 Conflict/.test(output) &&
    output.includes(
      `Cannot publish over previously staged version "${version}"`
    )
  );
}

/**
 * Select dependency-ordered version bumps under packages, excluding sample paths and private packages.
 * @param root Repository directory; no globals are read.
 * @param entries Discovered release workspace manifests.
 * @param previous Previous manifests keyed by package-relative directory.
 * @param allUnpublished Select all candidates for registry filtering on initial releases/retries.
 * @returns Ordered public release candidates; unchanged versions are excluded on pushes.
 */
/** Perform the select publish candidates operation.
 * @param {unknown} root - Input value for root.
 * @param {unknown} entries - Input value for entries.
 * @param {unknown} previous - Input value for previous.
 * @param {unknown} allUnpublished - Input value for all unpublished.
 * @returns {unknown} Result produced by select publish candidates.
 */
export function selectPublishCandidates(
  root,
  entries,
  previous,
  allUnpublished = false
) {
  /** Local value for eligible. */
  const eligible = new Map(
    [...entries].filter(([, entry]) => {
      /** Local value for parts. */
      const parts = path.relative(root, entry.dir).split(path.sep);
      return (
        parts[0] === 'packages' &&
        !parts.includes('..') &&
        !parts.slice(1).some((part) => part.startsWith('sample')) &&
        entry.pkg.private !== true
      );
    })
  );
  // Keep excluded packages private for dependency validation, so a public sample cannot silently become an external edge.
  /** Local value for graph. */
  const graph = new Map(
    [...entries].map(([name, entry]) => [
      name,
      eligible.has(name)
        ? entry
        : { ...entry, pkg: { ...entry.pkg, private: true } },
    ])
  );
  /** Local value for plan. */
  const plan = planPublicReleases(graph);
  if (!plan.ok) {
    throw Error(
      `Invalid release dependency graph: ${JSON.stringify(plan.issues)}`
    );
  }
  return plan.order
    .filter((item) => {
      /** Local value for entry. */
      const entry = eligible.get(item.name);
      compareReleaseVersions(item.version, item.version);
      if (entry.pkg.publishConfig?.access !== 'public') {
        throw Error(`${item.name}: publishConfig.access must be public`);
      }
      /** Local value for directory. */
      const directory = path
        .relative(root, entry.dir)
        .split(path.sep)
        .join('/');
      /** Local value for old. */
      const old = previous.get(directory);
      if (old?.name === item.name) {
        /** Local value for comparison. */
        const comparison = compareReleaseVersions(old.version, item.version);
        if (comparison > 0) {
          throw Error(
            `${item.name}: version decreased from ${old.version} to ${item.version}`
          );
        }
        return allUnpublished || comparison < 0;
      }
      return true;
    })
    .map((item) => ({
      ...item,
      directory: path
        .relative(root, eligible.get(item.name).dir)
        .split(path.sep)
        .join('/'),
    }));
}
