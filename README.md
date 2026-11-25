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

**Registered and running end-to-end on testnet (25 Nov 2026).**
ScoutAgent is registered in the testnet CIS-8004 registry ⟨12802,0⟩:
agent/token ID **1504**, badge **`JyP9Y7bJc1Kigrjen39Aj`**, status
**Active**, `badge_valid: true`, hosted Agent Card SHA-256 pinned on-chain
(register tx `40b031506674fd2e103573b934e4ccb9f6e4e274486d55f6f0188af4595be769`,
setAgentURI tx `58cdd7df341f72b38d69a8ef5e328fe79cd3b67e4481a637a6c853fcf21f3da8`).
The full demo flow has executed live (`npm run demo`): badge verified via
the hosted resolver → **1 CCD settlement transfer** to the registered
agent wallet (tx `2ecc4772167f30216c22f0a8697894af765978b2eb70999db05a7e91c7a1956b`)
→ gated task executed and digest delivered → an unverifiable badge
refused by the same gate. The run's audit digest is anchored on-chain
(Register data tx `2e865ef353c00b1d824c98e20815d366941fa6757f7434201cb9391973406066`).
**19 unit tests, all passing** (`npm test`).
Still open, honestly: cryptographic Web3ID presentation verification (the
demo evaluates a labelled fixture presentation offline — statement
satisfaction only).

## Setup (build phase)

1. Create a testnet identity + account in Concordium Wallet for Web
   (testnet IP), claim faucet CCD, export the account keys.
2. `cp .env.example .env` and fill in the account details.
3. `npm install`
4. `npm run register` — two-pass registration (build card → register →
   pin card hash → check-badge).
5. `npm run demo` — the end-to-end gated flow (verify → pay → gated task →
   refusal path), as executed live above.
