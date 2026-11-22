import { createDocumentation } from '@zeruxjs/docs';
/** Public authored examples; no workspace records, users, credentials or service data enter exports. */
export const documentation = createDocumentation({
  latest: 'current',
  basePath: '/docs',
  versions: [
    {
      id: 'baseline',
      fragments: {
        ownership: [
          'All examples use public package imports. The host owns authorization and cleanup.',
        ],
      },
      documents: [
        {
          slug: 'introduction',
          section: 'Get started',
          order: 1,
          title: 'Local integration documentation',
          access: 'public',
          parts: [
            '# Local services\n\nThis application uses ZeruxJS with ZyroJS.',
            { include: 'ownership' },
          ],
        },
      ],
    },
    {
      id: 'current',
      extends: 'baseline',
      documents: [
        {
          slug: 'rendering',
          section: 'Guide',
          order: 2,
          title: 'Rendering and hosting modes',
          access: 'public',
          parts: [
            'Use `npm run dev` or `npm start` for the dynamic application. Use `npm run docs:export` and `npm run docs:serve` for isolated public documentation output.',
            { include: 'ownership' },
          ],
        },
      ],
    },
  ],
});
