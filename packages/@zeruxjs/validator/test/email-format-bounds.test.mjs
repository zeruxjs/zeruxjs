import test from 'node:test';
import assert from 'node:assert/strict';
import {string,pipe,email,ajvSafeParse} from '../dist/index.js';
test('JSON-schema email format rejects long ambiguous domains and preserves ordinary addresses', {timeout:1000},async()=>{
 const schema=pipe(string(),email());
 assert.equal((await ajvSafeParse(schema,'reader@example.test')).success,true);
 assert.equal((await ajvSafeParse(schema,'reader@'+'a.'.repeat(20000)+'@invalid')).success,false);
 for(const input of ['@example.test','a@example','a@.test','a@example.','a@space .test'])assert.equal((await ajvSafeParse(schema,input)).success,false);
});
