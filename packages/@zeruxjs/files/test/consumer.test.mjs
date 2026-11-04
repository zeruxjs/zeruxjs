import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
const exec=promisify(execFile),require=createRequire(import.meta.url);
test('packed exports and README example compile and run with installed SDK dependencies',async()=>{
 const temporary=await mkdtemp(join(tmpdir(),'zx-files-consumer-'));
 const packageRoot=resolve(import.meta.dirname,'..'),workspace=resolve(packageRoot,'../../..');
 try{
  const packed=JSON.parse((await exec('npm',['pack','--json','--pack-destination',temporary],{cwd:packageRoot,env:{...process.env,npm_config_cache:join(temporary,'npm-cache')}})).stdout);
  const metadata=Array.isArray(packed)?packed[0]:Object.values(packed)[0];
  const destination=join(temporary,'node_modules/@zeruxjs/files');await mkdir(destination,{recursive:true});
  await exec('tar',['-xzf',join(temporary,metadata.filename),'--strip-components=1','-C',destination]);
  for(const scope of ['@aws-sdk','@smithy','@types'])await symlink(join(workspace,'node_modules',scope),join(temporary,'node_modules',scope),'dir');
  const readme=await readFile(join(packageRoot,'README.md'),'utf8');
  const example=readme.split('## IAM Roles Anywhere and credential diagnostics')[1].match(/```ts\n([\s\S]*?)```/)[1];
  await writeFile(join(temporary,'example.ts'),example);
  const resumable=readme.split('## Resumable uploads')[1].match(/```ts\n([\s\S]*?)```/)[1];
  await writeFile(join(temporary,'resumable.ts'),resumable);
  await writeFile(join(temporary,'package.json'),JSON.stringify({type:'module'}));
  await exec(process.execPath,[require.resolve('typescript/bin/tsc'),'--noEmit','--strict','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext','--skipLibCheck','example.ts','resumable.ts'],{cwd:temporary});
  await writeFile(join(temporary,'consumer.mjs'),`import {createS3Storage, monitorAwsCredentials, createResumableUploads} from '@zeruxjs/files';\nimport {createFilesClient} from '@zeruxjs/files/client';\nconst driver=createS3Storage({rolesAnywhere:{profile:'trusted'}});\nif(driver.capabilities.createOnlyStream!==false||typeof createResumableUploads!=='function'||typeof monitorAwsCredentials!=='function'||typeof createFilesClient!=='function')throw new Error('public contract');\nawait driver.close();`);
  await exec(process.execPath,['consumer.mjs'],{cwd:temporary});
  const manifest=JSON.parse(await readFile(join(destination,'package.json'),'utf8'));
  assert.equal(manifest.version,'0.0.4');assert.deepEqual(Object.keys(manifest.exports),['.','./client']);
 }finally{await rm(temporary,{recursive:true,force:true});}
});
