# ZeruxJS Development Guide

## Codebase structure

### Monorepo Overview

This is a npm monorepo containing the ZeruxJS framework, Zyro Library, Zenix CMS Based on ZeruxJS and Zyro Library and related packages.

```
ZeruxJS/
├── apps                                # Contain Application for hosting and Testing
│   ├── cms                             # It will have Test Application when developing @zenix packages for CMS
│   ├── sample-module                   # It will have application for Testing Modules of ./app/zerux-app
│   ├── zerux-docs                      # It will have application for Docs Development of @zeruxjs packages
│   ├── zeruxjs-app                     # It will have application for ZeruxJS Development
│   ├── zyro                            # It will have application for Zyro Development
│   └── zyro-single                     # It will have application for Zyro Single Development
├── packages                            # Contain Packages That need to be publish
│   ├── create                          # Contain Packages for Creating Packages for Installation of Zerix CMS, ZeruxJS and Zyro
│   │   ├── create-zenix-app            # It will have application for Creating Packages for Installation of Zerix CMS
│   │   ├── create-zerux-app            # It will have application for Creating Packages for Installation of ZeruxJS
│   │   └── create-zyro-app             # It will have application for Creating Packages for Installation of Zyro
│   ├── @zenix                          # It will have packages for Zenix CMS
│   ├── @zeruxjs                        # (In Progress) It will have packages for ZeruxJS
│   │   ├── accessibility               # It will have packages for Accessibility
│   │   ├── ai                          # It will have packages for AI functions
│   │   ├── ai-model                    # It will have packages for AI Model for Package development
│   │   ├── asset-manager               # It will have packages for Asset Manager, provide functions for managing assets with brand connection
│   │   ├── auth                        # It will have packages for Authentication
│   │   ├── cache                       # It will have packages for Cache
│   │   ├── cli                         # It will have packages for CLI
│   │   ├── db                          # It will have packages for Database functions wrapper to other db packages
│   │   ├── db-mongo                    # It will have packages for Mongo DB functions
│   │   ├── db-mysql                    # It will have packages for MySQL DB functions
│   │   ├── db-pgsql                    # It will have packages for Postgre SQL DB functions
│   │   ├── db-sqllite                  # It will have packages for SQLite DB functions
│   │   ├── feed                        # It will have packages for Feed functions
│   │   ├── font                        # It will have packages for Font functions
│   │   ├── hooks                       # It will have packages for Hooks functions
│   │   ├── lint                        # It will have packages for Lint functions
│   │   ├── mcp                         # It will have packages for MCP functions
│   │   ├── media                       # It will have packages for Media functions
│   │   ├── performance                 # It will have packages for Performance functions with support of Lighthouse, Web-Vitals report genration, and performance optimization, minification, cache manager from cache package.
│   │   ├── react                       # It will be used for React related functions
│   │   ├── search                      # It will be used for Search related functions
│   │   ├── security                    # It will be used for Security related functions
│   │   ├── seo                         # It will be used for SEO related functions
│   │   ├── server                      # It will be used for Server related functions, that starts normal and devtools (shared) together and also websockets
│   │   ├── share                       # It will be used for Share related functions
│   │   ├── typescript                  # It will be used for TypeScript related functions
│   │   ├── validator                   # It will be used for Validator related functions
│   │   ├── vue                         # It will be used for Vue related functions
│   │   ├── watcher                     # It is watcher that watchs file in shared mode, to reduce overall load
│   │   └── zyro                        # It will be used for Zyro related functions
│   ├── @zyrojs                         # It will have packages for ZyroJS, though it will contains pacakge that are mostly not required by production, only development.
│   ├── zenix                           # It is entry Package and all main connector of Zenix CMS Framework
│   ├── zeruxjs                         # It is entry Package and all main connector of ZeruxJS Framework
│   └── zyrojs                          # It is Library ZyroJS, its a full package of Zyrojs
├── pages                               # Static Sites for ZeruxJS, Zenix CMS, Zyro and Zyro Single
├── scripts                             # Scripts for ZeruxJS, Zenix CMS, Zyro and Zyro Single help in easy development and local setup,
└── vs-ext                              # Contains VS Code Extensions Packages
    └── zerux-n-zyro-js-dev             # VS Code Extension for ZeruxJS, Zenix CMS, Zyro and Zyro Single
```

## Core Package:
### ZeruxJS `packages/zeruxjs`: It is entry Package and all main connector of ZeruxJS Framework, its following packages are in `packages/@zeruxjs`, Important Files:
- `src/index.ts`: Export Funtions to public, more export mention in package.json,
- `src/bin/zerux.js`: It export `zerux` cli command, that can be used to run zerux commands, and it even uses `zcli` package, to let other package share `zerux` keyword.
- `src/bootstrap/`: Contains core runtime and bootstrapping logic (e.g., `runtime.ts` for managing application lifecycles, configuration (`config.ts`), loggers (`logger.ts`), database (`database.ts`), and environments (`env.ts`)).
- `src/commands/`: Defines CLI commands like `server` for starting development/production servers, and `build`.
- `src/loader/`: Contains custom loaders and module-resolution hooks (`loader.ts`, `register-loader.ts`).
- `src/exceptions/`: Centralized HTTP exception handling (`exception_handler.ts`, `http_error.ts`).
- `src/utils/`: Core utilities like file system (`fs.ts`) and host/domain (`host.ts`) functions.
- `src/compiler/`: Contains compiler wrappers and watcher configurations (`watcher.ts`).

