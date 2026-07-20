import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createFakeCollection } from "../fakeCollection.js";
import { recordChange } from "../../src/actions/recordChange.js";

describe("recordChange", () => {
  test("inserts a record with a createdAt timestamp", async () => {
    const collection = createFakeCollection();
    await recordChange(collection, {
      owner: "venom",
      repo: "sandbox",
      prNumber: 1,
      sha: "abc123",
      specPath: "openapi.yaml",
      breakingCount: 2,
      nonBreakingCount: 1,
      acknowledged: false,
    });

    assert.equal(collection._docs.length, 1);
    assert.equal(collection._docs[0].breakingCount, 2);
    assert.ok(collection._docs[0].createdAt instanceof Date);
  });
});
