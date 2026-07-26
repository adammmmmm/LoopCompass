#!/usr/bin/env node
/**
 * Conservative, local, non-mutating audit of committed LoopCompass state.
 *
 * Usage:
 *   node <installed-skill>/scripts/redact-check.mjs \
 *     --project <repo-root> --mode <audit|enforce>
 *
 * Exit codes:
 *   0  scan completed (audit findings are informational; enforce found no blocks)
 *   1  enforce mode found one or more blocking categories
 *   2  invocation, configuration, or filesystem preflight failed safely
 */
import {
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { constants as fsConstants } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_CONFIG_BYTES = 64 * 1024;
const SCAN_DIRS = ["incidents", "recoveries", "receipts", "terminal-receipts"];
const ROLE_NAMES = new Set([
  "operator",
  "user",
  "customer",
  "reviewer",
  "worker",
]);
const TEST_DOMAINS = new Set(["example.com", "example.net", "example.org"]);

const RULES = {
  BLOCK_EMAIL: "block",
  BLOCK_PERSONAL_HOME_PATH: "block",
  BLOCK_CREDENTIAL_URL: "block",
  BLOCK_KNOWN_TOKEN: "block",
  BLOCK_CREDENTIAL_VALUE: "block",
  BLOCK_PROJECT_PATTERN: "block",
  BLOCK_SYMLINK: "block",
  BLOCK_UNSUPPORTED_ENTRY: "block",
  WARN_POSSIBLE_HANDLE: "warn",
  WARN_POSSIBLE_PHONE: "warn",
  WARN_PROJECT_PATTERN: "warn",
  WARN_BINARY_SKIPPED: "warn",
  WARN_SIZE_LIMIT: "warn",
};

function fail(code) {
  console.error(`error ${code}`);
  process.exit(2);
}

function parseArgs(argv) {
  let project = null;
  let mode = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--project" && project === null) {
      project = argv[++index] || null;
    } else if (arg === "--mode" && mode === null) {
      mode = argv[++index] || null;
    } else {
      fail("INVALID_ARGUMENTS");
    }
  }
  if (!project || !["audit", "enforce"].includes(mode)) {
    fail("INVALID_ARGUMENTS");
  }
  return { project: path.resolve(project), mode };
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      !relative.startsWith(`..${path.sep}`) &&
      relative !== "..")
  );
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function assertStableDirectory(directory, expected) {
  const current = lstatSync(directory);
  if (
    !current.isDirectory() ||
    current.isSymbolicLink() ||
    !sameFile(current, expected)
  ) {
    throw new Error("directory identity changed");
  }
}

function readStableFile(filePath, expected, maxBytes) {
  const noFollow = fsConstants.O_NOFOLLOW || 0;
  const descriptor = openSync(filePath, fsConstants.O_RDONLY | noFollow);
  try {
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile() ||
      !sameFile(opened, expected) ||
      opened.size > maxBytes
    ) {
      throw new Error("unsafe file identity");
    }
    const raw = readFileSync(descriptor);
    const afterRead = fstatSync(descriptor);
    if (!sameFile(opened, afterRead) || opened.size !== afterRead.size) {
      throw new Error("file changed while reading");
    }
    return raw;
  } finally {
    closeSync(descriptor);
  }
}

function verifyStableFileBlob(filePath, expected, objectFormat, objectId) {
  const noFollow = fsConstants.O_NOFOLLOW || 0;
  const descriptor = openSync(filePath, fsConstants.O_RDONLY | noFollow);
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || !sameFile(opened, expected)) {
      throw new Error("unsafe file identity");
    }
    const hash = createHash(objectFormat).update(`blob ${opened.size}\0`);
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    while (position < opened.size) {
      const bytes = readSync(
        descriptor,
        buffer,
        0,
        Math.min(buffer.length, opened.size - position),
        position,
      );
      if (bytes <= 0) throw new Error("short file read");
      hash.update(buffer.subarray(0, bytes));
      position += bytes;
    }
    const afterRead = fstatSync(descriptor);
    if (
      !sameFile(opened, afterRead) ||
      opened.size !== afterRead.size ||
      hash.digest("hex") !== objectId
    ) {
      throw new Error("file differs from HEAD");
    }
  } finally {
    closeSync(descriptor);
  }
}

