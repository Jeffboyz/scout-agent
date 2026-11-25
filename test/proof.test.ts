/**
 * Identity proof statement builder + OFFLINE fixture evaluator.
 * The evaluator checks statement satisfaction on test data only — it is not
 * cryptographic verification (see identity/proof.ts).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildProofStatements,
  evaluateFixturePresentation,
  type FixturePresentation,
} from "../src/identity/proof.js";

type Stmt = Record<string, unknown>;

test("statement builder emits an 18+ dob range statement", () => {
  const stmts = buildProofStatements({ minAgeYears: 18 }) as Stmt[];
  assert.equal(stmts.length, 1);
  assert.equal(stmts[0].type, "AttributeInRange");
  assert.equal(stmts[0].attributeTag, "dob");
  const upperYear = Number((stmts[0].upper as string).slice(0, 4));
  assert.equal(upperYear, new Date().getFullYear() - 18);
});

test("statement builder adds a nationality set statement when policy requires it", () => {
  const stmts = buildProofStatements({
    minAgeYears: 18,
    allowedNationalities: ["ID", "SG"],
  }) as Stmt[];
  assert.equal(stmts.length, 2);
  assert.equal(stmts[1].type, "AttributeInSet");
  assert.equal(stmts[1].attributeTag, "nationality");
  assert.deepEqual(stmts[1].set, ["ID", "SG"]);
});

const adult: FixturePresentation = {
  provenAttributes: [
    { attributeTag: "dob", value: "1990-05-01T00:00:00.000Z" },
    { attributeTag: "nationality", value: "ID" },
  ],
};

test("fixture evaluator passes an adult with an allowed nationality", () => {
  const r = evaluateFixturePresentation(adult, {
    minAgeYears: 18,
    allowedNationalities: ["ID", "SG"],
  });
  assert.equal(r.ok, true);
});

test("fixture evaluator rejects an underage dob", () => {
  const r = evaluateFixturePresentation(
    {
      provenAttributes: [
        { attributeTag: "dob", value: "2015-01-01T00:00:00.000Z" },
      ],
    },
    { minAgeYears: 18 },
  );
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /outside range/);
});

test("fixture evaluator rejects a nationality outside the allowed set", () => {
  const r = evaluateFixturePresentation(
    {
      provenAttributes: [
        { attributeTag: "dob", value: "1990-05-01T00:00:00.000Z" },
        { attributeTag: "nationality", value: "US" },
      ],
    },
    { minAgeYears: 18, allowedNationalities: ["ID", "SG"] },
  );
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /not in allowed set/);
});

test("fixture evaluator rejects missing attributes and missing presentations", () => {
  const missing = evaluateFixturePresentation(
    { provenAttributes: [] },
    { minAgeYears: 18 },
  );
  assert.equal(missing.ok, false);
  assert.match(missing.reason ?? "", /missing proven attribute "dob"/);

  const none = evaluateFixturePresentation(undefined, { minAgeYears: 18 });
  assert.equal(none.ok, false);
  assert.equal(none.reason, "no presentation supplied");
});
