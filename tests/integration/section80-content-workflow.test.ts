import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createFileManager,
  createLocalStorage,
} from '../../packages/@zeruxjs/files/dist/index.js';
import { createMediaFilesService } from '../../packages/@zeruxjs/media/dist/index.js';
import { createAssetManager } from '../../packages/@zeruxjs/asset-manager/dist/index.js';
import { createSearchIndex } from '../../packages/@zeruxjs/search/dist/index.js';
import { createSearchHandler } from '../../packages/@zeruxjs/search/dist/http.js';
import { createFeedFetchHandler } from '../../packages/@zeruxjs/feed/dist/fetch.js';
import { createCrawlerService } from '../../packages/@zeruxjs/seo/dist/fetch.js';
import {
  createKnowledgeBase,
  retrieveEvidence,
} from '../../packages/@zeruxjs/ai-model/dist/index.js';

test('private media -> asset catalog -> scoped search -> RSS and sitemap content workflow', async () => {
  /** Test fixture or local value named root. */
  const root = await mkdtemp(join(tmpdir(), 'section80-content-'));
  /** Test fixture or local value named files. */
  const files = createFileManager({
    stores: [
      {
        name: 'local',
        driver: createLocalStorage({ root }),
        allowedBuckets: ['content-bucket'],
      },
    ],
  });
  /**
   * Authorize the content workflow's tenant-bound operations.
   *
   * @param {Request} req - Incoming request containing the bearer token.
   * @param {unknown} _address - Address metadata supplied by the service.
   * @param {string} op - Operation being authorized.
   * @param {{metadata?: {owner?: string}}} info - Resource metadata.
   * @returns {boolean} Whether the request may perform the operation.
   */
  const auth = (req, _address, op, info) =>
    req.headers.get('authorization') === 'Bearer editor' &&
    (op === 'write' || info?.metadata.owner === 'editor');
  /** Test fixture or local value named media. */
  const media = createMediaFilesService(files, {
    bucket: 'content-bucket',
    storage: 'local',
    authorize: auth,
  });
  try {
    /** Test fixture or local value named created. */
    const created = await media.upload(
      new Request('https://example.test/upload', {
        method: 'PUT',
        headers: {
          authorization: 'Bearer editor',
          'content-type': 'image/png',
        },
        body: Buffer.from('PNG'),
      }),
      { name: 'brand.png' }
    );
    await files.put(media.address(created.id), Buffer.from('PNG'), {
      contentType: 'image/png',
      ifNoneMatch: false,
      metadata: { owner: 'editor' },
    });
    /** Test fixture or local value named guest. */
    const guest = new Request('https://example.test/');
    assert.deepEqual((await media.listAuthorized(guest)).items, []);
    /** Test fixture or local value named editor. */
    const editor = new Request('https://example.test/', {
      headers: { authorization: 'Bearer editor' },
    });
    assert.deepEqual(
      (await media.listAuthorized(editor)).items.map((x) => x.id),
      [created.id]
    );
    assert.equal((await media.download(created.id, guest)).status, 403);
    assert.equal((await media.download(created.id, editor)).status, 200);
    /** Test fixture or local value named assets. */
    const assets = createAssetManager();
    assets.add({
      id: 'site/logo',
      name: 'Brand logo',
      type: 'image',
      url: `https://example.test/content/${created.id}`,
      tags: ['branding'],
    });
    /** Test fixture or local value named logo. */
    const logo = assets.get('site/logo');
    assert.equal(logo.name, 'Brand logo');
    /** Test fixture or local value named search. */
    const search = createSearchIndex();
    search.addMany([
      {
        id: 'logo',
        title: logo.name,
        text: 'official branding asset',
        owner: 'editor',
      },
      {
        id: 'private',
        title: 'Finance plan',
        text: 'confidential financial plans',
        owner: 'admin',
      },
    ]);
    /** Test fixture or local value named api. */
    const api = createSearchHandler({
      index: search,
      fields: ['id', 'title'],
      filter: (doc) => doc.owner === 'editor',
    });
    /** Test fixture or local value named response. */
    const response = await api(
      new Request('https://example.test/search?q=branding')
    );
    assert.deepEqual(
      (await response.json()).results.map((r) => r.document.id),
      ['logo']
    );
    assert.equal(
      (await api(new Request('https://example.test/search?q=finance'))).status,
      200
    );
    /** Test fixture or local value named feed. */
    const feed = createFeedFetchHandler({
      feed: {
        title: 'Updates',
        description: 'Asset updates',
        siteUrl: 'https://example.test/',
        items: [
          {
            id: logo.id,
            title: logo.name,
            url: logo.url,
            date: '2026-10-14T00:00:00Z',
          },
        ],
      },
      format: 'negotiate',
    });
    /** Test fixture or local value named rss. */
    const rss = await feed(
      new Request('https://example.test/feed', {
        headers: { accept: 'application/rss+xml' },
      })
    );
    assert.equal(rss.status, 200);
    assert.match(await rss.text(), /Brand logo/);
    /** Test fixture or local value named crawler. */
    const crawler = createCrawlerService({
      origin: 'https://example.test/',
      entries: [{ loc: logo.url }],
    });
    /** Test fixture or local value named sitemap. */
    const sitemap = await crawler.routes[1].handler(
      new Request('https://example.test/sitemap.xml')
    );
    assert.equal(sitemap.status, 200);
    assert.match(await sitemap.text(), /sitemap|urlset/);
    /** Test fixture or local value named kb. */
    const kb = createKnowledgeBase();
    kb.add({
      id: 'logo-guide',
      text: 'Branding assets are only shared after permission checks.',
    });
    assert.equal(retrieveEvidence(kb, 'branding').length, 1);
  } finally {
    await files.close();
    await rm(root, { recursive: true, force: true });
  }
});
