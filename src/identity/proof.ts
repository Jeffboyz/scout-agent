/**
 * Identity proof check — "Verify and Access" / Web3ID verifiable presentations.
 *
 * References:
 *  - Verify and Access overview: docs.concordium.com/en/mainnet/how-to/concordium-id/verify-and-access/index.html
 *    (ZKP attribute proofs: prove e.g. "over 18" without revealing the document
 *    or the exact date of birth; verification recorded on-chain; ~€0.02/tx.)
 *  - ZK proof tutorial (web SDK): docs.concordium.com/en/mainnet/tutorials/using-ID-in-dApps/zk-proofs-tutorial.html
 *    Statements are `AtomicStatementV2` objects from "@concordium/web-sdk":
 *      - RevealAttribute      — reveal one attribute's value (e.g. nationality)
 *      - AttributeInRange     — prove an attribute is in a range (e.g. dob ⇒ 18+)
 *      - AttributeInSet       — prove membership in a set (e.g. EU nationality)
 *    A recent block hash is embedded in the proof as the challenge so proofs
 *    expire; the VERIFIER must check that block hash was actually used.
 *  - Rust SDK verifier side: concordium_rust_sdk::web3id —
 *    `Request::prove` builds a Presentation; `Presentation::verify(&GlobalContext,
 *    public inputs)` verifies it (docs.rs/concordium-rust-sdk, module web3id).
 *    NB from the API docs: verify() checks cryptographic consistency only —
 *    metadata such as credential expiry must be checked separately.
 *
 * TESTNET NOTE: identities used here are issued by the "Concordium testnet IP"
 * WITHOUT any document check (official docs, setup-env page: "You don't have
 * to provide an ID to create an identity on testnet"). Attribute values in a
 * test identity are test data. On mainnet the same code path works against
 * identities issued by regulated identity providers (Notabene, Digital Trust
 * Solutions, Global FinReg) after a one-time real verification.
 */

// import type { AtomicStatementV2 } from "@concordium/web-sdk";

export interface ProofPolicy {
  /** Minimum age the counterparty's owner must prove (dob range statement). */
  minAgeYears: number;
  /** Optional ISO-3166-1 alpha-2 nationality set the owner must belong to. */
  allowedNationalities?: string[];
}

export interface ProofCheckResult {
  ok: boolean;
  /** Statements that were requested from the prover. */
  statements: unknown[];
  /** The verifiable presentation as received (JSON), if any. */
  presentation?: unknown;
  reason?: string;
}

/**
 * Build the Web3ID proof request (statement list) for a counterparty.
 * In the live flow this request is sent to the counterparty's wallet, which
 * returns a verifiable presentation; here we construct the exact statement
 * shapes used by the official ZK-proof tutorial.
 */
export function buildProofStatements(policy: ProofPolicy): unknown[] {
  const now = new Date();
  const latestDob = new Date(
    now.getFullYear() - policy.minAgeYears,
    now.getMonth(),
    now.getDate(),
  );
  const statements: unknown[] = [
    {
      // AttributeInRange on `dob`: proves age >= minAgeYears without
      // revealing the date of birth itself.
      type: "AttributeInRange",
      attributeTag: "dob",
      lower: "1800-01-01T00:00:00.000Z",
      upper: latestDob.toISOString(),
    },
  ];
  if (policy.allowedNationalities?.length) {
    statements.push({
      // AttributeInSet on `nationality`: ISO-3166-1 alpha-2 codes.
      type: "AttributeInSet",
      attributeTag: "nationality",
      set: policy.allowedNationalities,
    });
  }
  return statements;
}

/**
 * FIXTURE presentation — test data standing in for a real Web3ID
 * verifiable presentation. It lists the attribute values the prover claims
 * were proven, so the statement-satisfaction logic can be exercised
 * OFFLINE (unit tests, demo dry-runs) without a wallet or the chain.
 *
 * ⚠️ Evaluating a fixture is NOT cryptographic verification: nothing here
 * proves the values are backed by a real credential. The production path
 * is verifyPresentation() below (Rust SDK / web-sdk verifier). The gate
 * accepts a ProofCheckResult from either path, but only the crypto path
 * may be used for real counterparties.
 */
export interface FixturePresentation {
  provenAttributes: Array<{ attributeTag: string; value: string }>;
}

/**
 * Offline statement evaluator: does the fixture presentation satisfy every
 * statement in the policy (buildProofStatements)? Pure and deterministic
 * apart from the age bound, which is computed from today's date exactly as
 * the statement builder does.
 */
export function evaluateFixturePresentation(
  presentation: FixturePresentation | undefined,
  policy: ProofPolicy,
): ProofCheckResult {
  const statements = buildProofStatements(policy) as Array<
    Record<string, unknown>
  >;
  if (!presentation) {
    return { ok: false, statements, reason: "no presentation supplied" };
  }
  const valueOf = (tag: string) =>
    presentation.provenAttributes.find((a) => a.attributeTag === tag)?.value;

  const failures: string[] = [];
  for (const st of statements) {
    const tag = st.attributeTag as string;
    const value = valueOf(tag);
    if (value === undefined) {
      failures.push(`missing proven attribute "${tag}"`);
      continue;
    }
    if (st.type === "AttributeInRange") {
      // ISO date/timestamp strings compare correctly lexicographically.
      if (value < (st.lower as string) || value > (st.upper as string)) {
        failures.push(
          `"${tag}" value ${value} outside range [${st.lower}, ${st.upper}]`,
        );
      }
    } else if (st.type === "AttributeInSet") {
      if (!(st.set as string[]).includes(value)) {
        failures.push(`"${tag}" value ${value} not in allowed set`);
      }
    }
    // RevealAttribute: presence of the value is the whole requirement.
  }

  return failures.length
    ? { ok: false, statements, presentation, reason: failures.join("; ") }
    : { ok: true, statements, presentation };
}

/**
 * Verify a verifiable presentation against the chain.
 * STUB: the cryptographic verification is implemented with
 * concordium_rust_sdk::web3id::Presentation::verify (Rust sidecar) or the
 * web-sdk presentation verifier — to be wired during the build phase.
 * Must additionally check (per the Rust API docs):
 *  - the challenge/recent block hash embedded in the proof is fresh, and
 *  - credential metadata (expiry, issuer) — verify() does NOT check these.
 */
export async function verifyPresentation(
  presentation: unknown,
  policy: ProofPolicy,
): Promise<ProofCheckResult> {
  const statements = buildProofStatements(policy);
  if (!presentation) {
    return { ok: false, statements, reason: "no presentation supplied" };
  }
  // TODO(build): call Presentation::verify via the Rust verifier sidecar and
  // check expiry + challenge freshness; return the real verdict here.
  return {
    ok: false,
    statements,
    presentation,
    reason: "TODO(build): cryptographic verification not wired yet",
  };
}

/**
 * Account-level fallback gate (always available, no wallet interaction):
 * every Concordium account is anchored to an identity credential issued by
 * an identity provider, so resolving the counterparty's owner account and
 * confirming the account exists with a live credential is itself a
 * (weaker) Verify-and-Access signal. Implemented via the web SDK's
 * getAccountInfo on the configured node.
 */
export async function accountHasIdentityCredential(
  _accountAddress: string,
): Promise<boolean> {
  // TODO(build): ConcordiumGRPCNodeClient.getAccountInfo → check the account's
  // credential deployments / identity provider index.
  return false;
}