function parseScalar(raw) {
  const value = raw.trim();
  if (!value) throw new Error("empty scalar");
  if (value.startsWith('"')) {
    if (!value.endsWith('"')) throw new Error("unterminated string");
    return JSON.parse(value);
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'")) throw new Error("unterminated string");
    return value.slice(1, -1).replaceAll("''", "'");
  }
  if (value.includes("#")) throw new Error("quote values containing comments");
  return value;
}

function isEscaped(source, index) {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function hasUnsafeQuantifier(source) {
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if ("*+?".includes(character) && !isEscaped(source, index)) return true;
    if (character === "{" && !isEscaped(source, index)) {
      const close = source.indexOf("}", index + 1);
      if (close === -1 || isEscaped(source, close)) return true;
      const count = source.slice(index + 1, close);
      if (!/^[1-9]\d{0,2}$/.test(count) || Number(count) > 256) return true;
      index = close;
    } else if (character === "}" && !isEscaped(source, index)) {
      return true;
    }
  }
  return false;
}

function compileProjectPattern(entry) {
  const keys = new Set(Object.keys(entry));
  for (const key of keys) {
    if (!["id", "literal", "regex", "severity", "flags"].includes(key)) {
      throw new Error("unknown pattern key");
    }
  }
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(entry.id || "")) {
    throw new Error("invalid pattern id");
  }
  const severity = entry.severity || "block";
  if (!["block", "warn"].includes(severity)) throw new Error("invalid severity");
  const flags = entry.flags || "";
  if (!/^(?:i|m|u|im|iu|mu|imu)?$/.test(flags)) throw new Error("invalid flags");
  if (Boolean(entry.literal) === Boolean(entry.regex)) {
    throw new Error("pattern requires exactly one of literal or regex");
  }

  let source;
  if (entry.literal) {
    if (entry.literal.length < 3 || entry.literal.length > 256) {
      throw new Error("literal length out of range");
    }
    source = entry.literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  } else {
    source = entry.regex;
    if (
      source.length < 3 ||
      source.length > 256 ||
      !(
        source.startsWith("^") ||
        source.endsWith("$") ||
        source.includes("\\b")
      ) ||
      /[()]/.test(source) ||
      /\\[1-9]/.test(source) ||
      hasUnsafeQuantifier(source)
    ) {
      throw new Error("regex is not safely bounded");
    }
  }
  return {
    severity,
    regex: new RegExp(source, `${flags}g`),
  };
}

function parseConfig(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let version = null;
  let inPatterns = false;
  let current = null;
  const entries = [];

  function finishCurrent() {
    if (current) entries.push(current);
    current = null;
  }

  for (const raw of lines) {
    if (!raw.trim() || /^\s*#/.test(raw)) continue;
    const versionMatch = raw.match(/^version:\s*(.+?)\s*$/);
    if (versionMatch && !inPatterns && version === null) {
      version = Number(parseScalar(versionMatch[1]));
      continue;
    }
    if (/^patterns:\s*$/.test(raw) && !inPatterns) {
      inPatterns = true;
      continue;
    }
    if (!inPatterns) throw new Error("invalid top-level config");

    const item = raw.match(/^  -\s+([a-z_]+):\s*(.+?)\s*$/);
    if (item) {
      finishCurrent();
      current = { [item[1]]: parseScalar(item[2]) };
      continue;
    }
    const property = raw.match(/^    ([a-z_]+):\s*(.+?)\s*$/);
    if (!property || !current) throw new Error("invalid pattern entry");
    if (Object.hasOwn(current, property[1])) throw new Error("duplicate pattern key");
    current[property[1]] = parseScalar(property[2]);
  }
  finishCurrent();
  if (version !== 1 || !inPatterns) throw new Error("unsupported config");
  if (entries.length > 100) throw new Error("too many patterns");
  const ids = new Set();
  return entries.map((entry) => {
    if (ids.has(entry.id)) throw new Error("duplicate pattern id");
    ids.add(entry.id);
    return compileProjectPattern(entry);
  });
}

function loadProjectPatterns(projectRoot, stateRoot, trackedConfig) {
  const configPath = path.join(stateRoot, "redaction.yaml");
  if (!trackedConfig) return [];
  if (!existsSync(configPath)) throw new Error("tracked config unavailable");
  const before = lstatSync(configPath);
  if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_CONFIG_BYTES) {
    throw new Error("unsafe config");
  }
  const realConfig = realpathSync(configPath);
  if (!isWithin(projectRoot, realConfig) || !isWithin(stateRoot, realConfig)) {
    throw new Error("config escaped root");
  }
  const raw = readStableFile(realConfig, before, MAX_CONFIG_BYTES);
  if (gitBlobId(raw, trackedConfig.objectFormat) !== trackedConfig.object) {
    throw new Error("config differs from HEAD");
  }
  const after = lstatSync(configPath);
  if (!sameFile(before, after) || after.isSymbolicLink()) {
    throw new Error("config identity changed");
  }
  if (raw.includes(0)) throw new Error("binary config");
  return parseConfig(raw.toString("utf8"));
}

