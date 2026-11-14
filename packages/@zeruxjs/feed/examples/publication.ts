import {
  createRssFeed,
  createAtomFeed,
  createJsonFeed,
  type FeedOptions,
} from '@zeruxjs/feed';
import { createFeedFetchHandler } from '@zeruxjs/feed/fetch';

/** Fixed content-owned public facts with stable IDs/dates; no endpoint installs or remote downloads. */
export const publication: FeedOptions = {
  title: 'Release notes',
  description: 'Authored public release notes',
  siteUrl: 'https://example.com/',
  feedUrl: 'https://example.com/feed',
  id: 'urn:example:release-feed',
  strict: true,
  language: 'en-US',
  authors: [{ name: 'Release team', url: 'https://example.com/team' }],
  updated: '2025-01-02T12:00:00Z',
  items: [
    {
      id: 'release-1',
      atomId: 'urn:example:release-1',
      title: 'Release one',
      url: 'https://example.com/releases/1',
      contentText: 'The authored release summary.',
      date: '2025-01-02',
      categories: [{ term: 'releases' }],
      attachments: [
        {
          url: 'https://example.com/notes.pdf',
          type: 'application/pdf',
          length: 1024,
        },
      ],
    },
  ],
};
/**
 * Serialize all supported formats from the fixed authored public publication.
 *
 * @returns {{rss: string, atom: string, json: string}} Deterministic strings; a host must sanitize any future HTML fields before publishing.
 */
export const representations = () => ({
  rss: createRssFeed(publication),
  atom: createAtomFeed(publication),
  json: createJsonFeed(publication),
});
/** Owned public publication handler; the host must await close during teardown even though import opens no socket. */
export const handler = createFeedFetchHandler({
  feed: publication,
  format: 'negotiate',
  maxItems: 100,
  maxBytes: 1048576,
});
// Mount this public Fetch handler explicitly; import opens no socket and fetches no attachments.
// Await handler.close() on teardown. Sanitize any future contentHtml in the host before publishing.
