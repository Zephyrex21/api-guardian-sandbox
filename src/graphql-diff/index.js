import { buildSchema, findSchemaChanges, BreakingChangeType, DangerousChangeType } from "graphql";
import { makeChange } from "../diff/change.js";

/**
 * WHY THIS WRAPS graphql-js INSTEAD OF REIMPLEMENTING THE ALGORITHM:
 *
 * Unlike OpenAPI (where no standard library correctly encodes the
 * request/response asymmetry this project relies on), GraphQL's own
 * reference implementation already ships a correct, spec-compliant schema
 * differ (`findSchemaChanges`, stable as of graphql-js v17). Rewriting
 * type-system diffing - interfaces, unions, directives, argument
 * covariance, enum values, input vs output type rules - by hand would be
 * reinventing something the GraphQL Foundation already maintains and
 * tests against the spec itself. The actual engineering work here is
 * mapping graphql-js's categories onto this project's existing Change
 * shape, not re-deriving the categories.
 *
 * CLASSIFICATION:
 *   - BreakingChangeType (e.g. FIELD_REMOVED, REQUIRED_ARG_ADDED) -> our
 *     breaking: true, severity: "high". These will error at query time
 *     for at least some existing clients.
 *   - DangerousChangeType (e.g. VALUE_ADDED_TO_ENUM, OPTIONAL_ARG_ADDED)
 *     -> our breaking: true, severity: "medium". These won't error, but
 *     can silently change runtime behavior for clients that didn't expect
 *     the new possibility (e.g. a switch/case without a default branch
 *     hitting a new enum value) - worth a human's attention, same
 *     reasoning as the OpenAPI differ's response-side enum-widening case.
 *   - Anything else (e.g. FIELD_ADDED, TYPE_ADDED) -> breaking: false.
 *
 * KNOWN SIMPLIFICATION: graphql-js's change objects only carry a `type`
 * and a human-readable `description`, not a structured field path the
 * way this project's OpenAPI differ produces (e.g.
 * "POST /orders > request body.region"). The `location` on GraphQL
 * changes is therefore the change's type constant (e.g. "FIELD_REMOVED"),
 * with the specific type/field named inside the message text instead -
 * less precise for grouping/sorting, but the message itself is always a
 * complete, specific sentence naming exactly what changed.
 */
const breakingTypes = new Set(Object.values(BreakingChangeType));
const dangerousTypes = new Set(Object.values(DangerousChangeType));

export function diffGraphQLSchemas(baseSDL, headSDL) {
  if (!baseSDL) {
    // No prior schema to compare against (this PR introduces the schema
    // file) - nothing can be breaking yet, same treatment as a brand-new
    // OpenAPI spec in diff/index.js.
    const allChanges = [
      makeChange({
        type: "schema-introduced",
        breaking: false,
        severity: "none",
        location: "schema",
        message: "New GraphQL schema introduced - no prior schema to compare against.",
        meta: {},
      }),
    ];
    return { breakingChanges: [], nonBreakingChanges: allChanges, allChanges };
  }

  const baseSchema = buildSchema(baseSDL);
  const headSchema = buildSchema(headSDL);

  const allChanges = findSchemaChanges(baseSchema, headSchema).map((change) => {
    if (breakingTypes.has(change.type)) {
      return makeChange({
        type: change.type,
        breaking: true,
        severity: "high",
        location: change.type,
        message: change.description,
        meta: {},
      });
    }
    if (dangerousTypes.has(change.type)) {
      return makeChange({
        type: change.type,
        breaking: true,
        severity: "medium",
        location: change.type,
        message: change.description,
        meta: {},
      });
    }
    return makeChange({
      type: change.type,
      breaking: false,
      severity: "none",
      location: change.type,
      message: change.description,
      meta: {},
    });
  });

  return {
    breakingChanges: allChanges.filter((c) => c.breaking),
    nonBreakingChanges: allChanges.filter((c) => !c.breaking),
    allChanges,
  };
}
