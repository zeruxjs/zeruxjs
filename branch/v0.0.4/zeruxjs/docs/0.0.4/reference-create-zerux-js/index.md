# create-zerux-js

Current placeholder contract, installation and honest upgrade expectations.


## Current release contract

`create-zerux-js@0.0.3` is a public placeholder. The CLI supports help/version only and does not create an application. The purpose of this guide is to distinguish the published contract from future plans, not to invent setup steps that the release cannot perform.

## Install or inspect

```sh
npx create-zerux-js@0.0.3 --help
npx create-zerux-js@0.0.3 --version
```

A generation request exits with failure and does not create files. Do not make a deployment pipeline depend on a scaffold appearing after this command.

## TypeScript and configuration

This is a command-line placeholder, not a typed project-generation factory. A TypeScript application generated in a future release will need its own configuration and checker settings; the current CLI does not create those files.

There is no automatic `create-zerux-js` key in `zerux.config.js` that activates an unfinished feature. Use the [manual installation guide](/branch/v0.0.4/zeruxjs/docs/0.0.4/installation.md) for a working Zerux application and the package guides for implemented storage/cache/queue functionality. Do not copy future-roadmap examples into production and assume package installation supplies their dependencies.

## Upgrading and troubleshooting

Pin the version you actually inspected. When a future release implements functionality, review its changelog, public exports, migration/data policy and configuration contract before adopting it. Existing placeholder imports are not evidence of backward-compatible CMS implementation.

If a command prints help but produces no files, that is the documented placeholder behavior. If an expected factory cannot be imported, inspect the installed version and exports instead of importing internal files. A registry name reservation and a successful tarball install do not certify a working application.


## Public entry points

Manifest reference for `create-zerux-js@0.0.3`.

```json
{
  "exports": {
    ".": "./dist/index.js"
  },
  "engines": {},
  "dependencies": {},
  "peerDependencies": {},
  "bin": {
    "create-zerux": "./dist/index.js"
  }
}
```


## Package README

# create-zerux-js

Public `0.0.2` placeholder release to establish the package name for future development.

Version `0.0.2` is a placeholder. Project generation is not implemented. The CLI supports `--help` and `--version` (exit status 0). Requests to generate a project report the limitation and exit with status 1 without creating files.

## Future implementation

This package is intended to generate projects using [`zeruxjs`](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/README.md). Scaffolding will be added in a future release; `0.0.2` only provides placeholder help/version output.

## Invocation

```sh
npm create zerux-js@latest
```

## Development

Run `npm run build` from this package directory.

## License

MIT OR Apache-2.0.

## Release 0.0.2

Prepared to validate npm trusted publishing through GitHub Actions.


## Release 0.0.3

Synchronized ecosystem release, including Zuixs CSS-entry support and documentation updates. Existing placeholder packages retain their documented limitations.


## Implementation sources

- [packages/create/create-zerux-app/README.md](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/create/create-zerux-app/README.md)
- [packages/create/create-zerux-app/package.json](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/create/create-zerux-app/package.json)