#### Other Important Packages (`packages/@zeruxjs/`):
- `zsrv`: Handles server initialization, devtools operations, and WebSocket channels.
- `zcli`: Framework command line utility parser, sharing commands alongside the core package.
- `zwatch`: Custom file watcher running in shared mode to optimize and reduce CPU overhead.
- `@zeruxjs/validator`: Shared validation logic, schemas, and types for parameters and structures.
- `@zeruxjs/db` (and `db-*` adapters): Unified database wrappers to easily connect to Mongo, MySQL, PostgreSQL, and SQLite.
- `@zeruxjs/auth` & `@zeruxjs/security`: Authentication functions, guards, and security utilities.
- `@zeruxjs/performance`: Features for minification, Web-Vitals report generation, caching, and optimizations.

### ZyroJS `packages/zyrojs`: It is entry Package and all main connector of ZyroJS Library, Important Files:

### Zenix `packages/zenix`: It is entry Package and all main connector of Zenix CMS, Important Files:

## README files
Before Editing Any package or application, read its README file, it contains all the information about the package or application.

## Commands:
Never run root command, always run inside each package after editing `npm run build`, and never run for application, when developing, application will mostly already be running manually.

## Testing
For now there is no test files, will add in future as in package will have `/test` folder, and test will run by `npm run test` command.

## Writing Tests
For now ignore writing tests.

## Linting and Types
For now ignore Linting, will add soon.

## PR Status (CI Failures and Reviews)
{Later}

## PR Descriptions
{Later}

## Key Directories (Quick Reference)
See [Codebase structure](#codebase-structure) above for detailed explanations.


## Development Tips
- Must follow best Security and Performance practices, security is top priority before anything,
- Code must be formated properly as per [Linting](#linting-and-types)
- Must Re-Ckeck everything before finilizing output, from build to final output, must check everything.

## Secrets and Env Safety

Always treat environment variable values as sensitive unless they are known test-mode flags.

- Secret must not send anywhere, if you things its secret, not process or send any explite hide keywork instead of secret.
- environtment variables must not be hardcoded, always use `process.env` to access them.
- Never send .env, files that ignore by .gitignore and other ignore in process, but can take only keys from env file with command in such you can extract only key.
- Never print or paste secret values (tokens, API keys, cookies) in chat responses, commits, or shared logs.
- Mirror CI env **names and modes** exactly, but do not inline literal secret values in commands.
- If a required secret is missing locally, stop and ask the user rather than inventing placeholder credentials.
- Never commit local secret files; if documenting env setup, use placeholder-only examples.
- When sharing command output, summarize and redact sensitive-looking values.

## Specialized Skills
{Later}

## Context-Efficient Workflows
{Later}

## Commit and PR Style
{Later}

## Task Decomposition and Verification
- **Split work into smaller, individually verifiable tasks.** Before starting, break the overall goal into incremental steps where each step produces a result that can be checked independently.
- **Verify each task before moving on to the next.** After completing a step, confirm it works correctly (e.g., run relevant tests, check types, build, or manually inspect output). Do not proceed to the next task until the current one is verified.
- **Choose the right verification method for each change.** This may include running unit tests, integration tests, type checking, linting, building the project, or inspecting runtime behavior depending on what was changed.
- **When unclear how to verify a change, ask the user.** If there is no obvious test or verification method for a particular change, ask the user how they would like it verified before moving on.

**Pre-validate before committing** to avoid slow lint-staged failures (~2 min each):


## Rebuilding Before Running Tests
{Later}

## Development Anti-Patterns
{Later}

### Node.js Source Maps
{Later}

### Documentation Code Blocks

- Each function and class must have proper Doc comment with proper mention of params, return type, global variables (covers global, process, request headers and cookies), title and description.
- Must have inline comments for complex logic and important functions.
- Have small inline comments for everything for easy understanding of future development.
- Hooks use will also have doc comment, hooks are functions that are used to hook into the application lifecycle. they usually are functions that start with `on` or `use` and other are `addAction`, `doAction`, `addFilter` and `applyFilters`, more hooks coming soon.
- Other than that all public development must be documented in `apps/zeruxjs-docs` folder, in which it have structured `src/docs/[version]/` here in one level folder structure create public documentaion, as features that are exposed for other to use.

### Server Security: Internal Header Filtering
{Later}

## Editing AGENTS.md:

### When to Edit AGENTS.md:


### Which Section to Edit:

### What to Edit: