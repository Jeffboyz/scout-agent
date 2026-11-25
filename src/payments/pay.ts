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
 * explorer-visible), and the x402 path is kept behind the same interface as
 * a stretch goal pending an answer from the organisers. See BUILD-PLAN.md.
 */

import { loadConfig, type ScoutConfig } from "../config.js";

export interface PaymentResult {
  txHash: string;
  amountMicroCcd: bigint;
  to: string;
  rail: "ccd-transfer" | "x402";
}

/**
 * Resolve the payee's agent wallet from the registry metadata.
 * MCP tool: `get_agent_wallet` — reads the reserved `agentWallet` key.
 */
export async function resolveAgentWallet(
  _badge: string,
  _config: ScoutConfig = loadConfig(),
): Promise<string> {
  // TODO(build): call the MCP get_agent_wallet tool via AgentRegistryMcpClient.
  throw new Error("TODO(build): resolve agentWallet via MCP get_agent_wallet");
}

/**
 * Demo settlement: plain CCD transfer on testnet via @concordium/web-sdk.
 * STUB — wire with ConcordiumGRPCNodeClient.sendTransaction using the client
 * agent's account keys (SDK examples: concordium-node-sdk-js repo).
 */
export async function payWithCcdTransfer(
  _toAccount: string,
  _amountMicroCcd: bigint,
  _config: ScoutConfig = loadConfig(),
): Promise<PaymentResult> {
  throw new Error("TODO(build): CCD transfer via @concordium/web-sdk");
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
