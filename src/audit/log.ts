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

import {
  AccountAddress,
  DataBlob,
  Transaction,
  TransactionExpiry,
  isRejectTransaction,
} from "@concordium/web-sdk";
import { loadConfig, type ScoutConfig } from "../config.js";
import { createNodeClient, loadSigner } from "../registry/register.js";

/**
 * Anchor an audit digest on-chain with a Register data transaction.
 * The 32 raw bytes of the hex digest become the transaction's DataBlob,
 * so anyone can recompute the audit entry's SHA-256 locally and match it
 * against the data registered by this transaction on CCDScan.
 * Signed by the configured operator account.
 */
export async function anchorAuditDigestOnChain(
  digestHex: string,
  config: ScoutConfig = loadConfig(),
): Promise<string> {
  if (!/^[0-9a-f]{64}$/i.test(digestHex)) {
    throw new Error("digestHex must be a 32-byte SHA-256 hex string");
  }
  if (!config.ownerAccount) throw new Error("OWNER_ACCOUNT is not configured");
  const client = createNodeClient(config);
  const signer = loadSigner(config);
  const sender = AccountAddress.fromBase58(config.ownerAccount);
  const { nonce } = await client.getNextAccountNonce(sender);
  const bytes = Buffer.from(digestHex, "hex");
  const builder = Transaction.registerData({
    data: new DataBlob(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    ),
  });
  const signable = builder
    .addMetadata({
      sender,
      nonce,
      expiry: TransactionExpiry.futureMinutes(5),
    })
    .build();
  const finalized = await Transaction.signAndFinalize(signable, signer);
  const hash = await client.sendTransaction(finalized);
  const outcome = await client.waitForTransactionFinalization(hash);
  if (!outcome.summary || isRejectTransaction(outcome.summary)) {
    throw new Error(`Register data transaction rejected on-chain: ${hash.toString()}`);
  }
  return hash.toString();
}
