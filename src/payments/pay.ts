/**
 * Payments — how the client agent pays ScoutAgent for a research task.
 *
 * Design (from official Concordium material):
 *  - x402 is the pay-per-call HTTP payment standard Concordium supports for
 *    agent-to-agent payments; the x402 FACILITATOR acts as transaction
 *    sponsor under Protocol 10 "Sponsored Transactions" (live since
 *    10–12 Mar 2026): the agent signs a stablecoin (PLT) transfer naming the
 *    facilitator as sponsor; the facilitator verifies, co-signs, pays the
 *    ~€0.01 CCD fee and submits. The agent never needs to hold CCD.
 *    (concordium.com article "Sponsored Transactions: Who Actually Pays the Fee";
 *     concordium.blog Protocol 10 product update.)
 *  - The agent's payment wallet is discoverable from the registry: the
 *    reserved `agentWallet` metadata key (MCP tool `get_agent_wallet`).
 *
 * STATUS for this build: no Concordium-testnet x402 facilitator endpoint is
 * published in the official docs found during research (25 Nov 2026), so the
 * demo settlement leg is a plain testnet CCD transfer (real, on-chain,
 * explorer-visible — implemented in payWithCcdTransfer below), and the x402
 * path is kept behind the same interface as a stretch goal pending an
 * answer from the organisers. See BUILD-PLAN.md.
 */

import {
  AccountAddress,
  CcdAmount,
  Transaction,
  TransactionExpiry,
  isRejectTransaction,
} from "@concordium/web-sdk";
import { loadConfig, type ScoutConfig } from "../config.js";
import {
  createNodeClient,
  fetchBadgeBlock,
  loadSigner,
} from "../registry/register.js";

export interface PaymentResult {
  txHash: string;
  amountMicroCcd: bigint;
  to: string;
  rail: "ccd-transfer" | "x402";
}

/**
 * Resolve the payee's agent wallet from the registry metadata.
 * The hosted badge endpoint reads the reserved `agentWallet` key from the
 * agent's CIS-8004 record (same data the MCP `get_agent_wallet` tool
 * exposes); falls back to the record's owner account.
 */
export async function resolveAgentWallet(
  badge: string,
  config: ScoutConfig = loadConfig(),
): Promise<string> {
  const block = (await fetchBadgeBlock(badge, config)) as unknown as {
    agent_wallet?: string;
    owner_account?: string;
  };
  const wallet = block.agent_wallet ?? block.owner_account;
  if (!wallet) {
    throw new Error(`no agent wallet resolvable for badge ${badge}`);
  }
  return wallet;
}

/**
 * Demo settlement: plain CCD transfer on testnet via @concordium/web-sdk.
 * The payer is the configured operator account (OWNER_ACCOUNT +
 * ACCOUNT_EXPORT_FILE) — in the single-operator demo the same account plays
 * the client role; the transfer itself is a real, finalised, explorer-
 * visible testnet transaction to the agent's registered wallet.
 */
export async function payWithCcdTransfer(
  toAccount: string,
  amountMicroCcd: bigint,
  config: ScoutConfig = loadConfig(),
): Promise<PaymentResult> {
  if (!config.ownerAccount) throw new Error("OWNER_ACCOUNT is not configured");
  const client = createNodeClient(config);
  const signer = loadSigner(config);
  const sender = AccountAddress.fromBase58(config.ownerAccount);
  const { nonce } = await client.getNextAccountNonce(sender);
  const builder = Transaction.transfer({
    amount: CcdAmount.fromMicroCcd(amountMicroCcd),
    toAddress: AccountAddress.fromBase58(toAccount),
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
    throw new Error(`CCD transfer rejected on-chain: ${hash.toString()}`);
  }
  return {
    txHash: hash.toString(),
    amountMicroCcd,
    to: toAccount,
    rail: "ccd-transfer",
  };
}

/**
 * Stretch: x402 pay-per-call with a Protocol-10 sponsored transaction.
 * The facilitator co-signs and covers the fee; the agent pays in a PLT
 * stablecoin. Blocked on a published testnet facilitator endpoint.
 */
export async function payWithX402(
  _resourceUrl: string,
  _config: ScoutConfig = loadConfig(),
): Promise<PaymentResult> {
  throw new Error(
    "TODO(stretch): x402 facilitator endpoint for Concordium testnet not yet confirmed",
  );
}
