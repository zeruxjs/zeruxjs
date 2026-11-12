export default {
  extends: ['stylelint-config-standard'],
  ignoreFiles: [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/coverage/**',
    '**/.git/**',
    '**/.cache/**',
    '**/.next/**',
    '**/.output/**',
    '**/.zerux/**',
    '**/.zyro/**',
    '**/.workspace/**',
    '**/.dev-container/**',
    '**/vendor/**',
    '**/third-party-licenses/**',
    'notes/**',
    'reports/**',
    '**/*.min.css',
    '**/public/workspace-utilities.css',
  ],
  // Prettier owns indentation/wrapping; these rules preserve readable structure.
  rules: {
    'comment-whitespace-inside': 'always',
    'rule-empty-line-before': [
      'always-multi-line',
      { except: ['first-nested'], ignore: ['after-comment'] },
    ],
  },
  overrides: [
    {
      name: 'repository/scss',
      files: ['**/*.scss'],
      customSyntax: 'postcss-scss',
      extends: ['stylelint-config-standard-scss'],
    },
  ],
};
