import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { diffGraphQLSchemas } from "../../src/graphql-diff/index.js";

function findChange(result, type) {
  return result.allChanges.find((c) => c.type === type);
}

describe("diffGraphQLSchemas: new schema (no base)", () => {
  test("a schema introduced for the first time has no breaking changes", () => {
    const head = `
      type User { id: ID! name: String }
      type Query { viewer: User }
    `;
    const result = diffGraphQLSchemas(null, head);
    assert.equal(result.breakingChanges.length, 0);
    assert.equal(findChange(result, "schema-introduced").breaking, false);
  });
});

describe("diffGraphQLSchemas: breaking changes", () => {
  test("a removed field is breaking, high severity", () => {
    const base = `type User { id: ID! name: String } type Query { viewer: User }`;
    const head = `type User { id: ID! } type Query { viewer: User }`;
    const result = diffGraphQLSchemas(base, head);
    const change = findChange(result, "FIELD_REMOVED");
    assert.ok(change);
    assert.equal(change.breaking, true);
    assert.equal(change.severity, "high");
    assert.match(change.message, /User\.name was removed/);
  });

  test("a removed type is breaking, high severity", () => {
    const base = `type User { id: ID! } type Admin { id: ID! } type Query { viewer: User, admin: Admin }`;
    const head = `type User { id: ID! } type Query { viewer: User }`;
    const result = diffGraphQLSchemas(base, head);
    const change = findChange(result, "TYPE_REMOVED");
    assert.ok(change);
    assert.equal(change.breaking, true);
    assert.equal(change.severity, "high");
  });

  test("a new required argument is breaking, high severity", () => {
    const base = `type Query { user(id: ID!): String }`;
    const head = `type Query { user(id: ID!, region: String!): String }`;
    const result = diffGraphQLSchemas(base, head);
    const change = findChange(result, "REQUIRED_ARG_ADDED");
    assert.ok(change);
    assert.equal(change.breaking, true);
    assert.equal(change.severity, "high");
  });

  test("a value removed from an enum is breaking, high severity", () => {
    const base = `enum Status { ACTIVE INACTIVE PENDING } type Query { status: Status }`;
    const head = `enum Status { ACTIVE INACTIVE } type Query { status: Status }`;
    const result = diffGraphQLSchemas(base, head);
    const change = findChange(result, "VALUE_REMOVED_FROM_ENUM");
    assert.ok(change);
    assert.equal(change.breaking, true);
    assert.equal(change.severity, "high");
  });

  test("a field changing type is breaking, high severity", () => {
    const base = `type User { age: String } type Query { user: User }`;
    const head = `type User { age: Int } type Query { user: User }`;
    const result = diffGraphQLSchemas(base, head);
    const change = findChange(result, "FIELD_CHANGED_KIND");
    assert.ok(change);
    assert.equal(change.breaking, true);
    assert.equal(change.severity, "high");
  });
});

describe("diffGraphQLSchemas: dangerous (breaking:true, medium severity)", () => {
  test("a value added to an enum is flagged, medium severity", () => {
    const base = `enum Status { ACTIVE INACTIVE } type Query { status: Status }`;
    const head = `enum Status { ACTIVE INACTIVE PENDING } type Query { status: Status }`;
    const result = diffGraphQLSchemas(base, head);
    const change = findChange(result, "VALUE_ADDED_TO_ENUM");
    assert.ok(change);
    assert.equal(
      change.breaking,
      true,
      "dangerous changes are flagged for human attention even though they won't error at query time"
    );
    assert.equal(change.severity, "medium");
  });

  test("a new optional argument is flagged, medium severity", () => {
    const base = `type Query { user(id: ID!): String }`;
    const head = `type Query { user(id: ID!, nickname: String): String }`;
    const result = diffGraphQLSchemas(base, head);
    const change = findChange(result, "OPTIONAL_ARG_ADDED");
    assert.ok(change);
    assert.equal(change.breaking, true);
    assert.equal(change.severity, "medium");
  });
});

describe("diffGraphQLSchemas: safe changes", () => {
  test("a new field is non-breaking", () => {
    const base = `type Query { viewer: String }`;
    const head = `type Query { viewer: String, newField: Int }`;
    const result = diffGraphQLSchemas(base, head);
    const change = findChange(result, "FIELD_ADDED");
    assert.ok(change);
    assert.equal(change.breaking, false);
  });

  test("a new type is non-breaking", () => {
    const base = `type Query { viewer: String }`;
    const head = `type NewType { id: ID! } type Query { viewer: String, newThing: NewType }`;
    const result = diffGraphQLSchemas(base, head);
    const change = findChange(result, "TYPE_ADDED");
    assert.ok(change);
    assert.equal(change.breaking, false);
  });
});

describe("diffGraphQLSchemas: overall result shape", () => {
  test("a real multi-change schema evolution is classified correctly end to end", () => {
    const base = `
      enum OrderStatus { PENDING CONFIRMED }
      type Order { id: ID! legacyNote: String status: OrderStatus }
      type Query { order(id: ID!): Order }
    `;
    const head = `
      enum OrderStatus { PENDING CONFIRMED CANCELLED }
      type Order { id: ID! status: OrderStatus trackingNumber: String }
      type Query { order(id: ID!, includeHistory: Boolean): Order }
    `;
    const result = diffGraphQLSchemas(base, head);

    assert.ok(findChange(result, "FIELD_REMOVED"), "legacyNote removal should be flagged");
    assert.ok(findChange(result, "VALUE_ADDED_TO_ENUM"), "CANCELLED should be flagged as dangerous");
    assert.ok(findChange(result, "FIELD_ADDED"), "trackingNumber addition should be flagged as safe");
    assert.ok(findChange(result, "OPTIONAL_ARG_ADDED"), "includeHistory arg should be flagged as dangerous");

    assert.ok(result.breakingChanges.length >= 2);
    assert.ok(result.nonBreakingChanges.length >= 1);
  });

  test("throws a clear parse error on invalid SDL rather than a cryptic internal error", () => {
    assert.throws(() => diffGraphQLSchemas("type Query { viewer: String }", "this is not { valid SDL at all"));
  });
});
