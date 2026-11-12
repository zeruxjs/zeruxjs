import test from 'node:test';
import assert from 'node:assert/strict';
import { SaxesParser } from 'saxes';
import {
  createRssFeed,
  createAtomFeed,
  createJsonFeed,
  createFeedResponse,
} from '@zeruxjs/feed';
import { createFeedFetchHandler } from '@zeruxjs/feed/fetch';
/** Fixed authored strict publication covering format-specific mappings; private/remote resources are never accessed. */
const data = {
  strict: true,
  title: 'A & <B>',
  description: 'News',
  siteUrl: 'https://example.test/',
  feedUrl: 'https://example.test/feed',
  id: 'urn:example:feed',
  language: 'en-US',
  authors: [
    {
      name: 'Team',
      url: 'https://example.test/team',
      email: 'team@example.test',
    },
  ],
  categories: [
    { term: 'news', scheme: 'https://example.test/categories', label: 'News' },
  ],
  updated: '2025-01-02T00:00:00Z',
  items: [
    {
      id: 'one',
      atomId: 'urn:example:one',
      title: 'One <Two>',
      url: 'https://example.test/one?q=1&lang=en',
      contentText: 'Plain text',
      contentHtml: '<p>Text &amp; safe</p>',
      date: '2025-01-01',
      updated: '2025-01-03T00:00:00Z',
      authors: [
        {
          name: 'Alice',
          email: 'alice@example.test',
          url: 'https://example.test/alice',
          avatar: 'https://example.test/avatar.png',
        },
      ],
      language: 'fr',
      categories: [
        {
          term: 'release',
          scheme: 'https://example.test/categories',
          label: 'Release',
        },
      ],
      attachments: [
        {
          url: 'https://example.test/audio.mp3',
          type: 'audio/mpeg',
          length: 123,
          title: 'Audio',
          duration: 12,
        },
      ],
    },
  ],
};
/**
 * Parse the finite generated XML with namespace awareness without interpreting embedded HTML.
 *
 * @param {string} xml - Finite representation emitted by the public generator.
 * @returns {object} Captured element/text facts; well-formed parsing is not full feed-schema or reader qualification.
 */
