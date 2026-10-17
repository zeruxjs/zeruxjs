/** Post-install third-party license metadata inspection, not legal clearance. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const licenseNames=/^(?:LICEN[CS]E|COPYING|NOTICE)(?:[-._].*)?$/i;
/** Read modern and legacy npm license metadata without inventing a license. */
function declaredLicense(manifest) {
  if(typeof manifest.license==='string')return manifest.license;
  if(typeof manifest.license?.type==='string')return manifest.license.type;
  const legacy=manifest.licenses?.map(item=>typeof item==='string'?item:item?.type).filter(item=>typeof item==='string');
  return legacy?.length===1?legacy[0]:legacy?.length?`(${legacy.join(' OR ')})`:null;
}
export function inspectInstalledLicenses(root,lock) {
  const checked=[],missing=[],uninstalled=[],discrepancies=[],optionalNotInstalled=[],supplemented=[];
  const catalogRoot=path.join(root,'third-party-licenses');
  let notices=[];
  const catalogFile=path.join(catalogRoot,'manifest.json');
  if(fs.existsSync(catalogFile)) {
    try {
      const catalog=JSON.parse(fs.readFileSync(catalogFile,'utf8'));
      if(catalog.schemaVersion!==1||!Array.isArray(catalog.entries))throw Error('Invalid notice catalog');
      notices=catalog.entries;
    } catch {discrepancies.push({package:'third-party-licenses',reason:'Invalid supplemental notice catalog'});}
  }
  for(const [relative,entry] of Object.entries(lock.packages??{})) {
    if(!relative.startsWith('node_modules/')||entry.link)continue;
    const dir=path.resolve(root,relative);
    if(!dir.startsWith(path.resolve(root)+path.sep)){
      discrepancies.push({package:relative,reason:'Lockfile package path escapes workspace'});continue;
    }
    const manifestPath=path.join(dir,'package.json');
    if(!fs.statSync(manifestPath,{throwIfNoEntry:false})?.isFile()) {
      // npm legitimately omits optional native binaries on unsupported platforms or failed optional installs.
      if(entry.optional===true||entry.devOptional===true)optionalNotInstalled.push(relative);
      else uninstalled.push(relative);
      continue;
    }
    let manifest;
    try{manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));}
    catch{discrepancies.push({package:relative,reason:'Invalid installed manifest'});continue;}
    const name=manifest.name??relative,license=declaredLicense(manifest);
    if(entry.version&&manifest.version!==entry.version)discrepancies.push({package:relative,reason:`Version ${manifest.version} differs from lock ${entry.version}`});
    const files=fs.readdirSync(dir);
    const licenseFiles=files.filter(item=>licenseNames.test(item)&&fs.statSync(path.join(dir,item),{throwIfNoEntry:false})?.isFile());
    if(!licenseFiles.length&&license&&license!=='UNLICENSED') {
      const notice=notices.find(item=>item.name===name&&item.version===manifest.version&&item.license===license);
      if(notice) {
        const validPath=typeof notice.file==='string'&&/^notices\/[a-f0-9]{64}\.txt$/.test(notice.file);
        const file=validPath?path.join(catalogRoot,notice.file):null;
        const stat=file?fs.lstatSync(file,{throwIfNoEntry:false}):null;
        if(!stat?.isFile()||!fs.realpathSync(file).startsWith(fs.realpathSync(catalogRoot)+path.sep)||
          !/^https:\/\/raw\.githubusercontent\.com\//.test(notice.source??'')||
          crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==notice.sha256) {
          discrepancies.push({package:name,reason:'Supplemental notice evidence is missing, unsafe or modified'});
        } else {
          const relativeNotice=path.relative(root,file).split(path.sep).join('/');
          licenseFiles.push(relativeNotice);
          supplemented.push({package:name,version:manifest.version,file:relativeNotice,source:notice.source});
        }
      }
    }
    if(!license||license==='UNLICENSED'||!licenseFiles.length)missing.push({package:name,version:manifest.version??null,license,files:licenseFiles,reason:!license?'Missing installed license metadata':license==='UNLICENSED'?'Unlicensed package':'Missing distributable license/notice file'});
    checked.push({name,version:manifest.version??null,license,files:licenseFiles});
  }
  return {checked:checked.length,uninstalled,optionalNotInstalled,supplemented,discrepancies,missing,ok:!uninstalled.length&&!discrepancies.length&&!missing.length};
}
