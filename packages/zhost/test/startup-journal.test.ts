import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  writeStartupJournal,
  recoverStartupJournal,
  snapshot,
  atomicStateWrite,
  journalPath,
} from '../dist/portless/startup-journal.js';
import { publishStartupState } from '../dist/portless/startup-state.js';
/** Run one synchronous isolated synthetic journal fixture and clean all owned files.
 * @param {(dir: string) => void} f Assertions over the owned temporary namespace.
 * @returns {void} Completes assertions and unconditional cleanup. */
const run = (f) => {
  /** Owned private temporary state directory removed in the fixture cleanup. */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhost-journal-'));
  try {
    f(dir);
  } finally {
    fs.rmSync(dir, { force: true, recursive: true });
  }
};
/** Create fixed synthetic listener metadata without binding a native port.
 * @param {string} dir Owned private fixture namespace.
 * @returns {object} Fixed startup publication configuration. */
const state = (dir) => ({
  stateDir: dir,
  port: 3501,
  https: false,
  tld: 'localhost',
});
test('journal restores interrupted state and clears itself', () =>
  run((dir) => {
    fs.writeFileSync(path.join(dir, 'proxy.port'), '3000\n');
    /** Complete observed fixture state before simulated interrupted publication. */
    const before = snapshot(dir);
    /** Known proposed fixture bytes used to stage a partial write. */
    const after = {
      ...before,
      'proxy.port': Buffer.from('3501\n'),
      'proxy.tls': Buffer.from('1\n'),
    };
    writeStartupJournal(dir, before, after);
    atomicStateWrite(path.join(dir, 'proxy.port'), after['proxy.port']);
    assert.equal(
      recoverStartupJournal(dir, () => false),
      true
    );
    assert.equal(
      fs.readFileSync(path.join(dir, 'proxy.port'), 'utf8'),
      '3000\n'
    );
    assert.equal(fs.existsSync(journalPath(dir)), false);
    assert.equal(
      recoverStartupJournal(dir, () => false),
      false
    );
  }));
test('unrecognized external modification blocks recovery', () =>
  run((dir) => {
    /** Complete observed fixture state before simulated interrupted publication. */
    const before = snapshot(dir);
    /** Known proposed fixture bytes used to stage a partial write. */
    const after = { ...before, 'proxy.port': Buffer.from('3501\n') };
    writeStartupJournal(dir, before, after);
    fs.writeFileSync(path.join(dir, 'proxy.port'), 'other\n');
    assert.throws(
      () => recoverStartupJournal(dir, () => false),
      /outside interrupted/
    );
    assert.equal(fs.existsSync(journalPath(dir)), true);
  }));
test('invalid journal fails closed', () =>
  run((dir) => {
    fs.writeFileSync(journalPath(dir), 'bad json');
    assert.throws(
      () => recoverStartupJournal(dir, () => false),
      /Invalid proxy startup journal/
    );
  }));
test('live marker prevents recovery', () =>
  run((dir) => {
    /** Complete observed fixture state before simulated interrupted publication. */
    const before = snapshot(dir);
    /** Known proposed fixture bytes used to stage a partial write. */
    const after = { ...before, 'proxy.pid': Buffer.from('live') };
    writeStartupJournal(dir, before, after);
    fs.writeFileSync(path.join(dir, 'proxy.pid'), 'live');
    assert.throws(
      () => recoverStartupJournal(dir, () => true),
      /process is live/
    );
  }));
test('normal publication clears journal', () =>
  run((dir) => {
    /** Owned conditional publication rollback receipt under test. */
    const publication = publishStartupState(state(dir));
    assert.equal(fs.existsSync(journalPath(dir)), false);
    publication.rollback();
    assert.equal(fs.existsSync(path.join(dir, 'proxy.pid')), false);
  }));
