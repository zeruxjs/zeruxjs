/** Static site ownership. New apps get disjoint mounts; the root remains the shared ecosystem homepage. */
/** Explicit static-site ownership configuration; does not start builds on import. */
export interface SiteConfiguration {
  /** Branch whose authored content is built. */
  sourceBranch: string;
  /** Branch receiving explicitly published static output. */
  outputBranch: string;
  /** Complete candidate export directory. */
  output: string;
  /** Private publication workspace. */
  published: string;
  /** Root-page source and exact published ownership list. */
  root: { source: string; owned: string[] };
  /** Disjoint application mounts and their explicit compiler invocations. */
  apps: Array<{
    id: string;
    mount: string;
    directory: string;
    build: string[];
    developmentBuild: string[];
    watch: string[];
    output: string;
  }>;
}
export const sites = {
  sourceBranch: 'master',
  outputBranch: 'master-site',
  output: '.site-build',
  published: '.site-published',
  root: {
    source: 'pages',
    owned: [
      'index.html',
      'index.md',
      'zeruxjs.md',
      '404.md',
      '404.html',
      'robots.txt',
      'site-assets',
      'site-manifest.json',
      '.nojekyll',
    ],
  },
  apps: [
    {
      id: 'zeruxjs',
      mount: '/zeruxjs',
      directory: 'apps/zerux-docs',
      build: ['node', '--experimental-strip-types', 'scripts/build.ts'],
      developmentBuild: [
        'node',
        '--experimental-strip-types',
        'scripts/build.ts',
        '--development',
      ],
      watch: [
        'src',
        'public',
        'scripts',
        'zuix.config.mjs',
        'zuix.recipes.mjs',
        'zerux.config.js',
      ],
      output: 'dist/zeruxjs',
    },
  ],
} satisfies SiteConfiguration;
