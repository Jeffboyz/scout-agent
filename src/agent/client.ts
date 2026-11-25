/**
 * Client agent — the counterparty in the demo.
 *
 * Flow (mirrors the demo video script):
 *  1. Discover ScoutAgent and read its badge from its Agent Card
 *     (capabilities.extensions entry with URI
 *     https://docs.concordium.com/a2a-extensions/concordium-badge/v1).
 *  2. CHECK BEFORE PAYING: verify ScoutAgent's badge via the registry
 *     (registry/badge.ts) — owner, Active status, card hash.
 *  3. Pay ScoutAgent's agentWallet (payments/pay.ts).
 *  4. Present its owner's identity proof + request the task
 *     (agent/scout.ts runScoutTask enforces the gates server-side too).
 *  5. Print the result plus explorer hints for every transaction made.
 */

import { assertCounterpartyVerified } from "../registry/badge.js";
import { payWithCcdTransfer, resolveAgentWallet } from "../payments/pay.js";
import {
  evaluateFixturePresentation,
  type FixturePresentation,
} from "../identity/proof.js";
import {
  DEFAULT_PROOF_POLICY,
  runScoutTask,
  type ScoutDeps,
} from "./scout.js";
import { checkBadgeViaResolver } from "../registry/badge.js";
import { appendAudit } from "../audit/log.js";
import { explorerSearchHint, loadConfig } from "../config.js";

/** A testnet badge with no registry record (token 999999) — refusal path. */
const UNKNOWN_BADGE = "JyP9V5dupAgxNyUmSS4CG";

/**
 * Demo deps: the badge leg is the REAL hosted resolver; the identity-proof
 * leg evaluates a clearly-labelled FIXTURE presentation offline (statement
 * satisfaction only — NOT cryptographic verification; the production path
 * is the Web3ID verifier, see identity/proof.ts). The demo says so on
 * screen and in the audit log.
 */
const demoDeps: ScoutDeps = {
  checkBadge: checkBadgeViaResolver,
  verifyProof: async (presentation, policy) =>
    evaluateFixturePresentation(
      presentation as FixturePresentation | undefined,
      policy,
    ),
};

/** Fixture presentation for the demo client's owner (test identity data). */
const DEMO_CLIENT_PRESENTATION: FixturePresentation = {
  provenAttributes: [{ attributeTag: "dob", value: "1990-06-15" }],
};

export async function discoverScoutBadge(agentCardUrl: string): Promise<string> {
  const res = await fetch(agentCardUrl);
  if (!res.ok) throw new Error(`fetch agent card failed: HTTP ${res.status}`);
  const card = (await res.json()) as {
    capabilities?: {
      extensions?: Array<{ uri: string; params?: { tokenAddress?: string } }>;
    };
  };
  const ext = card.capabilities?.extensions?.find(
    (e) =>
      e.uri === "https://docs.concordium.com/a2a-extensions/concordium-badge/v1",
  );
  const badge = ext?.params?.tokenAddress;
  if (!badge) throw new Error("no Concordium badge extension in agent card");
  // tokenAddress is CAIP-19 (ccd:<genesis>/cis-2:<short>); the short form is
  // the segment after "cis-2:".
  return badge.split("cis-2:").pop() as string;
}

export async function runClientDemo(): Promise<void> {
  const config = loadConfig();
  const badge = config.scoutAgentBadge || (await discoverScoutBadge(config.agentCardUrl));

  const verdict = await assertCounterpartyVerified(badge, config);
  await appendAudit({
    ts: new Date().toISOString(),
    actor: "client-agent",
    action: "badge_check",
    subject: badge,
    verdict: "pass",
    detail: { owner: verdict.ownerAccount },
  });
  console.log(`ScoutAgent badge verified. Owner: ${verdict.ownerAccount}`);
  console.log(
    "Demo topology: one operator account plays both roles. The client below presents the operator's own registered badge — a real Active registry record — and the gate runs the identical check it would for any counterparty.",
  );

  // 3. Pay ScoutAgent's registered agent wallet (plain testnet CCD).
  const wallet = await resolveAgentWallet(badge, config);
  const payment = await payWithCcdTransfer(wallet, 1_000_000n, config);
  await appendAudit({
    ts: new Date().toISOString(),
    actor: "client-agent",
    action: "payment",
    subject: badge,
    verdict: "pass",
    txHash: payment.txHash,
    detail: { to: wallet, amountMicroCcd: "1000000", rail: payment.rail },
  });
  console.log(
    `Paid 1 CCD to ScoutAgent wallet ${wallet}. Tx: ${payment.txHash}`,
  );
  console.log(explorerSearchHint("transaction", payment.txHash));

  // 4. Request the task, presenting badge + owner proof (fixture leg).
  console.log(
    "Identity proof leg: FIXTURE presentation evaluated offline (statement check only, not cryptographic verification — production uses the Web3ID verifier).",
  );
  const result = await runScoutTask(
    {
      clientBadge: badge,
      clientPresentation: DEMO_CLIENT_PRESENTATION,
      topic: "hackathons",
    },
    DEFAULT_PROOF_POLICY,
    demoDeps,
  );
  console.log(`Digest for "${result.topic}" (${result.digest.length} items):`);
  for (const item of result.digest) {
    console.log(`- [${item.platform}] ${item.title} — ${item.note}`);
  }
  console.log(`Audit digest: ${result.auditDigest}`);

  // 5. Refusal path: an unregistered badge must be turned away.
  try {
    await runScoutTask(
      {
        clientBadge: UNKNOWN_BADGE,
        clientPresentation: DEMO_CLIENT_PRESENTATION,
        topic: "hackathons",
      },
      DEFAULT_PROOF_POLICY,
      demoDeps,
    );
    console.log("UNEXPECTED: unverified badge was accepted");
  } catch (err) {
    console.log(
      `Unverified badge ${UNKNOWN_BADGE} REFUSED: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  console.log(explorerSearchHint("account", verdict.ownerAccount ?? ""));
}
