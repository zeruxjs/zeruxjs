# Project structure

Keep routes, application logic and extensions separate.


## Default folders

app contains file routes. middleware contains global request middleware. controllers and composables hold reusable application logic. plugins extend the runtime. public contains directly served assets.

```text
app/
  page.ts
  api/health/route.ts
middleware/
controllers/
composables/
plugins/
public/
zerux.config.ts
```

## Override discovery

The structure option changes discovery directories. Plugin, middleware, controller, composable and public directories can be a string or an array. An entryPoint names an optional application registration module.

## Build artifacts

The application compiler stages output beneath .zerux/build. Keep generated artifacts out of source control. The documentation app has its own static export pipeline and writes dist instead.


## Implementation sources

- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/index.ts)
- [packages/zeruxjs/src/bootstrap/types.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/bootstrap/types.ts)
