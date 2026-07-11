#!/usr/bin/env node
/**
 * LoopCompass release helper (maintainer tool, not a runtime dependency).
 *
 * Commands:
 *   generate  Write skills/loop-compass/manifest.yaml from the current tree
 *   validate  Verify VERSION, policy markers, and per-file digests
 *   package   Build a release archive and SHA256SUMS
 *   check     Compare an installed skill path to a release manifest (non-mutating)
 *
 * Usage:
 *   node scripts/release.mjs generate
 *   node scripts/release.mjs validate
 *   node scripts/release.mjs package
 *   node scripts/release.mjs check --installed <skill-dir> --release-manifest <manifest.yaml>
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SKILL_DIR = path.join(ROOT, "skills", "loop-compass");
const MANIFEST_PATH = path.join(SKILL_DIR, "manifest.yaml");
const VERSION_PATH = path.join(ROOT, "VERSION");
const POLICY_PATH = path.join(SKILL_DIR, "assets", "project-policy.md");
const SOURCE = "https://github.com/adammmmmm/LoopCompass";

const REQUIRED_TOP_LEVEL = [
  "SKILL.md",
  "agents/openai.yaml",
  "assets/project-policy.md",
  "assets/recovery-template.md",
  "assets/incident-template.md",
  "references/classification.md",
  "references/integration.md",
];

function die(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function sha256File(filePath) {
  // Hash LF-normalized bytes so Windows working trees and Linux CI agree.
  // Git stores these skill files as LF (see git ls-files --eol); digests must match
  // the canonical text form, not platform checkout line endings.
  const raw = readFileSync(filePath);
  const asText = raw.toString("utf8");
  const normalized =
    asText.includes("\0")
      ? raw
      : Buffer.from(asText.replace(/\r\n/g, "\n").replace(/\r/g, "\n"), "utf8");
  return createHash("sha256").update(normalized).digest("hex");
}

function readVersion() {
  if (!existsSync(VERSION_PATH)) {
    die(`missing ${path.relative(ROOT, VERSION_PATH)}`);
  }
  const version = readFileSync(VERSION_PATH, "utf8").trim();
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
    die(`VERSION must be semver, got: ${JSON.stringify(version)}`);
  }
  return version;
}

function gitCommit() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return "unknown";
  }
  return result.stdout.trim();
}

function listSkillFiles(dir = SKILL_DIR, prefix = "") {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const files = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...listSkillFiles(path.join(dir, entry.name), rel));
      continue;
    }
    if (!entry.isFile() || entry.name === "manifest.yaml" || entry.name.startsWith(".")) {
      continue;
    }
    files.push(rel.replaceAll("\\", "/"));
  }
  return files;
}

function parseManifest(text) {
  const data = {
    name: null,
    version: null,
    source: null,
    release: null,
    commit: null,
    skill_schema: null,
    policy_version: null,
    state_schema: null,
    minimum_policy_version: null,
    files: {},
  };

  let inFiles = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, "");
    if (!line.trim()) {
      continue;
    }
    if (/^files:\s*$/.test(line)) {
      inFiles = true;
      continue;
    }
    if (inFiles) {
      const match = line.match(/^\s+([^:]+):\s*([0-9a-f]{64})\s*$/i);
      if (match) {
        data.files[match[1].trim()] = match[2].toLowerCase();
        continue;
      }
      if (/^\S/.test(line)) {
        inFiles = false;
      } else {
        die(`invalid files entry: ${rawLine}`);
      }
    }
    const kv = line.match(/^([A-Za-z0-9_]+):\s*(.+?)\s*$/);
    if (!kv) {
      continue;
    }
    const key = kv[1];
    let value = kv[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (Object.prototype.hasOwnProperty.call(data, key) && key !== "files") {
      data[key] = value;
    }
  }

  for (const required of [
    "name",
    "version",
    "source",
    "release",
    "commit",
    "skill_schema",
    "policy_version",
    "state_schema",
    "minimum_policy_version",
  ]) {
    if (data[required] == null || data[required] === "") {
      die(`manifest missing field: ${required}`);
    }
  }
  if (Object.keys(data.files).length === 0) {
    die("manifest files inventory is empty");
  }
  return data;
}

function readPolicyVersion(policyText) {
  const start = policyText.match(
    /<!--\s*loopcompass:start\s+policy=(\d+)\s*-->/,
  );
  const end = policyText.match(/<!--\s*loopcompass:end\s*-->/);
  if (!start) {
    die("project-policy.md missing opening marker <!-- loopcompass:start policy=N -->");
  }
  if (!end) {
    die("project-policy.md missing closing marker <!-- loopcompass:end -->");
  }
  const starts = [...policyText.matchAll(/<!--\s*loopcompass:start/g)];
  const ends = [...policyText.matchAll(/<!--\s*loopcompass:end/g)];
  if (starts.length !== 1 || ends.length !== 1) {
    die("project-policy.md must contain exactly one start and one end marker");
  }
  if (policyText.indexOf(starts[0][0]) > policyText.indexOf(ends[0][0])) {
    die("project-policy.md end marker appears before start marker");
  }
  return Number(start[1]);
}

function buildManifestYaml({ version, commit, policyVersion, files }) {
  const release = `${SOURCE}/releases/tag/v${version}`;
  const lines = [
    "# Generated by scripts/release.mjs. Do not hand-edit digests.",
    "# Re-run: node scripts/release.mjs generate",
    "name: loop-compass",
    `version: ${version}`,
    `source: ${SOURCE}`,
    `release: ${release}`,
    `commit: ${commit}`,
    "skill_schema: 1",
    `policy_version: ${policyVersion}`,
    "state_schema: 1",
    `minimum_policy_version: ${policyVersion}`,
    "files:",
  ];
  for (const rel of Object.keys(files).sort()) {
    lines.push(`  ${rel}: ${files[rel]}`);
  }
  lines.push("");
  return lines.join("\n");
}

function collectDigests() {
  const files = listSkillFiles();
  for (const required of REQUIRED_TOP_LEVEL) {
    if (!files.includes(required)) {
      die(`missing required skill file: ${required}`);
    }
  }
  const digests = {};
  for (const rel of files) {
    digests[rel] = sha256File(path.join(SKILL_DIR, rel));
  }
  return digests;
}

function cmdGenerate() {
  const version = readVersion();
  const commit = gitCommit();
  const policyVersion = readPolicyVersion(readFileSync(POLICY_PATH, "utf8"));
  const files = collectDigests();
  writeFileSync(
    MANIFEST_PATH,
    buildManifestYaml({ version, commit, policyVersion, files }),
    "utf8",
  );
  console.log(`wrote ${path.relative(ROOT, MANIFEST_PATH)}`);
  console.log(`version ${version}`);
  console.log(`commit  ${commit}`);
  console.log(`files   ${Object.keys(files).length}`);
}

function cmdValidate() {
  const version = readVersion();
  if (!existsSync(MANIFEST_PATH)) {
    die(`missing ${path.relative(ROOT, MANIFEST_PATH)}; run generate first`);
  }
  const manifest = parseManifest(readFileSync(MANIFEST_PATH, "utf8"));
  const policyVersion = readPolicyVersion(readFileSync(POLICY_PATH, "utf8"));
  const treeFiles = collectDigests();
  const errors = [];

  if (manifest.name !== "loop-compass") {
    errors.push(`name: expected loop-compass, got ${manifest.name}`);
  }
  if (manifest.version !== version) {
    errors.push(`version: VERSION=${version} but manifest.version=${manifest.version}`);
  }
  if (manifest.source !== SOURCE) {
    errors.push(`source: expected ${SOURCE}, got ${manifest.source}`);
  }
  if (manifest.release !== `${SOURCE}/releases/tag/v${version}`) {
    errors.push(
      `release: expected ${SOURCE}/releases/tag/v${version}, got ${manifest.release}`,
    );
  }
  if (String(manifest.policy_version) !== String(policyVersion)) {
    errors.push(
      `policy_version: marker=${policyVersion} manifest=${manifest.policy_version}`,
    );
  }
  if (String(manifest.minimum_policy_version) !== String(policyVersion)) {
    errors.push(
      `minimum_policy_version: expected ${policyVersion}, got ${manifest.minimum_policy_version}`,
    );
  }
  if (String(manifest.skill_schema) !== "1") {
    errors.push(`skill_schema: expected 1, got ${manifest.skill_schema}`);
  }
  if (String(manifest.state_schema) !== "1") {
    errors.push(`state_schema: expected 1, got ${manifest.state_schema}`);
  }

  const manifestPaths = new Set(Object.keys(manifest.files));
  const treePaths = new Set(Object.keys(treeFiles));

  for (const rel of treePaths) {
    if (!manifestPaths.has(rel)) {
      errors.push(`manifest missing file: ${rel}`);
    }
  }
  for (const rel of manifestPaths) {
    if (!treePaths.has(rel)) {
      errors.push(`manifest lists missing file: ${rel}`);
    } else if (manifest.files[rel] !== treeFiles[rel]) {
      errors.push(
        `digest mismatch: ${rel}\n  manifest: ${manifest.files[rel]}\n  tree:     ${treeFiles[rel]}`,
      );
    }
  }

  if (errors.length) {
    console.error("validate failed:");
    for (const err of errors) {
      console.error(`- ${err}`);
    }
    process.exit(1);
  }

  console.log("validate ok");
  console.log(`version ${version}`);
  console.log(`commit  ${manifest.commit}`);
  console.log(`files   ${manifestPaths.size}`);
  console.log(`policy  ${policyVersion}`);
}

function copyTree(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyTree(from, to);
    } else if (entry.isFile()) {
      copyFileSync(from, to);
    }
  }
}

function cmdPackage() {
  cmdValidate();
  const version = readVersion();
  const head = gitCommit();
  const distDir = path.join(ROOT, "dist");
  mkdirSync(distDir, { recursive: true });

  const archiveName = `loopcompass-v${version}.tar.gz`;
  const archivePath = path.join(distDir, archiveName);
  const staging = path.join(distDir, "staging");
  const releaseRoot = path.join(staging, "LoopCompass");

  rmSync(staging, { recursive: true, force: true });
  mkdirSync(path.join(releaseRoot, "skills"), { recursive: true });
  mkdirSync(path.join(releaseRoot, "docs"), { recursive: true });

  copyFileSync(VERSION_PATH, path.join(releaseRoot, "VERSION"));
  copyTree(SKILL_DIR, path.join(releaseRoot, "skills", "loop-compass"));
  // Pin packaged manifest commit to the tree being archived (HEAD), without
  // requiring a second git commit just to rewrite skills/.../manifest.yaml.
  const stagedManifest = path.join(releaseRoot, "skills", "loop-compass", "manifest.yaml");
  if (existsSync(stagedManifest) && head !== "unknown") {
    const text = readFileSync(stagedManifest, "utf8").replace(
      /^commit:\s*.+$/m,
      `commit: ${head}`,
    );
    writeFileSync(stagedManifest, text, "utf8");
  }
  for (const doc of readdirSync(path.join(ROOT, "docs"))) {
    if (doc.endsWith(".md")) {
      copyFileSync(
        path.join(ROOT, "docs", doc),
        path.join(releaseRoot, "docs", doc),
      );
    }
  }
  for (const name of ["LICENSE", "CHANGELOG.md", "README.md"]) {
    const p = path.join(ROOT, name);
    if (existsSync(p)) {
      copyFileSync(p, path.join(releaseRoot, name));
    }
  }

  rmSync(archivePath, { force: true });
  const tarResult = spawnSync(
    "tar",
    ["-czf", archivePath, "-C", staging, "LoopCompass"],
    { encoding: "utf8" },
  );
  if (tarResult.status !== 0 || !existsSync(archivePath)) {
    die(
      `failed to create archive with tar: ${tarResult.stderr || tarResult.stdout || "unknown error"}`,
    );
  }

  const digest = sha256File(archivePath);
  const sumsPath = path.join(distDir, "SHA256SUMS");
  writeFileSync(sumsPath, `${digest}  ${archiveName}\n`, "utf8");
  console.log(`wrote ${path.relative(ROOT, archivePath)}`);
  console.log(`wrote ${path.relative(ROOT, sumsPath)}`);
  console.log(`${digest}  ${archiveName}`);
}

function compareSemver(a, b) {
  const pa = a.split("-")[0].split(".").map((n) => Number(n));
  const pb = b.split("-")[0].split(".").map((n) => Number(n));
  for (let i = 0; i < 3; i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da < db) return -1;
    if (da > db) return 1;
  }
  return 0;
}

function cmdCheck(args) {
  const installedIdx = args.indexOf("--installed");
  const releaseIdx = args.indexOf("--release-manifest");
  if (installedIdx === -1 || releaseIdx === -1) {
    die(
      "check requires --installed <skill-dir> and --release-manifest <manifest.yaml>",
    );
  }
  const installedDir = path.resolve(args[installedIdx + 1] || "");
  const releaseManifestPath = path.resolve(args[releaseIdx + 1] || "");
  if (!existsSync(installedDir)) {
    die(`installed skill dir not found: ${installedDir}`);
  }
  if (!existsSync(releaseManifestPath)) {
    die(`release manifest not found: ${releaseManifestPath}`);
  }

  const installedManifestPath = path.join(installedDir, "manifest.yaml");
  if (!existsSync(installedManifestPath)) {
    die(`installed skill has no manifest.yaml: ${installedManifestPath}`);
  }

  const installed = parseManifest(readFileSync(installedManifestPath, "utf8"));
  const release = parseManifest(readFileSync(releaseManifestPath, "utf8"));

  console.log(`installed: ${installed.version} (commit ${installed.commit})`);
  console.log(`release:   ${release.version} (commit ${release.commit})`);
  console.log(
    `policy:    installed=${installed.policy_version} release=${release.policy_version}`,
  );
  console.log(
    `state:     installed=${installed.state_schema} release=${release.state_schema}`,
  );

  const cmp = compareSemver(installed.version, release.version);
  if (cmp === 0 && installed.commit === release.commit) {
    console.log("status: up to date");
    process.exit(0);
  }
  if (cmp < 0) {
    console.log(
      `status: behind (update available: ${installed.version} -> ${release.version})`,
    );
    process.exit(2);
  }
  if (cmp > 0) {
    console.log(
      `status: installed is newer than compared release (${installed.version} > ${release.version})`,
    );
    process.exit(3);
  }
  console.log("status: version match, commit differs");
  process.exit(4);
}

function printHelp() {
  console.log(`Usage: node scripts/release.mjs <command>

Commands:
  generate   Write skills/loop-compass/manifest.yaml
  validate   Verify VERSION, policy markers, and file digests
  package    Build dist/loopcompass-vVERSION.tar.gz and dist/SHA256SUMS
  check      Non-mutating compare of installed skill vs a release manifest
`);
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help") {
    printHelp();
    return;
  }
  switch (command) {
    case "generate":
      cmdGenerate();
      break;
    case "validate":
      cmdValidate();
      break;
    case "package":
      cmdPackage();
      break;
    case "check":
      cmdCheck(rest);
      break;
    default:
      die(`unknown command: ${command}`);
  }
}

main();
