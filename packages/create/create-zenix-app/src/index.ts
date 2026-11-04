#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  CommandRegistry,
  registerGeneratorCommand,
  createTerminalGeneratorPrompt,
  type GeneratorPrompt,
} from "zclivo";
import { zenixAppGenerator } from "./templates.js";
export { zenixAppGenerator, planZenixApp } from "./templates.js";
export const version = "0.0.4";
/** Reusable import has no process listeners, prompts, writes or installs. */
export async function runCreateZenix(
  argv: readonly string[],
  options: {
    signal?: AbortSignal;
    cwd?: string;
    out?: (message: string) => void;
    err?: (message: string) => void;
    prompt?: () => GeneratorPrompt;
  } = {},
): Promise<number> {
  const out = options.out ?? console.log,
    err = options.err ?? console.error;
  if (
    Array.isArray(argv) &&
    argv.length === 1 &&
    ["--version", "-v"].includes(argv[0])
  ) {
    out(version);
    return 0;
  }
  // Provider choices are deliberately fixed until another durable adapter is qualified.
  const remaining: string[] = [];
  try {
    if (!Array.isArray(argv)) throw Error();
    const seen = new Set<string>();
    let separated = false;
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      if (arg === "--") separated = true;
      const option = ["--database", "--storage"].find(
        (key) => !separated && (arg === key || arg.startsWith(key + "=")),
      );
      if (!option) {
        remaining.push(arg);
        continue;
      }
      if (seen.has(option)) throw Error();
      seen.add(option);
      const value = arg === option ? argv[++i] : arg.slice(option.length + 1);
      if (value !== (option === "--database" ? "sqlite" : "none"))
        throw Error();
    }
  } catch {
    err(
      "Supported CMS setup: --database sqlite --storage none. No React/Vue CMS or media upload template is available.",
    );
    return 2;
  }
  argv = remaining;
  const registry = new CommandRegistry();
  registerGeneratorCommand(registry, {
    keyword: "create-zenix-js",
    generator: zenixAppGenerator,
    ...options,
    ...(options.prompt
      ? {
          prompt: () => {
            const prompt = options.prompt!();
            let initialized = false;
            return {
              async ask(
                question: Parameters<GeneratorPrompt["ask"]>[0],
                signal: AbortSignal,
              ) {
                if (!initialized) {
                  initialized = true;
                  for (const [message, choice] of [
                    ["Database adapter", "sqlite"],
                    ["Binary storage (uploads unavailable)", "none"],
                  ] as const) {
                    const answer = await prompt.ask(
                      {
                        name: "template",
                        message,
                        defaultValue: choice,
                        choices: [choice],
                      },
                      signal,
                    );
                    if (answer !== choice)
                      throw new TypeError(
                        "Unsupported CMS provider configuration",
                      );
                  }
                }
                return prompt.ask(question, signal);
              },
              close: () => prompt.close(),
            };
          },
        }
      : {}),
  });
  const args = Array.isArray(argv)
    ? !argv.length
      ? options.prompt
        ? ["create", "--interactive"]
        : ["create", "--help"]
      : ["--help", "-h", "--docs"].includes(argv[0])
        ? ["create", ...argv]
        : argv[0] === "create"
          ? argv
          : ["create", ...argv]
    : argv;
  const result = await registry.dispatch("create-zenix-js", args, out, {
    signal: options.signal,
  });
  if (
    argv.includes("--help") ||
    argv.includes("-h") ||
    (!argv.length && !options.prompt)
  )
    out(
      "--database sqlite --storage none; host session/CSRF/setup policy required before startup.",
    );
  if (result.exitCode && result.message) err(result.message);
  return result.exitCode;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const controller = new AbortController(),
    interrupt = () => controller.abort();
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    process.exitCode = await runCreateZenix(process.argv.slice(2), {
      signal: controller.signal,
      ...(process.stdin.isTTY && process.stdout.isTTY
        ? {
            prompt: () =>
              createTerminalGeneratorPrompt({
                input: process.stdin,
                output: process.stdout,
                onInterrupt: interrupt,
              }),
          }
        : {}),
    });
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
  }
}
