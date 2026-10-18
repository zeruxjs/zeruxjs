#!/usr/bin/env node
/**
 * Title: Placeholder project-generator CLI.
 * Description: Reserved for the future ZyroJS project generator for `zyrojs`. Reports version/help; project generation remains unavailable.
 * Global Variables: Reads process.argv and writes stdout, stderr and process.exitCode. No project files or environment variables are accessed.
 */
const args = process.argv.slice(2);
if (args.length === 1 && (args[0] === "--version" || args[0] === "-v")) {
  console.log("0.0.3");
} else if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
  console.log("create-zyro-app 0.0.3: placeholder package. Project generation is not implemented.\nOptions: --help, --version");
} else {
  // Fail explicitly rather than suggesting that a project was created.
  console.error("create-zyro-app: project generation is not implemented in version 0.0.3.");
  process.exitCode = 1;
}
export {};
