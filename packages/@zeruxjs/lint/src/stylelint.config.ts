// Packaged defaults keep CSS and SCSS syntax/plugin settings available to consumers.
export default {
  extends: ['stylelint-config-standard'],
  overrides: [{ files: ['**/*.scss'], extends: ['stylelint-config-standard-scss'] }]
};
