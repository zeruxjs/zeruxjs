import { fileURLToPath } from 'node:url';
import { prepareDocumentationAssets } from '@zeruxjs/docs/build';
import {
  documentationStaticRoutes,
  documentationRedirects,
} from '@zeruxjs/docs/zerux';
import { documentation } from './lib/docs/catalog.js';
/** Only public referenced local images and the explicit package stylesheet are inventoried. */
const assets = await prepareDocumentationAssets(documentation, {
  rootDir: fileURLToPath(new URL('.', import.meta.url)),
  directory: 'public',
  include: ['/docs/assets/docs.css'],
});
/** Public pages and temporary latest/landing aliases share one exporter-owned route set. */
const pages = documentationStaticRoutes(documentation, {
  validateLinks: true,
  responsiveImages: true,
});
/** Explicit public-only export; no application bootstrap, SQLite state or secret configuration is imported. */
export default {
  ...pages,
  routes: [
    ...pages.routes,
    ...documentationRedirects(documentation, { landing: 'introduction' }),
  ],
  assets,
  document: { lang: 'en', stylesheets: ['/docs/assets/docs.css'] },
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
