import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { formatComment } from "../../src/format/formatComment.js";

const RESULT_WITH_BREAKING = {
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
};

describe("formatComment with AI data", () => {
  test("omitting ai (or passing null) produces identical output to Phase 2", () => {
    const withoutArg = formatComment(RESULT_WITH_BREAKING, "openapi.yaml");
    const withNull = formatComment(RESULT_WITH_BREAKING, "openapi.yaml", null);
    assert.equal(withoutArg, withNull);
    assert.doesNotMatch(withoutArg, /💡/, "no AI note marker should appear without ai data");
  });

  test("includes the AI summary near the top when provided", () => {
    const ai = { summary: "This adds a required field that breaks old clients.", notes: new Map() };
    const comment = formatComment(RESULT_WITH_BREAKING, "openapi.yaml", ai);
    assert.match(comment, /This adds a required field that breaks old clients\./);
  });

  test("attaches a per-change note under the matching change", () => {
    const ai = {
      summary: "Summary here.",
      notes: new Map([["POST /orders > request body.region", "Send a 'region' value with every order."]]),
    };
    const comment = formatComment(RESULT_WITH_BREAKING, "openapi.yaml", ai);
    assert.match(comment, /💡 Send a 'region' value with every order\./);
  });

  test("a change with no matching note in the map gets no note line (no crash on missing key)", () => {
    const ai = { summary: "Summary.", notes: new Map([["some/other/location", "irrelevant"]]) };
    const comment = formatComment(RESULT_WITH_BREAKING, "openapi.yaml", ai);
    assert.doesNotMatch(comment, /💡/);
  });
});
