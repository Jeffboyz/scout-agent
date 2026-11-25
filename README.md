# ScoutAgent Terverifikasi (Verified Bounty Scout)

An **accountable AI agent** built for the **Concordium Trusted Agents Hackathon**
(Encode Club) — Checkpoint 2 submission. ScoutAgent sells a micro-service to
other agents (a curated digest of Web3 bounty/hackathon opportunities), and it
is built so that nobody has to trust its word:

- **It has a verifiable on-chain identity.** ScoutAgent is registered in the
  Concordium **Agent Registry (CIS-8004)** on **testnet** as a CIS-2 NFT, with
  an A2A **Agent Card** whose SHA-256 is pinned on-chain — the
  **"Verified by Concordium" badge**.
- **It checks before it transacts.** Any client must (1) present a badge that
  resolves in the registry with status *Active* and a hash-matching Agent
  Card, and (2) pass an identity proof check (**Verify and Access** / Web3ID
  zero-knowledge presentation — e.g. prove the owner is 18+ without revealing
  any document or birth date). Fail either check → no service.
- **It leaves a trail.** Every check, payment and task is written to an audit
  log whose digests can be anchored on-chain (Register data transactions).

## Concordium components used

| Component | How ScoutAgent uses it |
|---|---|
| Agent Registry (CIS-8004) + Verified by Concordium badge | Agent identity NFT, Agent Card hash pinning, counterparty badge checks |
| Agent Registry MCP server (hosted) | Card building, registration payload builders, badge resolution/verification |
| Concordium ID / Verify and Access (Web3ID) | ZK identity proof gate on the counterparty's owner |
| Protocol-Level Tokens + x402 + Sponsored Transactions | Payment design: client pays per call, facilitator sponsors the fee (demo settles in test CCD — see `src/payments/pay.ts`) |

## Architecture

```
client agent ──1. discover badge (Agent Card extension)──▶ ScoutAgent
             ──2. badge-check (MCP REST /v1/badge-check)─▶ Agent Registry (CIS-8004)
             ──3. pay agentWallet (testnet CCD / x402)───▶ ScoutAgent wallet
             ──4. present Web3ID proof + task request────▶ ScoutAgent
ScoutAgent   ──5. verify badge + proof (gates)───────────▶ Registry / chain
             ──6. run task, write audit entry────────────▶ audit/audit.jsonl (+ on-chain anchor)
```

Code map: `src/registry/` (MCP client, badge check, registration),
`src/identity/` (proof statements & verification), `src/payments/`,
`src/agent/` (ScoutAgent service + demo client), `src/audit/`.

## Testnet identity — no real documents

Development runs entirely on **Concordium testnet**. Per the official docs,
an identity on testnet is created with the **Concordium testnet IP** and
*"You don't have to provide an ID to create an identity on testnet"* — test
identities carry test data and are for testnet only. Test CCD comes from the
wallet faucet (Activity → Request CCD, 2,000 CCD) or
`PUT https://wallet-proxy.testnet.concordium.com/v0/testnetGTUDrop/<address>`.
Real identity verification is only a mainnet concern — see the path to
mainnet in the hackathon submission.

## Status

Build in progress (Nov 2026). The **read-only registry path is real code,
verified live** against the hosted services: MCP client (handshake +
`contract_info` — testnet registries CIS-8004 ⟨12802,0⟩ / CIS-8 ⟨12801,0⟩
persisted in `config/registries.json`), the badge-check resolver client
with a parser fitted to the real response shape, local Agent Card SHA-256
verification (proven against a live mainnet agent's on-chain hash), the
pure gate logic (`src/agent/gate.ts`), and a fixture statement evaluator
for offline proof-gate tests — **19 unit tests, all passing**
(`npm test`). Still stubbed, in build order: registration signing,
CCD payment, cryptographic Web3ID verification. Build progress and the
remaining steps are tracked in `../BUILD-PLAN.md`.

## Setup (build phase)

1. Create a testnet identity + account in Concordium Wallet for Web
   (testnet IP), claim faucet CCD, export the account keys.
2. `cp .env.example .env` and fill in the account details.
3. `npm install`
4. `npm run register` — two-pass registration (build card → register →
   pin card hash → check-badge).
5. `npm run demo` — end-to-end gated transaction between the two agents.
