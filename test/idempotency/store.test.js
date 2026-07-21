import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createFakeCollection } from "../fakeCollection.js";
import { isDuplicateDelivery } from "../../src/idempotency/store.js";

describe("isDuplicateDelivery", () => {
  test("the first time a delivery ID is seen, it is NOT a duplicate", async () => {
    const collection = createFakeCollection();
    const result = await isDuplicateDelivery(collection, "delivery-abc");
    assert.equal(result, false);
  });

  test("CRITICAL: the same delivery ID seen again IS a duplicate", async () => {
    const collection = createFakeCollection();
    await isDuplicateDelivery(collection, "delivery-abc");
    const result = await isDuplicateDelivery(collection, "delivery-abc");
    assert.equal(result, true, "a retried webhook delivery must be recognized and skipped");
  });

  test("different delivery IDs are independently tracked", async () => {
    const collection = createFakeCollection();
    assert.equal(await isDuplicateDelivery(collection, "delivery-1"), false);
    assert.equal(await isDuplicateDelivery(collection, "delivery-2"), false);
    assert.equal(await isDuplicateDelivery(collection, "delivery-1"), true);
  });
});
