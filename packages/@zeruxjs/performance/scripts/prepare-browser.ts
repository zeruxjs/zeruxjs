/** Fixed Node build-time writer for the generated browser package marker. */
import { writeFileSync } from 'node:fs';
/** Fixed Node path joiner; no runtime browser dependency is introduced. */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
/** Directory of this build-only script, independent of the current working directory. */
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
writeFileSync(
  join(scriptDirectory, '../dist/browser/package.json'),
  '{"type":"module"}\n'
);