function allowedEmailDomain(domain) {
  const lower = domain.toLowerCase();
  return (
    TEST_DOMAINS.has(lower) ||
    [...TEST_DOMAINS].some((domain) => lower.endsWith(`.${domain}`)) ||
    lower.endsWith(".example") ||
    lower.endsWith(".test") ||
    lower.endsWith(".invalid")
  );
}

function safePlaceholder(value) {
  return (
    ROLE_NAMES.has(value.toLowerCase()) ||
    /^(?:<[^>]+>|\$\{?[A-Z][A-Z0-9_]*\}?|x+|\*+|redacted|example|placeholder)$/i.test(
      value,
    )
  );
}

function increment(counts, rule, amount = 1) {
  counts.set(rule, (counts.get(rule) || 0) + amount);
}

function countMatches(text, regex, predicate = () => true) {
  let count = 0;
  for (const match of text.matchAll(regex)) {
    if (predicate(match)) count += 1;
  }
  return count;
}

function scanText(text, counts, projectPatterns) {
  const emailCount = countMatches(
    text,
    /\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,63})\b/giu,
    (match) => !allowedEmailDomain(match[1]),
  );
  if (emailCount) increment(counts, "BLOCK_EMAIL", emailCount);

  const homeCount = countMatches(
    text,
    /(?:\/Users\/|\/home\/|[A-Z]:\\Users\\)([A-Za-z0-9._-]+)(?:[\\/]|$)/giu,
    (match) => !ROLE_NAMES.has(match[1].toLowerCase()),
  );
  if (homeCount) increment(counts, "BLOCK_PERSONAL_HOME_PATH", homeCount);

  const credentialUrlCount = countMatches(
    text,
    /\bhttps?:\/\/[^\s<>"']+/giu,
    (match) => {
      if (/^https?:\/\/[^/\s:@]+:[^/\s@]+@/iu.test(match[0])) return true;
      for (const parameter of match[0].matchAll(
        /[?&](?:access_?token|api_?key|auth|password|secret)=([^&#\s]+)/giu,
      )) {
        if (!safePlaceholder(parameter[1])) return true;
      }
      return false;
    },
  );
  if (credentialUrlCount) increment(counts, "BLOCK_CREDENTIAL_URL", credentialUrlCount);

  const tokenPatterns = [
    /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
    /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
    /\bxox[baprs]-[A-Za-z0-9-]{12,}\b/g,
    /\bAKIA[0-9A-Z]{16}\b/g,
    /\bAIza[0-9A-Za-z_-]{30,}\b/g,
    /\bsk-[A-Za-z0-9_-]{20,}\b/g,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  ];
  let tokenCount = 0;
  for (const regex of tokenPatterns) tokenCount += countMatches(text, regex);
  if (tokenCount) increment(counts, "BLOCK_KNOWN_TOKEN", tokenCount);

  const credentialValueCount = countMatches(
    text,
    /(?<![?&])\b(?:access[-_]?token|api[-_]?key|auth[-_]?token|client[-_]?secret|password|private[-_]?key|secret|token)\b["']?\s*(?:=|:)\s*(?:"([^"\r\n]{1,1024})"|'([^'\r\n]{1,1024})'|([^\s,;#]{8,1024}))/giu,
    (match) => !safePlaceholder(match[1] || match[2] || match[3]),
  );
  if (credentialValueCount) {
    increment(counts, "BLOCK_CREDENTIAL_VALUE", credentialValueCount);
  }

  const bearerCount = countMatches(
    text,
    /\bBearer\s+(?:"([^"\r\n]{1,1024})"|'([^'\r\n]{1,1024})'|([A-Za-z0-9._~+/$:@!-]{12,512}))/giu,
    (match) => !safePlaceholder(match[1] || match[2] || match[3]),
  );
  if (bearerCount) increment(counts, "BLOCK_CREDENTIAL_VALUE", bearerCount);

  const phoneCount = countMatches(
    text,
    /(?:^|[^\d])(?:\+?\d{1,3}[-.\s])?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}(?!\d)/g,
  );
  if (phoneCount) increment(counts, "WARN_POSSIBLE_PHONE", phoneCount);

  const handleCount = countMatches(
    text,
    /(?:^|[\s([])@([a-z][a-z0-9_-]{2,30})\b/giu,
    (match) => !ROLE_NAMES.has(match[1].toLowerCase()),
  );
  if (handleCount) increment(counts, "WARN_POSSIBLE_HANDLE", handleCount);

  for (const pattern of projectPatterns) {
    pattern.regex.lastIndex = 0;
    const matches = countMatches(text, pattern.regex);
    if (!matches) continue;
    increment(
      counts,
      pattern.severity === "block" ? "BLOCK_PROJECT_PATTERN" : "WARN_PROJECT_PATTERN",
      matches,
    );
  }
}

function cleanGitEnvironment() {
  const environment = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("GIT_")) environment[key] = value;
  }
  environment.GIT_NO_LAZY_FETCH = "1";
  environment.GIT_OPTIONAL_LOCKS = "0";
  environment.LC_ALL = "C";
  return environment;
}

function runRawGit(projectRoot, args, maxBuffer = 32 * 1024 * 1024) {
  const result = spawnSync("git", ["--no-replace-objects", ...args], {
    cwd: path.parse(projectRoot).root,
    encoding: null,
    maxBuffer,
    windowsHide: true,
    env: cleanGitEnvironment(),
  });
  if (result.status !== 0 || result.error) throw new Error("git preflight failed");
  return result.stdout;
}

function repositoryContext(projectRoot) {
  const prefix = ["-C", projectRoot];
  const top = runRawGit(projectRoot, [...prefix, "rev-parse", "--show-toplevel"])
    .toString("utf8")
    .trim();
  if (realpathSync(top) !== projectRoot) throw new Error("project is not repository root");
  const gitDirPath = runRawGit(projectRoot, [
    ...prefix,
    "rev-parse",
    "--absolute-git-dir",
  ])
    .toString("utf8")
    .trim();
  const gitDir = realpathSync(gitDirPath);
  const gitDirStat = lstatSync(gitDir);
  if (!gitDirStat.isDirectory() || gitDirStat.isSymbolicLink()) {
    throw new Error("unsafe git directory");
  }
  const bound = ["--git-dir", gitDir, "--work-tree", projectRoot];
  const head = runRawGit(projectRoot, [...bound, "rev-parse", "--verify", "HEAD^{commit}"])
    .toString("ascii")
    .trim();
  const objectFormat = runRawGit(projectRoot, [
    ...bound,
    "rev-parse",
    "--show-object-format",
  ])
    .toString("ascii")
    .trim();
  if (!["sha1", "sha256"].includes(objectFormat)) throw new Error("unsupported object format");
  return { bound, gitDir, gitDirStat, head, objectFormat };
}

function runGit(projectRoot, repository, args, maxBuffer = 32 * 1024 * 1024) {
  return runRawGit(projectRoot, [...repository.bound, ...args], maxBuffer);
}

function statePaths() {
  return [
    ...SCAN_DIRS.map((name) => `.loopcompass/${name}`),
    ".loopcompass/redaction.yaml",
  ];
}

function assertCleanState(projectRoot, repository) {
  const output = runGit(projectRoot, repository, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--",
    ...statePaths(),
  ]);
  if (output.length) throw new Error("committed state differs from HEAD");
}

