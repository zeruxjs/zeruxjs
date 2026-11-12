import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import {
  escapeHtmlText,
  escapeHtmlAttribute,
} from '@zeruxjs/security/encoding';
import { readConfig } from './config.mjs';
/** Read a bounded regular previous-output file through an owned no-follow descriptor.
 * @param {string} file - Build-owned prior-output path selected by manifest verification.
 * @returns {Promise<Buffer>} Verified bounded bytes; descriptor closes on every outcome.
 */
async function readOwnedOutput(file) {
  /** Owned no-follow nonblocking previous-output descriptor; finally closes it. */
  const handle = await fs.open(
    file,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  );
  try {
    /** Previous-output descriptor metadata validated before bounded allocation. */
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 2097152) {
      throw Error('Invalid prior output');
    }
    /** Bounded buffer with one extra byte detecting growth during prior-output verification. */
    const buffer = Buffer.alloc(stat.size + 1);
    let size = 0;
    while (size < buffer.length) {
      /** Native read/build output retained only for this explicit build candidate. */
      const result = await handle.read(
        buffer,
        size,
        buffer.length - size,
        null
      );
      if (!result.bytesRead) {
        break;
      }
      size += result.bytesRead;
    }
    if (size > stat.size) {
      throw Error('Prior output changed during read');
    }
    return buffer.subarray(0, size);
  } finally {
    await handle.close();
  }
}
/** Explicit generated project root derived from the build asset location. */
const root = fileURLToPath(new URL('../', import.meta.url));
/** Validated public-only build settings; mode must match this generated template. */
const config = readConfig(new URL('../', import.meta.url));
/** Fixed project-local dist destination, replaced only after ownership verification. */
const out = path.join(root, 'dist');
/** Trusted template placeholder replaced with the selected mode during generation. */
const expectedMode = __MODE_JSON__;
if (config.mode !== expectedMode) {
  throw Error(
    'Mode differs from the generated template; generate the requested mode explicitly'
  );
}
/** Fixed source extension from the validated language. */
const extension = config.language === 'typescript' ? 'ts' : 'mjs';
/** Canonical public mount prefix for generated URLs. */
const base = config.basePath === '/' ? '' : config.basePath;
/** Relative output subdirectory corresponding to the public mount. */
const mount = base.slice(1);
/** Compute content identity without interpreting asset bytes as code.
 * @param {Buffer | string} value - Build-owned bytes.
 * @returns {string} Hexadecimal SHA-256 digest.
 */
