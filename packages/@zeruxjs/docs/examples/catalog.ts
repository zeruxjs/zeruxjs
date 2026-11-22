import {
  createDocumentation,
  compareDocumentationVersions,
} from '@zeruxjs/docs';
/** Explicit public catalog; resources are served by the host and never fetched during registration. */
export const docs = createDocumentation({
  latest: 'v2',
  basePath: '/handbook',
  versions: [
    {
      id: 'v1',
      label: 'Version 1',
      status: 'archived',
      images: {
        pipeline: {
          src: '/handbook/assets/pipeline-v1.png',
          width: 144,
          height: 64,
          alt: 'Content, rendering and output are connected.',
          access: 'public',
        },
      },
      fragments: { ownership: ['The application owns resource cleanup.'] },
      documents: [
        {
          slug: 'introduction',
          title: 'Introduction',
          section: 'Get started',
          order: 1,
          description: 'A reusable versioned handbook.',
          cover: 'pipeline',
          keywords: ['installation'],
          access: 'public',
          parts: [
            '# Welcome\n\n> [!TIP]\n> Reuse shared parts without rewriting frozen releases.',
            { include: 'ownership' },
            '```ts\nconst ready = true;\n```',
          ],
        },
      ],
    },
    {
      id: 'v2',
      extends: 'v1',
      label: 'Current',
      status: 'stable',
      images: {
        pipeline: {
          src: '/handbook/assets/pipeline-v2.png',
          darkSrc: '/handbook/assets/pipeline-v2-dark.png',
          width: 144,
          height: 64,
          alt: 'Content, rendering and output are connected.',
          access: 'public',
        },
      },
      documents: [],
    },
  ],
});
/** Value-only release differences are suitable for a host authoring preview after authorization. */
export const changes = compareDocumentationVersions(docs, 'v1', 'v2');
