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
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCanonicalManifest,
  LOOPCOMPASS_SOURCE,
  parseCanonicalManifest,
} from "./lib/skill-manifest.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SKILL_DIR = path.join(ROOT, "skills", "loop-compass");
const MANIFEST_PATH = path.join(SKILL_DIR, "manifest.yaml");
const VERSION_PATH = path.join(ROOT, "VERSION");
const POLICY_PATH = path.join(SKILL_DIR, "assets", "project-policy.md");
const SOURCE = LOOPCOMPASS_SOURCE;

const REQUIRED_TOP_LEVEL = [
  "SKILL.md",
  "agents/openai.yaml",
  "assets/project-policy.md",
  "assets/recovery-template.md",
  "assets/incident-template.md",
  "references/classification.md",
  "references/integration.md",
  "references/pii-sanitation.md",
  "references/redaction-audit.md",
  "scripts/redact-check.mjs",
];

function die(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function readStableRegularFile(filePath) {
  const before = lstatSync(filePath);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error("non-regular release file");
  }
  const descriptor = openSync(
    filePath,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0),
  );
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || !sameFile(before, opened)) {
      throw new Error("release file changed");
    }
    const raw = readFileSync(descriptor);
    const afterRead = fstatSync(descriptor);
    const afterPath = lstatSync(filePath);
    if (
      !sameFile(opened, afterRead) ||
      opened.size !== afterRead.size ||
      !sameFile(before, afterPath) ||
      afterPath.isSymbolicLink()
    ) {
      throw new Error("release file changed");
    }
    return { raw, mode: before.mode };
  } finally {
    closeSync(descriptor);
  }
}

function sha256File(filePath) {
  // Hash LF-normalized bytes so Windows working trees and Linux CI agree.
  // Git stores these skill files as LF (see git ls-files --eol); digests must match
  // the canonical text form, not platform checkout line endings.
  return sha256Buffer(canonicalTextBytes(readStableRegularFile(filePath).raw));
}

function readVersion() {
  if (!existsSync(VERSION_PATH)) {
    die(`missing ${path.relative(ROOT, VERSION_PATH)}`);
  }
  const version = readStableRegularFile(VERSION_PATH).raw.toString("utf8").trim();
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
  const before = lstatSync(dir);
  if (!before.isDirectory() || before.isSymbolicLink()) {
    throw new Error("unsafe skill directory");
  }
  const entries = readdirSync(dir).sort((a, b) => a.localeCompare(b));
  const files = [];
  for (const name of entries) {
    const rel = prefix ? `${prefix}/${name}` : name;
    const full = path.join(dir, name);
    const stat = lstatSync(full);
    if (name.startsWith(".")) throw new Error("hidden skill entry");
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      const nested = listSkillFiles(full, rel);
      if (!nested.length) throw new Error("empty skill directory");
      files.push(...nested);
      continue;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("non-regular skill entry");
    if (name === "manifest.yaml" && prefix === "") continue;
    files.push(rel.replaceAll("\\", "/"));
  }
  const after = lstatSync(dir);
  if (!sameFile(before, after) || after.isSymbolicLink()) {
    throw new Error("skill directory changed");
  }
  return files;
}

