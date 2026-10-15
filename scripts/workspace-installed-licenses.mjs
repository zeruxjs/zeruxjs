/** Post-install third-party license metadata inspection, not legal clearance. */
import fs from 'node:fs';
import path from 'node:path';
const licenseNames=/^(?:LICEN[CS]E|COPYING|NOTICE)(?:[-._].*)?$/i;
export function inspectInstalledLicenses(root,lock) {
  const checked=[],missing=[],uninstalled=[],discrepancies=[];
  for(const [relative,entry] of Object.entries(lock.packages??{})) {
    if(!relative.startsWith('node_modules/')||entry.link)continue;
    const dir=path.resolve(root,relative);
    if(!dir.startsWith(path.resolve(root)+path.sep)){
      discrepancies.push({package:relative,reason:'Lockfile package path escapes workspace'});continue;
    }
    const manifestPath=path.join(dir,'package.json');
    if(!fs.statSync(manifestPath,{throwIfNoEntry:false})?.isFile()) {
      uninstalled.push(relative);continue;
    }
    let manifest;
    try{manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));}
    catch{discrepancies.push({package:relative,reason:'Invalid installed manifest'});continue;}
    const name=manifest.name??relative,license=manifest.license??null;
    if(entry.version&&manifest.version!==entry.version)discrepancies.push({package:relative,reason:`Version ${manifest.version} differs from lock ${entry.version}`});
    const files=fs.readdirSync(dir);
    const licenseFiles=files.filter(item=>licenseNames.test(item)&&fs.statSync(path.join(dir,item),{throwIfNoEntry:false})?.isFile());
    if(!license||license==='UNLICENSED'||!licenseFiles.length)missing.push({package:name,version:manifest.version??null,license,files:licenseFiles,reason:!license?'Missing installed SPDX license field':!licenseFiles.length?'Missing distributable license/notice file':'Unlicensed package'});
    checked.push({name,version:manifest.version??null,license,files:licenseFiles});
  }
  return {checked:checked.length,uninstalled,discrepancies,missing,ok:!uninstalled.length&&!discrepancies.length&&!missing.length};
}
