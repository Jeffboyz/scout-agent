/**
 * ScoutAgent — the service agent.
 *
 * ScoutAgent sells a micro-service to other agents: a short, curated digest
 * of current Web3 bounty/hackathon opportunities matching a topic.
 *
 * THE GATE (the whole point of the project): ScoutAgent only executes a task
 * for a client after BOTH checks pass —
 *   1. the client's badge verifies in the Agent Registry (CIS-8004, Active,
 *      card hash matches), and
 *   2. the client's owner passes the identity proof policy (Verify and
 *      Access / Web3ID verifiable presentation: e.g. owner is 18+).
 * The decision itself lives in agent/gate.ts (pure, fixture-testable);
 * this module collects the inputs, writes every step — pass or fail — to
 * the audit log, and enforces the decision.
 */

import {
  checkBadgeViaResolver,
  type BadgeVerdict,
} from "../registry/badge.js";
import {
  verifyPresentation,
  type ProofCheckResult,
  type ProofPolicy,
} from "../identity/proof.js";
import { evaluateBadgeGate, evaluateGate } from "./gate.js";
import { appendAudit } from "../audit/log.js";
import { loadConfig, type ScoutConfig } from "../config.js";

export interface ScoutRequest {
  clientBadge: string;
  /** Web3ID verifiable presentation from the client's owner (JSON). */
  clientPresentation?: unknown;
  topic: string;
}

export interface ScoutResult {
  topic: string;
  digest: Array<{ title: string; platform: string; note: string }>;
  auditDigest: string;
}

export const DEFAULT_PROOF_POLICY: ProofPolicy = { minAgeYears: 18 };

/**
 * The scouting catalogue the digest is curated from. Entries are real,
 * currently-open opportunities (verified by the operator on 25 Nov 2026);
 * topic matching is a simple tag/keyword filter.
 */
const CATALOGUE: Array<{
  title: string;
  platform: string;
  note: string;
  topics: string[];
}> = [
  {
    title: "Concordium Trusted Agents Hackathon — submissions close 10 Dec 2026",
    platform: "Encode Club",
    note: "3 × 1M CCD for verified-agent builds on the CIS-8004 Agent Registry.",
    topics: ["hackathons", "agents", "identity", "concordium"],
  },
  {
    title: "Build Before Q-Day — submissions close 3 Dec 2026",
    platform: "QoreChain Association",
    note: "Quantum Pass beginner track: hybrid secp256k1 + ML-DSA-87 signed transactions.",
    topics: ["hackathons", "quantum", "qorechain"],
  },
  {
    title: "GAME OVER 2026 — submissions close 1 Dec 2026",
    platform: "itch.io (Decentraland × Regenesis Labs)",
    note: "$8,000 in MANA across 10 winners for boss-fight game scenes.",
    topics: ["hackathons", "games", "decentraland"],
  },
];

function curateDigest(
  topic: string,
): Array<{ title: string; platform: string; note: string }> {
  const needle = topic.trim().toLowerCase();
  const hits = CATALOGUE.filter(
    (e) =>
      e.topics.some((t) => t.includes(needle) || needle.includes(t)) ||
      e.title.toLowerCase().includes(needle) ||
      e.platform.toLowerCase().includes(needle),
  );
  return (hits.length ? hits : CATALOGUE).map(({ title, platform, note }) => ({
    title,
    platform,
    note,
  }));
}

/**
 * Injectable seams for the two external checks, so the gated flow can be
 * unit-tested offline with recorded fixtures. Defaults are the real
 * implementations (hosted resolver + Web3ID verifier).
 */
export interface ScoutDeps {
  checkBadge: (
    badge: string,
    config: ScoutConfig,
  ) => Promise<BadgeVerdict>;
  verifyProof: (
    presentation: unknown,
    policy: ProofPolicy,
  ) => Promise<ProofCheckResult>;
}

export const defaultScoutDeps: ScoutDeps = {
  checkBadge: checkBadgeViaResolver,
  verifyProof: verifyPresentation,
};

/** The gated task. Throws (and audits) if any verification fails. */
export async function runScoutTask(
  request: ScoutRequest,
  policy: ProofPolicy = DEFAULT_PROOF_POLICY,
  deps: ScoutDeps = defaultScoutDeps,
): Promise<ScoutResult> {
  const config = loadConfig();
  const actor = config.scoutAgentBadge || "scout-agent";

  // Gate 1 — registry badge check on the CLIENT agent.
  let verdict: BadgeVerdict;
  try {
    verdict = await deps.checkBadge(request.clientBadge, config);
  } catch (err) {
    await appendAudit({
      ts: new Date().toISOString(),
      actor,
      action: "badge_check",
      subject: request.clientBadge,
      verdict: "fail",
      detail: { error: String(err) },
    });
    throw err;
  }
  const badgeGate = evaluateBadgeGate(verdict);
  await appendAudit({
    ts: new Date().toISOString(),
    actor,
    action: "badge_check",
    subject: request.clientBadge,
    verdict: badgeGate.allowed ? "pass" : "fail",
    detail: badgeGate.allowed
      ? { owner: verdict.ownerAccount, status: verdict.status }
      : { reasons: badgeGate.reasons },
  });

  // Gate 2 — identity proof check on the client's owner (Verify and Access).
  const proof = await deps.verifyProof(request.clientPresentation, policy);
  await appendAudit({
    ts: new Date().toISOString(),
    actor,
    action: "proof_check",
    subject: request.clientBadge,
    verdict: proof.ok ? "pass" : "fail",
    detail: { reason: proof.reason },
  });

  // Combined decision (pure logic in gate.ts).
  const decision = evaluateGate(verdict, proof);
  if (!decision.allowed) {
    throw new Error(`Gate denied: ${decision.reasons.join("; ")}`);
  }

  // Task execution — curated opportunity source (compiled 25 Nov 2026 from
  // the operator's live tracking; swap for a fetched source in production).
  const digest = curateDigest(request.topic);

  const auditDigest = await appendAudit({
    ts: new Date().toISOString(),
    actor,
    action: "scout_task",
    subject: request.clientBadge,
    verdict: "pass",
    detail: { topic: request.topic, results: digest.length },
  });

  return { topic: request.topic, digest, auditDigest };
}