function committedEntries(projectRoot, repository) {
  const output = runGit(projectRoot, repository, [
    "ls-tree",
    "-rz",
    "--full-tree",
    repository.head,
    "--",
    ...statePaths(),
  ]);
  return output
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((record) => {
      const match = record.match(/^(\d{6}) ([a-z]+) ([0-9a-f]{40,64})\t([\s\S]+)$/);
      if (!match) throw new Error("invalid git tree entry");
      return { mode: match[1], type: match[2], object: match[3], name: match[4] };
    });
}

function laneFilesystemEntries(stateRoot) {
  const entries = [];
  function visit(candidate, relative) {
    const before = lstatSync(candidate);
    const portable = relative.replaceAll("\\", "/");
    if (before.isSymbolicLink()) {
      entries.push(`symlink:${portable}`);
      return;
    }
    if (before.isFile()) {
      entries.push(`file:${portable}`);
      return;
    }
    if (!before.isDirectory()) throw new Error("unsupported state node");
    entries.push(`directory:${portable}`);
    for (const name of readdirSync(candidate).sort()) {
      visit(path.join(candidate, name), `${relative}/${name}`);
    }
    assertStableDirectory(candidate, before);
  }

  for (const name of SCAN_DIRS) {
    const candidate = path.join(stateRoot, name);
    if (existsSync(candidate)) visit(candidate, `.loopcompass/${name}`);
  }
  const config = path.join(stateRoot, "redaction.yaml");
  if (existsSync(config)) visit(config, ".loopcompass/redaction.yaml");
  return entries.sort();
}

