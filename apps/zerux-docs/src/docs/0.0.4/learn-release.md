---
{
  "title": "8. Verify and ship deliberately",
  "description": "Build the Node application, separate typechecking and collect useful debugging evidence.",
  "section": "Learning",
  "order": 80,
  "sources": [
    "apps/zerux-docs/src/lib/academy.mjs",
    "packages/zeruxjs/src/bootstrap/types.ts",
    "packages/zlocale/src/index.ts"
  ],
  "related": [
    "learn",
    "solutions",
    "glossary"
  ]
}
---

## Your goal

Verify the application you built, understand its deployment shape and create a reproducible issue report when a check fails.

## Check the application in layers

| Check | Evidence | What it does not prove |
| --- | --- | --- |
| Typecheck | Public imports and declared types fit | Incoming data or authorization is safe |
| Build | Source compilation succeeds | The production server starts correctly |
| Run compiled server | Startup succeeds in that environment | Every route/dependency/failure path works |
| Inspect real requests | Expected responses/errors occur | All tenants, load levels and browsers are certified |

A useful check states its boundary. Avoid “all safe” or “production-ready” claims based only on one green command.

## Build and run from your application

Stop the development server if it would compete for the same port. In your application directory:

```sh
npm run build
npm run start
```

Then inspect `/api/hello`, your valid and invalid POST requests, and the plugin route using the address printed by the compiled server. Keep required server environment variables in the deployment environment, not in a public asset directory.

`zerux build` compiles a Node application. It does not turn a general project into a static site suitable for GitHub Pages. This documentation site uses its own application-specific static exporter. Choose hosting that runs Node when your application needs the server runtime.

## Typecheck separately

Use the strict NodeNext setup in [the TypeScript guide](typescript.md). Keep typechecking as an explicit script/check. If a build succeeds but the typechecker fails, fix the declared contract rather than assuming compilation replaces checking.

## Turn a failure into a small question

```text title="A useful issue report template"
Package/runtime version:
Node/npm version and operating system:
Command and working directory:
Expected result:
Actual result and sanitized error:
Smallest files/steps that reproduce it:
Checks already tried:
```

Do not include tokens, cookies, full `.env` contents, private records or a live database URL. Keep the failing example small. Report whether the failure happens in development, compilation, startup or a request; those are different layers.

## Use the solution finder before changing unrelated code

[Find a solution](solutions.md) for a missing npm script, a route 404, config not changing behavior, missing/degraded services, a stale translation or a dark/offline docs issue. Each case gives a first check, an action and evidence that the problem is resolved. A diagnosis should narrow the cause, not add random packages.

## Try it yourself

Build and run the small app, inspect one success and one deliberate failure, and write a sanitized reproduction of a route typo. Explain which step proves compilation and which step proves the handler response. Save a short list of checks you would still need before handling private real-user data.

**You are done when:** you can show a working compiled response, name the remaining production boundaries and provide useful debugging evidence.

## Continue beyond the course

Move into [the full notes application](tutorial.md), [database access](database-queries.md), [authentication/security configuration](configuration-auth-security.md), [module localization](localization-package-authoring.md) or [site language settings](localization-site-settings.md). Completing the self-checks is a starting point for practice, not a professional credential.
