import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createFakeCollection } from "../fakeCollection.js";
import { getRecentChanges, getStats, getTrackedRepos } from "../../src/api/dashboardData.js";

async function seed(collection, changes) {
  for (const change of changes) {
    await collection.insertOne(change);
  }
}

describe("getRecentChanges", () => {
  test("returns changes sorted newest first", async () => {
    const collection = createFakeCollection();
    await seed(collection, [
      { owner: "a", repo: "r", createdAt: new Date("2026-01-01") },
      { owner: "a", repo: "r", createdAt: new Date("2026-03-01") },
      { owner: "a", repo: "r", createdAt: new Date("2026-02-01") },
    ]);

    const result = await getRecentChanges(collection);
    assert.deepEqual(
      result.map((c) => c.createdAt.getMonth()),
      [2, 1, 0] // March, Feb, Jan
    );
  });

  test("respects the limit", async () => {
    const collection = createFakeCollection();
    await seed(
      collection,
      Array.from({ length: 10 }, (_, i) => ({ owner: "a", repo: "r", createdAt: new Date(2026, 0, i + 1) }))
    );
    const result = await getRecentChanges(collection, { limit: 3 });
    assert.equal(result.length, 3);
  });
});

describe("getStats", () => {
  test("counts breaking vs clean and pending acknowledgments correctly", async () => {
    const collection = createFakeCollection();
    await seed(collection, [
      { owner: "a", repo: "r", breakingCount: 0, acknowledged: true, createdAt: new Date() }, // clean
      { owner: "a", repo: "r", breakingCount: 2, acknowledged: false, createdAt: new Date() }, // pending
      { owner: "a", repo: "r", breakingCount: 1, acknowledged: true, createdAt: new Date() }, // acknowledged
    ]);

    const stats = await getStats(collection);
    assert.equal(stats.totalChanges, 3);
    assert.equal(stats.breakingChangeCount, 2);
    assert.equal(stats.cleanChangeCount, 1);
    assert.equal(stats.pendingAcknowledgments, 1);
  });

  test("returns all zeros for an empty collection instead of erroring", async () => {
    const collection = createFakeCollection();
    const stats = await getStats(collection);
    assert.deepEqual(stats, {
      totalChanges: 0,
      breakingChangeCount: 0,
      pendingAcknowledgments: 0,
      cleanChangeCount: 0,
    });
  });
});

describe("getTrackedRepos", () => {
  test("returns one entry per unique repo, using the most recent check time", async () => {
    const collection = createFakeCollection();
    await seed(collection, [
      { owner: "venom", repo: "sandbox", createdAt: new Date("2026-01-01") },
      { owner: "venom", repo: "sandbox", createdAt: new Date("2026-02-01") },
      { owner: "venom", repo: "other-repo", createdAt: new Date("2026-01-15") },
    ]);

    const repos = await getTrackedRepos(collection);
    assert.equal(repos.length, 2);
    const sandbox = repos.find((r) => r.repo === "sandbox");
    assert.equal(sandbox.lastCheckedAt.toISOString().slice(0, 10), "2026-02-01");
  });
});
