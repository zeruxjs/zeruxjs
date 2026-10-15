# Contributing to ZeruxJS

First off, thank you for considering contributing to ZeruxJS! It's people like you that make ZeruxJS such a great tool.

This document provides guidelines and instructions for contributing to this repository.

## Code of Conduct

By participating in this project, you are expected to uphold our [Code of Conduct](CODE_OF_CONDUCT.md). Please report unacceptable behavior to the project core team.

## Monorepo Setup

ZeruxJS is a monorepo that manages multiple packages. We use standard package management workspaces (e.g., npm, yarn, or pnpm workspaces) to link them together.

The repository includes:
- `packages/zeruxjs`: The core framework.
- `packages/create-zerux-js`: The CLI application for scaffolding.
- `packages/zerus-js-vs-ext`: The official VS Code extension.

### Prerequisites

- [Node.js](https://nodejs.org/) (v16.x or higher is recommended)
- Your package manager of choice (`npm`, `yarn`, or `pnpm` depending on the workspace configuration)

### Local Development Setup

1. **Fork the repository** to your own GitHub account.
2. **Clone your fork**:
   ```bash
   git clone https://github.com/<your-username>/ZeruxJS.git
   cd ZeruxJS
   ```
3. **Install dependencies**:
   Run the install command at the root of the repository. This will install dependencies for all packages and link internal workspace packages.
   ```bash
   # Use npm, yarn, or pnpm
   npm install
   ```
4. **Build the packages**:
   ```bash
   npm run build
   ```

## Development Workflow

### Working on the Framework (`zeruxjs`)
1. Navigate to `packages/zeruxjs`.
2. Make your code changes.
3. Run tests frequently to ensure nothing is broken:
   ```bash
   npm run test
   ```

### Working on the CLI (`create-zerux-js`)
You can test the CLI locally by linking it or using the package manager's execute command.
1. Navigate to `packages/create-zerux-js`.
2. Link the package locally or run the binary entrypoint directly against a dummy target directory.

### Working on the VS Code Extension (`zerus-js-vs-ext`)
1. Open the `packages/zerus-js-vs-ext` folder in VS Code.
2. Press `F5` to open a new Extension Development Host window that runs your local extension code.
3. Use the VS Code Debug Console for output.

## Pull Request Process

1. Ensure any install or build dependencies are removed before the end of the layer when doing a build.
2. Update the README.md with details of changes to the interface, if applicable.
3. Thoroughly test your code. Add unit tests for any new features or bug fixes.
4. Run auto-fix linters and code formatters.
5. Create a Pull Request against the `main` branch. 
6. Describe your changes clearly in the PR description, referencing any issues it fixes.
7. You may merge the Pull Request in once you have the sign-off of at least one core developer, or if you do not have permission to do that, you may request the reviewer to merge it for you.

## Commit Message Guidelines

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification for our commit messages. This leads to more readable messages that are easy to follow when looking through the project history, and allows us to auto-generate release notes.

**Format**:
```
<type>(<scope>): <subject>
```

**Types**:
- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation only changes
- `style`: Changes that do not affect the meaning of the code (white-space, formatting, etc.)
- `refactor`: A code change that neither fixes a bug nor adds a feature
- `perf`: A code change that improves performance
- `test`: Adding missing tests or correcting existing tests
- `chore`: Changes to the build process or auxiliary tools and libraries

**Example**:
`feat(create-zerux-js): add prompt for interactive typescript configuration`

Thank you for your contributions!
