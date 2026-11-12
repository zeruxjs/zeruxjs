/** Node test registry; fixtures own all resources explicitly. */
const { test } = require('node:test');
/** Strict assertions; no test outcome is inferred from successful compilation. */
const assert = require('node:assert/strict');
/** Filesystem utilities restricted to disposable fixture roots. */
const fs = require('node:fs');
/** Filesystem path construction without shell interpolation. */
const path = require('node:path');
/** Temporary-directory discovery; no operator database path is used. */
const os = require('node:os');
/** Built public database module; import opens no connection. */
const db = require('../dist/index.js');
/** Public scoped acquisition factory. */
const { createDatabaseManager } = db;
/** Existing internal helpers tested for reference/JSON compatibility. */
const { getPathValue, assertJsonSerializable } = require('../dist/utils.js');
test('references never traverse object prototypes', () => {
  assert.equal(getPathValue({ a: { v: 1 } }, 'a.v'), 1);
  assert.equal(getPathValue({}, 'constructor.prototype'), undefined);
  assert.equal(getPathValue([1, 2], '0junk'), undefined);
  assert.throws(() => assertJsonSerializable({ a: undefined }, 'input'));
});
test('failed database manager initialization disconnects earlier connectors', async () => {
  /** Owned temporary application whose connector modules are removed in finally. */
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zx-db-manager-'));
  /** Caller working directory restored on every terminal path. */
  const previous = process.cwd();
  try {
    fs.writeFileSync(path.join(root, 'package.json'), '{}');
    /** First explicitly configured connector package with observable disconnect. */
    const mod = path.join(root, 'node_modules', 'test-first');
    fs.mkdirSync(mod, { recursive: true });
    /** Synthetic cleanup receipt written only inside the temporary root. */
    const recorded = path.join(root, 'closed');
    fs.writeFileSync(
      path.join(mod, 'index.js'),
      `exports.createConnector=()=>({kind:'fake',options:{},connect(){},disconnect(){require('node:fs').writeFileSync(require('node:path').join(__dirname,'../../closed'),'yes')},execute(){return {ok:true}}});`
    );
    /** Second explicitly configured connector package that rejects connect. */
    const fail = path.join(root, 'node_modules', 'test-second');
    fs.mkdirSync(fail, { recursive: true });
    fs.writeFileSync(
      path.join(fail, 'index.js'),
      `exports.createConnector=()=>({kind:'fake',options:{},connect(){throw Error('connect exploded')},disconnect(){}});`
    );
    process.chdir(root);
    await assert.rejects(
      createDatabaseManager({
        connections: [
          { slug: 'a', name: 'A', connector: 'test-first' },
          { slug: 'b', name: 'B', connector: 'test-second' },
        ],
        default: 'a',
      }),
      /connect exploded/
    );
    assert.equal(fs.readFileSync(recorded, 'utf8'), 'yes');
    /** Recovered manager owner proving idempotent disconnect after rollback testing. */
    const manager = await createDatabaseManager({
      connections: [{ slug: 'a', name: 'A', connector: 'test-first' }],
    });
    await manager.disconnect();
    await manager.disconnect();
    assert.throws(() => manager.dbAccess('a'), /disconnected/);
  } finally {
    process.chdir(previous);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('connection summaries hide URI credentials and nested secrets', () => {
  /** Compatibility redaction helper; arbitrary custom secret keys are not automatically discovered. */
  const { redactConnectionOptions } = require('../dist/utils.js');
  /** Synthetic nested connection summary checked for known secret-field masking. */
  const shown = redactConnectionOptions({
    uri: 'mongodb://admin:pass@localhost:27017',
    options: { password: 'secret', safe: true },
    client: { socket: 'secret' },
  });
  assert.equal(shown.uri, '[redacted]');
  assert.equal(shown.options.password, '[redacted]');
  assert.equal(shown.options.safe, true);
  assert.equal(shown.client, '[redacted]');
});
