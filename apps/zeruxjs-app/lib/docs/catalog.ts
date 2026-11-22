import { createDocumentation } from '@zeruxjs/docs';
/** Public authored examples; no workspace records, users, credentials or service data enter exports. */
export const documentation = createDocumentation({
  latest: 'current',
  basePath: '/docs',
  versions: [
    {
      id: 'baseline',
      label: 'Baseline',
      status: 'archived',
      images: {
        pipeline: {
          src: '/docs/assets/pipeline-v1.png',
          width: 144,
          height: 64,
          alt: 'Three connected blocks represent content, rendering and static output.',
          access: 'public',
        },
      },
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
          description:
            'A versioned local-service handbook built with ZeruxJS and ZyroJS.',
          keywords: ['documentation', 'local services'],
          cover: 'pipeline',
          access: 'public',
          parts: [
            '# Local services\n\nThis application uses ZeruxJS with ZyroJS.\n\n> [!TIP]\n> Reusable parts and image aliases are resolved for the selected version.',
            { include: 'ownership' },
            '```ts\nimport { createDocumentation } from "@zeruxjs/docs";\n// Register inert content and choose an explicit host renderer.\n```',
          ],
        },
      ],
    },
    {
      id: 'current',
      label: 'Current',
      status: 'stable',
      images: {
        pipeline: {
          src: '/docs/assets/pipeline-v2.png',
          darkSrc: '/docs/assets/pipeline-v2-dark.png',
          width: 144,
          height: 64,
          alt: 'Three connected blocks represent content, rendering and static output.',
          access: 'public',
        },
      },
      extends: 'baseline',
      documents: [
        {
          slug: 'rendering',
          section: 'Guide',
          order: 2,
          title: 'Rendering and hosting modes',
          description:
            'Choose dynamic serving or an explicit offline public export.',
          related: ['introduction'],
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
