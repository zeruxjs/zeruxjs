# Section 2 — Media, Assets, Search, SEO, Feed

This section restructures all five packages into domain modules, preserving the public barrel (`src/index.ts`) for consumers. Media gains bounded streamed uploads, integrity-checked buffered download, streaming download, expiration maintenance, listing, and signed-access helpers. Assets gains schema checks, atomic bulk import/update, snapshots and disk persistence. Search adds defensive document ownership and safe query highlighting. SEO adds crawler-delay validation and HTTP response helpers. Feed adds response helpers and fixes Atom copyright rendering and RSS namespace emission.

**Validation:** focused package TypeScript builds and tests only. Not yet full app integration or production certification. The media store is local disk, search and assets are memory based; distributed backends remain future work.
