/**
 * Agent registration — two-pass flow.
 *
 * References:
 *  - Badge page, "Add the badge to an existing card" / composing a card for an
 *    unregistered agent: docs.concordium.com/.../agent-registry/concordium-badge.html
 *  - MCP service tool list: docs.concordium.com/.../agent-registry/mcp-service.html
 *
 * The badge needs a token id that only exists once `register` mints the NFT,
 * so registration is a two-pass flow:
 *
 *  PASS 1 — compose & register
 *   1. MCP tool `build_agent_card`  → complete Agent Card JSON + its SHA-256
 *      (badge extension present with "tokenAddress": null, verifyUrl keyed on
 *      the owner account).
 *   2. Host the card at its public agent_uri (GitHub Pages in our setup).
 *   3. MCP tool `build_register`    → { hex, schema_json } sign-ready payload
 *      for the CIS-8004 `register` entrypoint.
 *   4. Sign the payload with the owner account keys (wallet export file) and
 *      submit it as a contract-update transaction via @concordium/web-sdk
 *      (ConcordiumGRPCNodeClient from "@concordium/web-sdk/nodejs").
 *      → the mint assigns the token id; the badge string is then
 *        tokenAddressToBase58(contract, tokenId) from @concordium/web-sdk.
 *
 *  PASS 2 — pin the final card (with the real badge embedded)
 *   5. REST GET /v1/get-badge-JSON/{badge} → the `extension` block +
 *      ERC-8004 `registrations` entry to paste into the card.
 *   6. Re-host the card; SHA-256 the *served* bytes.
 *   7. REST GET /v1/build-set-agent-uri/{badge}?metadata_hash_hex=<sha256>&sender=<owner>
 *      → sign-ready `setAgentURI` payload; sign & submit.
 *   8. REST GET /v1/check-badge/{badge} → require badge_valid,
 *      extension_conformant and verification_present all true, issues empty.
 *
 * NOTE: on mainnet, registry transactions run on Sponsored Transactions
 * (Concordium pays the fee, registration is free). On testnet we simply pay
 * the ~€0.01-equivalent fee from the faucet-funded account (2,000 test CCD).
 */


import { readFileSync } from "node:fs";
import {
  AccountAddress,
  CcdAmount,
  ContractAddress,
  Energy,
  Parameter,
  ReceiveName,
  Transaction,
  TransactionExpiry,
  buildAccountSigner,
  isRejectTransaction,
  isUpdateContractSummary,
  getTransactionRejectReason,
  type AccountSigner,
} from "@concordium/web-sdk";
import {
  ConcordiumGRPCNodeClient,
  credentials,
} from "@concordium/web-sdk/nodejs";
import { loadConfig, type ScoutConfig } from "../config.js";
import { AgentRegistryMcpClient } from "./mcpClient.js";

export interface RegistrationResult {
  badge: string;
  tokenId: string;
  registerTxHash: string;
  setAgentUriTxHash: string;
}

/** Step 0 of the build: discover the TESTNET CIS-8004/CIS-8 contracts. */
export async function discoverTestnetRegistries(
  mcp: AgentRegistryMcpClient,
  network: string,
) {
  // MCP tool `contract_info` — the testnet indices are not published in the
  // docs pages, so they are discovered here instead of hardcoded.
  return mcp.contractInfo(network);
}

/** Live shape of the MCP `build_agent_card` result (verified 25 Nov 2026). */
export interface BuiltAgentCard {
  /** The exact card JSON string to host at the agent_uri, byte for byte. */
  cardJson: string;
  /** SHA-256 of the card, computed by the service — pin this, not a local hash. */
  metadataHashHex: string;
  /** Base58 badge string once the token id is known; null pre-mint. */
  tokenAddress: string | null;
  notes: string[];
}

/** PASS 1, step 1: compose the Agent Card via the MCP `build_agent_card` tool. */
export async function buildAgentCard(
  mcp: AgentRegistryMcpClient,
  inputs: {
    name: string;
    description: string;
    agentUri: string;
    ownerAccount: string;
    network: string;
    tokenId?: string | number | null;
    skills?: Array<{
      id: string;
      name: string;
      description: string;
      tags?: string[];
    }>;
  },
): Promise<BuiltAgentCard> {
  const res = (await mcp.callTool("build_agent_card", {
    network: inputs.network,
    name: inputs.name,
    description: inputs.description,
    agent_uri: inputs.agentUri,
    owner_account: inputs.ownerAccount,
    token_id: inputs.tokenId ?? null,
    ...(inputs.skills ? { skills: inputs.skills } : {}),
  })) as {
    agent_card_json: string;
    metadata_hash_hex: string;
    token_address: string | null;
    notes?: string[];
  };
  return {
    cardJson: res.agent_card_json,
    metadataHashHex: res.metadata_hash_hex,
    tokenAddress: res.token_address,
    notes: res.notes ?? [],
  };
}

/** Live shape of a builder result (verified for `build_register`, 25 Nov 2026). */
export interface BuilderPayload {
  contractAddress: { index: number; subindex: number };
  receiveName: string;
  parameterHex: string;
  suggestedEnergy: number;
}

