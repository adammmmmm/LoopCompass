#!/usr/bin/env node
/**
 * Validate a project's .loopcompass recoveries and incidents.
 *
 * Usage:
 *   node scripts/validate-state.mjs --dir <path-to-.loopcompass>
 *   node scripts/validate-state.mjs --project <repo-root>
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateStateDir } from "./lib/capsule.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function die(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2);
  let dir = null;
  const dirIdx = args.indexOf("--dir");
  const projectIdx = args.indexOf("--project");
  if (dirIdx !== -1) {
    dir = path.resolve(args[dirIdx + 1] || "");
  } else if (projectIdx !== -1) {
    dir = path.resolve(args[projectIdx + 1] || "", ".loopcompass");
  } else {
    die("provide --dir <path-to-.loopcompass> or --project <repo-root>");
  }

  if (!existsSync(dir)) {
    die(`.loopcompass path not found: ${dir}`);
  }

  const result = validateStateDir(dir);
  for (const w of result.warnings) {
    console.warn(`warning: ${w}`);
  }
  if (result.errors.length) {
    console.error("validate-state failed:");
    for (const e of result.errors) console.error(`- ${e}`);
    process.exit(1);
  }

  console.log("validate-state ok");
  console.log(`recoveries ${result.recoveryFiles}`);
  console.log(`incidents  ${result.incidentFiles}`);
}

main();
