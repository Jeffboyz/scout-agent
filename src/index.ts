/**
 * ScoutAgent demo entrypoint — runs the end-to-end flow on Concordium testnet:
 * client discovers ScoutAgent → badge check → payment → identity-proof-gated
 * task → audited result. See README.md and ../BUILD-PLAN.md.
 */
import { runClientDemo } from "./agent/client.js";

await runClientDemo();
