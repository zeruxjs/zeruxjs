/** Pure, dependency-free public consumer selection/target checks. */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Title: Lock an isolated tarball consumer to the reviewed workspace resolutions.
 * Description: Replaces workspace links with actual archive versions/integrities and retains the reachable external lock graph, so npm ci needs cached tarballs rather than registry metadata.
 * Global Variables: None; filesystem paths are converted to portable file URLs without reading files or environment variables.
 * @param sourceLock Committed package-lock v3 data.
 * @param archives Packed workspace manifests, original relative directories, tarball paths and npm integrity hashes.
 * @param options.sourceRoot Repository directory for resolving committed local archive paths.
 * @returns Consumer manifest and lockfile containing no workspace symlinks.
 */
export function createConsumerLock(sourceLock, archives, { sourceRoot } = {}) {
  if (sourceLock.lockfileVersion !== 3 || !sourceLock.packages) throw Error('Consumer requires the committed v3 workspace lock');
  const packageName = location => location.slice(location.lastIndexOf('node_modules/') + 'node_modules/'.length);
  const resolutions = new Map();
  for (const [location, record] of Object.entries(sourceLock.packages)) {
    if (location.includes('node_modules/') && !record.link && record.resolved && record.integrity) {
      resolutions.set(`${record.name ?? packageName(location)}@${record.version}`, record);
    }
  }
  const available = {};
  for (const [location, record] of Object.entries(sourceLock.packages)) {
    if (location.startsWith('node_modules/') && !record.link) available[location] = { ...record };
  }
  const dependencies = {};
  for (const { pkg, relativeDir, tarball, integrity } of archives) {
    if (!integrity) throw Error(`${pkg.name}: packed archive integrity is missing`);
    const location = `node_modules/${pkg.name}`;
    const resolved = pathToFileURL(tarball).href;
    dependencies[pkg.name] = resolved;
    const record = { ...sourceLock.packages[relativeDir], version: pkg.version, resolved, integrity };
    delete record.devDependencies;
    delete record.link;
    available[location] = record;
    // npm may install a workspace's runtime dependencies below its local directory.
    for (const [key, nested] of Object.entries(sourceLock.packages)) {
      if (key.startsWith(`${relativeDir}/node_modules/`) && !nested.link) {
        available[location + key.slice(relativeDir.length)] = { ...nested };
      }
    }
  }
  const nodeTypes = available['node_modules/@types/node'];
  if (!nodeTypes?.version || !nodeTypes.resolved || !nodeTypes.integrity) throw Error('Missing locked @types/node consumer baseline; clean npm ci is required');
  dependencies['@types/node'] = nodeTypes.version;
  const manifest = { name: 'zerux-public-package-consumer', private: true, type: 'module', dependencies };
  const packages = { '': manifest };
  const queue = Object.keys(dependencies).map(name => `node_modules/${name}`);
  while (queue.length) {
    const location = queue.pop();
    if (Object.hasOwn(packages, location)) continue;
    const record = available[location];
    if (!record) throw Error(`Consumer dependency lacks a committed resolution: ${location}`);
    const locked = { ...record };
    if (!locked.resolved || !locked.integrity) {
      // npm can omit these fields for a repeated nested version. Reuse only an identical package/version already recorded in the committed lock.
      const resolution = resolutions.get(`${record.name ?? packageName(location)}@${record.version}`);
      if (!resolution) throw Error(`Consumer dependency lacks a complete committed resolution: ${location}`);
      locked.resolved ??= resolution.resolved;
      locked.integrity ??= resolution.integrity;
    }
    // A committed build-input archive lives in the source repository, not in the isolated consumer.
    if (locked.resolved.startsWith('file:') && !locked.resolved.startsWith('file://')) {
      if (!sourceRoot) throw Error(`Local consumer archive requires sourceRoot: ${location}`);
      const local = path.resolve(sourceRoot, locked.resolved.slice('file:'.length));
      if (!local.startsWith(path.resolve(sourceRoot) + path.sep)) throw Error(`Local consumer archive escapes sourceRoot: ${location}`);
      locked.resolved = pathToFileURL(local).href;
    }
    // These are production consumer dependencies even if used only for development in the source workspace.
    delete locked.dev;
    delete locked.devOptional;
    packages[location] = locked;
    for (const name of Object.keys({ ...record.dependencies, ...record.optionalDependencies, ...record.peerDependencies })) {
      let parent = location;
      let found;
      while (true) {
        const candidate = `${parent ? parent + '/' : ''}node_modules/${name}`;
        if (Object.hasOwn(available, candidate)) { found = candidate; break; }
        if (!parent) break;
        const nested = parent.lastIndexOf('/node_modules/');
        parent = nested < 0 ? '' : parent.slice(0, nested);
      }
      if (found) queue.push(found);
      else if (!Object.hasOwn(record.optionalDependencies ?? {}, name) &&
        record.peerDependenciesMeta?.[name]?.optional !== true && !record.bundleDependencies?.includes(name)) {
        throw Error(`Consumer dependency lacks a committed resolution: ${location} -> ${name}`);
      }
    }
  }
  return { manifest, lock: { name: manifest.name, lockfileVersion: 3, requires: true, packages } };
}
export function checkConsumerSelection(plan, only) {
  if (!plan.ok) throw Error('Public dependency graph failed');
  const available = plan.order.map(item=>item.name);
  if (!only) return available;
  const chosen=only.split(',');
  if (!chosen.length || chosen.some(item=>!item||!available.includes(item)) || new Set(chosen).size!==chosen.length)
    throw Error('Unknown, empty or duplicate public package name');
  return available.filter(name=>chosen.includes(name));
}
function collect(record,output=[]) {
  if (typeof record==='string') output.push(record);
  else if(record&&typeof record==='object') for(const value of Object.values(record)) collect(value,output);
  return output;
}
export function checkEntryTargets(dir,pkg) {
  const targets=[...new Set([...collect(pkg.main),...collect(pkg.types),...collect(pkg.bin),...collect(pkg.exports)])];
  if (!targets.length) return ['No declared package entry points'];
  const root=path.resolve(dir);
  return targets.filter(target=>{
    if(typeof target!=='string'||!target.startsWith('./')||target.includes('\\')||target.includes('\0'))return true;
    const segments=target.slice(2).split('/');
    if(segments.some(segment=>segment==='.'||segment==='..'||segment===''))return true;
    const output=path.resolve(dir,target);
    // Assets such as JSON schemas are valid exports; reject symlinks and escapes for every target.
    return !output.startsWith(root+path.sep)||!fs.lstatSync(output,{throwIfNoEntry:false})?.isFile()||
      !fs.realpathSync(output).startsWith(fs.realpathSync(root)+path.sep);
  })
    .map(target=>String(target));
}
