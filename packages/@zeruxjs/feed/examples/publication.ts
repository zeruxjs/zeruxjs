import {
  createRssFeed,
  createAtomFeed,
  createJsonFeed,
  type FeedOptions,
} from "@zeruxjs/feed";
import { createFeedFetchHandler } from "@zeruxjs/feed/fetch";

export const publication: FeedOptions = {
  title: "Release notes",
  description: "Authored public release notes",
  siteUrl: "https://example.com/",
  feedUrl: "https://example.com/feed",
  id: "urn:example:release-feed",
  strict: true,
  language: "en-US",
  authors: [{ name: "Release team", url: "https://example.com/team" }],
  updated: "2025-01-02T12:00:00Z",
  items: [
    {
      id: "release-1",
      atomId: "urn:example:release-1",
      title: "Release one",
      url: "https://example.com/releases/1",
      contentText: "The authored release summary.",
      date: "2025-01-02",
      categories: [{ term: "releases" }],
      attachments: [
        {
          url: "https://example.com/notes.pdf",
          type: "application/pdf",
          length: 1024,
        },
      ],
    },
  ],
};
export const representations = () => ({
  rss: createRssFeed(publication),
  atom: createAtomFeed(publication),
  json: createJsonFeed(publication),
});
export const handler = createFeedFetchHandler({
  feed: publication,
  format: "negotiate",
  maxItems: 100,
  maxBytes: 1048576,
});
// Mount this public Fetch handler explicitly; import opens no socket and fetches no attachments.
// Await handler.close() on teardown. Sanitize any future contentHtml in the host before publishing.
