import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createFakeOctokit } from "../fakeOctokit.js";
import { setCommitStatus } from "../../src/github/commitStatus.js";

describe("setCommitStatus", () => {
  test("sets the state, description, and a consistent context", async () => {
    const octokit = createFakeOctokit();
    await setCommitStatus(octokit, {
      owner: "venom",
      repo: "sandbox",
      sha: "abc123",
      state: "failure",
      description: "1 unacknowledged breaking change",
    });

    assert.equal(octokit._statuses.length, 1);
    assert.equal(octokit._statuses[0].state, "failure");
    assert.equal(octokit._statuses[0].description, "1 unacknowledged breaking change");
    assert.equal(octokit._statuses[0].context, "api-guardian/breaking-changes");
  });

  test("truncates descriptions over GitHub's 140-character limit instead of erroring", async () => {
    const octokit = createFakeOctokit();
    const longDescription = "x".repeat(200);
    await setCommitStatus(octokit, {
      owner: "venom",
      repo: "sandbox",
      sha: "abc123",
      state: "failure",
      description: longDescription,
    });

    assert.equal(octokit._statuses[0].description.length, 140);
  });
});
