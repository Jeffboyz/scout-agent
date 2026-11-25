/**
 * Central configuration for ScoutAgent.
 *
 * All endpoints below are taken from the official Concordium documentation
 * (accessed 25 Nov 2026):
 *  - Public testnet node: docs.concordium.com/en/mainnet/tutorials/setup-env.html
 *    ("The address is grpc.testnet.concordium.com on port 20000 (gRPCv2 and gRPC-web)")
 *  - Agent Registry MCP service (hosted, mainnet+testnet+devnet configured):
 *    docs.concordium.com/en/mainnet/technical-reference/agent-registry/mcp-service.html
 *  - Agent Registry Indexer base URL: same MCP service page.
 */

export type NetworkName = "testnet" | "mainnet";

export interface ScoutConfig {
  network: NetworkName;
  /** gRPC v2 endpoint of a Concordium node for the configured network. */
  nodeHost: string;
  nodePort: number;
  /** Hosted Agent Registry MCP/REST service base URL. */
  mcpBaseUrl: string;
  /** Agent Registry Indexer REST API base URL (discovery/search). */
  indexerBaseUrl: string;
  /** Owner account address (Base58Check) that owns the agent NFT. */
  ownerAccount: string;
  /** Path to the wallet key export file (<address>.export). Never commit. */
  accountExportFile: string;
  /** Badge (CIS-8004 token address, Base58Check short form) of ScoutAgent. */
  scoutAgentBadge: string;
  /** Public URL of the hosted Agent Card JSON. */
  agentCardUrl: string;
}

function env(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export function loadConfig(): ScoutConfig {
  const network = (env("NETWORK", "testnet") as NetworkName) ?? "testnet";
  return {
    network,
    nodeHost: env("CCD_NODE_HOST", "grpc.testnet.concordium.com"),
    nodePort: Number(env("CCD_NODE_PORT", "20000")),
    mcpBaseUrl: env(
      "MCP_BASE_URL",
      "https://agent-registry-mcp.concordium.com",
    ),
    indexerBaseUrl: env(
      "INDEXER_BASE_URL",
      "https://agent-registry-indexer.concordium.com",
    ),
    ownerAccount: env("OWNER_ACCOUNT"),
    accountExportFile: env("ACCOUNT_EXPORT_FILE"),
    scoutAgentBadge: env("SCOUT_AGENT_BADGE"),
    agentCardUrl: env(
      "AGENT_CARD_URL",
      "https://jeffboyz.github.io/scout-agent/agent-card.json",
    ),
  };
}

/**
 * Mainnet reference values (from the Agent Registry docs index page).
 * TESTNET contract indices are NOT published on that page; discover them at
 * runtime with the MCP `contract_info` tool (see registry/register.ts) —
 * do not hardcode a guessed testnet index.
 */
export const MAINNET_REGISTRIES = {
  cis8004: { index: 10082n, subindex: 0n },
  cis8: { index: 10081n, subindex: 0n },
  /** First 32 hex chars of the mainnet genesis hash (CAIP-2 chain id suffix). */
  genesisHashPrefix: "9dd9ca4d19e9393877d2c44b70f89acb",
} as const;

/**
 * Explorer links for the Checkpoint 2 "Testnet link" deliverable.
 * CCDScan (ccdscan.io) is the official explorer and has a Mainnet/Testnet
 * selector in its UI; CCDExplorer is the community explorer named in the
 * hackathon brief. Deep-link formats are captured during the build once real
 * accounts/transactions exist — until then this returns the explorer root
 * plus the search term to paste.
 */
export function explorerSearchHint(kind: "account" | "transaction", id: string) {
  return {
    explorer: "https://ccdscan.io",
    instruction: `Switch CCDScan to Testnet, then search for ${kind} ${id}`,
    id,
  };
}
