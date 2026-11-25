/**
 * Gate logic (agent/gate.ts) + the gated runScoutTask flow with injected
 * fixture-backed dependencies — fully offline. runScoutTask's audit log is
 * written under process.cwd(), so the integration tests chdir into a temp
 * dir first.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  parseBadgeCheckResponse,
  type BadgeCheckResponse,
  type BadgeVerdict,
} from "../src/registry/badge.js";
import type { ProofCheckResult } from "../src/identity/proof.js";
import { evaluateBadgeGate, evaluateGate } from "../src/agent/gate.js";
import { runScoutTask, type ScoutDeps } from "../src/agent/scout.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): BadgeCheckResponse =>
  JSON.parse(readFileSync(path.join(here, "fixtures", name), "utf8"));

const validBadge: BadgeVerdict = parseBadgeCheckResponse(
  "Mf22oaAZyQJaV1fCPjsjL",
  200,
  fixture("badge-check-valid-mainnet.json"),
);
const invalidBadge: BadgeVerdict = parseBadgeCheckResponse(
  "JyP9TtQC3HCNrTYR3sc2T",
  200,
  fixture("badge-check-invalid-testnet.json"),
);
const okProof: ProofCheckResult = { ok: true, statements: [] };
const failProof: ProofCheckResult = {
  ok: false,
  statements: [],
  reason: "fixture proof rejected",
};

test("gate allows a valid badge plus a passing proof", () => {
  const d = evaluateGate(validBadge, okProof);
  assert.equal(d.allowed, true);
  assert.deepEqual(d.reasons, []);
});

test("gate denies an invalid badge even with a passing proof", () => {
  const d = evaluateGate(invalidBadge, okProof);
  assert.equal(d.allowed, false);
  assert.ok(d.reasons.some((r) => r.startsWith("badge check failed")));
  assert.ok(d.reasons.some((r) => r.includes("SHA-256")));
});

test("gate denies a failing proof even with a valid badge", () => {
  const d = evaluateGate(validBadge, failProof);
  assert.equal(d.allowed, false);
  assert.deepEqual(d.reasons, ["identity proof failed: fixture proof rejected"]);
});

test("gate denies a revoked agent even if the resolver verdict were valid", () => {
  const revoked: BadgeVerdict = { ...validBadge, status: "Revoked" };
  const d = evaluateBadgeGate(revoked);
  assert.equal(d.allowed, false);
  assert.ok(d.reasons.some((r) => r.includes("not Active")));
});

test("gate reports badge and proof failures together", () => {
  const d = evaluateGate(invalidBadge, failProof);
  assert.equal(d.allowed, false);
  assert.ok(d.reasons.length >= 2);
});

// --- runScoutTask integration (injected deps, temp cwd for the audit log) ---

const originalCwd = process.cwd();
let workDir: string;

before(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "scout-agent-test-"));
  process.chdir(workDir);
});
after(async () => {
  process.chdir(originalCwd);
  await rm(workDir, { recursive: true, force: true });
});

const depsWith = (proof: ProofCheckResult): ScoutDeps => ({
  checkBadge: async () => validBadge,
  verifyProof: async () => proof,
});

test("runScoutTask executes and audits when both gates pass", async () => {
  const result = await runScoutTask(
    { clientBadge: validBadge.badge, topic: "ai agents" },
    { minAgeYears: 18 },
    depsWith(okProof),
  );
  assert.equal(result.topic, "ai agents");
  assert.equal(result.digest.length, 1);
  assert.match(result.auditDigest, /^[0-9a-f]{64}$/);

  const log = await readFile(path.join(workDir, "audit", "audit.jsonl"), "utf8");
  const actions = log
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l).action as string);
  assert.deepEqual(actions, ["badge_check", "proof_check", "scout_task"]);
});

test("runScoutTask throws and audits the failure when the proof gate fails", async () => {
  await assert.rejects(
    runScoutTask(
      { clientBadge: validBadge.badge, topic: "ai agents" },
      { minAgeYears: 18 },
      depsWith(failProof),
    ),
    /Gate denied: identity proof failed/,
  );
  const log = await readFile(path.join(workDir, "audit", "audit.jsonl"), "utf8");
  const entries = log
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as { action: string; verdict?: string });
  const proofEntries = entries.filter((e) => e.action === "proof_check");
  assert.equal(proofEntries.at(-1)?.verdict, "fail");
  assert.equal(
    entries.filter((e) => e.action === "scout_task").length,
    1, // only from the earlier passing test — no task ran for the denied one
  );
});
