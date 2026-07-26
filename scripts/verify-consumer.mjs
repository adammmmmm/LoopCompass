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
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import path from "node:path";
import { validateStateDir } from "./lib/capsule.mjs";

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
  "references/integration.md",
  "references/pii-sanitation.md",
  "references/redaction-audit.md",
  "scripts/redact-check.mjs",
];

function parseManifestFiles(text) {
  const files = new Map();
  let inFiles = false;
  for (const rawLine of text.split(/\r?\n/)) {
    if (/^files:\s*$/.test(rawLine)) {
      inFiles = true;
      continue;
    }
    if (!inFiles) continue;
    const match = rawLine.match(/^\s+([^:]+):\s*([0-9a-f]{64})\s*$/i);
    if (match) {
      const rel = match[1].trim().replaceAll("\\", "/");
      if (
        path.posix.isAbsolute(rel) ||
        rel.split("/").includes("..") ||
        files.has(rel)
      ) {
        return null;
      }
      files.set(rel, match[2].toLowerCase());
      continue;
    }
    if (/^\S/.test(rawLine)) break;
    if (rawLine.trim()) return null;
  }
  return files.size ? files : null;
}

function listFiles(root, dir = root, files = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (lstatSync(full).isDirectory()) listFiles(root, full, files);
    else files.push(path.relative(root, full).replaceAll("\\", "/"));
  }
  return files.sort();
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function main() {
  const { project, skillPaths } = parseArgs(process.argv.slice(2));
  if (!project) die("usage: node scripts/verify-consumer.mjs --project <repo-root>");
  if (!existsSync(project)) die(`project not found: ${project}`);

  const errors = [];
  const paths =
    skillPaths.length > 0
      ? skillPaths.map((p) => path.resolve(project, p))
      : [
          path.join(project, ".agents", "skills", "loop-compass"),
          path.join(project, ".claude", "skills", "loop-compass"),
          path.join(project, "skills", "loop-compass"),
        ].filter((p) => existsSync(p));

  if (paths.length === 0) {
    die("no loop-compass skill install found (looked under .agents, .claude, skills)");
  }

  // Skill files present
  for (const skillRoot of paths) {
    for (const rel of REQUIRED_SKILL_FILES) {
      if (!existsSync(path.join(skillRoot, rel))) {
        errors.push(`missing ${path.join(skillRoot, rel)}`);
      }
    }
    const manifestPath = path.join(skillRoot, "manifest.yaml");
    const manifestFiles =
      existsSync(manifestPath) && !lstatSync(manifestPath).isSymbolicLink()
      ? parseManifestFiles(readFileSync(manifestPath, "utf8"))
      : null;
    if (!manifestFiles) {
      errors.push(`invalid manifest inventory: ${manifestPath}`);
      continue;
    }
    for (const rel of listFiles(skillRoot)) {
      if (rel === "manifest.yaml") continue;
      const full = path.join(skillRoot, rel);
      const fileStat = lstatSync(full);
      if (fileStat.isSymbolicLink()) {
        errors.push(`non-portable skill file: ${full}`);
        continue;
      }
      const portableDocument = /\.(md|yaml|yml)$/i.test(rel);
      const manifestedScript =
        /^scripts\/[^/]+\.mjs$/.test(rel) && manifestFiles.has(rel);
      if (!portableDocument && !manifestedScript) {
        errors.push(`non-portable skill file: ${full}`);
      }
      if ((fileStat.mode & 0o111) !== 0 && !manifestedScript) {
        errors.push(`unexpected executable skill file: ${full}`);
      }
      if (!manifestFiles.has(rel)) {
        errors.push(`unmanifested skill file: ${full}`);
      } else if (sha256(full) !== manifestFiles.get(rel)) {
        errors.push(`skill digest mismatch: ${full}`);
      }
    }
    for (const rel of manifestFiles.keys()) {
      if (!existsSync(path.join(skillRoot, rel))) {
        errors.push(`manifest lists missing skill file: ${path.join(skillRoot, rel)}`);
      }
    }
  }

  // Dual-host byte equality when both present
  if (paths.length >= 2) {
    const firstFiles = listFiles(paths[0]);
    for (let i = 1; i < paths.length; i++) {
      if (JSON.stringify(listFiles(paths[i])) !== JSON.stringify(firstFiles)) {
        errors.push("skill file inventory drift between installs");
      }
    }
    for (const rel of firstFiles) {
      const first = path.join(paths[0], rel);
      if (lstatSync(first).isSymbolicLink()) continue;
      const a = readFileSync(first);
      for (let i = 1; i < paths.length; i++) {
        const other = path.join(paths[i], rel);
        if (!existsSync(other) || lstatSync(other).isSymbolicLink()) continue;
        const b = readFileSync(other);
        if (!a.equals(b)) {
          errors.push(`skill file drift between installs: ${rel}`);
        }
      }
    }
  }

  // Policy markers once per instruction file
  const policy = readFileSync(
    path.join(paths[0], "assets", "project-policy.md"),
    "utf8",
  ).trim();
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    const p = path.join(project, name);
    if (!existsSync(p)) continue;
    const text = readFileSync(p, "utf8");
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
  if (existsSync(state)) {
    const result = validateStateDir(state);
    errors.push(...result.errors);
    for (const w of result.warnings) console.warn(`warning: ${w}`);
  }

  if (errors.length) {
    console.error("verify-consumer failed:");
    for (const e of errors) console.error(`- ${e}`);
    process.exit(1);
  }

  console.log("verify-consumer ok");
  console.log(`skills  ${paths.length}`);
  console.log(`project ${project}`);
}

main();
