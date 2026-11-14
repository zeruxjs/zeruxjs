import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileManager, createLocalStorage } from '@zeruxjs/files';
import { createMediaFilesService } from '../dist/index.js';
test('Media can upload/download/list/delete files through the multi-store backend', async () => {
  /** Owned isolated temporary fixture directory, removed by the enclosing cleanup. */
  const root = await mkdtemp(join(tmpdir(), 'media-files-'));
  /** Owned local files manager used only within this synthetic fixture. */
  const manager = createFileManager({
    stores: [{ name: 'media', driver: createLocalStorage({ root }) }],
  });
  /** Synthetic permission switch controlled by the fixture host policy.
   * @param {Request} request - Synthetic request inspected by the host policy.
   * @param {object} _address - Synthetic provider address; never a verified identity.
   * @param {string} _action - Fixed requested operation label.
   * @returns {unknown} Observed synthetic result; failures stay explicit to the enclosing assertion.
   */
  const authorized = (request, _address, _action) =>
    request.headers.get('authorization') === 'Bearer allowed';
  /** Borrowed-manager media facade; the fixture retains manager lifecycle ownership. */
  const service = createMediaFilesService(manager, {
    storage: 'media',
    bucket: 'media-files',
    authorize: authorized,
  });
  /** Synthetic object key, caption identity or fixed protocol field used by this case. */
  const key = 'https://files.test';
  try {
    /** Synthetic explicit payload bytes; no real tenant content or remote files are used. */
    const bytes = Buffer.from([0, 1, 2, 254, 255]);
    /** Deliberately unauthorized fixture principal/client; denial must occur before exposure. */
    const denied = new Request(key, { method: 'PUT', body: bytes });
    await assert.rejects(service.upload(denied), { code: 'FORBIDDEN' });
    /** Synthetic verified request state used by the host callback. */
    const authenticated = new Request(key, {
      method: 'PUT',
      body: bytes,
      headers: {
        Authorization: 'Bearer allowed',
        'Content-Type': 'application/octet-stream',
      },
    });
    /** Synthetic successful upload receipt used for subsequent authorized checks. */
    const uploaded = await service.upload(authenticated, {
      name: 'camera.raw',
    });
    assert.equal(uploaded.info.size, 5);
    assert.equal(uploaded.info.visibility, 'private');
    assert.equal(uploaded.info.metadata.originalName, 'camera.raw');
    assert.equal((await service.list()).items.length, 1);
    /** Malformed synthetic request/ID/header used to assert explicit rejection. */
    const bad = await service.download(uploaded.id, new Request(key));
    assert.equal(bad.status, 403);
    /** Synthetic Fetch request for the specific method/body/authorization case. */
    const req = new Request(key, {
      headers: { Authorization: 'Bearer allowed', Range: 'bytes=2-4' },
    });
    /** Synthetic/native response whose body is explicitly consumed or cancelled by the fixture. */
    const response = await service.download(uploaded.id, req);
    assert.equal(response.status, 206);
    assert.deepEqual(
      Buffer.from(await response.arrayBuffer()),
      bytes.subarray(2)
    );
    assert.equal(
      await service.remove(
        uploaded.id,
        new Request(key, { headers: { Authorization: 'Bearer allowed' } })
      ),
      true
    );
    assert.equal(await service.stat(uploaded.id), null);
  } finally {
    await manager.close();
    await rm(root, { recursive: true, force: true });
  }
});
test('request-scoped media list and stat hide unauthorized file metadata', async () => {
  /** Owned isolated temporary fixture directory, removed by the enclosing cleanup. */
  const root = await mkdtemp(join(tmpdir(), 'media-scopes-'));
  /** Owned local files manager used only within this synthetic fixture. */
  const manager = createFileManager({
    stores: [{ name: 'media', driver: createLocalStorage({ root }) }],
  });
  /** Borrowed-manager media facade; the fixture retains manager lifecycle ownership. */
  const service = createMediaFilesService(manager, {
    storage: 'media',
    bucket: 'media-files',
    authorize: (request, _, action, info) =>
      request.headers.get('authorization') === 'Bearer alpha' &&
      (!info || info.metadata.owner === 'alpha'),
  });
  try {
    /** Synthetic Fetch request or fixed subprocess arguments; never operator credentials. */
    const request = new Request('https://files.test', {
      method: 'PUT',
      headers: { authorization: 'Bearer alpha' },
      body: 'hello',
    });
    /** Opaque synthetic committed ID extracted for authorized subsequent operations. */
    const { id } = await service.upload(request, { name: 'alpha.txt' });
    /** Fixed local synthetic destination inspected for deletion or isolation assertions. */
    const target = service.address(id);
    await manager.put(target, Buffer.from('hello'), {
      ifNoneMatch: false,
      visibility: 'private',
      metadata: { owner: 'alpha' },
    });
    /** Synthetic private record omitted by per-object authorization. */
    const hidden = service.address('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
    await manager.put(hidden, Buffer.from('secret'), {
      visibility: 'private',
      metadata: { owner: 'beta' },
    });
    /** Synthetic unauthenticated request that must not enumerate private metadata. */
    const guest = new Request('https://files.test');
    assert.deepEqual((await service.listAuthorized(guest)).items, []);
    await assert.rejects(service.statAuthorized(id, guest), {
      code: 'FORBIDDEN',
    });
    /** Synthetic permission switch controlled by the fixture host policy. */
    const authorized = new Request('https://files.test', {
      headers: { authorization: 'Bearer alpha' },
    });
    assert.equal(
      (await service.statAuthorized(id, authorized)).key,
      target.key
    );
    /** Authorized synthetic page whose metadata/cursor exposure is explicitly asserted. */
    const visible = await service.listAuthorized(authorized);
    assert.deepEqual(
      visible.items.map((item) => item.id),
      [id]
    );
  } finally {
    await manager.close();
    await rm(root, { recursive: true, force: true });
  }
});
test('authorized listings never expose a raw cursor containing a hidden key', async () => {
  /** Synthetic private record omitted by per-object authorization. */
  const hidden = {
    bucket: 'media-files',
    key: 'media/deadbeef-dead-4eed-8ead-deadbeefbeef',
    visibility: 'private',
    metadata: { owner: 'other' },
  };
  /** Owned local files manager used only within this synthetic fixture. */
  const manager = {
    /** Return the explicit synthetic provider page used for per-object visibility assertions.
     * @returns {Promise<unknown>} Fixture-owned result or explicit simulated failure; no live-provider guarantee.
     */
    async list() {
      return { items: [hidden], nextCursor: hidden.key };
    },
  };
  /** Borrowed-manager media facade; the fixture retains manager lifecycle ownership. */
  const service = createMediaFilesService(manager, {
    bucket: 'media-files',
    authorize: () => false,
  });
  assert.deepEqual(
    await service.listAuthorized(new Request('https://files.test')),
    { items: [] }
  );
});
