/** Pure, dependency-free public consumer selection/target checks. */
import fs from 'node:fs';
import path from 'node:path';
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
