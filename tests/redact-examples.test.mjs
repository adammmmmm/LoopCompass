import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("example redaction", () => {
  it("redact-check passes on examples/", () => {
    const r = spawnSync(
      process.execPath,
      [path.join(root, "scripts", "redact-check.mjs"), "examples"],
      { encoding: "utf8", cwd: root },
    );
    assert.equal(r.status, 0, r.stderr || r.stdout);
  });
});
