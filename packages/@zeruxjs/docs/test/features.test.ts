import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  symlink,
  readFile,
} from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import {
  createDocumentation,
  restoreDocumentation,
  documentationNavigation,
  compareDocumentationVersions,
  createDocumentationHandler,
  type DocumentationImage,
} from '@zeruxjs/docs';
import {
  analyzeDocumentationMarkdown,
  validateDocumentationLinks,
  createDocumentationRelease,
} from '@zeruxjs/docs/markdown';
import {
  renderDocumentationArticle,
  renderDocumentationDocument,
  documentationRedirects,
} from '@zeruxjs/docs/zerux';
import { prepareDocumentationAssets } from '@zeruxjs/docs/build';
import { enhanceDocumentation } from '@zeruxjs/docs/browser';
import { createDocumentationSearch } from '@zeruxjs/docs/search';

/** Explicit local image data, not a file fetch or a claim of actual pixel verification. */
const image: DocumentationImage = {
  src: '/manual/assets/v1.png',
  width: 1,
  height: 1,
  alt: 'Authored diagram',
  access: 'public',
};
/** Real one-pixel PNG fixture, not downloaded from an external provider. */
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=',
  'base64'
);
/** Build an inherited image/release catalog with no I/O or global state.
 * @returns {ReturnType<typeof createDocumentation>} Immutable owned catalog.
 */
function fixture() {
  return createDocumentation({
    latest: 'v2',
    basePath: '/manual',
    versions: [
      {
        id: 'v1',
        label: 'Version one',
        status: 'archived',
        releasedAt: '2025-01-01',
        images: {
          diagram: image,
          private: {
            ...image,
            src: '/manual/assets/private.png',
            access: 'private',
          },
        },
        documents: [
          {
            slug: 'intro',
            title: 'Introduction',
            access: 'public',
            description: 'Authored summary',
            keywords: ['installation'],
            updatedAt: '2026-01-01',
            parts: [
              '# Welcome\n\n![Architecture](asset:diagram)\n\n> [!TIP]\n> Keep documents modular.\n\n```ts\nconst value = "<script>";\n```',
            ],
          },
        ],
      },
      {
        id: 'v2',
        extends: 'v1',
        label: 'Current',
        status: 'preview',
        images: {
          diagram: {
            ...image,
            src: '/manual/assets/v2.png',
            darkSrc: '/manual/assets/v2-dark.png',
            sources: [{ src: '/manual/assets/v2-small.png', width: 1 }],
          },
        },
        documents: [],
      },
    ],
  });
}

test('image inheritance, removal and version metadata round-trip without changing released parents', () => {
  /** Immutable resources remain version-specific after overriding a shared alias. */
  const docs = fixture();
  assert.equal(docs.images('v1').diagram?.src, '/manual/assets/v1.png');
  assert.equal(docs.images('v2').diagram?.src, '/manual/assets/v2.png');
  assert.equal(docs.version('v2')?.label, 'Current');
  assert.equal(docs.version('missing'), undefined);
  assert.ok(Object.isFrozen(docs.images('v2').diagram?.sources));
  /** Saved expanded data preserves image/source metadata as well as prose. */
  const snapshot = docs.snapshot();
  assert.deepEqual(restoreDocumentation(snapshot).snapshot(), snapshot);
  assert.deepEqual(
    restoreDocumentation(createDocumentationRelease(docs, 'v2')).snapshot(),
    createDocumentationRelease(docs, 'v2')
  );
  /** Explicit null removes an inherited image, never the original release's record. */
  const removed = createDocumentation({
    latest: 'v3',
    versions: [
      ...snapshot.versions,
      { id: 'v3', extends: 'v2', images: { diagram: null }, documents: [] },
    ],
  });
  assert.equal(removed.images('v3').diagram, undefined);
  assert.ok(removed.images('v2').diagram);
  assert.ok(
    validateDocumentationLinks(removed, 'v3').some(
      (issue) => issue.code === 'unregistered-image'
    )
  );
  assert.throws(
    () =>
      createDocumentation({
        latest: 'a',
        versions: [{ id: 'a', releasedAt: '2026-02-30', documents: [] }],
      }),
    /calendar date/
  );
});

