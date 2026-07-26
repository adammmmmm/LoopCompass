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
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
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
  "root",
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
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
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
      /(^|[^\\])[*+]/.test(source) ||
      /\{\d+,\}/.test(source) ||
      [...source.matchAll(/\{\d+(?:,(\d+))?\}/g)].some(
        (match) => match[1] && Number(match[1]) > 256,
      )
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

function loadProjectPatterns(projectRoot, stateRoot) {
  const configPath = path.join(stateRoot, "redaction.yaml");
  if (!existsSync(configPath)) return [];
  const stat = lstatSync(configPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_CONFIG_BYTES) {
    throw new Error("unsafe config");
  }
  const realConfig = realpathSync(configPath);
  if (!isWithin(projectRoot, realConfig) || !isWithin(stateRoot, realConfig)) {
    throw new Error("config escaped root");
  }
  const raw = readFileSync(realConfig);
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
    /\bhttps?:\/\/(?:[^/\s:@]+:[^/\s@]+@|[^\s?#]+[?&](?:access_?token|api_?key|auth|password|secret)=([^&#\s]+))/giu,
    (match) => !match[1] || !safePlaceholder(match[1]),
  );
  if (credentialUrlCount) increment(counts, "BLOCK_CREDENTIAL_URL", credentialUrlCount);

  const tokenPatterns = [
    /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
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
    /\b(?:access[-_]?token|api[-_]?key|auth[-_]?token|client[-_]?secret|password|private[-_]?key|secret|token)\b\s*(?:=|:)\s*["']?([A-Za-z0-9+/_.,-]{8,})["']?/giu,
    (match) => !safePlaceholder(match[1]),
  );
  if (credentialValueCount) {
    increment(counts, "BLOCK_CREDENTIAL_VALUE", credentialValueCount);
  }

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

function scanTree(scanRoot, projectRoot, stateRoot, counts, projectPatterns, stats) {
  const stack = [scanRoot];
  while (stack.length) {
    const directory = stack.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (!isWithin(stateRoot, candidate)) {
        throw new Error("path escaped state root");
      }

      // Filenames are durable surfaces too. Never include them in diagnostics.
      scanText(entry.name, counts, projectPatterns);
      const stat = lstatSync(candidate);
      if (stat.isSymbolicLink()) {
        increment(counts, "BLOCK_SYMLINK");
        stats.skipped += 1;
        continue;
      }
      const realCandidate = realpathSync(candidate);
      if (!isWithin(projectRoot, realCandidate) || !isWithin(stateRoot, realCandidate)) {
        throw new Error("real path escaped root");
      }
      if (stat.isDirectory()) {
        stack.push(realCandidate);
        continue;
      }
      if (!stat.isFile()) continue;
      if (stat.size > MAX_FILE_BYTES) {
        increment(counts, "WARN_SIZE_LIMIT");
        stats.skipped += 1;
        continue;
      }
      const raw = readFileSync(realCandidate);
      if (raw.includes(0)) {
        increment(counts, "WARN_BINARY_SKIPPED");
        stats.skipped += 1;
        continue;
      }
      stats.scanned += 1;
      scanText(raw.toString("utf8"), counts, projectPatterns);
    }
  }
}

function main() {
  const { project, mode } = parseArgs(process.argv.slice(2));
  try {
    if (!existsSync(project)) fail("PROJECT_UNAVAILABLE");
    const projectStat = lstatSync(project);
    if (!projectStat.isDirectory() || projectStat.isSymbolicLink()) {
      fail("UNSAFE_PROJECT_ROOT");
    }
    const projectRoot = realpathSync(project);
    const statePath = path.join(projectRoot, ".loopcompass");
    if (!existsSync(statePath)) {
      console.log(`loopcompass-redaction ${mode}`);
      console.log("files_scanned 0");
      console.log("files_skipped 0");
      console.log("result pass");
      return;
    }
    const stateStat = lstatSync(statePath);
    if (!stateStat.isDirectory() || stateStat.isSymbolicLink()) {
      fail("UNSAFE_STATE_ROOT");
    }
    const stateRoot = realpathSync(statePath);
    if (!isWithin(projectRoot, stateRoot)) fail("STATE_ROOT_ESCAPE");

    const projectPatterns = loadProjectPatterns(projectRoot, stateRoot);
    const counts = new Map();
    const stats = { scanned: 0, skipped: 0 };
    for (const name of SCAN_DIRS) {
      const scanRoot = path.join(stateRoot, name);
      if (!existsSync(scanRoot)) continue;
      const stat = lstatSync(scanRoot);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        increment(counts, "BLOCK_SYMLINK");
        stats.skipped += 1;
        continue;
      }
      scanTree(scanRoot, projectRoot, stateRoot, counts, projectPatterns, stats);
    }

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
