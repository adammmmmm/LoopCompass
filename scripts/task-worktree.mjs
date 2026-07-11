#!/usr/bin/env node
// Create per-task Git worktrees so writer agents do not dirty the main checkout.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

function usage() {
  process.stderr.write(
    "Usage: node scripts/task-worktree.mjs create TASK-NNN slug --title \"Workstream: outcome\" --tags a,b --worker DRIVER [--owner OWNER] [--root DIR] [--base REF]\n" +
      "       node scripts/task-worktree.mjs list\n",
  );
  process.exit(2);
}

function run(args, opts = {}) {
  const out = execFileSync("git", args, {
    cwd: opts.cwd ?? process.cwd(),
    encoding: "utf8",
    stdio: opts.stdio ?? ["ignore", "pipe", "pipe"],
  });
  return typeof out === "string" ? out.trim() : "";
}

function slugify(raw) {
  return String(raw)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parse(argv) {
  const out = {
    command: argv[2],
    taskId: argv[3],
    slug: argv[4],
    root: "",
    base: "",
    title: "",
    tags: "",
    worker: "",
    owner: "",
  };
  for (let i = 5; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") {
      out.root = argv[i + 1] ?? "";
      i += 1;
    } else if (arg === "--base") {
      out.base = argv[i + 1] ?? "";
      i += 1;
    } else if (arg === "--title") {
      out.title = argv[i + 1] ?? "";
      i += 1;
    } else if (arg === "--tags") {
      out.tags = argv[i + 1] ?? "";
      i += 1;
    } else if (arg === "--worker") {
      out.worker = argv[i + 1] ?? "";
      i += 1;
    } else if (arg === "--owner") {
      out.owner = argv[i + 1] ?? "";
      i += 1;
    } else {
      usage();
    }
  }
  return out;
}

function repoRoot() {
  return run(["rev-parse", "--show-toplevel"]).replace(/\\/g, "/");
}

function commonGitDir(root) {
  const raw = run(["rev-parse", "--git-common-dir"], { cwd: root });
  return path.resolve(root, raw);
}

function writeClaim(root, taskId, branchName, worktreePath, owner, worker) {
  const dir = path.join(commonGitDir(root), "loopcompass-task-claims");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${taskId}.json`);
  let existing = {};
  try {
    existing = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    existing = {};
  }
  const now = new Date().toISOString();
  const claim = {
    ...existing,
    taskId,
    owner: existing.owner ?? owner,
    worker: existing.worker ?? worker,
    claimed: existing.claimed ?? now,
    heartbeat: now,
    branch: branchName,
    worktree: worktreePath,
  };
  writeFileSync(file, `${JSON.stringify(claim, null, 2)}\n`, "utf8");
  return claim;
}

function splitFrontmatter(rawText) {
  const text = rawText.replace(/\r\n/g, "\n");
  if (!text.startsWith("---\n")) return { fields: new Map(), body: text };
  const end = text.indexOf("\n---", 4);
  if (end === -1) return { fields: new Map(), body: text };
  const fields = new Map();
  for (const line of text.slice(4, end).split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_-]+):(?:\s*(.*))?$/.exec(line);
    if (match) fields.set(match[1], match[2] ?? "");
  }
  return { fields, body: text.slice(end + 4).replace(/^\n/, "") };
}

function renderFrontmatter(fields, body) {
  const lines = ["---"];
  for (const [key, value] of fields.entries()) {
    lines.push(value === "" ? `${key}:` : `${key}: ${value}`);
  }
  lines.push("---", "");
  return `${lines.join("\n")}${body}`;
}

function findTaskFile(worktreePath, taskId, state) {
  const dir = path.join(worktreePath, ".claude", "tasks", state);
  const exact = path.join(dir, `${taskId}.md`);
  if (existsSync(exact)) return exact;
  try {
    const prefix = `${taskId}-`;
    const match = readdirSync(dir)
      .filter((name) => name.startsWith(prefix) && name.endsWith(".md"))
      .sort()[0];
    return match ? path.join(dir, match) : null;
  } catch {
    return null;
  }
}

function quotedTitle(title) {
  return `"${title.replace(/"/g, '\\"')}"`;
}

function professionalTitle(title) {
  const match = /^([^:\r\n]{2,80}):\s+(.{3,160})$/.exec(title.trim());
  return Boolean(match?.[1].trim() && match?.[2].trim());
}

