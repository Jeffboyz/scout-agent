/**
 * Registry contract discovery — persisted.
 *
 * The docs publish the MAINNET CIS-8004 / CIS-8 contract indices
 * (⟨10082,0⟩ / ⟨10081,0⟩) but NOT the testnet ones. The authoritative source
 * for testnet is the hosted MCP `contract_info` tool, so this module calls
 * it once and stores the result in `config/registries.json` (committed to
 * the repo) with its source and retrieval date, instead of hardcoding —
 * or worse, guessing — the values in source code.
 *
 * Refresh with:  npm run contract-info
 *
 * First retrieval: 25 Nov 2026 —
 *   testnet CIS-8004 ⟨12802,0⟩, CIS-8 ⟨12801,0⟩ (see config/registries.json).
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../config.js";
import {
  AgentRegistryMcpClient,
  type ContractInfo,
} from "./mcpClient.js";

export interface StoredRegistries {
  /** Where the values came from (service + tool), for auditability. */
  source: string;
  tool: string;
  /** ISO-8601 timestamp of the retrieval that produced this file. */
  retrievedAt: string;
  networks: {
    testnet: ContractInfo;
    mainnet: ContractInfo;
  };
}

export const REGISTRIES_PATH = path.resolve(
  process.cwd(),
  "config/registries.json",
);

/** Call `contract_info` for testnet + mainnet and persist the result. */
export async function fetchAndStoreContractInfo(
  mcp: AgentRegistryMcpClient = new AgentRegistryMcpClient(
    loadConfig().mcpBaseUrl,
  ),
  storePath: string = REGISTRIES_PATH,
): Promise<StoredRegistries> {
  const [testnet, mainnet] = await Promise.all([
    mcp.contractInfo("testnet"),
    mcp.contractInfo("mainnet"),
  ]);
  const stored: StoredRegistries = {
    source: "https://agent-registry-mcp.concordium.com/mcp (hosted Agent Registry MCP service)",
    tool: "contract_info",
    retrievedAt: new Date().toISOString(),
    networks: { testnet, mainnet },
  };
  await mkdir(path.dirname(storePath), { recursive: true });
  await writeFile(storePath, JSON.stringify(stored, null, 2) + "\n", "utf8");
  return stored;
}

/** Read the persisted contract info (no network). Throws if not fetched yet. */
export async function loadStoredContractInfo(
  storePath: string = REGISTRIES_PATH,
): Promise<StoredRegistries> {
  const raw = await readFile(storePath, "utf8");
  return JSON.parse(raw) as StoredRegistries;
}

// CLI: `npm run contract-info`
if (import.meta.url === `file://${process.argv[1]}`) {
  const stored = await fetchAndStoreContractInfo();
  console.log(`stored -> ${REGISTRIES_PATH}`);
  console.log(JSON.stringify(stored, null, 2));
}
