import test from 'node:test';
import assert from 'node:assert/strict';
import {
  documentationNavigation,
  createDocumentation,
  restoreDocumentation,
  compareDocumentation,
  createDocumentationHandler,
} from '@zeruxjs/docs';
import {
  renderDocumentationMarkdown,
  analyzeDocumentationMarkdown,
  validateDocumentationLinks,
  createDocumentationRelease,
} from '@zeruxjs/docs/markdown';
import {
  documentationStaticRoutes,
  renderDocumentationArticle,
} from '@zeruxjs/docs/zerux';

/** Build a public/private two-version catalog without filesystem or network resources.
 * @returns {ReturnType<typeof createDocumentation>} Fresh owned catalog.
 */
function fixture() {
  return createDocumentation({
    latest: 'v2',
    basePath: '/manual',
    versions: [
      {
        id: 'v1',
        fragments: { shared: ['Original paragraph'] },
        documents: [
          {
            slug: 'intro',
            title: 'Introduction',
            access: 'public',
            parts: [{ include: 'shared' }],
          },
          { slug: 'secret', title: 'Private', parts: ['PRIVATE'] },
        ],
      },
      {
        id: 'v2',
        extends: 'v1',
        fragments: { shared: ['New paragraph'] },
        documents: [
          {
            slug: 'new',
            title: 'New page',
            access: 'public',
            parts: ['Hello'],
          },
        ],
      },
    ],
  });
}
test('fragments inherit explicitly without mutating older versions; expanded snapshots stay stable', () => {
  /** Immutable catalog with descendant-only paragraph override. */
  const docs = fixture();
  assert.equal(docs.get('v1', 'intro')?.body, 'Original paragraph');
  assert.equal(docs.get('v2', 'intro')?.body, 'New paragraph');
  assert.deepEqual(compareDocumentation(docs, 'v1', 'v2'), {
    added: ['new'],
    removed: [],
    changed: ['intro'],
  });
  /** Detached portable data; changing it cannot edit a registered release. */
  const snapshot = docs.snapshot();
  assert.deepEqual(restoreDocumentation(snapshot).snapshot(), snapshot);
  snapshot.versions[0]!.documents[0]!.title = 'Changed externally';
  assert.equal(docs.get('v1', 'intro')?.title, 'Introduction');
  assert.equal(docs.get('missing', 'intro'), undefined);
});
test('cycles, missing parts, duplicate identities and corrupt snapshots reject', () => {
  assert.throws(
    () =>
      createDocumentation({
        latest: 'a',
        versions: [{ id: 'a', extends: 'a', documents: [] }],
      }),
    /cycle/
  );
  assert.throws(
    () =>
      createDocumentation({
        latest: 'a',
        versions: [
          {
            id: 'a',
            documents: [
              { slug: 'intro', title: 'I', parts: [{ include: 'missing' }] },
            ],
          },
        ],
      }),
    /Unknown documentation part/
  );
  assert.throws(
    () =>
      createDocumentation({
        latest: 'a',
        versions: [
          { id: 'a', documents: [] },
          { id: 'a', documents: [] },
        ],
      }),
    /Duplicate/
  );
  assert.throws(() => restoreDocumentation({ schemaVersion: 99 }), /snapshot/);
  assert.throws(
    () =>
      createDocumentation({
        latest: 'a',
        versions: [
          {
            id: 'a',
            fragments: { loop: [{ include: 'loop' }] },
            documents: [
              { slug: 'intro', title: 'I', parts: [{ include: 'loop' }] },
            ],
          },
        ],
      }),
    /cycle/
  );
});
test('input getters never execute and excessive expansion is rejected', () => {
  let invoked = false;
  /** Hostile accessor entry emulates malformed JavaScript callers, not JSON parsing. */
  const documents = Object.defineProperty([], 0, {
    get() {
      invoked = true;
      return {};
    },
  });
  assert.throws(
    () =>
      createDocumentation({ latest: 'a', versions: [{ id: 'a', documents }] }),
    /accessor/
  );
  assert.equal(invoked, false);
  assert.throws(
    () =>
      createDocumentation({
        latest: 'a',
        versions: [
          {
            id: 'a',
            documents: [{ slug: '../escape', title: 'Bad', parts: [] }],
          },
        ],
      }),
    /identifier/
  );
});
test('private pages deny by default, authorization stays fresh and exported routes exclude them', async () => {
  /** Host-owned current permission; no browser role strings are consumed. */
  let allowed = false;
  /** Catalog contains private data which must not enter public exports. */
  const docs = fixture();
  /** Request consumer borrows catalog and host policy without owning a server. */
  const handler = createDocumentationHandler(docs, {
    authorize: () => allowed,
  });
  assert.equal(
    (await handler(new Request('https://site.test/manual/v1/secret/'))).status,
    404
  );
  allowed = true;
  assert.equal(
    (await handler(new Request('https://site.test/manual/v1/secret/'))).status,
    200
  );
  allowed = false;
  assert.equal(
    (await handler(new Request('https://site.test/manual/v1/secret/'))).status,
    404
  );
  assert.equal(
    (
      await handler(
        new Request('https://site.test/manual/v1/intro/', { method: 'HEAD' })
      )
    ).body,
    null
  );
  assert.equal(
    (
      await handler(
        new Request('https://site.test/manual/v1/intro/', { method: 'POST' })
      )
    ).status,
    405
  );
  assert.ok(
    documentationStaticRoutes(docs).routes.every(
      (route) => !route.path.includes('secret')
    )
  );
  await assert.rejects(
    createDocumentationHandler(docs, {
      render: async () => {
        throw Error('renderer unavailable');
      },
    })(new Request('https://site.test/manual/v1/intro/')),
    /unavailable/
  );
});
test('Markdown keeps stored HTML inert, denies executable links and never loads remote images', () => {
  /** Literal hostile content remains data throughout parser/rendering. */
  const html = renderDocumentationMarkdown(
    '# Hello\n\n<script>never()</script>\n\n[x](javascript:never)\n\n![private](https://remote.test/tracker)'
  );
  assert.match(html, /<h1>Hello/);
  assert.doesNotMatch(html, /<script|href="javascript:|<img/);
  assert.match(html, /&lt;script/);
});

test('explicit removals preserve other releases and expansion budgets reject exponential reuse', () => {
  /** Expanded historical versions are independent of later shared-part edits. */
  const snapshot = fixture().snapshot();
  /** Descendant removes one known page without changing either saved parent. */
  const catalog = createDocumentation({
    latest: 'v3',
    versions: [
      ...snapshot.versions,
      { id: 'v3', extends: 'v2', documents: [{ slug: 'new', remove: true }] },
    ],
  });
  assert.ok(catalog.get('v2', 'new'));
  assert.equal(catalog.get('v3', 'new'), undefined);
  /** Finite input graph deliberately requests exponential textual expansion. */
  const fragments: Record<string, { include: string }[] | string[]> = {
    leaf: ['x'],
  };
  // Build only eight explicit levels; expansion limits must reject before materializing the full output.
  for (let level = 0; level < 8; level++) {
    fragments['part' + level] = Array.from({ length: 4 }, () => ({
      include: level === 0 ? 'leaf' : 'part' + (level - 1),
    }));
  }
  assert.throws(
    () =>
      createDocumentation({
        latest: 'v1',
        versions: [
          {
            id: 'v1',
            fragments,
            documents: [
              { slug: 'intro', title: 'I', parts: [{ include: 'part7' }] },
            ],
          },
        ],
      }),
    RangeError
  );
});

test('authored navigation stays deterministic, private-safe and snapshot-compatible', () => {
  /** Explicit order must override alphabetic identity without exposing private titles. */
  const docs = createDocumentation({
    latest: 'v1',
    versions: [
      {
        id: 'v1',
        documents: [
          {
            slug: 'alpha',
            title: 'Alpha',
            access: 'public',
            order: 2,
            section: 'Guide',
            parts: [],
          },
          {
            slug: 'zeta',
            title: 'Zeta',
            access: 'public',
            order: 1,
            section: 'Start',
            parts: [],
          },
          { slug: 'secret', title: 'Hidden', order: 0, parts: [] },
        ],
      },
    ],
  });
  /** Detached navigation is safe for a host UI to reorder locally. */
  const navigation = documentationNavigation(docs, 'v1', 'zeta');
  assert.deepEqual(
    navigation.pages.map((page) => page.slug),
    ['zeta', 'alpha']
  );
  assert.equal(navigation.next?.slug, 'alpha');
  assert.equal(navigation.previous, undefined);
  assert.deepEqual(navigation.breadcrumbs, ['v1', 'Start', 'Zeta']);
  navigation.pages.reverse();
  assert.equal(documentationNavigation(docs, 'v1').pages[0]?.slug, 'zeta');
  assert.deepEqual(
    restoreDocumentation(docs.snapshot()).snapshot(),
    docs.snapshot()
  );
  assert.equal(documentationNavigation(docs, 'v1', 'secret').next, undefined);
  assert.throws(() => documentationNavigation(docs, 'absent'), /Unknown/);
  assert.throws(
    () =>
      createDocumentation({
        latest: 'v1',
        versions: [
          {
            id: 'v1',
            documents: [{ slug: 'bad', title: 'Bad', order: NaN, parts: [] }],
          },
        ],
      }),
    /order/
  );
});

test('article headings have collision-free multilingual anchors and one page title', () => {
  /** Repeated heading identities and raw tags remain inert. */
  const body =
    '# Hello\n\n## Hello\n\n## Hello--1\n\n## नमस्ते\n\n<script>bad()</script>';
  /** Article metadata is computed by the same parser used for rendered headings. */
  const analysis = analyzeDocumentationMarkdown(body);
  assert.equal(new Set(analysis.headings.map((heading) => heading.id)).size, 4);
  assert.equal(analysis.headings[0]?.id, 'hello--1');
  assert.match(analysis.headings[3]!.id, /न/);
  assert.doesNotMatch(analysis.html, /<h1|<script/);
  /** Default standalone Markdown keeps its compatible H1 rendering. */
  assert.match(renderDocumentationMarkdown('# Hello'), /<h1>Hello/);
  /** The optional framework article adds a title, TOC and ordered navigation. */
  const docs = createDocumentation({
    latest: 'v1',
    versions: [
      {
        id: 'v1',
        documents: [
          { slug: 'intro', title: 'Title', access: 'public', parts: [body] },
        ],
      },
    ],
  });
  const html = renderDocumentationArticle(docs, docs.get('v1', 'intro')!);
  assert.equal((html.match(/<h1>/g) ?? []).length, 1);
  assert.match(html, /aria-label="On this page"/);
  assert.match(html, /href="#hello--1"/);
});

test('release validation finds broken cross-version links and freezes expanded data without I/O', () => {
  /** Public links to private pages must fail even though the target exists. */
  const docs = createDocumentation({
    latest: 'v2',
    versions: [
      {
        id: 'v1',
        documents: [
          {
            slug: 'old',
            title: 'Old',
            access: 'public',
            parts: ['## Existing'],
          },
        ],
      },
      {
        id: 'v2',
        documents: [
          {
            slug: 'intro',
            title: 'Intro',
            access: 'public',
            parts: [
              '[good](/docs/v1/old/#existing--1) [bad](../missing/) [private](../secret/) [heading](/docs/v1/old/#absent)',
            ],
          },
          { slug: 'secret', title: 'Secret', parts: [] },
        ],
      },
    ],
  });
  assert.deepEqual(
    validateDocumentationLinks(docs, 'v2').map((issue) => issue.code),
    ['missing-page', 'private-target', 'missing-heading']
  );
  assert.throws(
    () => documentationStaticRoutes(docs, { validateLinks: true }),
    /invalid local links/
  );
  assert.throws(
    () => createDocumentationRelease(docs, 'v2'),
    /invalid local links/
  );
  /** Release data has no mutable inheritance; no remote URLs are fetched. */
  const release = createDocumentationRelease(docs, 'v1');
  assert.equal(release.versions.length, 1);
  assert.deepEqual(restoreDocumentation(release).snapshot(), release);
  release.versions[0]!.documents[0]!.title = 'External edit';
  assert.equal(docs.get('v1', 'old')?.title, 'Old');
  assert.throws(() => createDocumentationRelease(docs, 'unknown'), /Unknown/);
});

test('request route indexing happens once while authorization remains per request', async () => {
  let inventories = 0;
  let authorizations = 0;
  /** Wrapped catalog records lookup cost without changing page content. */
  const source = fixture();
  /** Registration borrows catalog pages once, not on every request. */
  const handler = createDocumentationHandler(
    {
      ...source,
      pages: () => {
        inventories++;
        return source.pages();
      },
    },
    {
      authorize: () => {
        authorizations++;
        return false;
      },
    }
  );
  for (let request = 0; request < 3; request++) {
    assert.equal(
      (await handler(new Request('https://site.test/manual/v1/secret/')))
        .status,
      404
    );
  }
  assert.equal(inventories, 1);
  assert.equal(authorizations, 3);
});

test('exporter-owned missing page renders without registered release navigation', () => {
  /** A public 404 view has no catalog identity and must not disclose navigation accidentally. */
  const html = renderDocumentationArticle(fixture(), {
    version: '',
    slug: 'missing',
    title: 'Not found',
    body: '# Missing',
    url: '/404.html',
    access: 'public',
  });
  assert.match(html, /<h1>Not found/);
  assert.match(html, /<h2 id="missing--1">/);
  assert.doesNotMatch(html, /aria-label="Documentation"/);
});
