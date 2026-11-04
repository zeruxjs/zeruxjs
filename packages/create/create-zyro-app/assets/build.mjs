import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import {
  escapeHtmlText,
  escapeHtmlAttribute,
} from '@zeruxjs/security/encoding';
import { readConfig } from './config.mjs';
async function readOwnedOutput(file) {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 2097152) throw Error('Invalid prior output');
    const buffer = Buffer.alloc(stat.size + 1);
    let size = 0;
    while (size < buffer.length) {
      const result = await handle.read(buffer, size, buffer.length - size, null);
      if (!result.bytesRead) break;
      size += result.bytesRead;
    }
    if (size > stat.size) throw Error('Prior output changed during read');
    return buffer.subarray(0, size);
  } finally {await handle.close();}
}
const root = fileURLToPath(new URL('../', import.meta.url)),
  config = readConfig(new URL('../', import.meta.url)),
  out = path.join(root, 'dist');
const expectedMode = __MODE_JSON__;
if (config.mode !== expectedMode)
  throw Error(
    'Mode differs from the generated template; generate the requested mode explicitly',
  );
const extension = config.language === 'typescript' ? 'ts' : 'mjs',
  base = config.basePath === '/' ? '' : config.basePath,
  mount = base.slice(1),
  sha = (value) => createHash('sha256').update(value).digest('hex');
