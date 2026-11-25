/**
 * Badge lookup & verification — the "check before you transact" gate.
 *
 * A "Verified by Concordium" badge is the agent's CIS-8004 NFT token address.
 * Reference: docs.concordium.com/en/mainnet/technical-reference/agent-registry/concordium-badge.html
 *
 * Verification steps defined by the spec (all trustless):
 *  1. Parse the Base58Check badge into (contract, token_id)
 *     — @concordium/web-sdk helpers `tokenAddressFromBase58` / `tokenAddressToBase58`.
 *  2. Confirm the contract implements CIS-8004 and is a registry we trust.
 *  3. Resolve on-chain with the CIS-8004 `agent_of` query → owner account,
 *     agent wallet, status, agent_uri, metadata_hash. Require status = Active.
 *  4. Fetch the Agent Card at agent_uri; SHA-256 of its canonical bytes must
 *     equal the on-chain metadata_hash.
 *
 * Zero-setup path used here: the hosted resolver runs exactly those steps.
 *  - GET {MCP_BASE}/v1/badge-check/{badge}   (permanent alias of /v1/check-badge/{id};
 *    this is the path stamped into every badge's `verification.verifyUrl`)
 *  - GET {MCP_BASE}/v1/verify-agent-card/{badge}  (card hash vs on-chain hash only)
 * The network is resolved from the badge itself; `?network=` only overrides.
 *
 * RESPONSE SHAPE — verified live against the hosted service (25 Nov 2026),
 * see test/fixtures/badge-check-*.json:
 *  - A well-formed badge ALWAYS returns HTTP 200 with the full verdict body,
 *    even when the agent is unknown (on_chain: null) or invalid.
 *  - `issues` is an array of OBJECTS { severity, field, message, expected?,
 *    actual? } — and a badge can be `badge_valid: true` while carrying
 *    severity:"warning" issues (e.g. legacy badge embedding). Only
 *    severity:"error" issues invalidate.
 *  - A malformed badge returns HTTP 400 { error: "bad_request", message }.
 *  - The verdict body carries `checks` (per-step booleans incl.
 *    hash_matches_on_chain), `on_chain` (owner_account, status, agent_uri,
 *    metadata_hash_hex), `card_sha256`, and `expected` (chain id + the
 *    registry contracts the resolver used).
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
// import { tokenAddressFromBase58 } from "@concordium/web-sdk"; // step 1 helper (direct-chain path)
import { loadConfig, type ScoutConfig } from "../config.js";

export interface BadgeIssue {
  severity: "error" | "warning" | string;
  field?: string;
  message: string;
  expected?: unknown;
  actual?: unknown;
}

/** Raw body of GET /v1/badge-check/{badge} (or an error body). */
export interface BadgeCheckResponse {
  token_id?: number;
  token_address?: string;
  agent_uri?: string | null;
  http_status?: number | null;
  card_sha256?: string | null;
  on_chain?: {
    owner_account: string;
    status: string;
    agent_uri: string;
    metadata_hash_hex: string;
  } | null;
  checks?: Record<string, boolean | string>;
  badge_valid?: boolean;
  issues?: BadgeIssue[];
  network?: string;
  expected?: { chain: string; contracts: { cis8004: string; cis8: string } };
  /** Present on HTTP-error bodies (e.g. 400) instead of the verdict fields. */
  error?: string;
  message?: string;
}

export interface BadgeVerdict {
  badge: string;
  /** True only if the resolver says badge_valid AND no error-severity issue exists. */
  valid: boolean;
  ownerAccount?: string;
  status?: "Active" | "Revoked" | string;
  agentUri?: string;
  /** On-chain metadata_hash pinned for the agent's card. */
  metadataHash?: string;
  /** SHA-256 of the card bytes the resolver fetched from agent_uri. */
  cardSha256?: string;
  /** Whether the fetched card's SHA-256 equals the on-chain metadata_hash. */
  cardHashMatches?: boolean;
  network?: string;
  /** All issues, normalised to "field: message" strings (warnings included). */
  issues: string[];
  /** Only the severity:"error" issues — these are what invalidate a badge. */
  errorIssues: string[];
  /** Raw resolver response, kept for the audit log / demo screen. */
  raw: unknown;
}

/**
 * Pure parser: BadgeCheckResponse body + HTTP status → BadgeVerdict.
 * Offline-testable against recorded fixtures (test/fixtures/).
 */
