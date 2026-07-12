#!/usr/bin/env node
/**
 * Fail if example capsules still contain denylisted project-specific tokens.
 *
 * Usage:
 *   node scripts/redact-check.mjs [dir]
 * Default dir: examples/
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Tokens that must not appear in published examples. */
export const DENYLIST = [
  /DraftKings/i,
  /FanDuel/i,
  /\bKalshi\b/i,
  /\bTASK-\d+/i,
  /\bhedge-0-collector\b/i,
  /\bhedge_collector\b/i,
  /getEligibleBets/,
  /adammmmmm\/(?!LoopCompass)/i,
];

function walk(dir, files = []) {
  if (!existsSync(dir)) return files;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, files);
    else if (/\.(md|json|txt)$/i.test(name)) files.push(full);
  }
  return files;
}

function main() {
  const target = path.resolve(ROOT, process.argv[2] || "examples");
  const files = walk(target);
  const hits = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const re of DENYLIST) {
      if (re.test(text)) {
        hits.push(`${path.relative(ROOT, file)}: matches ${re}`);
      }
    }
  }
  if (hits.length) {
    console.error("redact-check failed:");
    for (const h of hits) console.error(`- ${h}`);
    process.exit(1);
  }
  console.log(`redact-check ok (${files.length} files under ${path.relative(ROOT, target) || "."})`);
}

main();
