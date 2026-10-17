import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join,dirname} from 'node:path';
const here=dirname(fileURLToPath(import.meta.url));
test('legacy Zerux command executes once and does not terminate handlers',()=>{
 const modulePath=join(here,'../dist/index.js');
 const source=`import {ZeruxCLI} from ${JSON.stringify('file://'+modulePath)};
 const cli=new ZeruxCLI(['dev','--port','6000']);
 cli.addKey('zerux',{func(){cli.addCommand('zerux','dev',args=>{console.log('RUN:'+args.namedArgs.port);});}});`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',source],{encoding:'utf8',timeout:3000});
 assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/RUN:6000/);
});
