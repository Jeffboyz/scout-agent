/**
 * Badge-check parser + local card-hash verification, tested OFFLINE against
 * responses recorded from the live hosted resolver on 25 Nov 2026:
 *  - badge-check-valid-mainnet.json   — Mf22oaAZyQJaV1fCPjsjL (mainnet ⟨10082,0⟩ token 4):
 *    badge_valid=true WITH warning-severity issues (legacy embedding).
 *  - badge-check-invalid-testnet.json — JyP9TtQC3HCNrTYR3sc2T (testnet ⟨12802,0⟩ token 0):
 *    card URL 404s → hash mismatch → badge_valid=false.
 *  - badge-check-unknown-testnet.json — JyP9V5dupAgxNyUmSS4CG (testnet token 999999):
 *    no on-chain record (HTTP 200, on_chain=null).
 *  - badge-check-malformed.json       — the HTTP 400 error body for a bad badge string.
 *  - agent-card-valid-mainnet.json    — the actual card bytes of the valid
 *    mainnet agent; their SHA-256 equals its on-chain metadata_hash.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  parseBadgeCheckResponse,
  cardHashMatches,
  verifyCardFile,
  type BadgeCheckResponse,
} from "../src/registry/badge.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): BadgeCheckResponse =>
  JSON.parse(readFileSync(path.join(here, "fixtures", name), "utf8"));

const VALID_MAINNET_BADGE = "Mf22oaAZyQJaV1fCPjsjL";
const VALID_MAINNET_HASH =
  "c62c2a50727c7f0c1e8f373984aeaec9cfc54d8cdd6865f62934806f31304285";

test("valid mainnet badge parses as valid despite warning issues", () => {
  const v = parseBadgeCheckResponse(
    VALID_MAINNET_BADGE,
    200,
    fixture("badge-check-valid-mainnet.json"),
  );
  assert.equal(v.valid, true);
  assert.equal(v.status, "Active");
  assert.equal(v.ownerAccount, "4rNDAkRn6cPsNKW5f6sYF4wuAxpirQvBBAQ4GZyYKeyQWeEPzs");
  assert.equal(v.cardHashMatches, true);
  assert.equal(v.metadataHash, VALID_MAINNET_HASH);
  assert.equal(v.network, "mainnet");
  assert.equal(v.errorIssues.length, 0);
  // The two warnings (legacy embedding, missing verify field) are reported
  // but must NOT invalidate the badge.
  assert.equal(v.issues.length, 2);
});

test("invalid testnet badge (dead card URL) parses as invalid with error issues", () => {
  const v = parseBadgeCheckResponse(
    "JyP9TtQC3HCNrTYR3sc2T",
    200,
    fixture("badge-check-invalid-testnet.json"),
  );
  assert.equal(v.valid, false);
  assert.equal(v.status, "Active"); // on-chain record exists and is Active…
  assert.equal(v.cardHashMatches, false); // …but the card does not hash-match
  assert.ok(v.errorIssues.some((i) => i.startsWith("card_fetch:")));
  assert.ok(v.errorIssues.some((i) => i.startsWith("metadata_hash:")));
  assert.equal(v.network, "testnet");
});

test("unknown token parses as not found, not as a transport error", () => {
  const v = parseBadgeCheckResponse(
    "JyP9V5dupAgxNyUmSS4CG",
    200,
    fixture("badge-check-unknown-testnet.json"),
  );
  assert.equal(v.valid, false);
  assert.equal(v.ownerAccount, undefined);
  assert.ok(v.errorIssues[0].includes("no CIS-8004 record"));
});

test("malformed badge (HTTP 400 body) parses as invalid with the resolver message", () => {
  const v = parseBadgeCheckResponse(
    "not-a-badge",
    400,
    fixture("badge-check-malformed.json"),
  );
  assert.equal(v.valid, false);
  assert.ok(v.issues[0].includes("neither a CIS-8004 badge token address"));
});

test("local card hash verification matches the real on-chain hash", async () => {
  const cardPath = path.join(here, "fixtures", "agent-card-valid-mainnet.json");
  const bytes = readFileSync(cardPath);
  assert.equal(cardHashMatches(bytes, VALID_MAINNET_HASH), true);
  assert.equal(
    cardHashMatches(
      bytes,
      "e1299b4e1de23375342f4d2de6d19858d5d02217b4a87a526aa06deb539fc1fc",
    ),
    false,
  );
  assert.equal(await verifyCardFile(cardPath, VALID_MAINNET_HASH), true);
});