function parseManifest(text) {
  return parseCanonicalManifest(text);
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
  return buildCanonicalManifest({ version, commit, policyVersion, files });
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
  const policyVersion = readPolicyVersion(
    readStableRegularFile(POLICY_PATH).raw.toString("utf8"),
  );
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
  const manifest = parseManifest(
    readStableRegularFile(MANIFEST_PATH).raw.toString("utf8"),
  );
  const policyVersion = readPolicyVersion(
    readStableRegularFile(POLICY_PATH).raw.toString("utf8"),
  );
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

/**
 * Canonical text bytes for release archives and digests: LF newlines, no CR.
 * Binary (NUL) files are copied unchanged.
 * @param {Buffer} raw
 * @returns {Buffer}
 */
function canonicalTextBytes(raw) {
  if (raw.includes(0)) return raw;
  const asText = raw.toString("utf8");
  return Buffer.from(asText.replace(/\r\n/g, "\n").replace(/\r/g, "\n"), "utf8");
}

function sha256Buffer(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Copy a tree. When canonicalizeText is true, write LF-normalized text so
 * archive members match manifest digests byte-for-byte (not only after LF hash).
 * Windows worktrees may have CRLF even when git blobs are LF.
 */
function copyTree(src, dest, { canonicalizeText = false } = {}) {
  const before = lstatSync(src);
  if (!before.isDirectory() || before.isSymbolicLink()) {
    throw new Error("unsafe copy source");
  }
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src).sort()) {
    const from = path.join(src, name);
    const to = path.join(dest, name);
    const stat = lstatSync(from);
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      copyTree(from, to, { canonicalizeText });
    } else if (stat.isFile() && !stat.isSymbolicLink()) {
      const raw = readStableRegularFile(from).raw;
      writeFileSync(to, canonicalizeText ? canonicalTextBytes(raw) : raw);
    } else {
      throw new Error("non-regular copy source");
    }
  }
  const after = lstatSync(src);
  if (!sameFile(before, after) || after.isSymbolicLink()) {
    throw new Error("copy source changed");
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

  writeFileSync(
    path.join(releaseRoot, "VERSION"),
    canonicalTextBytes(readStableRegularFile(VERSION_PATH).raw),
  );
  // Canonicalize skill text so archive members match manifest digests as raw
  // bytes (consumer tools often hash files without LF normalization).
  copyTree(SKILL_DIR, path.join(releaseRoot, "skills", "loop-compass"), {
    canonicalizeText: true,
  });
  // Pin packaged manifest commit to the tree being archived (HEAD), without
  // requiring a second git commit just to rewrite skills/.../manifest.yaml.
  const stagedManifest = path.join(releaseRoot, "skills", "loop-compass", "manifest.yaml");
  if (existsSync(stagedManifest) && head !== "unknown") {
    const text = readStableRegularFile(stagedManifest).raw.toString("utf8").replace(
      /^commit:\s*.+$/m,
      `commit: ${head}`,
    );
    writeFileSync(stagedManifest, canonicalTextBytes(Buffer.from(text, "utf8")));
  }
  for (const doc of readdirSync(path.join(ROOT, "docs"))) {
    if (doc.endsWith(".md")) {
      writeFileSync(
        path.join(releaseRoot, "docs", doc),
        canonicalTextBytes(readStableRegularFile(path.join(ROOT, "docs", doc)).raw),
      );
    }
  }
  for (const name of ["LICENSE", "CHANGELOG.md", "README.md"]) {
    const p = path.join(ROOT, name);
    if (existsSync(p)) {
      writeFileSync(
        path.join(releaseRoot, name),
        canonicalTextBytes(readStableRegularFile(p).raw),
      );
    }
  }

  // Fail closed: staged skill files must match manifest digests as raw bytes.
  const stagedSkill = path.join(releaseRoot, "skills", "loop-compass");
  const stagedMan = parseManifest(
    readStableRegularFile(stagedManifest).raw.toString("utf8"),
  );
  for (const [rel, expected] of Object.entries(stagedMan.files)) {
    const actual = sha256Buffer(
      readStableRegularFile(path.join(stagedSkill, rel)).raw,
    );
    if (actual !== expected) {
      die(
        `package staging digest mismatch for ${rel}\n  manifest: ${expected}\n  staged:   ${actual}\n` +
          "skill files must be LF-canonical in the archive (see copyTree canonicalizeText)",
      );
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

  // SHA256SUMS for the archive uses raw bytes of the tarball (not text-normalized).
  const archiveRaw = readStableRegularFile(archivePath).raw;
  const digest = sha256Buffer(archiveRaw);
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

function sameManifestPayload(left, right) {
  const fields = [
    "name",
    "version",
    "source",
    "release",
    "skill_schema",
    "policy_version",
    "state_schema",
    "minimum_policy_version",
  ];
  return (
    fields.every((field) => String(left[field]) === String(right[field])) &&
    JSON.stringify(left.files) === JSON.stringify(right.files)
  );
}

function installedPayloadMatchesManifest(installedDir, manifest, manifestRaw) {
  const expectedFiles = Object.keys(manifest.files).sort();
  const expectedDirectories = new Set();
  for (const relative of expectedFiles) {
    let directory = path.posix.dirname(relative);
    while (directory !== ".") {
      expectedDirectories.add(directory);
      directory = path.posix.dirname(directory);
    }
  }
  function inventory() {
    const actualFiles = new Map();
    let valid = true;
    let manifestSeen = false;
    let manifestDigest = null;
    function visit(directory, prefix = "") {
      const before = lstatSync(directory);
      if (!before.isDirectory() || before.isSymbolicLink()) {
        throw new Error("unsafe installed directory");
      }
      for (const name of readdirSync(directory).sort()) {
        const relative = prefix ? `${prefix}/${name}` : name;
        const full = path.join(directory, name);
        const stat = lstatSync(full);
        if (name.startsWith(".")) valid = false;
        if (stat.isDirectory() && !stat.isSymbolicLink()) {
          if (!expectedDirectories.has(relative)) valid = false;
          visit(full, relative);
        } else if (stat.isFile() && !stat.isSymbolicLink()) {
          const raw = readStableRegularFile(full).raw;
          if (relative === "manifest.yaml") {
            manifestSeen = true;
            manifestDigest = sha256Buffer(raw);
          }
          else actualFiles.set(relative, sha256Buffer(raw));
        } else {
          valid = false;
        }
      }
      const after = lstatSync(directory);
      if (!sameFile(before, after) || after.isSymbolicLink()) {
        throw new Error("installed directory changed");
      }
    }
    visit(installedDir);
    return { actualFiles, valid, manifestSeen, manifestDigest };
  }
  const before = inventory();
  const expectedManifestDigest = sha256Buffer(manifestRaw);
  if (
    !before.valid ||
    !before.manifestSeen ||
    before.manifestDigest !== expectedManifestDigest
  ) {
    return false;
  }
  if (JSON.stringify([...before.actualFiles.keys()]) !== JSON.stringify(expectedFiles)) {
    return false;
  }
  if (
    !expectedFiles.every(
      (relative) => before.actualFiles.get(relative) === manifest.files[relative],
    )
  ) {
    return false;
  }
  const after = inventory();
  return (
    after.valid &&
    after.manifestSeen &&
    after.manifestDigest === expectedManifestDigest &&
    JSON.stringify([...after.actualFiles]) === JSON.stringify([...before.actualFiles])
  );
}

function manifestPayloadBytes(raw) {
  const text = raw.toString("utf8");
  const matches = text.match(/^commit:\s*.+$/gm) || [];
  if (matches.length !== 1) return null;
  return text.replace(/^commit:\s*.+$/m, "commit: <provenance>");
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
    die("installed skill directory is unavailable");
  }
  if (!existsSync(releaseManifestPath)) {
    die("release manifest is unavailable");
  }

  const installedManifestPath = path.join(installedDir, "manifest.yaml");
  if (!existsSync(installedManifestPath)) {
    die("installed skill manifest is unavailable");
  }

  let installedManifestRaw;
  let releaseManifestRaw;
  try {
    installedManifestRaw = readStableRegularFile(installedManifestPath).raw;
    releaseManifestRaw = readStableRegularFile(releaseManifestPath).raw;
  } catch {
    die("manifest failed regular-file integrity validation");
  }
  const installed = parseManifest(installedManifestRaw.toString("utf8"));
  const release = parseManifest(releaseManifestRaw.toString("utf8"));
  let installedPayloadValid = false;
  try {
    installedPayloadValid = installedPayloadMatchesManifest(
      installedDir,
      installed,
      installedManifestRaw,
    );
  } catch {
    die("installed skill failed stable-tree integrity validation");
  }
  if (!installedPayloadValid) {
    die("installed skill payload does not match its manifest");
  }

  console.log(`installed: ${installed.version} (commit ${installed.commit})`);
  console.log(`release:   ${release.version} (commit ${release.commit})`);
  console.log(
    `policy:    installed=${installed.policy_version} release=${release.policy_version}`,
  );
  console.log(
    `state:     installed=${installed.state_schema} release=${release.state_schema}`,
  );

  const cmp = compareSemver(installed.version, release.version);
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
  if (
    manifestPayloadBytes(installedManifestRaw) === null ||
    manifestPayloadBytes(installedManifestRaw) !== manifestPayloadBytes(releaseManifestRaw)
  ) {
    die("installed manifest bytes do not match release payload");
  }
  if (sameManifestPayload(installed, release)) {
    console.log("status: up to date");
    process.exit(0);
  }
  console.log("status: version match, payload differs");
  process.exit(4);
}

/**
 * Stage a project-scope skill install into one or more host skill directories.
 * Does not write policy or touch .loopcompass state.
 *
 *   node scripts/release.mjs stage-install --project <dir> --hosts agents,claude
 * Host tokens: agents -> .agents/skills/loop-compass
 *              claude -> .claude/skills/loop-compass
 *              skills -> skills/loop-compass
 */
function cmdStageInstall(args) {
  const projectIdx = args.indexOf("--project");
  const hostsIdx = args.indexOf("--hosts");
  if (projectIdx === -1) {
    die("stage-install requires --project <repo-root>");
  }
  const project = path.resolve(args[projectIdx + 1] || "");
  if (!existsSync(project)) {
    die(`project not found: ${project}`);
  }
  const hostsRaw = hostsIdx === -1 ? "agents,claude" : args[hostsIdx + 1] || "";
  const hosts = hostsRaw.split(",").map((s) => s.trim()).filter(Boolean);
  const map = {
    agents: path.join(".agents", "skills", "loop-compass"),
    claude: path.join(".claude", "skills", "loop-compass"),
    skills: path.join("skills", "loop-compass"),
  };
  for (const h of hosts) {
    if (!map[h]) die(`unknown host token: ${h} (use agents, claude, skills)`);
    const dest = path.join(project, map[h]);
    rmSync(dest, { recursive: true, force: true });
    copyTree(SKILL_DIR, dest, { canonicalizeText: true });
    console.log(`staged ${path.relative(project, dest)}`);
  }
  console.log("stage-install ok (state and policy untouched)");
}

/**
 * Maintainer diagnostic: compare source-tree manifest.commit to git HEAD.
 *
 * NOT a consumer install gate. Consumers trust the published release archive
 * (package rewrites manifest.commit to the tag SHA inside the tarball).
 *
 *   node scripts/release.mjs pin-check
 *   node scripts/release.mjs pin-check --strict   # maintainer-only; fails on lag
 */
function cmdPinCheck(args) {
  const strict = args.includes("--strict");
  if (!existsSync(MANIFEST_PATH)) {
    die(`missing ${path.relative(ROOT, MANIFEST_PATH)}`);
  }
  const manifest = parseManifest(
    readStableRegularFile(MANIFEST_PATH).raw.toString("utf8"),
  );
  const head = gitCommit();
  console.log(`manifest.commit ${manifest.commit}`);
  console.log(`git HEAD         ${head}`);
  console.log(
    "note: maintainer diagnostic only; consumers use the published archive pin",
  );
  if (head === "unknown") {
    if (strict) die("cannot resolve git HEAD");
    console.log("status: skip (no git)");
    return;
  }
  if (manifest.commit === head) {
    console.log("status: pin matches HEAD");
    return;
  }
  // Self-referential commit hashes cannot equal the commit that contains them
  // after generate+commit. package() rewrites the archived manifest.commit to
  // HEAD so the published tarball is authoritative for consumers.
  console.log(
    "status: source pin lags HEAD (expected on tag checkouts; package rewrites archive pin)",
  );
  if (strict) {
    die(
      "strict pin-check failed on source checkout. This is NOT a consumer defect. " +
        "Published archives from `package` set commit to the tag SHA. " +
        "Consumers must verify SHA256SUMS + per-file digests from the release assets, " +
        "not pin-check --strict on a git tag worktree.",
    );
  }
}

function printHelp() {
  console.log(`Usage: node scripts/release.mjs <command>

Commands:
  generate       Write skills/loop-compass/manifest.yaml
  validate       Verify VERSION, policy markers, and file digests
  package        Build dist/loopcompass-vVERSION.tar.gz and dist/SHA256SUMS
  check          Non-mutating compare of installed skill vs a release manifest
  stage-install  Copy skill unit into project host paths (no state/policy writes)
  pin-check      Maintainer: source manifest.commit vs HEAD (not a consumer gate)
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
    case "stage-install":
      cmdStageInstall(rest);
      break;
    case "pin-check":
      cmdPinCheck(rest);
      break;
    default:
      die(`unknown command: ${command}`);
  }
}

try {
  main();
} catch {
  die("release operation failed stable filesystem validation");
}
