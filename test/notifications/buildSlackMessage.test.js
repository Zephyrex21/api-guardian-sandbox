import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildSlackMessage } from "../../src/notifications/buildSlackMessage.js";

describe("buildSlackMessage", () => {
  test("includes the repo, PR number, and breaking count in the fallback text", () => {
    const message = buildSlackMessage({
      owner: "venom",
      repo: "sandbox",
      prNumber: 7,
      breakingCount: 2,
      prUrl: "https://github.com/venom/sandbox/pull/7",
      acknowledgeUrl: "https://example.com/acknowledge/123",
    });

    assert.match(message.text, /venom\/sandbox/);
    assert.match(message.text, /#7/);
    assert.match(message.text, /2 unacknowledged breaking changes/);
  });

  test("uses singular 'change' for exactly one breaking change", () => {
    const message = buildSlackMessage({
      owner: "venom",
      repo: "sandbox",
      prNumber: 1,
      breakingCount: 1,
      prUrl: "https://github.com/venom/sandbox/pull/1",
      acknowledgeUrl: "https://example.com/acknowledge/1",
    });

    assert.match(message.text, /1 unacknowledged breaking change /); // singular, not "changes"
    assert.doesNotMatch(message.text, /1 unacknowledged breaking changes/);
  });

  test("includes both the PR link and the acknowledge link", () => {
    const message = buildSlackMessage({
      owner: "venom",
      repo: "sandbox",
      prNumber: 7,
      breakingCount: 1,
      prUrl: "https://github.com/venom/sandbox/pull/7",
      acknowledgeUrl: "https://example.com/acknowledge/123",
    });

    const linkBlock = message.blocks.find((b) => b.text?.text?.includes("http"));
    assert.match(linkBlock.text.text, /https:\/\/github\.com\/venom\/sandbox\/pull\/7/);
    assert.match(linkBlock.text.text, /https:\/\/example\.com\/acknowledge\/123/);
  });

  test("returns valid Block Kit structure (header + section blocks)", () => {
    const message = buildSlackMessage({
      owner: "venom",
      repo: "sandbox",
      prNumber: 1,
      breakingCount: 1,
      prUrl: "https://example.com/pr",
      acknowledgeUrl: "https://example.com/ack",
    });

    assert.equal(message.blocks[0].type, "header");
    assert.ok(message.blocks.some((b) => b.type === "section"));
  });
});
