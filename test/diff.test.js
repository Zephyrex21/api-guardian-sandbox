import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { diffSpecs } from "../src/diff/index.js";

// Minimal valid OpenAPI wrapper so every test only has to specify the
// `paths` object it actually cares about.
function spec(paths) {
  return { openapi: "3.0.0", info: { title: "test", version: "1.0.0" }, paths };
}

function jsonBody(schema) {
  return { content: { "application/json": { schema } } };
}

function findChange(result, type) {
  return result.allChanges.find((c) => c.type === type);
}

describe("path and operation level", () => {
  test("removed path is breaking, high severity", () => {
    const base = spec({ "/users": { get: { responses: { 200: jsonBody({ type: "object" }) } } } });
    const head = spec({});
    const result = diffSpecs(base, head);
    const change = findChange(result, "path-removed");
    assert.ok(change, "expected a path-removed change");
    assert.equal(change.breaking, true);
    assert.equal(change.severity, "high");
  });

  test("added path is non-breaking", () => {
    const base = spec({});
    const head = spec({ "/users": { get: { responses: { 200: jsonBody({ type: "object" }) } } } });
    const result = diffSpecs(base, head);
    const change = findChange(result, "path-added");
    assert.ok(change);
    assert.equal(change.breaking, false);
  });

  test("removed operation (method) is breaking, high severity", () => {
    const base = spec({
      "/users": {
        get: { responses: { 200: jsonBody({ type: "object" }) } },
        post: { responses: { 201: jsonBody({ type: "object" }) } },
      },
    });
    const head = spec({ "/users": { get: { responses: { 200: jsonBody({ type: "object" }) } } } });
    const result = diffSpecs(base, head);
    const change = findChange(result, "operation-removed");
    assert.ok(change);
    assert.equal(change.location, "POST /users");
    assert.equal(change.breaking, true);
    assert.equal(change.severity, "high");
  });
});

describe("request-side field changes", () => {
  function withRequestBody(schema) {
    return spec({
      "/users": {
        post: { requestBody: jsonBody(schema), responses: { 201: jsonBody({ type: "object" }) } },
      },
    });
  }

  test("new required field in request is breaking, high severity", () => {
    const base = withRequestBody({ type: "object", properties: { name: { type: "string" } } });
    const head = withRequestBody({
      type: "object",
      properties: { name: { type: "string" }, email: { type: "string" } },
      required: ["email"],
    });
    const result = diffSpecs(base, head);
    const change = findChange(result, "field-required-added");
    assert.ok(change);
    assert.equal(change.breaking, true);
    assert.equal(change.severity, "high");
  });

  test("new optional field in request is non-breaking", () => {
    const base = withRequestBody({ type: "object", properties: { name: { type: "string" } } });
    const head = withRequestBody({
      type: "object",
      properties: { name: { type: "string" }, nickname: { type: "string" } },
    });
    const result = diffSpecs(base, head);
    const change = findChange(result, "field-optional-added");
    assert.ok(change);
    assert.equal(change.breaking, false);
  });

  test("removed required field in request is breaking, medium severity", () => {
    const base = withRequestBody({
      type: "object",
      properties: { name: { type: "string" }, email: { type: "string" } },
      required: ["email"],
    });
    const head = withRequestBody({
      type: "object",
      properties: { name: { type: "string" } },
    });
    const result = diffSpecs(base, head);
    const change = findChange(result, "field-removed");
    assert.ok(change);
    assert.equal(change.breaking, true);
    assert.equal(change.severity, "medium");
  });

  test("field type change is breaking, high severity, in the request", () => {
    const base = withRequestBody({ type: "object", properties: { age: { type: "string" } } });
    const head = withRequestBody({ type: "object", properties: { age: { type: "integer" } } });
    const result = diffSpecs(base, head);
    const change = findChange(result, "type-changed");
    assert.ok(change);
    assert.equal(change.breaking, true);
    assert.equal(change.severity, "high");
  });

  test("narrowed enum in request is breaking, medium severity", () => {
    const base = withRequestBody({
      type: "object",
      properties: { role: { type: "string", enum: ["admin", "editor", "viewer"] } },
    });
    const head = withRequestBody({
      type: "object",
      properties: { role: { type: "string", enum: ["admin", "viewer"] } },
    });
    const result = diffSpecs(base, head);
    const change = findChange(result, "enum-narrowed");
    assert.ok(change);
    assert.equal(change.breaking, true);
    assert.equal(change.severity, "medium");
    assert.deepEqual(change.meta.removed, ["editor"]);
  });

  test("widened enum in request is non-breaking", () => {
    const base = withRequestBody({
      type: "object",
      properties: { role: { type: "string", enum: ["admin", "viewer"] } },
    });
    const head = withRequestBody({
      type: "object",
      properties: { role: { type: "string", enum: ["admin", "viewer", "editor"] } },
    });
    const result = diffSpecs(base, head);
    const change = findChange(result, "enum-widened");
    assert.ok(change);
    assert.equal(change.breaking, false);
  });

  test("field rename (remove + add with identical schema) is detected as one change, not two", () => {
    const base = withRequestBody({
      type: "object",
      properties: { full_name: { type: "string" } },
    });
    const head = withRequestBody({
      type: "object",
      properties: { fullName: { type: "string" } },
    });
    const result = diffSpecs(base, head);

    const rename = findChange(result, "field-renamed");
    assert.ok(rename, "expected a field-renamed change");
    assert.equal(rename.breaking, true);
    assert.equal(rename.severity, "high");
    assert.equal(rename.meta.from, "full_name");
    assert.equal(rename.meta.to, "fullName");

    // Should NOT also report this as a separate remove + add
    assert.equal(findChange(result, "field-removed"), undefined);
    assert.equal(findChange(result, "field-optional-added"), undefined);
    assert.equal(findChange(result, "field-required-added"), undefined);
  });
});