test('registered images emit escaped lazy picture/srcset markup and preserve inert code/notices', () => {
  /** The same alias selects different sources for different releases. */
  const docs = fixture();
  /** Image rendering shares the version registry used by release validation. */
  const html = renderDocumentationArticle(docs, docs.get('v2', 'intro')!);
  assert.match(html, /<picture>/);
  assert.match(html, /src="\/manual\/assets\/v2.png"/);
  assert.match(html, /srcset="\/manual\/assets\/v2-small.png 1w"/);
  assert.match(
    html,
    /loading="lazy" decoding="async" referrerpolicy="no-referrer"/
  );
  assert.match(html, /role="note" aria-label="tip"/);
  assert.match(html, /data-docs-code/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /preview documentation/);
  assert.equal((html.match(/<h1>/g) ?? []).length, 1);
  /** Default direct/unregistered image syntax remains inert for compatibility/privacy. */
  assert.doesNotMatch(
    analyzeDocumentationMarkdown('![x](https://tracker.test/image.png)').html,
    /<img/
  );
});

test('image origins, access, alt labels and malformed syntax fail closed without private URL disclosure', () => {
  /** The browser may contact this remote origin only after explicit host approval. */
  const images = {
    remote: { ...image, src: 'https://images.example/diagram.png' },
    private: { ...image, access: 'private' as const },
    unlabelled: { ...image, alt: undefined },
  };
  assert.equal(
    analyzeDocumentationMarkdown('![Alt](asset:remote)', { images })
      .imageIssues[0]?.code,
    'image-origin-denied'
  );
  assert.match(
    analyzeDocumentationMarkdown('![Alt](asset:remote)', {
      images,
      allowedImageOrigins: ['https://images.example'],
    }).html,
    /<img/
  );
  assert.equal(
    analyzeDocumentationMarkdown('![Alt](asset:private)', { images })
      .imageIssues[0]?.code,
    'private-image'
  );
  assert.equal(
    analyzeDocumentationMarkdown('![](asset:unlabelled)', { images })
      .imageIssues[0]?.code,
    'missing-image-alt'
  );
  assert.doesNotMatch(
    analyzeDocumentationMarkdown('![Alt](asset:private)', { images }).html,
    /manual\/assets/
  );
  for (const src of [
    'javascript:run()',
    'data:image/svg+xml,x',
    '//images.example/x.png',
    '/manual/../secret.png',
    'https://images.example/x.png?token=secret',
  ]) {
    assert.throws(() =>
      createDocumentation({
        latest: 'a',
        versions: [
          { id: 'a', images: { bad: { ...image, src } }, documents: [] },
        ],
      })
    );
  }
  assert.throws(
    () =>
      createDocumentation({
        latest: 'a',
        versions: [
          { id: 'a', images: { bad: { ...image, width: 0 } }, documents: [] },
        ],
      }),
    /dimensions/
  );
  assert.throws(
    () =>
      createDocumentation({
        latest: 'a',
        versions: [
          {
            id: 'a',
            images: {
              bad: {
                ...image,
                sources: [
                  { src: image.src, width: 1 },
                  { src: image.src, width: 1 },
                ],
              },
            },
            documents: [],
          },
        ],
      }),
    /Duplicate/
  );
  assert.throws(
    () =>
      analyzeDocumentationMarkdown('x', {
        images,
        allowedImageOrigins: ['https://images.example/path'],
      }),
    /origin/
  );
});

test('metadata controls navigation/search intent and related/private links are validated', () => {
  /** Hidden is a navigation policy; explicit access is the independent security boundary. */
  const docs = createDocumentation({
    latest: 'a',
    versions: [
      {
        id: 'a',
        documents: [
          {
            slug: 'intro',
            title: 'Visible',
            access: 'public',
            toc: false,
            related: ['hidden', 'private'],
            parts: ['# Section'],
          },
          {
            slug: 'hidden',
            title: 'Hidden sidebar title',
            access: 'public',
            hidden: true,
            parts: [],
          },
          { slug: 'private', title: 'Private title', parts: [] },
        ],
      },
    ],
  });
  assert.deepEqual(
    documentationNavigation(docs, 'a').pages.map((page) => page.slug),
    ['intro']
  );
  assert.ok(
    validateDocumentationLinks(docs, 'a').some(
      (issue) => issue.code === 'private-target'
    )
  );
  /** Public related content is deliberate; private titles stay out of renderer navigation. */
  const html = renderDocumentationArticle(docs, docs.get('a', 'intro')!);
  assert.doesNotMatch(html, /Private title|aria-label="On this page"/);
  assert.match(html, /Related pages/);
  /** Saved metadata is attribute/text escaped, not concatenated as arbitrary head HTML. */
  const document = renderDocumentationDocument(
    docs,
    docs.get('a', 'private')!,
    { stylesheet: '/manual/assets/docs.css' }
  );
  assert.match(document, /name="robots" content="noindex, nofollow"/);
  assert.throws(
    () =>
      renderDocumentationDocument(docs, docs.get('a', 'intro')!, {
        stylesheet: 'https://outside.test/style.css',
      }),
    /stylesheet/
  );
});

