import { createDocumentation } from '@zeruxjs/docs';
/** Explicit immutable public catalog; import performs no I/O or server startup. */
export const docs = createDocumentation({
  latest: 'v1',
  versions: [
    {
      id: 'v1',
      fragments: { ownership: ['The application owns resource cleanup.'] },
      documents: [
        {
          slug: 'introduction',
          section: 'Get started',
          order: 1,
          title: 'Introduction',
          access: 'public',
          parts: ['# Welcome', { include: 'ownership' }],
        },
      ],
    },
  ],
});
