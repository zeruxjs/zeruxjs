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
  const dist=path.resolve(dir,'dist');
  return targets.filter(target=>{
    if(typeof target!=='string'||!target.startsWith('./dist/'))return true;
    const output=path.resolve(dir,target);
    return !output.startsWith(dist+path.sep)||!fs.lstatSync(output,{throwIfNoEntry:false})?.isFile();
  })
    .map(target=>String(target));
}
