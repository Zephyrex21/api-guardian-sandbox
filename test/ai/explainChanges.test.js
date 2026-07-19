import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { explainChanges } from "../../src/ai/explainChanges.js";

const SAMPLE_RESULT = {
  breakingChanges: [
    {
      type: "field-required-added",
      breaking: true,
      severity: "high",
      location: "POST /orders > request body.region",
      message: "New required field 'region' added",
    },
  ],
  nonBreakingChanges: [],
  allChanges: [
    {
      type: "field-required-added",
      breaking: true,
      severity: "high",
      location: "POST /orders > request body.region",
      message: "New required field 'region' added",
    },
  ],
};

const GOOD_RESPONSE = JSON.stringify({
  summary: "This PR adds a required field that will break existing clients.",
  notes: [{ location: "POST /orders > request body.region", note: "Add a 'region' field to your request." }],
});

describe("explainChanges", () => {
  test("returns null immediately when no providers are configured", async () => {
    const result = await explainChanges(SAMPLE_RESULT, []);
    assert.equal(result, null);
  });

  test("uses the primary provider when it succeeds", async () => {
    const primary = async () => GOOD_RESPONSE;
    const fallback = async () => {
      throw new Error("should not be called");
    };
    const result = await explainChanges(SAMPLE_RESULT, [primary, fallback]);
    assert.equal(result.summary, "This PR adds a required field that will break existing clients.");
    assert.equal(result.notes.get("POST /orders > request body.region"), "Add a 'region' field to your request.");
  });

  test("falls back to the second provider when the first throws", async () => {
    const primary = async () => {
      throw new Error("Groq is down");
    };
    const fallback = async () => GOOD_RESPONSE;
    const result = await explainChanges(SAMPLE_RESULT, [primary, fallback]);
    assert.ok(result, "should still get a result from the fallback");
    assert.equal(result.summary, "This PR adds a required field that will break existing clients.");
  });

  test("falls back to the second provider when the first returns unparseable JSON", async () => {
    const primary = async () => "not json at all, oops";
    const fallback = async () => GOOD_RESPONSE;
    const result = await explainChanges(SAMPLE_RESULT, [primary, fallback]);
    assert.ok(result);
    assert.equal(result.summary, "This PR adds a required field that will break existing clients.");
  });

  test("returns null (not a throw) when every provider fails", async () => {
    const primary = async () => {
      throw new Error("Groq down");
    };
    const fallback = async () => {
      throw new Error("Gemini down too");
    };
    const result = await explainChanges(SAMPLE_RESULT, [primary, fallback]);
    assert.equal(result, null, "total AI failure should degrade gracefully, never throw");
  });

  test("rejects a response missing the required shape (summary/notes)", async () => {
    const primary = async () => JSON.stringify({ somethingElse: true });
    const result = await explainChanges(SAMPLE_RESULT, [primary]);
    assert.equal(result, null);
  });
});
