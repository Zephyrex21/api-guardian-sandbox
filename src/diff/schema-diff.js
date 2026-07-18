import { makeChange } from "./change.js";

/**
 * THE KEY INSIGHT THIS FILE IS BUILT AROUND:
 *
 * Whether a schema change is "breaking" depends on which direction the data
 * flows, not just what changed. The same edit can be safe in one direction
 * and dangerous in the other:
 *
 *   REQUEST body/params (client -> server):
 *     - A field being REMOVED is fine for the server (client sending extra
 *       stuff is usually ignored), but breaks strongly-typed generated
 *       clients/SDKs that reference it -> breaking (medium).
 *     - A field becoming REQUIRED is dangerous: old clients that don't send
 *       it will get rejected -> breaking (high).
 *     - An enum being NARROWED is dangerous: an old client might still send
 *       a value that's no longer allowed -> breaking (medium).
 *     - An enum being WIDENED is safe: nothing old clients send stops being
 *       valid -> non-breaking.
 *
 *   RESPONSE body (server -> client):
 *     - A field being REMOVED is dangerous: client code reading that field
 *       breaks -> breaking (high).
 *     - A field becoming OPTIONAL (no longer always present) is dangerous:
 *       client code assuming it's always there breaks -> breaking (medium).
 *     - An enum being WIDENED is dangerous: a client with a switch/case (or
 *       similar) that doesn't expect the new value can break -> breaking
 *       (low - usually caught by a default case, but worth flagging).
 *     - An enum being NARROWED is safe: every value the server can now send
 *       was already something the client knew how to handle.
 *
 * This is the same covariance/contravariance idea type systems use, applied
 * to API contracts. Getting this asymmetry right is what separates a real
 * breaking-change detector from a text diff with extra steps.
 */

/**
 * @param {object} base - schema from the base/main branch
 * @param {object} head - schema from the PR branch
 * @param {object} ctx
 * @param {"request"|"response"} ctx.direction
 * @param {string} ctx.location - human-readable path for messages
 * @returns {import("./change.js").Change[]}
 */
export function diffSchema(base, head, { direction, location }) {
  const changes = [];

  if (!base || !head) {
    // Whole-schema add/remove is handled by the caller (it knows whether
    // this is a "field added" or "field removed" case, which carries more
    // context than this function has on its own).
    return changes;
  }

  changes.push(...diffType(base, head, { direction, location }));
  changes.push(...diffEnum(base, head, { direction, location }));
  changes.push(...diffProperties(base, head, { direction, location }));
  changes.push(...diffItems(base, head, { direction, location }));

  return changes;
}

function diffType(base, head, { location }) {
  if (base.type && head.type && base.type !== head.type) {
    return [
      makeChange({
        type: "type-changed",
        breaking: true,
        severity: "high",
        location,
        message: `Type changed from '${base.type}' to '${head.type}' at ${location} - existing clients sending/parsing '${base.type}' data will likely fail`,
        meta: { from: base.type, to: head.type },
      }),
    ];
  }
  return [];
}

function diffEnum(base, head, { direction, location }) {
  if (!base.enum && !head.enum) return [];

  const baseEnum = new Set(base.enum || []);
  const headEnum = new Set(head.enum || []);
  const removed = [...baseEnum].filter((v) => !headEnum.has(v));
  const added = [...headEnum].filter((v) => !baseEnum.has(v));
  const changes = [];

  if (removed.length) {
    const breaking = direction === "request";
    changes.push(
      makeChange({
        type: "enum-narrowed",
        breaking,
        severity: breaking ? "medium" : "none",
        location,
        message: breaking
          ? `Allowed values removed at ${location}: ${removed.join(", ")} - a client still sending one of these will now be rejected`
          : `Allowed response values narrowed at ${location}: ${removed.join(", ")} (safe - clients already handle every value the server can still send)`,
        meta: { removed },
      })
    );
  }

  if (added.length) {
    const breaking = direction === "response";
    changes.push(
      makeChange({
        type: "enum-widened",
        breaking,
        severity: breaking ? "low" : "none",
        location,
        message: breaking
          ? `New possible response value(s) at ${location}: ${added.join(", ")} - clients without a default/fallback case may not handle these`
          : `New allowed request value(s) at ${location}: ${added.join(", ")} (safe - existing clients aren't forced to use them)`,
        meta: { added },
      })
    );
  }

  return changes;
}

