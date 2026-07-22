#!/usr/bin/env node
/**
 * LoopCompass verification entrypoint: unit tests + release inventory validate + redaction.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(label, args) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    console.error(`failed: ${label} (exit ${result.status})`);
    process.exit(result.status ?? 1);
  }
}

const testFiles = [
  "tests/signature.test.mjs",
  "tests/identity-goldens.test.mjs",
  "tests/classification-fixtures.test.mjs",
  "tests/classification-assist.test.mjs",
  "tests/evaluation-fixtures.test.mjs",
  "tests/evaluation-report.test.mjs",
  "tests/site.test.mjs",
  "tests/artifact-schema.test.mjs",
  "tests/capsule-validate.test.mjs",
  "tests/install-update-dry-run.test.mjs",
  "tests/stage-install.test.mjs",
  "tests/release-tooling.test.mjs",
  "tests/redact-examples.test.mjs",
  "tests/verify-consumer.test.mjs",
];

run("unit + fixture tests", ["--test", ...testFiles]);
run("release inventory validate", ["scripts/release.mjs", "validate"]);
run("example redaction denylist", ["scripts/redact-check.mjs", "examples"]);
console.log("\nverify ok");
