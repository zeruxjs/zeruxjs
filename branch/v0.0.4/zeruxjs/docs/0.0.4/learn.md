# Learn ZeruxJS, one working step at a time

An eight-lesson, self-paced path from a first request to a verified application—with exercises and browser-local progress.


## No assumed framework knowledge

You do not need to know every package or understand every type table before starting. Begin with what a browser asks for, make one route respond, and add one responsibility at a time. Each lesson includes a plain-language explanation, a concrete example, an expected result, an exercise and a short knowledge check.

The course takes roughly two to three hours plus practice time. It teaches the implemented 0.0.3 package contracts used by this 0.0.4 documentation preview. It is not a certification, a production security review or a promise that every ecosystem package is complete.

## Two ways through the handbook

**New to coding or building with AI?** Follow the lessons in order. Keep the [glossary](/branch/v0.0.4/zeruxjs/docs/0.0.4/glossary.md) open. Ask your tool to explain the change, inspect the files it touches, run the example and compare the real result with the expected result. Never paste a private environment file into an AI prompt or issue.

**Already develop applications?** Skip directly to [configuration](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-handbook.md), [request context](/branch/v0.0.4/zeruxjs/docs/0.0.4/context-reference.md), [plugin contracts](/branch/v0.0.4/zeruxjs/docs/0.0.4/plugin-reference.md) or [the solution finder](/branch/v0.0.4/zeruxjs/docs/0.0.4/solutions.md). The course still offers practical checks for ownership, request isolation, caches and deployment differences.

## How progress and points work

Each lesson has two questions worth 10 points each. Correct answers earn points once; retries do not farm more points. A lesson is complete after both questions are answered correctly and you confirm you tried its exercise. Lessons never lock the next page. Answers and explanations remain readable without JavaScript.

With browser storage available, your answers, exercise confirmations, bookmarks and recent pages stay in this browser for this documentation mount/version. There is no account, sync service, leaderboard or telemetry. Clearing site data removes progress; private browsing may discard it. These points are a learning aid, not a credential. Use the progress panel to export, reset or continue locally. The settings/help page explains [offline reading and keyboard controls](/branch/v0.0.4/zeruxjs/docs/0.0.4/handbook-help.md).

## Learn by making and explaining

After each working change, explain what the request reads, what it returns, who owns any stored data and what happens on failure. If you cannot explain it, reduce the example before adding another package. A small application you can verify is a stronger foundation than a large generated application you cannot debug.

## Choose a lesson

The lesson list below remains ordinary links without JavaScript. Enhanced progress is optional. You can revisit any lesson or jump straight to a task.


## Course lessons

1. [Understand what you are building](/branch/v0.0.4/zeruxjs/docs/0.0.4/learn-foundations/) — Browser, server, terminal and packages—explained with one request.
2. [Run your first route](/branch/v0.0.4/zeruxjs/docs/0.0.4/learn-first-route/) — Create a small project, run it, and recognize a successful response.
3. [Make configuration predictable](/branch/v0.0.4/zeruxjs/docs/0.0.4/learn-config/) — Understand scripts, zerux.config, TypeScript and secret boundaries.
4. [Accept input safely](/branch/v0.0.4/zeruxjs/docs/0.0.4/learn-input/) — Turn unknown request data into a deliberately validated API.
5. [Add data with a clear owner](/branch/v0.0.4/zeruxjs/docs/0.0.4/learn-data/) — Know when memory is enough and when a database or cache is needed.
6. [Build a language-aware feature](/branch/v0.0.4/zeruxjs/docs/0.0.4/learn-language/) — Use zlocale catalogs, domains and locale-fixed translators.
7. [Turn a feature into a plugin](/branch/v0.0.4/zeruxjs/docs/0.0.4/learn-plugin/) — Register routes and share a host-owned contract without global side effects.
8. [Verify and ship deliberately](/branch/v0.0.4/zeruxjs/docs/0.0.4/learn-release/) — Build, typecheck, inspect a real response and diagnose common failures.

## Implementation sources

- [apps/zerux-docs/src/lib/academy.mjs](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/apps/zerux-docs/src/lib/academy.mjs)
- [packages/zeruxjs/src/bootstrap/types.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/bootstrap/types.ts)
- [packages/zlocale/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zlocale/src/index.ts)
