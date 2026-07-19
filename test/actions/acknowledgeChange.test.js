import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createFakeOctokit } from "../fakeOctokit.js";
import { createFakeCollection } from "../fakeCollection.js";
import { acknowledgeChange } from "../../src/actions/acknowledgeChange.js";
import { isAcknowledged } from "../../src/acknowledgments/store.js";

describe("acknowledgeChange", () => {
  test("records the acknowledgment and sets the commit status to success", async () => {
    const octokit = createFakeOctokit();
    const collection = createFakeCollection();

    await acknowledgeChange({
      octokit,
      collection,
      owner: "venom",
      repo: "sandbox",
      prNumber: 5,
      sha: "abc123",
      installationId: 999,
    });

    const acknowledged = await isAcknowledged(collection, {
      owner: "venom",
      repo: "sandbox",
      prNumber: 5,
      sha: "abc123",
    });
    assert.equal(acknowledged, true);

    assert.equal(octokit._statuses.length, 1);
    assert.equal(octokit._statuses[0].state, "success");
  });
});