describe("response-side field changes (the asymmetric cases)", () => {
  function withResponseBody(schema) {
    return spec({
      "/users/{id}": { get: { responses: { 200: jsonBody(schema) } } },
    });
  }

  test("removed field in response is breaking, high severity (stricter than request-side removal)", () => {
    const base = withResponseBody({
      type: "object",
      properties: { id: { type: "string" }, email: { type: "string" } },
    });
    const head = withResponseBody({ type: "object", properties: { id: { type: "string" } } });
    const result = diffSpecs(base, head);
    const change = findChange(result, "field-removed");
    assert.ok(change);
    assert.equal(change.breaking, true);
    assert.equal(change.severity, "high");
  });

  test("new field in response is non-breaking even if marked required (server just guarantees more)", () => {
    const base = withResponseBody({ type: "object", properties: { id: { type: "string" } } });
    const head = withResponseBody({
      type: "object",
      properties: { id: { type: "string" }, createdAt: { type: "string" } },
      required: ["createdAt"],
    });
    const result = diffSpecs(base, head);
    const change = findChange(result, "field-required-added");
    assert.ok(change);
    assert.equal(change.breaking, false, "response-side required-field additions should be safe");
  });

  test("field becoming optional in response is breaking (asymmetric to request-side, which is safe)", () => {
    const base = withResponseBody({
      type: "object",
      properties: { id: { type: "string" }, email: { type: "string" } },
      required: ["email"],
    });
    const head = withResponseBody({
      type: "object",
      properties: { id: { type: "string" }, email: { type: "string" } },
    });
    const result = diffSpecs(base, head);
    const change = findChange(result, "field-became-optional");
    assert.ok(change);
    assert.equal(change.breaking, true);
    assert.equal(change.severity, "medium");
  });

  test("widened enum in response IS breaking (opposite of request-side widening)", () => {
    const base = withResponseBody({
      type: "object",
      properties: { status: { type: "string", enum: ["active", "inactive"] } },
    });
    const head = withResponseBody({
      type: "object",
      properties: { status: { type: "string", enum: ["active", "inactive", "pending"] } },
    });
    const result = diffSpecs(base, head);
    const change = findChange(result, "enum-widened");
    assert.ok(change);
    assert.equal(
      change.breaking,
      true,
      "clients without a default case for the new response value can break"
    );
    assert.equal(change.severity, "low");
  });

  test("narrowed enum in response is non-breaking (opposite of request-side narrowing)", () => {
    const base = withResponseBody({
      type: "object",
      properties: { status: { type: "string", enum: ["active", "inactive", "pending"] } },
    });
    const head = withResponseBody({
      type: "object",
      properties: { status: { type: "string", enum: ["active", "inactive"] } },
    });
    const result = diffSpecs(base, head);
    const change = findChange(result, "enum-narrowed");
    assert.ok(change);
    assert.equal(change.breaking, false);
  });
});

