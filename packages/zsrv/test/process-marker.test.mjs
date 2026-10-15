import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createProcessMarker, parseProcessMarker, processIdentity, markerMatchesProcess, writeProcessMarker, stopMarkedProcess } from '../dist/portless/lifecycle.js';

test('process marker validation and atomic storage', {skip: process.platform !== 'linux'}, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zsrv-marker-'));
  try {
    const file = path.join(dir, 'proxy.pid');
    const marker = createProcessMarker();
    assert.equal(markerMatchesProcess(marker), true);
    assert.equal(marker.identity, processIdentity(process.pid));
    writeProcessMarker(file, marker);
    assert.deepEqual(parseProcessMarker(fs.readFileSync(file, 'utf8')), marker);
    assert.equal(parseProcessMarker(`${process.pid}`), null);
    assert.equal(parseProcessMarker(JSON.stringify({...marker, nonce:'bad'})), null);
  } finally { fs.rmSync(dir, {recursive:true, force:true}); }
});

test('stop refuses legacy or unverifiable markers', {skip: process.platform !== 'linux'}, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zsrv-stop-'));
  try {
    const file = path.join(dir, 'proxy.pid');
    fs.writeFileSync(file, `${process.pid}`);
    assert.equal(await stopMarkedProcess(file, async()=>true), 'unverified');
    assert.equal(fs.existsSync(file), true);
    const marker = {...createProcessMarker(), pid: process.pid + 1000000};
    writeProcessMarker(file, marker);
    assert.equal(await stopMarkedProcess(file, async()=>true), 'stale');
    assert.equal(fs.existsSync(file), false);
  } finally { fs.rmSync(dir, {recursive:true, force:true}); }
});

test('identified child can be stopped and removed only after exit', {skip: process.platform !== 'linux'}, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zsrv-child-'));
  const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>process.exit(0));setInterval(()=>{},1000)'], {stdio:'ignore'});
  try {
    const file = path.join(dir, 'proxy.pid');
    let identity;
    for (let i=0;i<50;i++) { identity=processIdentity(child.pid); if (identity) break; await new Promise(r=>setTimeout(r,20)); }
    assert.ok(identity);
    writeProcessMarker(file, createProcessMarker(child.pid));
    assert.equal(await stopMarkedProcess(file, async()=>true,{waitMs:3000,pollMs:20}), 'stopped');
    assert.equal(fs.existsSync(file), false);
  } finally { try { child.kill('SIGKILL'); } catch {} fs.rmSync(dir, {recursive:true,force:true}); }
});
