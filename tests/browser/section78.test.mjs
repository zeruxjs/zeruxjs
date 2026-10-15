import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {withBrowserFixture,runChromium} from './harness.mjs';
const browser=process.env.CHROMIUM_BIN??'chromium';
const available=process.env.RUN_BROWSER_TESTS==='1' && spawnSync(browser,['--version'],{timeout:2500}).status===0;
test('Section 78 Chromium bridge, keyboard, ARIA and reduced-motion fixture',{skip:!available},async()=>{
 await withBrowserFixture('section78.html',async url=>{
  const result=await runChromium(url,{binary:browser,flags:['--force-prefers-reduced-motion']});
  assert.deepEqual(result,{pass:true,errors:[]});
 });
});