test('asset inventory selects referenced public local bytes, verifies hashes and rejects escapes/missing files', async () => {
  /** All test bytes are synthetic and the directory is removed in finally. */
  const root = await mkdtemp(path.join(tmpdir(), 'zerux-docs-assets-'));
  try {
    await mkdir(path.join(root, 'public/manual/assets'), { recursive: true });
    for (const name of ['v1.png', 'v2.png', 'v2-dark.png', 'v2-small.png']) {
      await writeFile(path.join(root, 'public/manual/assets', name), png);
    }
    await writeFile(
      path.join(root, 'public/manual/assets/docs.css'),
      '.theme { color: purple; }'
    );
    /** Manifest is consumed by the framework, which rechecks actual bytes on publication. */
    const assets = await prepareDocumentationAssets(fixture(), {
      rootDir: root,
      directory: 'public',
      include: ['/manual/assets/docs.css'],
    });
    assert.equal(assets.include.length, 5);
    assert.ok(!assets.include.some((url) => url.includes('private')));
    assert.equal(
      assets.manifest.assets.find((asset) => asset.url.endsWith('v1.png'))
        ?.integrity,
      'sha256-' + createHash('sha256').update(png).digest('base64')
    );
    await rm(path.join(root, 'public/manual/assets/v1.png'));
    await assert.rejects(
      prepareDocumentationAssets(fixture(), {
        rootDir: root,
        directory: 'public',
      }),
      /ENOENT/
    );
    await symlink(
      path.join(root, 'public/manual/assets/v2.png'),
      path.join(root, 'public/manual/assets/v1.png')
    );
    await assert.rejects(
      prepareDocumentationAssets(fixture(), {
        rootDir: root,
        directory: 'public',
      }),
      /symlink/
    );
    await assert.rejects(
      prepareDocumentationAssets(fixture(), {
        rootDir: root,
        directory: '../',
      }),
      /escapes/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('asset hash mismatch and non-image payloads fail without writing an output directory', async () => {
  /** Only an explicitly registered public image is eligible for reading. */
  const root = await mkdtemp(path.join(tmpdir(), 'zerux-docs-hash-'));
  try {
    await mkdir(path.join(root, 'public/manual/assets'), { recursive: true });
    await writeFile(path.join(root, 'public/manual/assets/v1.png'), png);
    /** A valid-shaped wrong hash must fail actual byte verification. */
    const pinned = createDocumentation({
      latest: 'a',
      versions: [
        {
          id: 'a',
          images: {
            diagram: {
              ...image,
              integrity: 'sha256-' + Buffer.alloc(32).toString('base64'),
            },
          },
          documents: [
            {
              slug: 'intro',
              title: 'I',
              access: 'public',
              cover: 'diagram',
              parts: [],
            },
          ],
        },
      ],
    });
    await assert.rejects(
      prepareDocumentationAssets(pinned, {
        rootDir: root,
        directory: 'public',
      }),
      /integrity mismatch/
    );
    await writeFile(
      path.join(root, 'public/manual/assets/v1.png'),
      '<script>not an image</script>'
    );
    await assert.rejects(
      prepareDocumentationAssets(
        createDocumentation({
          ...fixture().snapshot(),
          latest: 'v1',
          versions: [fixture().snapshot().versions[0]!],
        }),
        { rootDir: root, directory: 'public' }
      ),
      /container mismatch/
    );
    assert.equal(
      await readFile(path.join(root, 'public/manual/assets/v1.png'), 'utf8'),
      '<script>not an image</script>'
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('public search reuses weighted local ranking, excludes private/disabled/history and owns disposal', () => {
  /** Unique private words must never enter the public index vocabulary. */
  const docs = createDocumentation({
    latest: 'a',
    versions: [
      {
        id: 'a',
        documents: [
          {
            slug: 'title',
            title: 'Installation',
            access: 'public',
            parts: ['Quick start'],
          },
          {
            slug: 'body',
            title: 'Other',
            access: 'public',
            parts: ['Installation'],
          },
          { slug: 'secret', title: 'secretsentinel', parts: [] },
          {
            slug: 'excluded',
            title: 'excludedtoken',
            access: 'public',
            searchable: false,
            parts: [],
          },
        ],
      },
      {
        id: 'old',
        documents: [
          { slug: 'old', title: 'historicword', access: 'public', parts: [] },
        ],
      },
    ],
  });
  /** Search scope owns one index, without a server, browser or remote upload. */
  const search = createDocumentationSearch(docs);
  assert.equal(
    search.search('installation')[0]?.document.title,
    'Installation'
  );
  for (const word of ['secretsentinel', 'excludedtoken', 'historicword']) {
    assert.deepEqual(search.search(word), []);
  }
  /** Result records are clones rather than references to index/catalog state. */
  const result = search.search('installation');
  result[0]!.document.title = 'Changed';
  assert.equal(
    search.search('installation')[0]?.document.title,
    'Installation'
  );
  assert.throws(() => search.search('x'.repeat(513)), /limit/);
  search.destroy();
  search.destroy();
  assert.throws(() => search.search('installation'), /disposed/);
});

test('browser code controls copy only on click, preserve authored DOM and ignore late completion after destroy', async () => {
  /** DOM emulation qualifies ownership/handlers, not browser clipboard permissions or assistive technology. */
  const dom = new JSDOM(
    '<main role="article"><pre data-docs-code><code>&lt;script&gt;literal&lt;/script&gt;</code></pre></main>'
  );
  try {
    /** Explicit mounted scope is borrowed from this owned fixture window. */
    const root = dom.window.document.querySelector('main')!;
    /** Original markup must be exactly preserved after owned enhancements are removed. */
    const original = root.innerHTML;
    let copied = '';
    let finish!: () => void;
    /** Host adapter gives deterministic pending behavior without native clipboard access. */
    const enhancement = enhanceDocumentation(root, {
      writeText: async (text) => {
        copied = text;
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      },
    });
    assert.equal(copied, '');
    root.querySelector<HTMLButtonElement>('button')!.click();
    await Promise.resolve();
    assert.equal(copied, '<script>literal</script>');
    assert.ok(enhancement.pending);
    enhancement.destroy();
    enhancement.destroy();
    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(root.innerHTML, original);
    assert.equal(root.getAttribute('role'), 'article');
  } finally {
    dom.window.close();
  }
});

test('clipboard outage, cancellation and absent DOM reject or disable without changing user attributes', async () => {
  /** Owned isolated document exposes no native clipboard in jsdom. */
  const dom = new JSDOM(
    '<main><pre data-docs-code><code>x</code></pre></main>'
  );
  try {
    /** Browser dependencies remain optional until an explicit DOM scope is enhanced. */
    const root = dom.window.document.querySelector('main')!;
    /** No available clipboard produces a real disabled control rather than a false success. */
    const unavailable = enhanceDocumentation(root);
    assert.ok(root.querySelector<HTMLButtonElement>('button')!.disabled);
    unavailable.destroy();
    /** Host-controlled abort owns listener/control cleanup. */
    const controller = new AbortController();
    enhanceDocumentation(root, {
      signal: controller.signal,
      writeText: async () => {
        throw new Error('clipboard denied');
      },
    });
    root.querySelector<HTMLButtonElement>('button')!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(root.textContent!, /Copy failed/);
    controller.abort();
    assert.equal(root.querySelector('button'), null);
    assert.throws(
      () => enhanceDocumentation(null as unknown as HTMLElement),
      /DOM/
    );
  } finally {
    dom.window.close();
  }
});

test('release comparisons include image changes and temporary aliases never shadow/private-target releases', () => {
  /** No page bodies enter release preview differences. */
  const docs = fixture();
  assert.deepEqual(
    compareDocumentationVersions(docs, 'v1', 'v2').images.changed,
    ['diagram']
  );
  assert.ok(compareDocumentationVersions(docs, 'v1', 'v2').metadataChanged);
  /** Temporary aliases deliberately avoid permanent caches when latest changes. */
  const redirects = documentationRedirects(docs, { landing: 'intro' });
  assert.ok(redirects.every((route) => route.status === 302));
  assert.equal(
    redirects.find((route) => route.path === '/manual')?.redirect,
    '/manual/v2/intro/'
  );
  assert.throws(
    () => documentationRedirects(docs, { alias: 'v1' }),
    /conflicts/
  );
  assert.throws(
    () => documentationRedirects(docs, { landing: 'missing' }),
    /landing/
  );
});

test('remote CSP approval is explicit and private requests remain authorized/noindex', async () => {
  /** This test never fetches a remote URL; only fixed response header policy is inspected. */
  const docs = createDocumentation({
    latest: 'a',
    versions: [
      {
        id: 'a',
        documents: [{ slug: 'private', title: 'Private', parts: [] }],
      },
    ],
  });
  /** Renderer origin approval does not replace a fresh server authorization decision. */
  const handler = createDocumentationHandler(docs, {
    authorize: () => true,
    imageOrigins: ['https://images.example'],
  });
  const response = await handler(
    new Request('https://site.test/docs/a/private/')
  );
  assert.equal(response.status, 200);
  assert.match(
    response.headers.get('Content-Security-Policy')!,
    /img-src 'self' https:\/\/images.example;/
  );
  assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  assert.throws(
    () =>
      createDocumentationHandler(docs, {
        imageOrigins: ['https://images.example/path'],
      }),
    /origin/
  );
});

test('Markdown expansion/count budgets reject pathological authoring before browser enhancement', () => {
  assert.throws(
    () =>
      analyzeDocumentationMarkdown(
        Array.from(
          { length: 201 },
          () => '\x60\x60\x60ts\nx\n\x60\x60\x60'
        ).join('\n\n')
      ),
    /code-block limit/
  );
  assert.throws(
    () =>
      analyzeDocumentationMarkdown(
        Array.from({ length: 4097 }, () => '# Heading').join('\n\n')
      ),
    /heading limit/
  );
  assert.throws(
    () =>
      analyzeDocumentationMarkdown(
        Array.from({ length: 4097 }, () => '[x](/docs/a/intro/)').join(' ')
      ),
    /link limit/
  );
});

test('nested guide routes retain exact mounted links, snapshots and bounded traversal denial', () => {
  /** Nested routes are authored URL identities, never local paths read by the compiler. */
  const docs = createDocumentation({
    latest: 'v1',
    basePath: '/handbook',
    versions: [
      {
        id: 'v1',
        documents: [
          {
            slug: 'guide/install',
            title: 'Installation',
            access: 'public',
            related: ['guide/next'],
            parts: ['[Next](../next/)'],
          },
          { slug: 'guide/next', title: 'Next', access: 'public', parts: [] },
        ],
      },
    ],
  });
  assert.equal(
    docs.get('v1', 'guide/install')?.url,
    '/handbook/v1/guide/install/'
  );
  assert.deepEqual(validateDocumentationLinks(docs, 'v1'), []);
  assert.deepEqual(
    restoreDocumentation(docs.snapshot()).snapshot(),
    docs.snapshot()
  );
  for (const slug of [
    'guide/../private',
    '/absolute',
    'guide//empty',
    'guide/%2e%2e',
    'a/'.repeat(9) + 'b',
  ]) {
    assert.throws(() =>
      createDocumentation({
        latest: 'v1',
        versions: [
          { id: 'v1', documents: [{ slug, title: 'Invalid', parts: [] }] },
        ],
      })
    );
  }
});

test('image registration order cannot change snapshots and script delivery remains an explicit host approval', async () => {
  /** Equivalent alias definitions must produce equivalent frozen release bytes. */
  const make = (reverse: boolean) =>
    createDocumentation({
      latest: 'a',
      versions: [
        {
          id: 'a',
          images: reverse ? { z: image, a: image } : { a: image, z: image },
          documents: [
            {
              slug: 'intro',
              title: 'Intro',
              access: 'public',
              parts: ['<script>never()</script>'],
            },
          ],
        },
      ],
    });
  /** This public catalog contains no executable source, despite an inert script-shaped text fixture. */
  const docs = make(false);
  assert.equal(
    JSON.stringify(docs.snapshot()),
    JSON.stringify(make(true).snapshot())
  );
  /** Renderer scripts can come only from explicit host options, not Markdown data. */
  const html = renderDocumentationDocument(docs, docs.get('a', 'intro')!, {
    script: '/assets/docs.js',
  });
  assert.equal((html.match(/<script /g) ?? []).length, 1);
  assert.match(html, /&lt;script&gt;never/);
  assert.throws(
    () =>
      renderDocumentationDocument(docs, docs.get('a', 'intro')!, {
        script: 'https://outside.test/code.js',
      }),
    /script URL/
  );
  assert.throws(
    () =>
      renderDocumentationDocument(docs, docs.get('a', 'intro')!, {
        script: '/assets/../private.js',
      }),
    /script URL/
  );
  /** Default CSP never grants script delivery; the explicit option enables self only. */
  const request = new Request('https://site.test/docs/a/intro/');
  assert.doesNotMatch(
    (await createDocumentationHandler(docs)(request)).headers.get(
      'Content-Security-Policy'
    )!,
    /script-src/
  );
  assert.match(
    (
      await createDocumentationHandler(docs, { enableLocalScripts: true })(
        request
      )
    ).headers.get('Content-Security-Policy')!,
    /script-src 'self'/
  );
});
