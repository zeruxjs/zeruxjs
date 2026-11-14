import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRssFeed,
  createAtomFeed,
  createJsonFeed,
  getFeedContentType,
} from '../dist/index.js';
/** Authored fixed-date public fixture; URLs/enclosures are inert metadata and must never be fetched. */
const feed = {
  title: 'Example & Co',
  description: 'News',
  siteUrl: 'https://example.com',
  feedUrl: 'https://example.com/feed',
  items: [
    {
      id: 'one',
      title: 'A < B',
      url: 'https://example.com/one',
      date: '2025-01-01',
      author: 'Bob',
      tags: ['news'],
      enclosure: {
        url: 'https://example.com/a.mp3',
        type: 'audio/mpeg',
        length: 200,
      },
    },
  ],
};
test('well-escaped feeds with metadata', () => {
  assert.match(createRssFeed(feed), /Example &amp; Co/);
  assert.match(createRssFeed(feed), /enclosure/);
  assert.match(createAtomFeed(feed), /<entry>/);
  assert.equal(
    JSON.parse(createJsonFeed(feed)).items[0].attachments[0].size_in_bytes,
    200
  );
  assert.match(getFeedContentType('json'), /feed\+json/);
});
test('rejects invalid dates, urls and enclosures', () => {
  /** Single authored item reused for independent invalid-field cases. */
  const item = feed.items[0];
  if (!item) {
    throw new Error('Feed fixture requires one item');
  }
  assert.throws(
    () =>
      createRssFeed({
        ...feed,
        items: [{ ...item, date: 'not a date' }],
      }),
    /date/
  );
  assert.throws(
    () =>
      createJsonFeed({
        ...feed,
        items: [{ ...item, url: 'javascript:alert(1)' }],
      }),
    /URL/
  );
  assert.throws(
    () =>
      createAtomFeed({
        ...feed,
        items: [
          {
            ...item,
            enclosure: { url: 'https://example.com/a', type: 'a', length: -1 },
          },
        ],
      }),
    /length/
  );
});
