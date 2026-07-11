import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeSignature,
  resolveSlugCollision,
  signatureIdentity,
  slugFromSignature,
} from "../scripts/lib/signature.mjs";

describe("normalizeSignature", () => {
  it("strips UUIDs, timestamps, paths, and secrets", () => {
    const raw =
      "auth failed for agent@example.com Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb path C:\\Users\\op\\key.pem id 550e8400-e29b-41d4-a716-446655440000 at 2026-07-11T12:00:00Z pid=48291";
    const n = normalizeSignature(raw);
    assert.match(n, /auth failed/i);
    assert.equal(n.includes("550e8400"), false);
    assert.equal(n.includes("Users\\op"), false);
    assert.equal(n.includes("eyJhbGci"), false);
    assert.equal(n.includes("agent@example.com"), false);
    assert.equal(n.includes("2026-07-11"), false);
    assert.match(n, /<secret>|<path>|<id>|<ts>|<email>/);
  });

  it("collapses whitespace", () => {
    assert.equal(normalizeSignature("a   b\n\tc"), "a b c");
  });

  it("is stable for equivalent volatile noise", () => {
    const a = normalizeSignature(
      "gap at /tmp/run-1 id aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    );
    const b = normalizeSignature(
      "gap at /tmp/run-2 id 11111111-2222-4333-8444-555555555555",
    );
    assert.equal(a, b);
  });
});

describe("slugFromSignature", () => {
  it("lowercases and hyphenates", () => {
    assert.equal(slugFromSignature("Git Push Denied"), "git-push-denied");
  });

  it("trims edges and collapses runs", () => {
    assert.equal(slugFromSignature("--Hello---World--"), "hello-world");
  });

  it("truncates to 96 and re-trims trailing hyphen", () => {
    const long = "a".repeat(50) + "!!!" + "b".repeat(50);
    const slug = slugFromSignature(long);
    assert.ok(slug.length <= 96);
    assert.equal(slug.endsWith("-"), false);
    assert.match(slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it("uses failure when empty", () => {
    assert.equal(slugFromSignature("???"), "failure");
    assert.equal(slugFromSignature(""), "failure");
  });
});

describe("signatureIdentity", () => {
  it("returns normalized + slug", () => {
    const { normalized, slug } = signatureIdentity(
      "Permission DENIED for /home/runner/work/x",
    );
    assert.match(normalized, /permission denied/i);
    assert.equal(slug, slugFromSignature(normalized));
  });
});

describe("resolveSlugCollision", () => {
  it("returns base slug when free", () => {
    assert.equal(resolveSlugCollision("git-denied", () => false), "git-denied");
  });

  it("appends lowest integer suffix from -2", () => {
    const taken = new Set(["git-denied", "git-denied-2"]);
    assert.equal(
      resolveSlugCollision("git-denied", (s) => taken.has(s)),
      "git-denied-3",
    );
  });
});
