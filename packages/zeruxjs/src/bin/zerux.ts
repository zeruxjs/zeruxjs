#!/usr/bin/env node
import { registerLoader } from '../loader/register-loader.js';
import { cli } from 'zclivo';

// Core commands
import { server } from '../commands/server.js';
import { buildProject } from '../commands/build.js';

/** Register explicit framework/build/lint commands with the shared CLI.
 * @returns {void} Registration completion; command handlers run only after CLI selection.
 */
const addCommands = () => {
  /**
   * Core Commands
   */
  cli.addCommand(
    'zerux',
    'dev',
    async (args) => {
      /** Fixed framework loader namespace; never a user-supplied module path. */
      const serviceName = 'zerux';
      registerLoader(serviceName, { sourceRoot: process.cwd() });
      await server('dev', { ...args, serviceName });
    },
    {
      description: 'Start development server',
      docs: 'Runs the development server with hot reload support.',
      example: 'npx zerux dev',
    }
  );

  cli.addCommand(
    'zerux',
    'start',
    async (args) => {
      /** Fixed framework loader namespace; never a user-supplied module path. */
      const serviceName = 'zerux';
      registerLoader(serviceName);
      await server('start', { ...args, serviceName });
    },
    {
      description: 'Start production server',
      docs: 'Runs the built application in production mode.',
      example: 'npx zerux start',
    }
  );

  cli.addCommand(
    'zerux',
    'build',
    async () => {
      registerLoader('zerux', { sourceRoot: process.cwd() });
      await buildProject();
    },
    {
      description: 'Build the project',
      docs: 'Compiles the project for production deployment.',
      example: 'npx zerux build',
    }
  );

  /**
   * Lint Commands (auto-generated)
   */
  const lintCommands = [
    'lint',
    'lint:watch',
    'lint:fix',
    'lint:watch:fix',
    'lint:js',
    'lint:js:watch',
    'lint:js:fix',
    'lint:js:watch:fix',
    'lint:css',
    'lint:css:watch',
    'lint:css:fix',
    'lint:css:watch:fix',
    'lint:all',
    'lint:all:watch',
    'lint:all:fix',
    'lint:all:watch:fix',
  ];

  for (const command of lintCommands) {
    cli.addCommand(
      'zerux',
      command,
      async () => {
        /** Lazily loaded lint package, used only for an explicitly selected lint command. */
        const lint = await import('@zeruxjs/lint');

        /** Whether this selected command explicitly authorizes source fixes. */
        const fix = command.includes(':fix');
        /** Whether the selected command retains a watcher rather than running once. */
        const watch = command.includes(':watch');

        let runner: () => Promise<{ ok: boolean }>;

        if (command.includes(':js')) {
          runner = () => lint.lintJs({ fix });
        } else if (command.includes(':css')) {
          runner = () => lint.lintCss({ fix });
        } else if (command.includes(':all')) {
          runner = () => lint.lintAll({ fix });
        } else {
          runner = () => lint.lint({ fix });
        }

        if (watch) {
          await lint.watch(async () => {
            /** Selected runner receipt; unsuccessful checks become CLI command failures. */
            const result = await runner();
            if (!result.ok) {
              throw new Error(`Lint check failed: ${command}`);
            }
          });
        } else {
          /** Selected runner receipt; unsuccessful checks become CLI command failures. */
          const result = await runner();
          if (!result.ok) {
            throw new Error(`Lint check failed: ${command}`);
          }
        }
      },
      {
        description: `Run ${command}`,
        docs: `Executes ${command} with optional flags like :fix and :watch.`,
        example: `npx zerux ${command}`,
      }
    );
  }
};

cli.addKey('zerux', {
  description: 'Zerux JS CLI - All commands',
  func: addCommands,
});
