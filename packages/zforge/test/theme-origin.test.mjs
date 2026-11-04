import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const script = readFileSync(new URL('../assets/app.js', import.meta.url), 'utf8');
test('theme messages require the reviewed parent origin and source', () => {
  const callbacks = new Map(), storage = new Map(), messages = [], attributes = new Map();
  const parent = {postMessage(data, origin) {messages.push({data, origin});}};
  const window = {parent, location:{origin:'http://localhost:9000'}, zdev:{config:{themeParentOrigins:['https://app.example']}}, matchMedia(){return {matches:false,addEventListener(){}};}, addEventListener(name, callback){callbacks.set(name,callback);}};
  const document = {documentElement:{setAttribute(name, value){attributes.set(name,value);}},querySelector(){return null;}};
  vm.runInNewContext(script, {window, document, URL, localStorage:{getItem(key){return storage.get(key);},setItem(key,value){storage.set(key,value);}}});
  assert(messages.every(value => value.origin !== '*'));
  const message = callbacks.get('message'), data={type:'zdev:theme-sync',mode:'dark',effectiveTheme:'dark'};
  message({origin:'https://attacker.example',source:parent,data});
  message({origin:'https://app.example',source:{},data});
  assert.equal(attributes.get('data-theme'),'light'); assert.equal(storage.size,0);
  message({origin:'https://app.example',source:parent,data});
  assert.equal(attributes.get('data-theme'),'dark'); assert.equal(storage.get('zdev:devtools:theme'),'dark');
});
