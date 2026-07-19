import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createFakeCollection } from "../fakeCollection.js";
import { isAcknowledged, recordAcknowledgment } from "../../src/acknowledgments/store.js";

describe("acknowledgment store", () => {
  test("isAcknowledged is false when nothing has been recorded", async () => {
    const collection = createFakeCollection();
    const result = await isAcknowledged(collection, {
      owner: "venom",
      repo: "sandbox",
      prNumber: 1,
      sha: "abc123",
    });
    assert.equal(result, false);
  });

  test("recording an acknowledgment makes isAcknowledged true for that exact key", async () => {
    const collection = createFakeCollection();
    await recordAcknowledgment(collection, {
      owner: "venom",
      repo: "sandbox",
      prNumber: 1,
      sha: "abc123",
      installationId: 999,
    });

    const result = await isAcknowledged(collection, {
      owner: "venom",
      repo: "sandbox",
      prNumber: 1,
      sha: "abc123",
    });
    assert.equal(result, true);
  });

  test("CRITICAL: a new commit SHA on the same PR is NOT covered by an old acknowledgment", async () => {
    const collection = createFakeCollection();
    await recordAcknowledgment(collection, {
      owner: "venom",
      repo: "sandbox",
      prNumber: 1,
      sha: "old-sha",
      installationId: 999,
    });

    // Same PR, new push -> new SHA. This must NOT be considered acknowledged,
    // or a re-push could silently smuggle in new breaking changes under an
    // acknowledgment that never actually saw them.
    const result = await isAcknowledged(collection, {
      owner: "venom",
      repo: "sandbox",
      prNumber: 1,
      sha: "new-sha",
    });
    assert.equal(result, false);
  });

  test("acknowledgments are scoped per repo, not just per PR number (two repos could both have a PR #1)", async () => {
    const collection = createFakeCollection();
    await recordAcknowledgment(collection, {
      owner: "venom",
      repo: "repo-a",
      prNumber: 1,
      sha: "same-sha",
      installationId: 999,
    });

    const result = await isAcknowledged(collection, {
      owner: "venom",
      repo: "repo-b",
      prNumber: 1,
      sha: "same-sha",
    });
    assert.equal(result, false);
  });
});
