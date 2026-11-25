/**
 * Persisted contract_info (config/registries.json), retrieved live from the
 * hosted MCP `contract_info` tool on 25 Nov 2026 and committed to the repo.
 * Testnet values are the whole point: they are NOT published in the docs.
 * Mainnet values cross-check against the docs (⟨10082,0⟩ / ⟨10081,0⟩).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadStoredContractInfo } from "../src/registry/registries.js";

test("stored contract info carries the discovered testnet registries", async () => {
  const stored = await loadStoredContractInfo();
  assert.equal(stored.tool, "contract_info");
  assert.ok(stored.source.includes("agent-registry-mcp.concordium.com"));
  assert.ok(!Number.isNaN(Date.parse(stored.retrievedAt)));

  assert.deepEqual(stored.networks.testnet.cis8004_contract, {
    index: 12802,
    subindex: 0,
  });
  assert.deepEqual(stored.networks.testnet.cis8_contract, {
    index: 12801,
    subindex: 0,
  });
  assert.equal(
    stored.networks.testnet.explorer_base,
    "https://testnet.ccdscan.io",
  );

  // Cross-check: mainnet must match the values published in the docs.
  assert.deepEqual(stored.networks.mainnet.cis8004_contract, {
    index: 10082,
    subindex: 0,
  });
  assert.deepEqual(stored.networks.mainnet.cis8_contract, {
    index: 10081,
    subindex: 0,
  });
});