function normalizedTags(rawTags) {
  return rawTags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function validateCreateArgs(args) {
  if (!/^TASK-\d+$/.test(args.taskId ?? "")) usage();
  if (!slugify(args.slug)) usage();
  if (!professionalTitle(args.title)) {
    process.stderr.write(
      'A professional --title in the form "Workstream: outcome" is required.\n',
    );
    process.exit(2);
  }
  if (normalizedTags(args.tags).length === 0) {
    process.stderr.write("At least one task metadata tag is required via --tags.\n");
    process.exit(2);
  }
  if (!/^[a-z][a-z0-9_-]*$/.test(args.worker)) {
    process.stderr.write("A lowercase driver identity is required via --worker.\n");
    process.exit(2);
  }
  if (args.owner && !/^[^\s:]+:[^\s:]+$/.test(args.owner)) {
    process.stderr.write('When provided, --owner must use the form "driver:identity".\n');
    process.exit(2);
  }
}

function resolveBase(root, baseOverride) {
  if (baseOverride) {
    return {
      commit: run(["rev-parse", "--verify", `${baseOverride}^{commit}`], { cwd: root }),
      source: "explicit",
      override: baseOverride,
    };
  }

  run(["fetch", "--no-tags", "origin", "+refs/heads/main:refs/remotes/origin/main"], {
    cwd: root,
    stdio: "inherit",
  });
  return {
    commit: run(["rev-parse", "--verify", "origin/main^{commit}"], { cwd: root }),
    source: "origin/main",
    override: "",
  };
}

function ensureTaskFile(worktreePath, args, branchName, leaf, base, claim) {
  const tasksDir = path.join(worktreePath, ".claude", "tasks");
  const todoFile = findTaskFile(worktreePath, args.taskId, "todo");
  const doingFile =
    findTaskFile(worktreePath, args.taskId, "doing") ??
    path.join(tasksDir, "doing", `${leaf}.md`);
  const stamp = new Date().toISOString();
  const owner = claim.owner;
  const worker = claim.worker;
  const tags = `[${normalizedTags(args.tags).join(", ")}]`;

  mkdirSync(path.dirname(doingFile), { recursive: true });
  if (todoFile && todoFile !== doingFile) {
    renameSync(todoFile, doingFile);
  }

  if (existsSync(doingFile)) {
    const task = splitFrontmatter(readFileSync(doingFile, "utf8"));
    task.fields.set("id", args.taskId);
    task.fields.set("title", quotedTitle(args.title));
    task.fields.set("tags", tags);
    task.fields.set("status", "in-progress");
    if (!task.fields.get("owner")) task.fields.set("owner", owner);
    if (!task.fields.get("claimed")) task.fields.set("claimed", stamp);
    task.fields.set("heartbeat", stamp);
    if (!task.fields.get("worker")) task.fields.set("worker", worker);
    task.fields.set("branch", branchName);
    task.fields.set("base_source", base.source);
    task.fields.set("base_commit", base.commit);
    if (base.override) task.fields.set("base_override", base.override);
    else task.fields.delete("base_override");
    writeFileSync(doingFile, renderFrontmatter(task.fields, task.body), "utf8");
  } else {
    const title = quotedTitle(args.title);
    const created = stamp.replace(/\.\d{3}Z$/, "Z");
    writeFileSync(
      doingFile,
      [
        "---",
        `id: ${args.taskId}`,
        `title: ${title}`,
        "status: in-progress",
        `created: ${created}`,
        `tags: ${tags}`,
        `owner: ${owner}`,
        `claimed: ${stamp}`,
        `heartbeat: ${stamp}`,
        `worker: ${worker}`,
        `branch: ${branchName}`,
        `base_source: ${base.source}`,
        `base_commit: ${base.commit}`,
        ...(base.override ? [`base_override: ${base.override}`] : []),
        "---",
        "",
        `# ${args.taskId} - ${args.title}`,
        "",
        "## Goal",
        "",
        "Define the accepted outcome for this task before changing product code.",
        "",
      ].join("\n"),
      "utf8",
    );
  }

  return doingFile;
}

function create(args) {
  validateCreateArgs(args);
  const slug = slugify(args.slug);

  const root = repoRoot();
  const projectName = path.basename(root);
  const parent = args.root
    ? path.resolve(args.root)
    : path.resolve(path.dirname(root), `${projectName}-worktrees`);
  const leaf = `${args.taskId}-${slug}`;
  const worktreePath = path.join(parent, leaf);
  const branchName = `task/${args.taskId}-${slug}`;

  if (existsSync(worktreePath)) {
    process.stderr.write(`Refusing to reuse existing path: ${worktreePath}\n`);
    process.exit(1);
  }

  const base = resolveBase(root, args.base);
  mkdirSync(parent, { recursive: true });
  run(["worktree", "add", "-b", branchName, worktreePath, base.commit], {
    cwd: root,
    stdio: "inherit",
  });
  const owner = args.owner || `${args.worker}:${args.taskId}`;
  const claim = writeClaim(root, args.taskId, branchName, worktreePath, owner, args.worker);
  const taskFile = ensureTaskFile(worktreePath, args, branchName, leaf, base, claim);

  process.stdout.write(`worktree=${worktreePath}\n`);
  process.stdout.write(`branch=${branchName}\n`);
  process.stdout.write(`base=${base.commit}\n`);
  process.stdout.write(`base_source=${base.source}\n`);
  if (base.override) process.stdout.write(`base_override=${base.override}\n`);
  process.stdout.write(`owner=${claim.owner}\n`);
  process.stdout.write(`worker=${claim.worker}\n`);
  process.stdout.write(`task=${taskFile}\n`);
  process.stdout.write(`next=cd ${worktreePath}\n`);
}

function list() {
  process.stdout.write(`${run(["worktree", "list"])}\n`);
}

const args = parse(process.argv);
if (args.command === "create") create(args);
else if (args.command === "list") list();
else usage();
