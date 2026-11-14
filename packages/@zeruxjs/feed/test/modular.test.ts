import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeedResponse, createAtomFeed } from '../dist/index.js';
/** Legacy-mode publication with no authored update time; epoch fallback is compatibility, not a real content fact. */
const options = {
  title: 'Hello',
  description: 'News',
  siteUrl: 'https://example.com',
  copyright: '(c) Team',
  items: [{ id: 'x', title: 'Post', url: 'https://example.com/post' }],
};
test('feed content response headers and atom rights', () => {
  /** Low-level public-cache descriptor; it does not perform request authentication or negotiation. */
  const out = createFeedResponse('json', options);
  assert.equal(out.status, 200);
  assert.match(out.headers['content-type'] ?? '', /feed\+json/);
  assert.match(createAtomFeed(options), /<rights>\(c\) Team<\/rights>/);
  assert.throws(() => createFeedResponse('rss', options, -1), RangeError);
});
