import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createFakeOctokit } from "./fakeOctokit.js";
import { createFakeCollection } from "./fakeCollection.js";
import { fetchFileAtRef } from "../src/github/fetchFile.js";
import { resolveSpecFile } from "../src/github/resolveSpecFile.js";
import { reviewApiChanges } from "../src/actions/reviewApiChanges.js";
import { recordAcknowledgment } from "../src/acknowledgments/store.js";

const OWNER = "venom";
const REPO = "sandbox";

describe("fetchFileAtRef", () => {
  test("returns decoded content when the file exists", async () => {
    const octokit = createFakeOctokit({ "main:hello.txt": "hello world" });
    const content = await fetchFileAtRef(octokit, { owner: OWNER, repo: REPO, path: "hello.txt", ref: "main" });
    assert.equal(content, "hello world");
  });

  test("returns null (not an error) when the file doesn't exist", async () => {
    const octokit = createFakeOctokit({});
    const content = await fetchFileAtRef(octokit, { owner: OWNER, repo: REPO, path: "missing.txt", ref: "main" });
    assert.equal(content, null);
  });
});

describe("resolveSpecFile", () => {
  test("finds openapi.yaml with no config present, kind is openapi", async () => {
    const octokit = createFakeOctokit({ "abc123:openapi.yaml": "openapi: 3.0.0" });
    const result = await resolveSpecFile(octokit, { owner: OWNER, repo: REPO, ref: "abc123" });
    assert.equal(result.path, "openapi.yaml");
    assert.equal(result.kind, "openapi");
    assert.equal(result.content, "openapi: 3.0.0");
  });

  test("falls back to openapi.json if .yaml doesn't exist", async () => {
    const octokit = createFakeOctokit({ "abc123:openapi.json": '{"openapi":"3.0.0"}' });
    const result = await resolveSpecFile(octokit, { owner: OWNER, repo: REPO, ref: "abc123" });
    assert.equal(result.path, "openapi.json");
    assert.equal(result.kind, "openapi");
  });

  test("finds schema.graphql, kind is graphql", async () => {
    const octokit = createFakeOctokit({ "abc123:schema.graphql": "type Query { viewer: String }" });
    const result = await resolveSpecFile(octokit, { owner: OWNER, repo: REPO, ref: "abc123" });
    assert.equal(result.path, "schema.graphql");
    assert.equal(result.kind, "graphql");
  });

  test("finds schema.graphqls as an alternate GraphQL extension", async () => {
    const octokit = createFakeOctokit({ "abc123:schema.graphqls": "type Query { viewer: String }" });
    const result = await resolveSpecFile(octokit, { owner: OWNER, repo: REPO, ref: "abc123" });
    assert.equal(result.path, "schema.graphqls");
    assert.equal(result.kind, "graphql");
  });

  test("OpenAPI defaults are checked before GraphQL defaults when both exist (documented, deterministic order)", async () => {
    const octokit = createFakeOctokit({
      "abc123:openapi.yaml": "openapi: 3.0.0",
      "abc123:schema.graphql": "type Query { viewer: String }",
    });
    const result = await resolveSpecFile(octokit, { owner: OWNER, repo: REPO, ref: "abc123" });
    assert.equal(result.kind, "openapi");
  });

  test("respects a .guardian.yml override even if a default-named file also exists", async () => {
    const octokit = createFakeOctokit({
      "abc123:.guardian.yml": "specPath: api/spec.yaml",
      "abc123:api/spec.yaml": "openapi: 3.0.0",
      "abc123:openapi.yaml": "openapi: 3.0.0 # should be ignored",
    });
    const result = await resolveSpecFile(octokit, { owner: OWNER, repo: REPO, ref: "abc123" });
    assert.equal(result.path, "api/spec.yaml");
    assert.equal(result.kind, "openapi", "kind should be inferred from the .yaml extension");
  });

  test(".guardian.yml infers GraphQL kind from a .graphql extension without an explicit type field", async () => {
    const octokit = createFakeOctokit({
      "abc123:.guardian.yml": "specPath: contracts/schema.graphql",
      "abc123:contracts/schema.graphql": "type Query { viewer: String }",
    });
    const result = await resolveSpecFile(octokit, { owner: OWNER, repo: REPO, ref: "abc123" });
    assert.equal(result.kind, "graphql");
  });

  test(".guardian.yml respects an explicit type field even against a non-matching extension", async () => {
    const octokit = createFakeOctokit({
      "abc123:.guardian.yml": "specPath: contracts/api-def\ntype: graphql",
      "abc123:contracts/api-def": "type Query { viewer: String }",
    });
    const result = await resolveSpecFile(octokit, { owner: OWNER, repo: REPO, ref: "abc123" });
    assert.equal(result.kind, "graphql");
  });

  test("returns null path/kind/content when nothing is found anywhere", async () => {
    const octokit = createFakeOctokit({});
    const result = await resolveSpecFile(octokit, { owner: OWNER, repo: REPO, ref: "abc123" });
    assert.equal(result.path, null);
    assert.equal(result.kind, null);
    assert.equal(result.content, null);
  });

  test("a malformed .guardian.yml falls back to default search instead of crashing", async () => {
    const octokit = createFakeOctokit({
      "abc123:.guardian.yml": "this: is: not: valid: yaml: [",
      "abc123:openapi.yaml": "openapi: 3.0.0",
    });
    const result = await resolveSpecFile(octokit, { owner: OWNER, repo: REPO, ref: "abc123" });
    assert.equal(result.path, "openapi.yaml");
  });
});

