#!/usr/bin/env node
/**
 * Consumer-project integration checks (portable; no Python required).
 *
 * Usage:
 *   node scripts/verify-consumer.mjs --project <repo-root>
 *   node scripts/verify-consumer.mjs --project <repo-root> --skill-paths .agents/skills/loop-compass,.claude/skills/loop-compass
 */
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import os from "node:os";
import { validateStateDir } from "./lib/capsule.mjs";
import { parseCanonicalManifest } from "./lib/skill-manifest.mjs";

function die(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { project: null, skillPaths: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--project") out.project = path.resolve(argv[++i] || "");
    if (argv[i] === "--skill-paths") {
      out.skillPaths = String(argv[++i] || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return out;
}

const REQUIRED_SKILL_FILES = [
  "SKILL.md",
  "manifest.yaml",
  "agents/openai.yaml",
  "assets/incident-template.md",
  "assets/project-policy.md",
  "assets/recovery-template.md",
  "references/classification.md",
  "references/human-attention.md",
  "references/integration.md",
  "references/pii-sanitation.md",
  "references/redaction-audit.md",
  "scripts/redact-check.mjs",
];

function parseManifestFiles(text) {
  try {
    return new Map(Object.entries(parseCanonicalManifest(text).files));
  } catch {
    return null;
  }
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function lstatOptional(candidate) {
  try {
    return lstatSync(candidate);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function readStableRegular(file) {
  const before = lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error("non-regular skill entry");
  }
  const descriptor = openSync(
    file,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0),
  );
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || !sameFile(before, opened)) {
      throw new Error("skill entry changed");
    }
    const raw = readFileSync(descriptor);
    const afterRead = fstatSync(descriptor);
    const afterPath = lstatSync(file);
    if (
      !sameFile(opened, afterRead) ||
      opened.size !== afterRead.size ||
      !sameFile(before, afterPath) ||
      afterPath.isSymbolicLink()
    ) {
      throw new Error("skill entry changed");
    }
    return { raw, mode: before.mode };
  } finally {
    closeSync(descriptor);
  }
}

function typedInventory(root) {
  const inventory = new Map();
  const rootBefore = lstatSync(root);
  if (!rootBefore.isDirectory() || rootBefore.isSymbolicLink()) {
    throw new Error("unsafe skill root");
  }
  function visit(directory, prefix = "") {
    const before = lstatSync(directory);
    if (!before.isDirectory() || before.isSymbolicLink()) {
      throw new Error("non-directory skill parent");
    }
    for (const name of readdirSync(directory).sort()) {
      const full = path.join(directory, name);
      const relative = prefix ? `${prefix}/${name}` : name;
      const stat = lstatSync(full);
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        inventory.set(relative, { type: "directory" });
        visit(full, relative);
      } else if (stat.isFile() && !stat.isSymbolicLink()) {
        const { raw, mode } = readStableRegular(full);
        inventory.set(relative, { type: "file", raw, mode });
      } else {
        throw new Error("non-regular skill entry");
      }
    }
    const after = lstatSync(directory);
    if (!sameFile(before, after) || after.isSymbolicLink()) {
      throw new Error("skill directory changed");
    }
  }
  visit(root);
  const rootAfter = lstatSync(root);
  if (!sameFile(rootBefore, rootAfter) || rootAfter.isSymbolicLink()) {
    throw new Error("skill root changed");
  }
  return inventory;
}

function validateStateSnapshot(state) {
  const before = typedInventory(state);
  const temporary = mkdtempSync(path.join(os.tmpdir(), "lc-state-snapshot-"));
  const snapshot = path.join(temporary, ".loopcompass");
  mkdirSync(snapshot);
  try {
    for (const [relative, entry] of before) {
      const destination = path.join(snapshot, relative);
      if (entry.type === "directory") {
        mkdirSync(destination, { recursive: true });
      } else {
        mkdirSync(path.dirname(destination), { recursive: true });
        writeFileSync(destination, entry.raw);
      }
    }
    const result = validateStateDir(snapshot);
    const after = typedInventory(state);
    if (inventoryFingerprint(after) !== inventoryFingerprint(before)) {
      throw new Error("state changed during validation");
    }
    return result;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function inventoryFingerprint(inventory) {
  return JSON.stringify(
    [...inventory].map(([relative, entry]) => [
      relative,
      entry.type,
      entry.type === "file"
        ? createHash("sha256").update(entry.raw).digest("hex")
        : null,
      entry.mode || null,
    ]),
  );
}

function expectedInventory(manifestFiles) {
  const expected = new Map([["manifest.yaml", "file"]]);
  for (const relative of manifestFiles.keys()) {
    expected.set(relative, "file");
    let directory = path.posix.dirname(relative);
    while (directory !== ".") {
      expected.set(directory, "directory");
      directory = path.posix.dirname(directory);
    }
  }
  return expected;
}

function inventoryShape(inventory) {
  return JSON.stringify(
    [...inventory]
      .map(([relative, entry]) => [
        relative,
        typeof entry === "string" ? entry : entry.type,
      ])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function main() {
  const { project, skillPaths } = parseArgs(process.argv.slice(2));
  if (!project) die("usage: node scripts/verify-consumer.mjs --project <repo-root>");
  if (!existsSync(project)) die(`project not found: ${project}`);
  const projectStat = lstatSync(project);
  if (!projectStat.isDirectory() || projectStat.isSymbolicLink()) {
    die("project root failed directory validation");
  }

  const errors = [];
  const paths =
    skillPaths.length > 0
      ? skillPaths.map((p) => path.resolve(project, p))
      : [
          path.join(project, ".agents", "skills", "loop-compass"),
          path.join(project, ".claude", "skills", "loop-compass"),
          path.join(project, "skills", "loop-compass"),
        ].filter((p) => lstatOptional(p));

  if (paths.length === 0) {
    die("no loop-compass skill install found (looked under .agents, .claude, skills)");
  }

  const installs = [];
  // Skill files present
  for (const skillRoot of paths) {
    let inventory;
    try {
      inventory = typedInventory(skillRoot);
    } catch {
      errors.push("skill install failed typed-tree validation");
      continue;
    }
    const manifestEntry = inventory.get("manifest.yaml");
    const manifestFiles = manifestEntry?.type === "file"
      ? parseManifestFiles(manifestEntry.raw.toString("utf8"))
      : null;
    if (!manifestFiles) {
      errors.push("skill manifest failed canonical validation");
      continue;
    }
    const expected = expectedInventory(manifestFiles);
    if (
      inventoryShape(inventory) !== inventoryShape(expected)
    ) {
      errors.push("skill install inventory does not match manifest");
      continue;
    }
    for (const rel of REQUIRED_SKILL_FILES) {
      if (inventory.get(rel)?.type !== "file") {
        errors.push("skill install is missing a required regular file");
      }
    }
    for (const [rel, digest] of manifestFiles) {
      const entry = inventory.get(rel);
      if (!entry || entry.type !== "file") {
        errors.push("skill install inventory does not match manifest");
        continue;
      }
      const portableDocument = /\.(md|yaml|yml)$/i.test(rel);
      const manifestedScript =
        /^scripts\/[^/]+\.mjs$/.test(rel) && manifestFiles.has(rel);
      if (!portableDocument && !manifestedScript) {
        errors.push("skill install contains a non-portable file");
      }
      if ((entry.mode & 0o111) !== 0 && !manifestedScript) {
        errors.push("skill install contains an unexpected executable");
      }
      if (createHash("sha256").update(entry.raw).digest("hex") !== digest) {
        errors.push("skill install digest mismatch");
      }
    }
    try {
      const after = typedInventory(skillRoot);
      if (inventoryFingerprint(after) !== inventoryFingerprint(inventory)) {
        errors.push("skill install changed during verification");
      }
    } catch {
      errors.push("skill install changed during verification");
    }
    installs.push({ inventory, skillRoot });
  }

  // Dual-host byte equality when both present
  if (installs.length >= 2) {
    const first = inventoryFingerprint(installs[0].inventory);
    for (const install of installs.slice(1)) {
      if (inventoryFingerprint(install.inventory) !== first) {
        errors.push("skill inventory or bytes drift between installs");
      }
    }
  }

  // Policy markers once per instruction file
  const policyEntry = installs[0]?.inventory.get("assets/project-policy.md");
  if (!policyEntry || policyEntry.type !== "file") {
    errors.push("canonical project policy is unavailable");
  }
  const policy = policyEntry?.raw.toString("utf8").trim() || "";
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    const p = path.join(project, name);
    if (!lstatOptional(p)) continue;
    let text;
    try {
      text = readStableRegular(p).raw.toString("utf8");
    } catch {
      errors.push(`${name}: instruction file failed regular-file validation`);
      continue;
    }
    const starts = (text.match(/<!--\s*loopcompass:start/g) || []).length;
    const ends = (text.match(/<!--\s*loopcompass:end/g) || []).length;
    if (starts !== 1 || ends !== 1) {
      errors.push(`${name}: expected exactly one policy marker pair (start=${starts} end=${ends})`);
    }
    if (!text.includes(policy)) {
      errors.push(`${name}: canonical project-policy body not present verbatim`);
    }
    if (text.includes("<!-- loopcompass-policy:")) {
      errors.push(`${name}: legacy policy marker still present`);
    }
  }

  // State dir if present
  const state = path.join(project, ".loopcompass");
  const stateStat = lstatOptional(state);
  if (stateStat) {
    if (!stateStat.isDirectory() || stateStat.isSymbolicLink()) {
      errors.push("LoopCompass state root failed directory validation");
    } else {
      try {
        const result = validateStateSnapshot(state);
        if (result.errors.length) {
          errors.push(`LoopCompass state validation failed (${result.errors.length} errors)`);
        }
        if (result.warnings.length) {
          console.warn(
            `warning: LoopCompass state validation reported ${result.warnings.length} warnings`,
          );
        }
      } catch {
        errors.push("LoopCompass state failed regular-tree validation");
      }
    }
  }

  if (errors.length) {
    console.error("verify-consumer failed:");
    for (const e of errors) console.error(`- ${e}`);
    process.exit(1);
  }

  console.log("verify-consumer ok");
  console.log(`skills  ${paths.length}`);
}

try {
  main();
} catch {
  die("consumer verification failed stable filesystem validation");
}