function assertExactStateInventory(stateRoot, entries) {
  const tracked = new Set();
  for (const entry of entries) {
    tracked.add(
      `${entry.mode === "120000" ? "symlink" : "file"}:${entry.name}`,
    );
    if (entry.name === ".loopcompass/redaction.yaml") continue;
    let directory = path.posix.dirname(entry.name);
    while (directory !== ".loopcompass") {
      tracked.add(`directory:${directory}`);
      directory = path.posix.dirname(directory);
    }
  }
  const actual = stateRoot ? laneFilesystemEntries(stateRoot) : [];
  if (JSON.stringify(actual) !== JSON.stringify([...tracked].sort())) {
    throw new Error("state inventory differs from HEAD");
  }
}

function gitBlobId(raw, objectFormat) {
  return createHash(objectFormat)
    .update(`blob ${raw.length}\0`)
    .update(raw)
    .digest("hex");
}

function readTrackedFile(projectRoot, stateRoot, repository, entry) {
  if (entry.mode === "120000" || entry.type !== "blob" || entry.mode === "160000") {
    throw new Error("unsupported tracked entry");
  }
  const candidate = path.join(projectRoot, entry.name);
  if (!isWithin(stateRoot, candidate)) throw new Error("tracked path escaped state");
  const before = lstatSync(candidate);
  if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_FILE_BYTES) {
    throw new Error("unsafe tracked file");
  }
  const realCandidate = realpathSync(candidate);
  if (!isWithin(projectRoot, realCandidate) || !isWithin(stateRoot, realCandidate)) {
    throw new Error("real path escaped root");
  }
  const raw = readStableFile(realCandidate, before, MAX_FILE_BYTES);
  const after = lstatSync(candidate);
  if (!sameFile(before, after) || after.isSymbolicLink()) {
    throw new Error("tracked file identity changed");
  }
  if (gitBlobId(raw, repository.objectFormat) !== entry.object) {
    throw new Error("tracked file differs from HEAD");
  }
  return raw;
}

function scanCommittedState(projectRoot, stateRoot, repository, entries, counts, projectPatterns, stats) {
  for (const entry of entries) {
    if (entry.name === ".loopcompass/redaction.yaml") continue;
    // Git paths are canonical durable filenames. Never include them in diagnostics.
    scanText(entry.name, counts, projectPatterns);
    if (entry.mode === "120000") {
      increment(counts, "BLOCK_SYMLINK");
      stats.skipped += 1;
      continue;
    }
    if (entry.type !== "blob" || entry.mode === "160000") {
      increment(counts, "BLOCK_UNSUPPORTED_ENTRY");
      stats.skipped += 1;
      continue;
    }
    const candidate = path.join(projectRoot, entry.name);
    const stat = lstatSync(candidate);
    if (stat.size > MAX_FILE_BYTES) {
      const realCandidate = realpathSync(candidate);
      if (
        !isWithin(projectRoot, realCandidate) ||
        !isWithin(stateRoot, realCandidate) ||
        !sameFile(stat, lstatSync(realCandidate))
      ) {
        throw new Error("real path escaped root");
      }
      verifyStableFileBlob(
        realCandidate,
        stat,
        repository.objectFormat,
        entry.object,
      );
      const after = lstatSync(candidate);
      if (!sameFile(stat, after) || after.isSymbolicLink()) {
        throw new Error("tracked file identity changed");
      }
      increment(counts, "WARN_SIZE_LIMIT");
      stats.skipped += 1;
      continue;
    }
    const raw = readTrackedFile(projectRoot, stateRoot, repository, entry);
    if (raw.includes(0)) {
      increment(counts, "WARN_BINARY_SKIPPED");
      stats.skipped += 1;
      continue;
    }
    stats.scanned += 1;
    scanText(raw.toString("utf8"), counts, projectPatterns);
  }
}