const lock = await fs.open(path.join(root, '.zyro-build.lock'), 'wx', 0o600);
let stage;
try {
  stage = await fs.mkdtemp(path.join(root, '.zyro-candidate-'));
  const put = async (file, data) => {
    if (file.split('/').some((x) => !x || x === '.' || x === '..'))
      throw Error('Invalid build path');
    const target = path.join(stage, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data, { flag: 'wx' });
  };
  const css = await fs.readFile(path.join(root, 'public/style.css'));
  const styleFile = [mount, 'assets/style-' + sha(css).slice(0, 16) + '.css']
    .filter(Boolean)
    .join('/');
  let clientFile;
  if (['client', 'hydrated'].includes(config.mode)) {
    const result = await build({
      absWorkingDir: root,
      entryPoints: ['src/client.' + extension],
      bundle: true,
      write: false,
      metafile: true,
      platform: 'browser',
      format: 'iife',
      target: 'es2022',
      minify: true,
      sourcemap: false,
      legalComments: 'eof',
      outfile: 'client.js',
      plugins: [
        {
          name: 'no-network-imports',
          setup(api) {
            api.onResolve({ filter: /^(?:node|https?|data):/ }, () => ({
              errors: [
                {
                  text: 'Client imports must be public browser modules, not Node/network URLs',
                },
              ],
            }));
          },
        },
      ],
    });
    const publicSources = new Set(
      [
        'src/client.' + extension,
        'src/App.' + extension,
        'src/public-props.' + extension,
      ].map((f) => path.join(root, f)),
    );
    const dependencyRoots = [
      path.dirname(fileURLToPath(import.meta.resolve('zyrojs'))),
      path.dirname(
        fileURLToPath(import.meta.resolve('@zeruxjs/security/encoding')),
      ),
    ];
    for (const input of Object.keys(result.metafile.inputs)) {
      const absolute = path.resolve(root, input);
      if (
        !publicSources.has(absolute) &&
        !dependencyRoots.some((directory) =>
          absolute.startsWith(directory + path.sep),
        )
      )
        throw Error(
          'Client graph includes a non-public source; review it explicitly: ' +
            input,
        );
    }
    const bytes = result.outputFiles[0].contents;
    if (bytes.length > 1048576) throw Error('Client bundle limit');
    clientFile = [mount, 'assets/client-' + sha(bytes).slice(0, 16) + '.js']
      .filter(Boolean)
      .join('/');
    await put(clientFile, bytes);
  }
  await put(styleFile, css);
  if (config.mode === 'static') {
    const component = path.join(stage, 'component.mjs');
    await build({
      absWorkingDir: root,
      entryPoints: ['src/App.' + extension],
      outfile: component,
      bundle: true,
      packages: 'external',
      platform: 'node',
      format: 'esm',
      target: 'node24',
    });
    const { App, validatePublicProps } = await import(
      pathToFileURL(component).href
    );
    const { h, renderToString } = await import('zyrojs/dom');
    const { exportStaticSite } = await import('zeruxjs/static-export');
    const { createZyroRenderer } = await import('zeruxjs/renderers');
    const integrity =
      'sha256-' + createHash('sha256').update(css).digest('base64');
    await exportStaticSite({
      rootDir: root,
      outDir: 'dist',
      origin: config.origin,
      basePath: config.basePath,
      routes: [
        {
          path: base || '/',
          access: 'public',
          title: config.title,
          view: (_params, ctx) => ({
            title: config.title,
            interactive: false,
            style: ctx.asset('/style.css'),
          }),
        },
      ],
      notFound: {
        access: 'public',
        title: 'Not found',
        view: {
          title: 'Not found',
          interactive: false,
          style: base + '/style.css',
        },
      },
      assets: {
        directory: 'public',
        manifest: {
          schema: 1,
          assets: [{ url: '/style.css', bytes: css.length, integrity }],
        },
        include: ['/style.css'],
      },
      renderer: () =>
        createZyroRenderer((view) =>
          renderToString([
            h('link', { rel: 'stylesheet', href: view.style }),
            h(
              App,
              validatePublicProps({ title: view.title, interactive: false }),
            ),
          ]),
        ),
    });
  } else {
    if (config.mode === 'client') {
      const shell =
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' +
        escapeHtmlText(config.title) +
        '</title><link rel="stylesheet" href="' +
        escapeHtmlAttribute('/' + styleFile) +
        '"></head><body><div id="app"><p>Enable JavaScript to mount the client application.</p></div><script defer src="' +
        escapeHtmlAttribute('/' + clientFile) +
        '"></script></body></html>';
      await put([mount, 'index.html'].filter(Boolean).join('/'), shell);
      await put(
        [mount, '404.html'].filter(Boolean).join('/'),
        '<!doctype html><title>Not found</title><h1>Not found</h1>',
      );
    } else
      await build({
        absWorkingDir: root,
        entryPoints: ['src/server.mjs'],
        outfile: path.join(stage, 'server.mjs'),
        bundle: true,
        packages: 'external',
        platform: 'node',
        format: 'esm',
        target: 'node24',
        sourcemap: false,
      });
    const list = async (dir) => {
      const result = [];
      for (const item of await fs.readdir(dir, { withFileTypes: true })) {
        const location = path.join(dir, item.name);
        if (item.isSymbolicLink()) throw Error('Symlink output rejected');
        if (item.isDirectory()) result.push(...(await list(location)));
        else {
          const bytes = await fs.readFile(location);
          if (bytes.length > 2097152) throw Error('Output file limit');
          result.push({
            file: path.relative(stage, location).split(path.sep).join('/'),
            bytes: bytes.length,
            sha256: sha(bytes),
          });
        }
      }
      return result.sort((a, b) => a.file.localeCompare(b.file, 'en'));
    };
    const manifest = {
      kind: 'create-zyro-build-v1',
      schema: 1,
      basePath: config.basePath,
      config,
      assets: {
        style: '/' + styleFile,
        ...(clientFile ? { client: '/' + clientFile } : {}),
      },
      files: await list(stage),
    };
    await put('build-manifest.json', JSON.stringify(manifest, null, 2) + '\n');
    let exists = false;
    try {
      const info = await fs.lstat(out);
      if (info.isSymbolicLink() || !info.isDirectory())
        throw Error('Unsafe existing output');
      exists = true;
      const old = JSON.parse(
        (await readOwnedOutput(path.join(out, 'build-manifest.json'))).toString('utf8'),
      );
      if (old.kind !== 'create-zyro-build-v1') throw Error('Unowned output');
      const expected = new Set(['build-manifest.json']);
      for (const file of old.files) {
        if (
          typeof file.file !== 'string' ||
          file.file.includes('\\') ||
          file.file.split('/').some((p) => !p || p === '.' || p === '..')
        )
          throw Error('Invalid output manifest');
        const candidate = path.join(out, file.file);
        if (sha(await readOwnedOutput(candidate)) !== file.sha256)
          throw Error('Edited output; refusing replacement');
        expected.add(file.file);
      }
      const check = async (dir) => {
        for (const item of await fs.readdir(dir, { withFileTypes: true })) {
          const file = path.join(dir, item.name);
          if (item.isSymbolicLink()) throw Error('Symlink output');
          if (item.isDirectory()) await check(file);
          else if (
            !expected.has(path.relative(out, file).split(path.sep).join('/'))
          )
            throw Error('Unowned output file');
        }
      };
      await check(out);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (exists) throw Error('Unowned existing output');
    }
    const backup = path.join(root, '.zyro-previous');
    try {
      await fs.lstat(backup);
      throw Error('Prior build recovery required');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (exists) await fs.rename(out, backup);
    try {
      await fs.rename(stage, out);
      stage = undefined;
    } catch (error) {
      if (exists) await fs.rename(backup, out);
      throw error;
    }
    if (exists) await fs.rm(backup, { recursive: true });
  }
  console.log(
    'Built ' + config.mode + ' at ' + config.basePath + '; no server started',
  );
} finally {
  if (stage) await fs.rm(stage, { recursive: true, force: true });
  await lock.close();
  await fs.unlink(path.join(root, '.zyro-build.lock'));
}
