import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createCacheHelper } from '@zeruxjs/cache-valkey';
test('actual iovalkey driver connects to a scoped RESP fixture and releases its socket', async () => {
  /** Fixture-owned accepted TCP sockets, destroyed during teardown. */
  const sockets = new Set();
  /** Synthetic RESP string storage; not a live Valkey database. */
  const values = new Map();
  /** Ephemeral loopback RESP server for the actual pinned driver. */
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      // Parse complete RESP commands only; partial frames remain buffered.
      while (buffer.length) {
        let position = 0;
        /** Read one complete RESP line from the local fixture buffer.

 * @returns {string} Line without CRLF; zero sentinel signals incomplete data. */
        const line = () => {
          /** Next CRLF boundary; partial frames wait for more bytes. */
          const end = buffer.indexOf('\r\n', position);
          if (end < 0) {
            throw 0;
          }
          /** Decoded complete local fixture line. */
          const value = buffer.toString('utf8', position, end);
          position = end + 2;
          return value;
        };
        let args;
        try {
          /** RESP array header for one complete request. */
          const head = line();
          assert.equal(head[0], '*');
          args = [];
          // Read exactly the declared argument count before dispatching the synthetic command.
          for (let n = Number(head.slice(1)); n--; ) {
            /** Declared bulk-string byte length before buffer consumption. */
            const size = Number(line().slice(1));
            if (buffer.length < position + size + 2) {
              throw 0;
            }
            args.push(buffer.toString('utf8', position, position + size));
            position += size + 2;
          }
        } catch (error) {
          if (error === 0) {
            return;
          }
          socket.destroy(error);
          return;
        }
        buffer = buffer.subarray(position);
        /** Synthetic native command and bounded test arguments interpreted by the fixture. */
        const [command, key, value, ...options] = args;
        switch (command.toLowerCase()) {
          case 'info': {
            /** Fixed minimal INFO reply used by driver initialization. */
            const info = 'redis_version:7.2.0\r\nloading:0\r\n';
            socket.write(`$${Buffer.byteLength(info)}\r\n${info}\r\n`);
            break;
          }
          case 'client':
            socket.write('+OK\r\n');
            break;
          case 'set':
            if (options.includes('NX') && values.has(key)) {
              socket.write('$-1\r\n');
              break;
            }
            values.set(key, value);
            socket.write('+OK\r\n');
            break;
          case 'get': {
            /** Synthetic stored body returned as a RESP bulk string. */
            const result = values.get(key);
            socket.write(
              result === undefined
                ? '$-1\r\n'
                : `$${Buffer.byteLength(result)}\r\n${result}\r\n`
            );
            break;
          }
          case 'quit':
            socket.end('+OK\r\n');
            break;
          default:
            socket.write('-ERR fixture unsupported command\r\n');
        }
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let helper;
  try {
    helper = await createCacheHelper({
      host: '127.0.0.1',
      port: server.address().port,
    });
    await helper.set('normal', { text: 'é' });
    assert.deepEqual(await helper.get('normal'), { text: 'é' });
    await helper.set('normal', false, { ifAbsent: true });
    assert.deepEqual(await helper.get('normal'), { text: 'é' });
    assert.equal(await helper.get('missing'), undefined);
    await helper.close();
    await helper.whenClosed();
  } finally {
    if (helper) {
      await helper.close();
    }
    // Destroy every fixture-owned peer socket before closing the local server.
    for (const socket of sockets) {
      socket.destroy();
    }
    await new Promise((resolve) => server.close(resolve));
  }
  assert.equal(server.listening, false);
});