describe("reviewApiChanges (full pipeline, real GitHub calls faked out)", () => {
  const baseSpecYaml = `
openapi: 3.0.0
paths:
  /users:
    post:
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                name:
                  type: string
              required: [name]
`;

  const headSpecYamlWithBreakingChange = `
openapi: 3.0.0
paths:
  /users:
    post:
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                name:
                  type: string
                email:
                  type: string
              required: [name, email]
`;

  test("posts a comment listing a real breaking change, sets pending then failure status, includes an acknowledge link", async () => {
    const octokit = createFakeOctokit({
      "base-sha:openapi.yaml": baseSpecYaml,
      "head-sha:openapi.yaml": headSpecYamlWithBreakingChange,
    });
    const collection = createFakeCollection();

    await reviewApiChanges({
      octokit,
      acknowledgmentsCollection: collection,
      changesCollection: createFakeCollection(),
      owner: OWNER,
      repo: REPO,
      prNumber: 1,
      baseSha: "base-sha",
      headSha: "head-sha",
      installationId: 999,
    });

    assert.equal(octokit._comments.length, 1);
    assert.match(octokit._comments[0], /breaking change/);
    assert.match(octokit._comments[0], /email/);
    assert.match(octokit._comments[0], /acknowledge/i, "unacknowledged breaking change should include a link");

    assert.equal(octokit._statuses.length, 2, "should set pending first, then a final status");
    assert.equal(octokit._statuses[0].state, "pending");
    assert.equal(octokit._statuses[1].state, "failure");
  });

  test("posts nothing and sets no status when the PR doesn't touch any spec file", async () => {
    const octokit = createFakeOctokit({}); // no openapi file at all, anywhere
    const collection = createFakeCollection();

    await reviewApiChanges({
      octokit,
      acknowledgmentsCollection: collection,
      changesCollection: createFakeCollection(),
      owner: OWNER,
      repo: REPO,
      prNumber: 2,
      baseSha: "base-sha",
      headSha: "head-sha",
      installationId: 999,
    });

    assert.equal(octokit._comments.length, 0, "should stay quiet on PRs unrelated to the API spec");
    assert.equal(octokit._statuses.length, 0, "should not add a status check to unrelated PRs");
  });

  test("handles a spec being newly added in this PR (no base version to compare), sets success status", async () => {
    const octokit = createFakeOctokit({
      "head-sha:openapi.yaml": baseSpecYaml, // only exists at head, not base
    });
    const collection = createFakeCollection();

    await reviewApiChanges({
      octokit,
      acknowledgmentsCollection: collection,
      changesCollection: createFakeCollection(),
      owner: OWNER,
      repo: REPO,
      prNumber: 3,
      baseSha: "base-sha",
      headSha: "head-sha",
      installationId: 999,
    });

    assert.equal(octokit._comments.length, 1);
    // A brand-new spec has no prior contract to break - should report no
    // breaking changes, only additions.
    assert.match(octokit._comments[0], /no changes detected|non-breaking/i);
    assert.equal(octokit._statuses.at(-1).state, "success");
  });

  test("posts a clear error comment and sets an error status instead of crashing on invalid YAML", async () => {
    const octokit = createFakeOctokit({
      "base-sha:openapi.yaml": baseSpecYaml,
      "head-sha:openapi.yaml": "this is: not: valid: yaml: [[[",
    });
    const collection = createFakeCollection();

    await reviewApiChanges({
      octokit,
      acknowledgmentsCollection: collection,
      changesCollection: createFakeCollection(),
      owner: OWNER,
      repo: REPO,
      prNumber: 4,
      baseSha: "base-sha",
      headSha: "head-sha",
      installationId: 999,
    });

    assert.equal(octokit._comments.length, 1);
    assert.match(octokit._comments[0], /couldn't parse/i);
    assert.equal(octokit._statuses.at(-1).state, "error");
  });

  test("respects a .guardian.yml override for a non-default spec path", async () => {
    const octokit = createFakeOctokit({
      "head-sha:.guardian.yml": "specPath: contracts/api.yaml",
      "base-sha:.guardian.yml": "specPath: contracts/api.yaml",
      "base-sha:contracts/api.yaml": baseSpecYaml,
      "head-sha:contracts/api.yaml": headSpecYamlWithBreakingChange,
    });
    const collection = createFakeCollection();

    await reviewApiChanges({
      octokit,
      acknowledgmentsCollection: collection,
      changesCollection: createFakeCollection(),
      owner: OWNER,
      repo: REPO,
      prNumber: 5,
      baseSha: "base-sha",
      headSha: "head-sha",
      installationId: 999,
    });

    assert.equal(octokit._comments.length, 1);
    assert.match(octokit._comments[0], /contracts\/api\.yaml/);
  });

  test("an already-acknowledged breaking change sets success status and skips the AI call/link", async () => {
    const octokit = createFakeOctokit({
      "base-sha:openapi.yaml": baseSpecYaml,
      "head-sha:openapi.yaml": headSpecYamlWithBreakingChange,
    });
    const collection = createFakeCollection();
    await recordAcknowledgment(collection, {
      owner: OWNER,
      repo: REPO,
      prNumber: 6,
      sha: "head-sha",
      installationId: 999,
    });

    await reviewApiChanges({
      octokit,
      acknowledgmentsCollection: collection,
      changesCollection: createFakeCollection(),
      owner: OWNER,
      repo: REPO,
      prNumber: 6,
      baseSha: "base-sha",
      headSha: "head-sha",
      installationId: 999,
    });

    assert.equal(octokit._comments.length, 1);
    assert.doesNotMatch(
      octokit._comments[0],
      /Click here to acknowledge/,
      "an already-acknowledged change shouldn't offer to acknowledge again"
    );
    assert.equal(octokit._statuses.at(-1).state, "success");
  });
});

describe("reviewApiChanges: GraphQL schemas (full pipeline)", () => {
  const baseSchema = `
    type User { id: ID! name: String }
    type Query { viewer: User }
  `;
  const headSchemaWithBreakingChange = `
    type User { id: ID! }
    type Query { viewer: User }
  `;

  test("detects a real breaking change in schema.graphql via the full pipeline", async () => {
    const octokit = createFakeOctokit({
      "base-sha:schema.graphql": baseSchema,
      "head-sha:schema.graphql": headSchemaWithBreakingChange,
    });
    const collection = createFakeCollection();

    await reviewApiChanges({
      octokit,
      acknowledgmentsCollection: collection,
      changesCollection: createFakeCollection(),
      owner: OWNER,
      repo: REPO,
      prNumber: 10,
      baseSha: "base-sha",
      headSha: "head-sha",
      installationId: 999,
    });

    assert.equal(octokit._comments.length, 1);
    assert.match(octokit._comments[0], /breaking change/);
    assert.match(octokit._comments[0], /User\.name was removed/);
    assert.match(octokit._comments[0], /acknowledge/i);

    assert.equal(octokit._statuses.length, 2, "pending then a final status, same as the OpenAPI path");
    assert.equal(octokit._statuses[0].state, "pending");
    assert.equal(octokit._statuses[1].state, "failure");
  });

  test("a clean GraphQL schema change sets success status, same as a clean OpenAPI change", async () => {
    const octokit = createFakeOctokit({
      "base-sha:schema.graphql": baseSchema,
      "head-sha:schema.graphql": `
        type User { id: ID! name: String, newField: Int }
        type Query { viewer: User }
      `,
    });

    await reviewApiChanges({
      octokit,
      acknowledgmentsCollection: createFakeCollection(),
      changesCollection: createFakeCollection(),
      owner: OWNER,
      repo: REPO,
      prNumber: 11,
      baseSha: "base-sha",
      headSha: "head-sha",
      installationId: 999,
    });

    assert.equal(octokit._statuses.at(-1).state, "success");
    assert.match(octokit._comments[0], /no changes detected|non-breaking/i);
  });

  test("posts a clear error and sets an error status on invalid SDL, matching the OpenAPI parse-error behavior", async () => {
    const octokit = createFakeOctokit({
      "base-sha:schema.graphql": baseSchema,
      "head-sha:schema.graphql": "this is { not valid SDL at all",
    });

    await reviewApiChanges({
      octokit,
      acknowledgmentsCollection: createFakeCollection(),
      changesCollection: createFakeCollection(),
      owner: OWNER,
      repo: REPO,
      prNumber: 12,
      baseSha: "base-sha",
      headSha: "head-sha",
      installationId: 999,
    });

    assert.equal(octokit._comments.length, 1);
    assert.match(octokit._comments[0], /couldn't parse/i);
    assert.equal(octokit._statuses.at(-1).state, "error");
  });

  test("acknowledging a GraphQL breaking change flips the status to success on redelivery, same as OpenAPI", async () => {
    const octokit = createFakeOctokit({
      "base-sha:schema.graphql": baseSchema,
      "head-sha:schema.graphql": headSchemaWithBreakingChange,
    });
    const collection = createFakeCollection();
    await recordAcknowledgment(collection, {
      owner: OWNER,
      repo: REPO,
      prNumber: 13,
      sha: "head-sha",
      installationId: 999,
    });

    await reviewApiChanges({
      octokit,
      acknowledgmentsCollection: collection,
      changesCollection: createFakeCollection(),
      owner: OWNER,
      repo: REPO,
      prNumber: 13,
      baseSha: "base-sha",
      headSha: "head-sha",
      installationId: 999,
    });

    assert.equal(octokit._statuses.at(-1).state, "success");
  });
});

describe("reviewApiChanges: Slack notifications", () => {
  const baseSpecYaml = `
openapi: 3.0.0
paths:
  /users:
    post:
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                name:
                  type: string
              required: [name]
`;
  const headSpecYamlWithBreakingChange = `
openapi: 3.0.0
paths:
  /users:
    post:
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                name:
                  type: string
                email:
                  type: string
              required: [name, email]
`;

  // reviewApiChanges calls sendSlackNotification without injecting a
  // fetchImpl, so it falls through to the real global fetch - stubbing
  // globalThis.fetch for the duration of each test is what lets these
  // tests verify the pipeline's actual Slack-triggering logic (not just
  // the notification module in isolation) without hitting the network.
  let originalFetch;
  function stubFetch(impl) {
    originalFetch = globalThis.fetch;
    globalThis.fetch = impl;
  }
  function restoreFetch() {
    globalThis.fetch = originalFetch;
  }

  test("fires a Slack notification for a new unacknowledged breaking change when SLACK_WEBHOOK_URL is set", async () => {
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/fake";
    const calls = [];
    stubFetch(async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200 };
    });

    try {
      const octokit = createFakeOctokit({
        "base-sha:openapi.yaml": baseSpecYaml,
        "head-sha:openapi.yaml": headSpecYamlWithBreakingChange,
      });

      await reviewApiChanges({
        octokit,
        acknowledgmentsCollection: createFakeCollection(),
        changesCollection: createFakeCollection(),
        owner: OWNER,
        repo: REPO,
        prNumber: 20,
        baseSha: "base-sha",
        headSha: "head-sha",
        installationId: 999,
      });

      assert.equal(calls.length, 1, "should post exactly one Slack notification");
      assert.equal(calls[0].url, "https://hooks.slack.com/services/fake");
      const body = JSON.parse(calls[0].options.body);
      assert.match(body.text, /venom\/sandbox/);
      assert.match(body.text, /#20/);
    } finally {
      restoreFetch();
      delete process.env.SLACK_WEBHOOK_URL;
    }
  });

  test("does NOT fire Slack when SLACK_WEBHOOK_URL is not configured", async () => {
    delete process.env.SLACK_WEBHOOK_URL;
    let called = false;
    stubFetch(async () => {
      called = true;
      return { ok: true, status: 200 };
    });

    try {
      const octokit = createFakeOctokit({
        "base-sha:openapi.yaml": baseSpecYaml,
        "head-sha:openapi.yaml": headSpecYamlWithBreakingChange,
      });

      await reviewApiChanges({
        octokit,
        acknowledgmentsCollection: createFakeCollection(),
        changesCollection: createFakeCollection(),
        owner: OWNER,
        repo: REPO,
        prNumber: 21,
        baseSha: "base-sha",
        headSha: "head-sha",
        installationId: 999,
      });

      assert.equal(called, false, "no webhook URL configured means no network call at all");
    } finally {
      restoreFetch();
    }
  });

  test("does NOT fire Slack for an already-acknowledged breaking change", async () => {
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/fake";
    let called = false;
    stubFetch(async () => {
      called = true;
      return { ok: true, status: 200 };
    });

    try {
      const octokit = createFakeOctokit({
        "base-sha:openapi.yaml": baseSpecYaml,
        "head-sha:openapi.yaml": headSpecYamlWithBreakingChange,
      });
      const collection = createFakeCollection();
      await recordAcknowledgment(collection, {
        owner: OWNER,
        repo: REPO,
        prNumber: 22,
        sha: "head-sha",
        installationId: 999,
      });

      await reviewApiChanges({
        octokit,
        acknowledgmentsCollection: collection,
        changesCollection: createFakeCollection(),
        owner: OWNER,
        repo: REPO,
        prNumber: 22,
        baseSha: "base-sha",
        headSha: "head-sha",
        installationId: 999,
      });

      assert.equal(called, false, "already-acknowledged changes shouldn't re-notify");
    } finally {
      restoreFetch();
      delete process.env.SLACK_WEBHOOK_URL;
    }
  });

  test("does NOT fire Slack for a clean (non-breaking) change", async () => {
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/fake";
    let called = false;
    stubFetch(async () => {
      called = true;
      return { ok: true, status: 200 };
    });

    try {
      const octokit = createFakeOctokit({
        "base-sha:openapi.yaml": baseSpecYaml,
        "head-sha:openapi.yaml": baseSpecYaml, // identical - no changes at all
      });

      await reviewApiChanges({
        octokit,
        acknowledgmentsCollection: createFakeCollection(),
        changesCollection: createFakeCollection(),
        owner: OWNER,
        repo: REPO,
        prNumber: 23,
        baseSha: "base-sha",
        headSha: "head-sha",
        installationId: 999,
      });

      assert.equal(called, false, "a clean PR has nothing that needs Slack's attention");
    } finally {
      restoreFetch();
      delete process.env.SLACK_WEBHOOK_URL;
    }
  });

  test("a Slack failure does not break the rest of the review (comment and status still complete)", async () => {
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/fake";
    stubFetch(async () => {
      throw new Error("Slack is down");
    });

    try {
      const octokit = createFakeOctokit({
        "base-sha:openapi.yaml": baseSpecYaml,
        "head-sha:openapi.yaml": headSpecYamlWithBreakingChange,
      });

      // Should not throw, despite Slack being completely unreachable.
      await reviewApiChanges({
        octokit,
        acknowledgmentsCollection: createFakeCollection(),
        changesCollection: createFakeCollection(),
        owner: OWNER,
        repo: REPO,
        prNumber: 24,
        baseSha: "base-sha",
        headSha: "head-sha",
        installationId: 999,
      });

      assert.equal(octokit._comments.length, 1, "the PR comment should still be posted");
      assert.equal(octokit._statuses.at(-1).state, "failure", "the commit status should still be set correctly");
    } finally {
      restoreFetch();
      delete process.env.SLACK_WEBHOOK_URL;
    }
  });
});
