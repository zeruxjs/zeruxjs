/** Static site ownership. New apps get disjoint mounts; the root remains the shared ecosystem homepage. */
export const sites = {
  sourceBranch: 'master',
  outputBranch: 'master-site',
  output: '.site-build',
  published: '.site-published',
  root: {
    source: 'pages',
    owned: [
      'index.html',
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
      build: ['node', 'scripts/build.mjs'],
      developmentBuild: ['node', 'scripts/build.mjs', '--development'],
      watch: ['src', 'public', 'scripts', 'zuix.config.mjs'],
      output: 'dist/zeruxjs',
    },
  ],
};
