export default {
  extends: ['stylelint-config-standard'],
  ignoreFiles: [
    '**/node_modules/**', '**/dist/**', '**/build/**', '**/coverage/**',
    '**/.git/**', '**/.cache/**', '**/.next/**', '**/.output/**',
    '**/.zerux/**', '**/.zyro/**', '**/.workspace/**', '**/.dev-container/**',
    '**/vendor/**', '**/third-party-licenses/**', 'notes/**', 'reports/**',
    '**/*.min.css', '**/public/workspace-utilities.css',
  ],
  overrides: [{
    name: 'repository/scss',
    files: ['**/*.scss'],
    customSyntax: 'postcss-scss',
    extends: ['stylelint-config-standard-scss'],
  }],
};
