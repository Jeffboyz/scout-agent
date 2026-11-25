/**
 * The ScoutAgent gate — pure decision logic, no I/O.
 *
 * A client task is allowed ONLY if BOTH hold:
 *   1. Badge gate: the client's CIS-8004 badge verifies (resolver verdict
 *      valid, no error-severity issues), the agent record is Active, and
 *      the served Agent Card's SHA-256 matches the on-chain metadata_hash.
 *   2. Proof gate: the client's owner passes the identity proof policy
 *      (Verify and Access / Web3ID — see identity/proof.ts).
 *
 * Kept pure so the whole decision is unit-testable offline with recorded
 * fixtures (test/fixtures/) and fixture presentations. scout.ts collects
 * the two inputs (network), audits them, and asks this module for the call.
 */

import type { BadgeVerdict } from "../registry/badge.js";
import type { ProofCheckResult } from "../identity/proof.js";

export interface GateDecision {
  allowed: boolean;
  /** Every reason the gate denied (empty when allowed). */
  reasons: string[];
}

/** Badge-only slice of the gate (used for the audit trail's badge entry). */
export function evaluateBadgeGate(badge: BadgeVerdict): GateDecision {
  const reasons: string[] = [];
  if (!badge.valid) {
    reasons.push(
      `badge check failed: ${badge.errorIssues.join("; ") || "not valid"}`,
    );
  }
  if (badge.status && badge.status !== "Active") {
    reasons.push(`agent is not Active (status=${badge.status})`);
  }
  if (badge.cardHashMatches === false) {
    reasons.push("agent card SHA-256 does not match on-chain metadata_hash");
  }
  return { allowed: reasons.length === 0, reasons };
}

/** Full gate: badge decision + identity proof decision. */
export function evaluateGate(
  badge: BadgeVerdict,
  proof: ProofCheckResult,
): GateDecision {
  const reasons = [...evaluateBadgeGate(badge).reasons];
  if (!proof.ok) {
    reasons.push(`identity proof failed: ${proof.reason ?? "unknown reason"}`);
  }
  return { allowed: reasons.length === 0, reasons };
}