function diffProperties(base, head, { direction, location }) {
  const baseProps = base.properties || {};
  const headProps = head.properties || {};
  const baseRequired = new Set(base.required || []);
  const headRequired = new Set(head.required || []);
  const allNames = new Set([...Object.keys(baseProps), ...Object.keys(headProps)]);
  const changes = [];

  // Rename detection: a field being removed and a different field being
  // added in the same pass, with an identical schema, is far more likely a
  // rename than two unrelated changes. Catching this matters because
  // "removed + added" reads as two problems when it's really one - and the
  // fix for a rename ("update the field name you send") is different from
  // the fix for a genuine removal ("this data is gone").
  //
  // Schema equality alone is NOT enough of a signal - two unrelated string
  // fields (e.g. "legacyDiscountCode" and "shippingRegion") have identical
  // trivial schemas ({type: "string"}) without being any kind of rename.
  // We only call it a rename when the schema matches AND the names
  // themselves are recognizably the same word under naming-convention
  // differences (snake_case/camelCase/kebab-case).
  const normalizeName = (n) => n.toLowerCase().replace(/[_-]/g, "");

  const removedNames = [...allNames].filter((n) => n in baseProps && !(n in headProps));
  const addedNames = [...allNames].filter((n) => !(n in baseProps) && n in headProps);
  const renamedFrom = new Map(); // headName -> baseName
  const renamedTo = new Set(); // baseNames already matched to a rename

  for (const removedName of removedNames) {
    const match = addedNames.find(
      (addedName) =>
        !renamedFrom.has(addedName) &&
        normalizeName(addedName) === normalizeName(removedName) &&
        JSON.stringify(baseProps[removedName]) === JSON.stringify(headProps[addedName])
    );
    if (match) {
      renamedFrom.set(match, removedName);
      renamedTo.add(removedName);
    }
  }

  for (const [newName, oldName] of renamedFrom) {
    const propLocation = `${location}.${oldName}`;
    changes.push(
      makeChange({
        type: "field-renamed",
        breaking: true,
        severity: "high",
        location: propLocation,
        message: `Field '${oldName}' appears to have been renamed to '${newName}' at ${location} - existing clients using the old name will get undefined/missing data`,
        meta: { from: oldName, to: newName },
      })
    );
  }

  for (const name of allNames) {
    if (renamedTo.has(name) || renamedFrom.has(name)) continue; // already handled as a rename above

    const propLocation = `${location}.${name}`;
    const inBase = name in baseProps;
    const inHead = name in headProps;

    if (inBase && !inHead) {
      const breaking = true; // removal is breaking in both directions, severity differs
      changes.push(
        makeChange({
          type: "field-removed",
          breaking,
          severity: direction === "response" ? "high" : "medium",
          location: propLocation,
          message:
            direction === "response"
              ? `Field '${name}' removed from the response at ${propLocation} - client code reading it will get undefined/null`
              : `Field '${name}' removed from the ${direction} at ${propLocation} - generated/typed clients referencing it will break`,
          meta: {},
        })
      );
      continue;
    }

    if (!inBase && inHead) {
      const nowRequired = headRequired.has(name);
      const breaking = nowRequired && direction === "request";
      changes.push(
        makeChange({
          type: nowRequired ? "field-required-added" : "field-optional-added",
          breaking,
          severity: breaking ? "high" : "none",
          location: propLocation,
          message: breaking
            ? `New required field '${name}' added at ${propLocation} - existing clients that don't send it will be rejected`
            : `New ${nowRequired ? "required (response-guaranteed)" : "optional"} field '${name}' added at ${propLocation}`,
          meta: {},
        })
      );
      continue;
    }

    // Field exists on both sides - check whether its required-ness changed.
    const wasRequired = baseRequired.has(name);
    const isRequired = headRequired.has(name);

    if (wasRequired && !isRequired) {
      const breaking = direction === "response";
      changes.push(
        makeChange({
          type: "field-became-optional",
          breaking,
          severity: breaking ? "medium" : "none",
          location: propLocation,
          message: breaking
            ? `Field '${name}' is no longer guaranteed in the response at ${propLocation} - client code assuming it's always present can break`
            : `Field '${name}' is no longer required at ${propLocation} (safe - clients can still send it)`,
          meta: {},
        })
      );
    } else if (!wasRequired && isRequired) {
      const breaking = direction === "request";
      changes.push(
        makeChange({
          type: "field-became-required",
          breaking,
          severity: breaking ? "high" : "none",
          location: propLocation,
          message: breaking
            ? `Field '${name}' is now required at ${propLocation} - existing clients that omit it will be rejected`
            : `Field '${name}' is now always present in the response at ${propLocation} (safe - a stronger guarantee than before)`,
          meta: {},
        })
      );
    }

    // Recurse into the nested schema regardless - a field can both change
    // required-ness AND have internal changes (e.g. a nested object gaining
    // its own new required sub-field).
    changes.push(
      ...diffSchema(baseProps[name], headProps[name], { direction, location: propLocation })
    );
  }

  return changes;
}

function diffItems(base, head, { direction, location }) {
  if (!base.items && !head.items) return [];
  return diffSchema(base.items || {}, head.items || {}, {
    direction,
    location: `${location}[]`,
  });
}
