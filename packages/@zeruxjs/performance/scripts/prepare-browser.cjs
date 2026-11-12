/** Fixed Node build-time writer for the generated browser package marker. */
const { writeFileSync } = require('node:fs');
/** Fixed Node path joiner; no runtime browser dependency is introduced. */
const { join } = require('node:path');
writeFileSync(
  join(__dirname, '../dist/browser/package.json'),
  '{"type":"module"}\n'
);
