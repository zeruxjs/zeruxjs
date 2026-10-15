import test from 'node:test';import assert from 'node:assert/strict';
import {withBrowserFixture} from './harness.mjs';
test('static browser fixture serves allowed modules and blocks arbitrary files',async()=>{
 await withBrowserFixture('section78.html',async base=>{
  const entry=await fetch(base);assert.equal(entry.status,200);assert.match(await entry.text(),/Frontend bridge browser fixture/);
  const js=await fetch(new URL('/packages/@zeruxjs/react/dist/index.js',base));
  assert.equal(js.status,200);assert.match(js.headers.get('content-type'),/javascript/);
  const blocked=await fetch(new URL('/package.json',base));assert.equal(blocked.status,403);
  const missing=await fetch(new URL('/nonexistent.js',base));assert.equal(missing.status,404);
 });
});
