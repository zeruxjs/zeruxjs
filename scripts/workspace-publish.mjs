import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import { planPublicReleases } from './workspace-release-plan.mjs';

/**
 * Summarize confirmed registry publication, keeping failures and unattempted packages visible.
 * @param plan Selected releases and their recorded publication statuses; reads no globals.
 * @returns Counts and Markdown for the GitHub Actions job summary.
 */
export function summarizePublication(plan) {
  const rows = (plan.releaseTargets ?? plan.packages).map(item => ({name:item.name,version:item.version,
    status:plan.publicationResults?.find(result=>result.name===item.name&&result.version===item.version)?.status ??
      (plan.skipped?.includes(`${item.name}@${item.version}`)?'already-published':'pending')}));
  const count = status => rows.filter(row=>row.status===status).length;
  const published=count('published'), alreadyPublished=count('already-published');
  const confirmed=published+alreadyPublished, total=rows.length;
  const complete=total>0&&confirmed===total;
  const markdown = `## npm publication: ${complete?'complete':'incomplete'}\n\n`+
    `**${confirmed}/${total} selected package versions confirmed on npm.**\n\n`+
    `Newly published: ${published}. Already published: ${alreadyPublished}. Failed: ${count('failed')}. Registry processing: ${count('processing')}. Pending: ${count('pending')}.\n\n`+
    '| Package | Version | Result |\n| --- | --- | --- |\n'+rows.map(row=>
      `| [${row.name}](https://www.npmjs.com/package/${row.name}/v/${row.version}) | ${row.version} | ${row.status} |`).join('\n')+'\n';
  return {complete,total,confirmed,published,alreadyPublished,markdown};
}

/**
 * Poll accepted uploads until their exact versions are visible in the public registry.
 * @param packages Accepted releases to verify, without further registry writes.
 * @param options Injected registry lookup, progress hooks, clock and waiting function.
 * @returns Unconfirmed packages at the deadline; an empty list means all were confirmed.
 * @global Date.now and setTimeout supply default timing; no environment values are read.
 */
export async function waitForRegistryPublication(packages, {lookup, onConfirmed=()=>{}, onWaiting=()=>{},
  now=Date.now, wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)), timeoutMs=900000, intervalMs=10000} = {}) {
  if (typeof lookup!=='function'||!Number.isFinite(timeoutMs)||timeoutMs<0||!Number.isFinite(intervalMs)||intervalMs<=0) throw Error('Invalid registry verification options');
  const pending=new Map(packages.map(item=>[`${item.name}@${item.version}`,item]));
  const deadline=now()+timeoutMs;
  while (pending.size) {
    const batch=[...pending.values()];
    for (let offset=0;offset<batch.length;offset+=6) {
      const checked=await Promise.all(batch.slice(offset,offset+6).map(async item=>({item,available:await lookup(item.name,item.version)})));
      for (const {item,available} of checked) if (available) {
        pending.delete(`${item.name}@${item.version}`);await onConfirmed(item);
      }
    }
    if (!pending.size) break;
    const remaining=deadline-now();
    if (remaining<=0) break;
    await onWaiting([...pending.values()],remaining);
    await wait(Math.min(intervalMs,remaining));
  }
  return [...pending.values()];
}

/** Compare stable release versions without numeric precision loss; reads no globals. */
export function compareReleaseVersions(before, after) {
  const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  if (!stable.test(before) || !stable.test(after)) throw Error('Publishing requires stable major.minor.patch versions');
  const a = before.split('.').map(BigInt), b = after.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

/** Compare consumer-facing manifest fields with a published version, ignoring object key order and npm bin-path normalization. */
export function comparePublishedContract(local, published) {
  const fields=['dependencies','optionalDependencies','peerDependencies','peerDependenciesMeta','exports','main','types','module','bin','engines'];
  const value=(manifest,key)=>{
    if (key==='bin') {
      const bins=typeof manifest.bin==='string'?{[manifest.name.split('/').pop()]:manifest.bin}:manifest.bin??{};
      return Object.fromEntries(Object.entries(bins).map(([name,file])=>[name,file.replace(/^\.\//,'')]));
    }
    return manifest[key]??(['main','types','module'].includes(key)?null:{});
  };
  return fields.filter(key=>!isDeepStrictEqual(value(local,key),value(published,key)));
}

/** Only npm's explicit reserved-version conflict can be treated as waiting for prior processing; other publish failures remain fatal. */
export function isReservedVersionConflict(output, version) {
  return /E409|409 Conflict/.test(output)&&output.includes(`Cannot publish over previously staged version "${version}"`);
}

/**
 * Select dependency-ordered version bumps under packages, excluding sample paths and private packages.
 * @param root Repository directory; no globals are read.
 * @param entries Discovered release workspace manifests.
 * @param previous Previous manifests keyed by package-relative directory.
 * @param allUnpublished Select all candidates for registry filtering on initial releases/retries.
 * @returns Ordered public release candidates; unchanged versions are excluded on pushes.
 */
export function selectPublishCandidates(root, entries, previous, allUnpublished = false) {
  const eligible = new Map([...entries].filter(([, entry]) => {
    const parts = path.relative(root, entry.dir).split(path.sep);
    return parts[0] === 'packages' && !parts.includes('..') &&
      !parts.slice(1).some(part => part.startsWith('sample')) && entry.pkg.private !== true;
  }));
  // Keep excluded packages private for dependency validation, so a public sample cannot silently become an external edge.
  const graph = new Map([...entries].map(([name, entry]) => [name, eligible.has(name) ? entry :
    { ...entry, pkg: { ...entry.pkg, private: true } }]));
  const plan = planPublicReleases(graph);
  if (!plan.ok) throw Error(`Invalid release dependency graph: ${JSON.stringify(plan.issues)}`);
  return plan.order.filter(item => {
    const entry = eligible.get(item.name);
    compareReleaseVersions(item.version, item.version);
    if (entry.pkg.publishConfig?.access !== 'public') throw Error(`${item.name}: publishConfig.access must be public`);
    const directory = path.relative(root, entry.dir).split(path.sep).join('/');
    const old = previous.get(directory);
    if (old?.name === item.name) {
      const comparison = compareReleaseVersions(old.version, item.version);
      if (comparison > 0) throw Error(`${item.name}: version decreased from ${old.version} to ${item.version}`);
      return allUnpublished || comparison < 0;
    }
    return true;
  }).map(item => ({ ...item, directory: path.relative(root, eligible.get(item.name).dir).split(path.sep).join('/') }));
}