/** PASS 1, step 3: get the sign-ready `register` payload from MCP `build_register`. */
export async function buildRegisterPayload(
  mcp: AgentRegistryMcpClient,
  args: {
    network: string;
    sender: string;
    agentUri: string;
    metadataHashHex: string;
  },
): Promise<BuilderPayload> {
  const res = (await mcp.callTool("build_register", {
    network: args.network,
    sender: args.sender,
    agent_uri: args.agentUri,
    metadata_hash_hex: args.metadataHashHex,
  })) as {
    contract_address: { index: number; subindex: number };
    receive_name: string;
    parameter_hex: string;
    suggested_energy: number;
  };
  return {
    contractAddress: res.contract_address,
    receiveName: res.receive_name,
    parameterHex: res.parameter_hex,
    suggestedEnergy: res.suggested_energy,
  };
}

/** Node client for the configured network. The public nodes speak TLS. */
export function createNodeClient(
  config: ScoutConfig,
): ConcordiumGRPCNodeClient {
  return new ConcordiumGRPCNodeClient(
    config.nodeHost,
    config.nodePort,
    credentials.createSsl(),
  );
}

/** Account signer built from the browser-wallet export file (never logged). */
export function loadSigner(config: ScoutConfig): AccountSigner {
  if (!config.accountExportFile) {
    throw new Error("ACCOUNT_EXPORT_FILE is not configured");
  }
  const parsed = JSON.parse(readFileSync(config.accountExportFile, "utf8"));
  return buildAccountSigner(parsed);
}

/**
 * Sign & submit a builder payload as a contract update, then wait for
 * finalisation. Throws if the transaction is rejected on-chain.
 * Returns the transaction hash.
 */
export async function signAndSubmitContractUpdate(
  payload: BuilderPayload,
  config: ScoutConfig,
): Promise<string> {
  if (!config.ownerAccount) throw new Error("OWNER_ACCOUNT is not configured");
  const client = createNodeClient(config);
  const signer = loadSigner(config);
  const sender = AccountAddress.fromBase58(config.ownerAccount);
  const { nonce } = await client.getNextAccountNonce(sender);
  const builder = Transaction.updateContract(
    {
      amount: CcdAmount.fromMicroCcd(0n),
      address: ContractAddress.create(
        BigInt(payload.contractAddress.index),
        BigInt(payload.contractAddress.subindex),
      ),
      receiveName: ReceiveName.fromString(payload.receiveName),
      message: Parameter.fromHexString(payload.parameterHex),
    },
    Energy.create(BigInt(payload.suggestedEnergy)),
  );
  const signable = builder
    .addMetadata({
      sender,
      nonce,
      expiry: TransactionExpiry.futureMinutes(10),
    })
    .build();
  const finalized = await Transaction.signAndFinalize(signable, signer);
  const hash = await client.sendTransaction(finalized);
  const outcome = await client.waitForTransactionFinalization(hash);
  const summary = outcome.summary;
  if (!summary) throw new Error("Finalised without a summary");
  if (isRejectTransaction(summary)) {
    throw new Error(
      `Transaction rejected on-chain: ${JSON.stringify(getTransactionRejectReason(summary))}`,
    );
  }
  if (!isUpdateContractSummary(summary)) {
    throw new Error("Finalised, but not as a contract update");
  }
  return hash.toString();
}

/** PASS 2, step 5: fetch the badge extension block for the registered agent. */
export async function fetchBadgeBlock(
  badge: string,
  config: ScoutConfig = loadConfig(),
) {
  const res = await fetch(
    `${config.mcpBaseUrl}/v1/get-badge-JSON/${encodeURIComponent(badge)}`,
  );
  if (!res.ok) throw new Error(`get-badge-JSON failed: HTTP ${res.status}`);
  return res.json() as Promise<{
    extension: unknown;
    registrations_entry: unknown;
    next_steps: unknown;
  }>;
}

/** PASS 2, step 8: final confirmation via REST check-badge. */
export async function confirmBadge(
  badge: string,
  config: ScoutConfig = loadConfig(),
) {
  const res = await fetch(
    `${config.mcpBaseUrl}/v1/check-badge/${encodeURIComponent(badge)}`,
  );
  if (!res.ok) throw new Error(`check-badge failed: HTTP ${res.status}`);
  return res.json();
}

/** Orchestrates the full two-pass registration. Signing steps are stubbed. */
export async function registerScoutAgent(
  config: ScoutConfig = loadConfig(),
): Promise<RegistrationResult> {
  const mcp = new AgentRegistryMcpClient(config.mcpBaseUrl);
  await discoverTestnetRegistries(mcp, config.network);
  // 1) build card → 2) host card (manual step, GitHub Pages) →
  // 3) build_register → 4) signAndSubmitContractUpdate →
  // 5) fetchBadgeBlock → re-host → 7) build-set-agent-uri + submit →
  // 8) confirmBadge. Implemented incrementally during the build phase.
  throw new Error("TODO(build): registration orchestration — see BUILD-PLAN.md steps 3–5");
}
