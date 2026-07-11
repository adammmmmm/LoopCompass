#!/usr/bin/env node
/**
 * LoopCompass verification entrypoint: unit tests + release inventory validate.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(label, command, args) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    console.error(`failed: ${label} (exit ${result.status})`);
    process.exit(result.status ?? 1);
  }
}

run("unit + fixture tests", "node", ["--test", "tests/signature.test.mjs", "tests/classification-fixtures.test.mjs", "tests/artifact-schema.test.mjs", "tests/install-update-dry-run.test.mjs", "tests/release-tooling.test.mjs"]);
run("release inventory validate", "node", ["scripts/release.mjs", "validate"]);
console.log("\nverify ok");
