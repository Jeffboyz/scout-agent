/**
 * Audit trail — every ScoutAgent action leaves a traceable record.
 *
 * Two layers:
 *  1. Local append-only JSONL log (audit/audit.jsonl, gitignored) with the
 *     full context of each action: who asked, which badge/proof checks ran
 *     and their verdicts, payment tx hash, and the result digest. This is
 *     the log shown in the demo video.
 *  2. Optional on-chain anchor: periodically register the SHA-256 of the log
 *     (or of a single high-value entry) with a Concordium "Register data"
 *     transaction, so the trail is tamper-evident and explorer-visible.
 *     The JS SDK exposes this as a RegisterDataPayload with a DataBlob
 *     (@concordium/node-sdk / web-sdk account transaction types).
 *
 * Accountability narrative: each entry links an action → the agent's badge →
 * the owner account → the identity credential behind that account, matching
 * the audit-trail expectations of EU AI Act Article 12 style record-keeping.
 */

import { appendFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

export interface AuditEntry {
  ts: string;
  actor: string; // badge or account that initiated the action
  action: string; // e.g. "badge_check" | "proof_check" | "payment" | "scout_task"
  subject?: string; // counterparty badge/account
  verdict?: "pass" | "fail";
  txHash?: string;
  detail?: Record<string, unknown>;
}

/** Resolved per call (not at import time) so tests/tools can chdir first. */
function auditFile(): string {
  return path.join(path.resolve(process.cwd(), "audit"), "audit.jsonl");
}

export async function appendAudit(entry: AuditEntry): Promise<string> {
  const file = auditFile();
  await mkdir(path.dirname(file), { recursive: true });
  const line = JSON.stringify(entry);
  await appendFile(file, line + "\n", "utf8");
  // Entry digest — the value that would be anchored on-chain.
  return createHash("sha256").update(line).digest("hex");
}

/**
 * Anchor an audit digest on-chain with a Register data transaction.
 * STUB — build with the web SDK's register-data account transaction
 * (RegisterDataPayload { data: DataBlob }) and return the tx hash.
 */
export async function anchorAuditDigestOnChain(
  _digestHex: string,
): Promise<string> {
  throw new Error("TODO(build): Register data transaction via @concordium/web-sdk");
}