const sha = (value) => createHash('sha256').update(value).digest('hex');
/** Exclusive private build lock; finally closes and removes only this owned lock. */
const lock = await fs.open(path.join(root, '.zyro-build.lock'), 'wx', 0o600);
let stage;
try {
  stage = await fs.mkdtemp(path.join(root, '.zyro-candidate-'));
  /** Write one reviewed relative candidate file without overwrite.
   * @param {string} file - Validated relative path under the owned stage.
   * @param {Buffer | string} data - Trusted build output bytes.
   * @returns {Promise<void>} Exclusive staged write settlement.
   */
  const put = async (file, data) => {
    if (file.split('/').some((x) => !x || x === '.' || x === '..')) {
      throw Error('Invalid build path');
    }
    /** Candidate path under the build-owned staging directory. */
    const target = path.join(stage, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data, { flag: 'wx' });
  };
  /** Explicit public stylesheet bytes hashed for deterministic asset identity. */
  const css = await fs.readFile(path.join(root, 'public/style.css'));
  /** Mounted content-hashed stylesheet output path. */
  const styleFile = [mount, 'assets/style-' + sha(css).slice(0, 16) + '.css']
    .filter(Boolean)
    .join('/');
  let clientFile;
  if (['client', 'hydrated'].includes(config.mode)) {
    /** Native read/build output retained only for this explicit build candidate. */
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
    /** Explicit allowlist of generated browser source modules; server modules stay excluded. */
    const publicSources = new Set(
      [
        'src/client.' + extension,
        'src/App.' + extension,
        'src/public-props.' + extension,
      ].map((f) => path.join(root, f))
    );
    /** Fixed reviewed public library/security output roots allowed in the browser graph. */
    const dependencyRoots = [
      path.dirname(fileURLToPath(import.meta.resolve('zyrojs'))),
      path.dirname(
        fileURLToPath(import.meta.resolve('@zeruxjs/security/encoding'))
      ),
    ];
    for (const input of Object.keys(result.metafile.inputs)) {
      /** Resolved bundler input checked against the exact public source allowlist. */
      const absolute = path.resolve(root, input);
      if (
        !publicSources.has(absolute) &&
        !dependencyRoots.some((directory) =>
          absolute.startsWith(directory + path.sep)
        )
      ) {
        throw Error(
          'Client graph includes a non-public source; review it explicitly: ' +
            input
        );
      }
    }
    /** Bounded generated output bytes used for hashing and manifest metadata. */
    const bytes = result.outputFiles[0].contents;
    if (bytes.length > 1048576) {
      throw Error('Client bundle limit');
    }
    clientFile = [mount, 'assets/client-' + sha(bytes).slice(0, 16) + '.js']
      .filter(Boolean)
      .join('/');
    await put(clientFile, bytes);
  }
  await put(styleFile, css);
  if (config.mode === 'static') {
    /** Temporary build-owned server component bundle used by the explicit static exporter. */
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
    /** Explicit authored component exports loaded only during the opt-in local build. */
    const { App, validatePublicProps } = await import(
      pathToFileURL(component).href
    );
    /** Public standalone static renderer used by the general exporter. */
    const { h, renderToString } = await import('zyrojs/dom');
    /** General framework exporter owns complete static candidate validation and promotion. */
    const { exportStaticSite } = await import('zeruxjs/static-export');
    /** Explicit adapter wrapping the selected standalone static renderer. */
    const { createZyroRenderer } = await import('zeruxjs/renderers');
    /** SHA-256 stylesheet integrity metadata consumed by the general exporter. */
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
              validatePublicProps({ title: view.title, interactive: false })
            ),
          ])
        ),
    });
  } else {
    if (config.mode === 'client') {
      /** Escaped authored client-mode HTML shell with external same-origin assets only. */
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
        '<!doctype html><title>Not found</title><h1>Not found</h1>'
      );
    } else {
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
    }
    /** Enumerate this candidate without symlinks and compute deterministic manifest entries.
     * @param {string} dir - Owned candidate directory.
     * @returns {Promise<object[]>} Sorted bounded file metadata with byte hashes.
     */
    const list = async (dir) => {
      /** Native read/build output retained only for this explicit build candidate. */
      const result = [];
      for (const item of await fs.readdir(dir, { withFileTypes: true })) {
        /** Candidate path obtained from directory enumeration, never request input. */
        const location = path.join(dir, item.name);
        if (item.isSymbolicLink()) {
          throw Error('Symlink output rejected');
        }
        if (item.isDirectory()) {
          result.push(...(await list(location)));
        } else {
          /** Bounded generated output bytes used for hashing and manifest metadata. */
          const bytes = await fs.readFile(location);
          if (bytes.length > 2097152) {
            throw Error('Output file limit');
          }
          result.push({
            file: path.relative(stage, location).split(path.sep).join('/'),
            bytes: bytes.length,
            sha256: sha(bytes),
          });
        }
      }
      return result.sort((a, b) => a.file.localeCompare(b.file, 'en'));
    };
    /** Complete deterministic output manifest written before promotion. */
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
      /** Existing output metadata; symlinks and non-directory destinations reject. */
      const info = await fs.lstat(out);
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw Error('Unsafe existing output');
      }
      exists = true;
      /** Prior build-owned manifest; edited/unowned output must not be replaced. */
      const old = JSON.parse(
        (await readOwnedOutput(path.join(out, 'build-manifest.json'))).toString(
          'utf8'
        )
      );
      if (old.kind !== 'create-zyro-build-v1') {
        throw Error('Unowned output');
      }
      /** Allowlisted previous-output entries used to detect unowned files before promotion. */
      const expected = new Set(['build-manifest.json']);
      for (const file of old.files) {
        if (
          typeof file.file !== 'string' ||
          file.file.includes('\\') ||
          file.file.split('/').some((p) => !p || p === '.' || p === '..')
        ) {
          throw Error('Invalid output manifest');
        }
        /** Prior manifest-listed output file whose bytes must match the recorded hash. */
        const candidate = path.join(out, file.file);
        if (sha(await readOwnedOutput(candidate)) !== file.sha256) {
          throw Error('Edited output; refusing replacement');
        }
        expected.add(file.file);
      }
      /** Reject unowned or symlinked prior-output files before promotion.
       * @param {string} dir - Existing verified output tree.
       * @returns {Promise<void>} Resolves only for the build-owned previous tree.
       */
      const check = async (dir) => {
        for (const item of await fs.readdir(dir, { withFileTypes: true })) {
          /** Existing directory entry verified against the previous manifest allowlist. */
          const file = path.join(dir, item.name);
          if (item.isSymbolicLink()) {
            throw Error('Symlink output');
          }
          if (item.isDirectory()) {
            await check(file);
          } else if (
            !expected.has(path.relative(out, file).split(path.sep).join('/'))
          ) {
            throw Error('Unowned output file');
          }
        }
      };
      await check(out);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      if (exists) {
        throw Error('Unowned existing output');
      }
    }
    /** Fixed private previous-output recovery location; never silently overwritten. */
    const backup = path.join(root, '.zyro-previous');
    try {
      await fs.lstat(backup);
      throw Error('Prior build recovery required');
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
    if (exists) {
      await fs.rename(out, backup);
    }
    try {
      await fs.rename(stage, out);
      stage = undefined;
    } catch (error) {
      if (exists) {
        await fs.rename(backup, out);
      }
      throw error;
    }
    if (exists) {
      await fs.rm(backup, { recursive: true });
    }
  }
  console.log(
    'Built ' + config.mode + ' at ' + config.basePath + '; no server started'
  );
} finally {
  if (stage) {
    await fs.rm(stage, { recursive: true, force: true });
  }
  await lock.close();
  await fs.unlink(path.join(root, '.zyro-build.lock'));
}
