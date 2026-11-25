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
import { appendAudit } from "../audit/log.js";
import { explorerSearchHint, loadConfig } from "../config.js";

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

  // TODO(build): pay via payments/pay.ts (payWithCcdTransfer demo rail),
  // then call runScoutTask with this client's badge + owner presentation,
  // then print explorerSearchHint("transaction", txHash) for each tx.
  console.log("TODO(build): payment + task request — see BUILD-PLAN.md step 6");
  console.log(explorerSearchHint("account", verdict.ownerAccount ?? ""));
}
