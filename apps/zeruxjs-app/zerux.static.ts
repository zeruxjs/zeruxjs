import { documentationStaticRoutes } from '@zeruxjs/docs/zerux';
import { documentation } from './lib/docs/catalog.js';
/** Explicit public-only export; no application bootstrap, SQLite state or secret configuration is imported. */
export default {
  ...documentationStaticRoutes(documentation, { validateLinks: true }),
  origin: 'http://localhost:3010',
  outDir: 'docs-dist',
  notFound: {
    access: 'public' as const,
    view: {
      version: '',
      slug: 'missing',
      title: 'Not found',
      body: 'This documentation page does not exist.',
      url: '/404.html',
      access: 'public' as const,
    },
  },
};
