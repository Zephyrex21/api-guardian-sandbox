import { makeChange } from "./change.js";
import { diffSchema } from "./schema-diff.js";

/**
 * OpenAPI parameters (query/path/header/cookie) are a flat array, matched
 * by the combination of `in` + `name` (that pair is the actual unique key -
 * two params can share a name if they're in different locations, e.g. a
 * path param and a query param both called "id").
 *
 * Parameters only ever flow client -> server, so every schema comparison
 * here uses direction: "request".
 */
export function diffParameters(baseParams = [], headParams = [], { location }) {
  const key = (p) => `${p.in}:${p.name}`;
  const baseMap = new Map((baseParams || []).map((p) => [key(p), p]));
  const headMap = new Map((headParams || []).map((p) => [key(p), p]));
  const allKeys = new Set([...baseMap.keys(), ...headMap.keys()]);
  const changes = [];

  for (const k of allKeys) {
    const paramLocation = `${location} > parameter '${k}'`;
    const inBase = baseMap.has(k);
    const inHead = headMap.has(k);

    if (inBase && !inHead) {
      changes.push(
        makeChange({
          type: "parameter-removed",
          breaking: true,
          severity: "medium",
          location: paramLocation,
          message: `Parameter '${k}' removed - generated/typed clients referencing it will break`,
          meta: {},
        })
      );
      continue;
    }

    if (!inBase && inHead) {
      const p = headMap.get(k);
      changes.push(
        makeChange({
          type: p.required ? "parameter-required-added" : "parameter-optional-added",
          breaking: !!p.required,
          severity: p.required ? "high" : "none",
          location: paramLocation,
          message: p.required
            ? `New required parameter '${k}' added - existing clients that don't send it will be rejected`
            : `New optional parameter '${k}' added`,
          meta: {},
        })
      );
      continue;
    }

    const basep = baseMap.get(k);
    const headp = headMap.get(k);

    if (!basep.required && headp.required) {
      changes.push(
        makeChange({
          type: "parameter-became-required",
          breaking: true,
          severity: "high",
          location: paramLocation,
          message: `Parameter '${k}' is now required - existing clients that omit it will be rejected`,
          meta: {},
        })
      );
    } else if (basep.required && !headp.required) {
      changes.push(
        makeChange({
          type: "parameter-became-optional",
          breaking: false,
          severity: "none",
          location: paramLocation,
          message: `Parameter '${k}' is no longer required (safe)`,
          meta: {},
        })
      );
    }

    if (basep.schema || headp.schema) {
      changes.push(
        ...diffSchema(basep.schema || {}, headp.schema || {}, {
          direction: "request",
          location: paramLocation,
        })
      );
    }
  }

  return changes;
}
