import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  publishStaticOutput,
  createStaticSiteHandler,
} from 'zeruxjs/static-site';

test('public artifact publication serves mounted pages, HEAD, validators and private request cache policy', async (t) => {
  /** Disposable project contains only synthetic public output. */
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zerux-static-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'candidate/manual/v1/intro'), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(root, 'candidate/manual/v1/intro/index.html'),
    '<h1>Public</h1>'
  );
  await fs.writeFile(path.join(root, 'candidate/404.html'), 'Missing');
  await publishStaticOutput({ rootDir: root, stagingDir: 'candidate' });
  /** Manifest-bound consumer; no native listener is started. */
  const handle = await createStaticSiteHandler({ rootDir: root });
  /** Real Web response over synthetic artifact bytes. */
  const response = await handle(
    new Request('https://site.test/manual/v1/intro/')
  );
  assert.equal(await response.text(), '<h1>Public</h1>');
  assert.equal(
    (await handle(new Request('https://site.test/manual/v1/intro'))).status,
    308
  );
  assert.equal(
    (
      await handle(
        new Request('https://site.test/manual/v1/intro/', { method: 'HEAD' })
      )
    ).body,
    null
  );
  assert.equal(
    (
      await handle(
        new Request('https://site.test/manual/v1/intro/', {
          headers: { 'If-None-Match': response.headers.get('etag')! },
        })
      )
    ).status,
    304
  );
  assert.equal(
    (
      await handle(
        new Request('https://site.test/manual/v1/intro/', {
          headers: { Cookie: 'session=fixture' },
        })
      )
    ).headers.get('cache-control'),
    'private, no-store'
  );
  assert.equal(
    (await handle(new Request('https://site.test/.env'))).status,
    404
  );
  assert.equal(
    (
      await handle(
        new Request('https://site.test/manual/v1/intro/', { method: 'POST' })
      )
    ).status,
    405
  );
  await fs.writeFile(
    path.join(root, 'out/manual/v1/intro/index.html'),
    'Tampered'
  );
  assert.equal(
    (await handle(new Request('https://site.test/manual/v1/intro/'))).status,
    503
  );
});
test('failed validation preserves previous output and symlink/source escapes reject', async (t) => {
  /** Isolated staging/public output; no operator application directories are used. */
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zerux-stage-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'out'));
  await fs.writeFile(path.join(root, 'out/index.html'), 'Previous');
  await fs.mkdir(path.join(root, 'candidate'));
  await fs.writeFile(path.join(root, 'candidate/index.html'), 'Next');
  await assert.rejects(
    publishStaticOutput({
      rootDir: root,
      stagingDir: 'candidate',
      replaceExisting: true,
      validate: async () => {
        throw Error('Validation failed');
      },
    }),
    /failed/
  );
  assert.equal(
    await fs.readFile(path.join(root, 'out/index.html'), 'utf8'),
    'Previous'
  );
  await fs.symlink(
    path.join(root, 'out/index.html'),
    path.join(root, 'candidate/secret.html')
  );
  await assert.rejects(
    publishStaticOutput({
      rootDir: root,
      stagingDir: 'candidate',
      replaceExisting: true,
    }),
    /symlink/
  );
  await assert.rejects(
    publishStaticOutput({
      rootDir: root,
      stagingDir: 'candidate',
      outDir: '../escape',
    }),
    /escapes/
  );
});

test('export manifest redirects retain status and corrupt redirect policies reject before serving', async (t) => {
  /** Synthetic output exercises the existing exporter hosting contract without starting services. */
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zerux-hosting-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'candidate'));
  await fs.writeFile(path.join(root, 'candidate/index.html'), 'Public');
  await fs.writeFile(path.join(root, 'candidate/404.html'), 'Missing');
  await publishStaticOutput({ rootDir: root, stagingDir: 'candidate' });
  /** Convert only the fixture's schema discriminator to the original exporter contract. */
  const manifest = JSON.parse(
    await fs.readFile(path.join(root, 'out/static-output.json'), 'utf8')
  );
  manifest.kind = 'zerux-static-export';
  manifest.hosting = {
    notFound: { file: '404.html', status: 404 },
    redirects: [{ from: '/old', to: '/', status: 302 }],
  };
  await fs.unlink(path.join(root, 'out/static-output.json'));
  await fs.writeFile(
    path.join(root, 'out/static-export.json'),
    JSON.stringify(manifest)
  );
  /** Handler honors explicit public redirect status without resolving an external destination. */
  const handler = await createStaticSiteHandler({ rootDir: root });
  assert.equal(
    (await handler(new Request('https://site.test/old'))).status,
    302
  );
  assert.equal(
    (await handler(new Request('https://site.test/404.html'))).status,
    404
  );
  manifest.hosting.redirects[0].to = '//evil.test';
  await fs.writeFile(
    path.join(root, 'out/static-export.json'),
    JSON.stringify(manifest)
  );
  await assert.rejects(createStaticSiteHandler({ rootDir: root }), /redirect/);
});