describe("parameters", () => {
  function withParams(params) {
    return spec({ "/users": { get: { parameters: params, responses: { 200: jsonBody({}) } } } });
  }

  test("new required parameter is breaking, high severity", () => {
    const base = withParams([]);
    const head = withParams([{ name: "region", in: "query", required: true, schema: { type: "string" } }]);
    const result = diffSpecs(base, head);
    const change = findChange(result, "parameter-required-added");
    assert.ok(change);
    assert.equal(change.breaking, true);
    assert.equal(change.severity, "high");
  });

  test("removed parameter is breaking, medium severity", () => {
    const base = withParams([{ name: "region", in: "query", required: false, schema: { type: "string" } }]);
    const head = withParams([]);
    const result = diffSpecs(base, head);
    const change = findChange(result, "parameter-removed");
    assert.ok(change);
    assert.equal(change.breaking, true);
    assert.equal(change.severity, "medium");
  });

  test("parameter becoming required is breaking, high severity", () => {
    const base = withParams([{ name: "limit", in: "query", required: false, schema: { type: "integer" } }]);
    const head = withParams([{ name: "limit", in: "query", required: true, schema: { type: "integer" } }]);
    const result = diffSpecs(base, head);
    const change = findChange(result, "parameter-became-required");
    assert.ok(change);
    assert.equal(change.breaking, true);
    assert.equal(change.severity, "high");
  });

  test("same param name in different locations (path vs query) are treated as distinct parameters", () => {
    const base = withParams([{ name: "id", in: "path", required: true, schema: { type: "string" } }]);
    const head = withParams([
      { name: "id", in: "path", required: true, schema: { type: "string" } },
      { name: "id", in: "query", required: false, schema: { type: "string" } },
    ]);
    const result = diffSpecs(base, head);
    const change = findChange(result, "parameter-optional-added");
    assert.ok(change);
    assert.equal(change.location, "GET /users > parameter 'query:id'");
  });
});

describe("real-world-shaped scenario", () => {
  test("a realistic multi-change PR is classified correctly end to end", () => {
    // Modeled on a plausible real API evolution: an e-commerce order
    // endpoint that (a) drops a deprecated field, (b) requires a new
    // shipping region, and (c) adds a new optional promo code field.
    const base = spec({
      "/orders": {
        post: {
          requestBody: jsonBody({
            type: "object",
            properties: {
              customerId: { type: "string" },
              legacyDiscountCode: { type: "string" },
              items: { type: "array", items: { type: "object", properties: { sku: { type: "string" } } } },
            },
            required: ["customerId"],
          }),
          responses: {
            201: jsonBody({
              type: "object",
              properties: { orderId: { type: "string" }, status: { type: "string", enum: ["pending", "confirmed"] } },
              required: ["orderId", "status"],
            }),
          },
        },
      },
    });

    const head = spec({
      "/orders": {
        post: {
          requestBody: jsonBody({
            type: "object",
            properties: {
              customerId: { type: "string" },
              shippingRegion: { type: "string" },
              promoCode: { type: "string" },
              items: { type: "array", items: { type: "object", properties: { sku: { type: "string" } } } },
            },
            required: ["customerId", "shippingRegion"],
          }),
          responses: {
            201: jsonBody({
              type: "object",
              properties: {
                orderId: { type: "string" },
                status: { type: "string", enum: ["pending", "confirmed", "cancelled"] },
              },
              required: ["orderId", "status"],
            }),
          },
        },
      },
    });

    const result = diffSpecs(base, head);

    assert.ok(findChange(result, "field-removed"), "legacyDiscountCode removal should be flagged");
    assert.ok(findChange(result, "field-required-added"), "shippingRegion should be flagged as breaking");
    assert.ok(findChange(result, "field-optional-added"), "promoCode should be flagged as non-breaking");
    assert.ok(findChange(result, "enum-widened"), "new 'cancelled' status should be flagged (response-side, breaking)");

    // Sanity check on the overall verdict: this PR should NOT be waved
    // through as safe - it has real breaking changes a human should see.
    assert.ok(result.breakingChanges.length >= 2);
  });
});
