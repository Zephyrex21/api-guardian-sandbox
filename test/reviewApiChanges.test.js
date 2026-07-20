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
  test("finds openapi.yaml with no config present", async () => {
    const octokit = createFakeOctokit({ "abc123:openapi.yaml": "openapi: 3.0.0" });
    const result = await resolveSpecFile(octokit, { owner: OWNER, repo: REPO, ref: "abc123" });
    assert.equal(result.path, "openapi.yaml");
    assert.equal(result.content, "openapi: 3.0.0");
  });

  test("falls back to openapi.json if .yaml doesn't exist", async () => {
    const octokit = createFakeOctokit({ "abc123:openapi.json": '{"openapi":"3.0.0"}' });
    const result = await resolveSpecFile(octokit, { owner: OWNER, repo: REPO, ref: "abc123" });
    assert.equal(result.path, "openapi.json");
  });

  test("respects a .guardian.yml override even if a default-named file also exists", async () => {
    const octokit = createFakeOctokit({
      "abc123:.guardian.yml": "specPath: api/spec.yaml",
      "abc123:api/spec.yaml": "openapi: 3.0.0",
      "abc123:openapi.yaml": "openapi: 3.0.0 # should be ignored",
    });
    const result = await resolveSpecFile(octokit, { owner: OWNER, repo: REPO, ref: "abc123" });
    assert.equal(result.path, "api/spec.yaml");
  });

  test("returns null path/content when nothing is found anywhere", async () => {
    const octokit = createFakeOctokit({});
    const result = await resolveSpecFile(octokit, { owner: OWNER, repo: REPO, ref: "abc123" });
    assert.equal(result.path, null);
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