function main() {
  const { project, mode } = parseArgs(process.argv.slice(2));
  try {
    if (!existsSync(project)) fail("PROJECT_UNAVAILABLE");
    const projectBefore = lstatSync(project);
    if (!projectBefore.isDirectory() || projectBefore.isSymbolicLink()) {
      fail("UNSAFE_PROJECT_ROOT");
    }
    const projectRoot = realpathSync(project);
    const resolvedProject = lstatSync(projectRoot);
    if (!sameFile(projectBefore, resolvedProject)) fail("UNSAFE_PROJECT_ROOT");
    const statePath = path.join(projectRoot, ".loopcompass");
    let stateRoot = null;
    let stateBefore = null;
    if (existsSync(statePath)) {
      stateBefore = lstatSync(statePath);
      if (!stateBefore.isDirectory() || stateBefore.isSymbolicLink()) {
        fail("UNSAFE_STATE_ROOT");
      }
      stateRoot = realpathSync(statePath);
      if (!isWithin(projectRoot, stateRoot)) fail("STATE_ROOT_ESCAPE");
      const resolvedState = lstatSync(stateRoot);
      if (!sameFile(stateBefore, resolvedState)) fail("UNSAFE_STATE_ROOT");
    }

    const repository = repositoryContext(projectRoot);
    assertCleanState(projectRoot, repository);
    const entries = committedEntries(projectRoot, repository);
    assertExactStateInventory(stateRoot, entries);
    const trackedConfig = entries.find(
      (entry) => entry.name === ".loopcompass/redaction.yaml",
    );
    const projectPatterns =
      stateRoot && trackedConfig
        ? loadProjectPatterns(projectRoot, stateRoot, {
            ...trackedConfig,
            objectFormat: repository.objectFormat,
          })
        : [];
    const counts = new Map();
    const stats = { scanned: 0, skipped: 0 };
    if (!stateRoot && entries.length) throw new Error("tracked state unavailable");
    if (stateRoot) {
      scanCommittedState(
        projectRoot,
        stateRoot,
        repository,
        entries,
        counts,
        projectPatterns,
        stats,
      );
    }
    assertCleanState(projectRoot, repository);
    assertExactStateInventory(stateRoot, entries);
    assertStableDirectory(projectRoot, projectBefore);
    if (stateRoot) assertStableDirectory(statePath, stateBefore);
    assertStableDirectory(repository.gitDir, repository.gitDirStat);

    console.log(`loopcompass-redaction ${mode}`);
    console.log(`files_scanned ${stats.scanned}`);
    console.log(`files_skipped ${stats.skipped}`);
    for (const rule of Object.keys(RULES).sort()) {
      const count = counts.get(rule) || 0;
      if (count) console.log(`${RULES[rule]} ${rule} ${count}`);
    }
    const blocks = [...counts].reduce(
      (sum, [rule, count]) => sum + (RULES[rule] === "block" ? count : 0),
      0,
    );
    const warnings = [...counts].reduce(
      (sum, [rule, count]) => sum + (RULES[rule] === "warn" ? count : 0),
      0,
    );
    if (blocks || warnings) {
      console.log(
        mode === "audit"
          ? "result findings_audit_only"
          : blocks
            ? "result blocked"
            : "result warnings_only",
      );
    } else {
      console.log("result pass");
    }
    if (mode === "enforce" && blocks) process.exit(1);
  } catch {
    fail("SCAN_FAILED");
  }
}

main();
