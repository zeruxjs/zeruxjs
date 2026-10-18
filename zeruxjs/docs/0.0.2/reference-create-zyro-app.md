# create-zyro-app

Placeholder CLI for the future ZyroJS project generator

# create-zyro-app

Public `0.0.2` placeholder release to establish the package name for future development.

Version `0.0.2` is a placeholder. Project generation is not implemented. The CLI supports `--help` and `--version` (exit status 0). Requests to generate a project report the limitation and exit with status 1 without creating files.

## Future implementation

This package is intended to generate projects using [`zyrojs`](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zyrojs/README.md). Scaffolding will be added in a future release; `0.0.2` only provides placeholder help/version output.

## Invocation

```sh
npm create zyro-app@latest
```

## Development

Run `npm run build` from this package directory.

## License

MIT OR Apache-2.0.

## Release 0.0.2

Prepared to validate npm trusted publishing through GitHub Actions.


## Public entry points

Manifest reference for `create-zyro-app@0.0.2`.

```json
{
  "exports": {
    ".": "./dist/index.js"
  },
  "engines": {},
  "dependencies": {},
  "peerDependencies": {},
  "bin": {
    "create-zyro": "./dist/index.js"
  }
}
```


## Implementation sources

- [packages/create/create-zyro-app/package.json](https://github.com/zeruxjs/zeruxjs/blob/master/packages/create/create-zyro-app/package.json)
- [packages/create/create-zyro-app/README.md](https://github.com/zeruxjs/zeruxjs/blob/master/packages/create/create-zyro-app/README.md)