function parse(xml) {
  /** Captured namespace-aware XML element records, not DOM nodes or executed HTML. */
  const tags = [];
  /** Decoded XML text values; embedded HTML remains untrusted data. */
  const texts = [];
  /** Owned synchronous Saxes parser closed immediately after the finite XML string. */
  const parser = new SaxesParser({ xmlns: true });
  parser.on('opentag', (tag) => tags.push(tag));
  parser.on('text', (value) => texts.push(value));
  parser.write(xml).close();
  return { tags, texts };
}
test('standard XML parser reads RSS/Atom namespaces, authors, categories, enclosure metadata and language', () => {
  /** Parsed RSS result or local response; namespace facts remain representation-specific. */
  const rss = parse(createRssFeed(data));
  /** Parsed/negotiated Atom result; strict facts are authored, never inferred. */
  const atom = parse(createAtomFeed(data));
  assert(
    rss.tags.some(
      (t) =>
        t.local === 'creator' && t.uri === 'http://purl.org/dc/elements/1.1/'
    )
  );
  assert(
    rss.tags.some(
      (t) =>
        t.local === 'encoded' &&
        t.uri === 'http://purl.org/rss/1.0/modules/content/'
    )
  );
  assert(
    rss.tags.some(
      (t) => t.local === 'enclosure' && t.attributes.length.value === '123'
    )
  );
  assert(atom.tags.every((t) => t.uri === 'http://www.w3.org/2005/Atom'));
  assert(
    atom.tags.some(
      (t) =>
        t.local === 'link' &&
        t.attributes.rel?.value === 'enclosure' &&
        t.attributes.type.value === 'audio/mpeg'
    )
  );
  assert(
    atom.tags.some(
      (t) => t.local === 'feed' && t.attributes['xml:lang'].value === 'en-US'
    )
  );
  assert(atom.texts.includes('A & <B>'));
  assert(atom.texts.includes('urn:example:one'));
  /** Parsed/negotiated JSON Feed result; unsupported person fields must not appear. */
  const json = JSON.parse(createJsonFeed(data));
  assert.equal(json.authors[0].name, 'Team');
  assert.equal(
    json.items[0].authors[0].avatar,
    'https://example.test/avatar.png'
  );
  assert.equal(json.items[0].attachments[0].duration_in_seconds, 12);
  assert.equal(json.items[0].language, 'fr');
  assert.equal(createAtomFeed(data), createAtomFeed(data));
  assert.match(createRssFeed(data), /Fri, 03 Jan 2025 00:00:00 GMT/);
});
test('duplicate IDs, strict missing facts, invalid dates/URLs/MIME, accessors and byte limits reject directly', () => {
  /**
   * Create an independent malformed-input candidate without changing the shared publication.
   *
   * @returns {object} Detached strict fixture record for one validation case.
   */
  const cloned = () => structuredClone(data);
  let f = cloned();
  f.items.push({ ...f.items[0] });
  assert.throws(() => createJsonFeed(f), /Duplicate/);
  f = cloned();
  f.items.push({ ...f.items[0], id: 'two' });
  assert.throws(() => createAtomFeed(f), /Duplicate Atom/);
  f = cloned();
  delete f.authors;
  delete f.items[0].authors;
  assert.throws(() => createAtomFeed(f), /authors/);
  f = cloned();
  delete f.items[0].date;
  delete f.items[0].updated;
  assert.throws(() => createAtomFeed(f), /updated/);
  // Exercise only the finite invalid-date/URL corpus; generation must never fetch these values.
  for (const date of ['2025-02-30', '2025-01-01T24:00:00Z', 'not-date']) {
    f = cloned();
    f.items[0].date = date;
    assert.throws(() => createRssFeed(f), /date/);
  }
  // Exercise only the finite invalid-date/URL corpus; generation must never fetch these values.
  for (const url of [
    'javascript:alert(1)',
    'https://user:pass@example.test/a',
  ]) {
    f = cloned();
    f.items[0].attachments[0].url = url;
    assert.throws(() => createAtomFeed(f), /URL/);
  }
  f = cloned();
  f.items[0].attachments[0].type = 'audio/mpeg" hacked="x';
  assert.throws(() => createJsonFeed(f), /MIME/);
  f = cloned();
  f.items[0].attachments.push({
    ...f.items[0].attachments[0],
    url: 'https://example.test/second.mp3',
  });
  assert.throws(() => createRssFeed(f), /one enclosure/);
  assert.equal(JSON.parse(createJsonFeed(f)).items[0].attachments.length, 2);
  f = cloned();
  f.maxBytes = 256;
  assert.throws(() => createRssFeed(f), /byte limit/);
  let getter = false;
  f = cloned();
  Object.defineProperty(f.items[0], 'contentHtml', {
    enumerable: true,
    /**
     * Expose a deliberately observable getter that validation must reject before invocation.
     *
     * @returns {string} Unsafe fixture value only if incorrectly invoked; the test checks the flag remains false.
     */
    get() {
      getter = true;
      return 'unsafe';
    },
  });
  assert.throws(() => createJsonFeed(f));
  assert.equal(getter, false);
  assert.throws(() => createFeedResponse('bogus', data), /format/);
});
test('negotiation quality/specificity, representation ETags, weak 304/HEAD and last-modified maximum', async (t) => {
  /** Private clone or owned Fetch handler; only actual factory calls acquire close ownership. */
  const feed = createFeedFetchHandler({ feed: data, format: 'negotiate' });
  // Drain actual producer ownership even if an assertion fails; cancellation is cooperative.
  t.after(() => feed.close());
  try {
    /**
     * Call the retained local handler with explicit Accept and conditional request fields.
     *
     * @param {string} accept - Literal negotiated preference/exclusion fixture.
     * @param {Record<string, string>} headers - Explicit synthetic conditional/credential headers, empty by default.
     * @returns {Promise<Response>} Local selected, not-modified or unavailable response without network I/O.
     */
    const get = (accept, headers = {}) =>
      feed(
        new Request('https://example.test/feed', {
          headers: { accept, ...headers },
        })
      );
    /** Initial local representation used to test known-content date/weak-validator behavior. */
    const first = await get('application/atom+xml');
    assert.match(first.headers.get('last-modified'), /03 Jan 2025/);
    assert.equal(
      (
        await get('application/atom+xml', {
          'if-none-match': 'W/' + first.headers.get('etag'),
        })
      ).status,
      304
    );
    assert.equal(
      (
        await feed(
          new Request('https://example.test/feed', {
            method: 'HEAD',
            headers: { accept: 'application/feed+json' },
          })
        )
      ).body,
      null
    );
    /** Parsed RSS result or local response; namespace facts remain representation-specific. */
    const rss = await get('application/rss+xml');
    /** Parsed/negotiated JSON Feed result; unsupported person fields must not appear. */
    const json = await get('application/feed+json');
    assert.notEqual(rss.headers.get('etag'), json.headers.get('etag'));
    /** Explicit RSS exclusion plus wildcard preference; specificity must prevent q=0 fallback. */
    const specific = await get('application/rss+xml;q=0, */*;q=1');
    assert.match(specific.headers.get('content-type'), /atom\+xml/);
    assert.equal((await get('text/html')).status, 406);
    assert.equal((await get('application/rss+xml;q=1.5')).status, 406);
    /** Credential-bearing synthetic request gets defensive no-store, without authenticating a reader. */
    const privateResponse = await get('application/rss+xml', {
      cookie: 'session=private',
    });
    assert.equal(
      privateResponse.headers.get('cache-control'),
      'private, no-store'
    );
    assert.equal(
      (
        await get('application/rss+xml', {
          'if-modified-since': 'Thu, 02 Jan 2025 00:00:00 GMT',
        })
      ).status,
      200
    );
  } finally {
    await feed.close();
  }
});
test('supplier outage/cancellation retains native slot and close drains; no raw causes or remote URL fetches', async (t) => {
  /** Owned public handler whose registered source deliberately fails with a synthetic private cause. */
  const outage = createFeedFetchHandler({
    feed: async () => {
      throw Error('private database token');
    },
  });
  // Drain actual producer ownership even if an assertion fails; cancellation is cooperative.
  t.after(() => outage.close());
  try {
    /** Body-free unavailable observation; private source cause must not enter the public response. */
    const response = await outage(new Request('https://example.test/feed'));
    assert.equal(response.status, 503);
    assert.equal(await response.text(), '');
  } finally {
    await outage.close();
  }
  let finish, signal;
  /** Owned handler with one actual pending synthetic producer; timeout alone cannot release capacity. */
  const blocked = createFeedFetchHandler({
    maxPending: 1,
    timeoutMs: 10,
    feed: async (ctx) => {
      signal = ctx.signal;
      return new Promise((r) => (finish = r));
    },
  });
  // Drain actual producer ownership even if an assertion fails; cancellation is cooperative.
  t.after(async () => {
    finish?.(data);
    await blocked.close();
  });
  /** Body-free unavailable observation; private source cause must not enter the public response. */
  const response = await blocked(new Request('https://example.test/feed'));
  assert.equal(response.status, 503);
  assert(signal.aborted);
  assert.equal(blocked.status().pending, 1);
  assert.equal(
    (await blocked(new Request('https://example.test/feed'))).status,
    503
  );
  let closed = false;
  /** Actual close promise; it cannot finish until the held producer settles. */
  const closing = blocked.close().then(() => (closed = true));
  await new Promise((r) => setImmediate(r));
  assert.equal(closed, false);
  finish(data);
  await closing;
  assert.equal(blocked.status().pending, 0);
  /** Borrowed global Fetch implementation restored in finally after the no-remote-fetch assertion. */
  const original = globalThis.fetch;
  globalThis.fetch = () => {
    throw Error('Generation must not fetch attachments');
  };
  try {
    createRssFeed(data);
    createAtomFeed(data);
    createJsonFeed(data);
  } finally {
    globalThis.fetch = original;
  }
});

test('XML attribute whitespace survives namespace-aware parsing without becoming extra markup', () => {
  /** Private clone or owned Fetch handler; only actual factory calls acquire close ownership. */
  const feed = structuredClone(data);
  feed.items[0].categories = [
    { term: 'line\nsecond\tpart', label: 'label\rending' },
  ];
  /** Parsed/negotiated Atom result; strict facts are authored, never inferred. */
  const atom = parse(createAtomFeed(feed));
  /** Namespace-parsed category attributes; encoded whitespace must preserve the authored values. */
  const category = atom.tags.find(
    (t) => t.local === 'category' && t.attributes.term.value.includes('second')
  );
  assert.equal(category.attributes.term.value, 'line\nsecond\tpart');
  assert.equal(category.attributes.label.value, 'label\rending');
});