export function parseBadgeCheckResponse(
  badge: string,
  httpStatus: number,
  body: BadgeCheckResponse,
): BadgeVerdict {
  // Error body (e.g. HTTP 400 malformed badge): { error, message }.
  if (body.error || (httpStatus >= 400 && body.badge_valid === undefined)) {
    const msg = body.message ?? `resolver HTTP ${httpStatus}`;
    return { badge, valid: false, issues: [msg], errorIssues: [msg], raw: body };
  }

  const issues = (body.issues ?? []).map((i) =>
    i.field ? `${i.field}: ${i.message}` : i.message,
  );
  const errorIssues = (body.issues ?? [])
    .filter((i) => i.severity === "error")
    .map((i) => (i.field ? `${i.field}: ${i.message}` : i.message));

  if (!body.on_chain) {
    // Well-formed badge, but no CIS-8004 record exists for the token.
    const notFound = errorIssues.length
      ? errorIssues
      : ["on_chain: no CIS-8004 record found for this token"];
    return {
      badge,
      valid: false,
      network: body.network,
      issues: issues.length ? issues : notFound,
      errorIssues: notFound,
      raw: body,
    };
  }

  return {
    badge,
    valid: body.badge_valid === true && errorIssues.length === 0,
    ownerAccount: body.on_chain.owner_account,
    status: body.on_chain.status,
    agentUri: body.on_chain.agent_uri ?? body.agent_uri ?? undefined,
    metadataHash: body.on_chain.metadata_hash_hex,
    cardSha256: body.card_sha256 ?? undefined,
    cardHashMatches:
      typeof body.checks?.hash_matches_on_chain === "boolean"
        ? body.checks.hash_matches_on_chain
        : undefined,
    network: body.network,
    issues,
    errorIssues,
    raw: body,
  };
}

/** Primary path: hosted badge-check resolver (single GET, no SDK needed). */
export async function checkBadgeViaResolver(
  badge: string,
  config: ScoutConfig = loadConfig(),
): Promise<BadgeVerdict> {
  const url = `${config.mcpBaseUrl}/v1/badge-check/${encodeURIComponent(badge)}`;
  const res = await fetch(url);
  const body = (await res.json().catch(() => ({}))) as BadgeCheckResponse;
  return parseBadgeCheckResponse(badge, res.status, body);
}

/** SHA-256 of raw card bytes equals the expected (on-chain) hash? Pure. */
export function cardHashMatches(
  cardBytes: Uint8Array,
  expectedMetadataHashHex: string,
): boolean {
  const digest = createHash("sha256").update(cardBytes).digest("hex");
  return digest.toLowerCase() === expectedMetadataHashHex.toLowerCase();
}

/**
 * Independent local check (defense in depth): hash a LOCAL Agent Card file
 * (e.g. our own agent-card/agent-card.json before hosting it) against the
 * on-chain metadata_hash, without trusting any remote fetcher.
 */
export async function verifyCardFile(
  filePath: string,
  expectedMetadataHashHex: string,
): Promise<boolean> {
  const bytes = await readFile(filePath);
  return cardHashMatches(bytes, expectedMetadataHashHex);
}

/**
 * Independent local check (defense in depth for the demo): fetch the Agent
 * Card ourselves and compare its SHA-256 against the on-chain metadata_hash
 * reported by the resolver, instead of trusting the resolver's flag.
 */
export async function verifyCardHashLocally(
  agentUri: string,
  expectedMetadataHashHex: string,
): Promise<boolean> {
  const res = await fetch(agentUri);
  if (!res.ok) return false;
  const bytes = Buffer.from(await res.arrayBuffer());
  return cardHashMatches(bytes, expectedMetadataHashHex);
}

/**
 * The gate used by the client agent before paying ScoutAgent:
 * badge must resolve, be valid (no error issues), and be Active.
 */
export async function assertCounterpartyVerified(
  badge: string,
  config: ScoutConfig = loadConfig(),
): Promise<BadgeVerdict> {
  const verdict = await checkBadgeViaResolver(badge, config);
  if (!verdict.valid) {
    throw new Error(
      `Counterparty badge check FAILED for ${badge}: ${verdict.errorIssues.join("; ") || "not valid"}`,
    );
  }
  if (verdict.status && verdict.status !== "Active") {
    throw new Error(`Counterparty agent is not Active (status=${verdict.status})`);
  }
  return verdict;
}

// CLI: `npm run badge-check -- <badge>`
if (import.meta.url === `file://${process.argv[1]}`) {
  const badge = process.argv[2];
  if (!badge) {
    console.error("usage: npm run badge-check -- <badge>");
    process.exit(1);
  }
  const verdict = await checkBadgeViaResolver(badge);
  console.log(JSON.stringify(verdict, null, 2));
}
