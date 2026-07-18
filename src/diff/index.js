import { makeChange } from "./change.js";
import { diffSchema } from "./schema-diff.js";
import { diffParameters } from "./parameter-diff.js";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options", "trace"];

/**
 * Public entry point. Compares two OpenAPI 3.x documents and returns every
 * detected change, split into breaking and non-breaking.
 *
 * @param {object} baseSpec - parsed OpenAPI document from the base branch
 * @param {object} headSpec - parsed OpenAPI document from the PR branch
 */
export function diffSpecs(baseSpec, headSpec) {
  const allChanges = [...diffPaths(baseSpec.paths || {}, headSpec.paths || {})];

  return {
    breakingChanges: allChanges.filter((c) => c.breaking),
    nonBreakingChanges: allChanges.filter((c) => !c.breaking),
    allChanges,
  };
}

function diffPaths(basePaths, headPaths) {
  const allPathKeys = new Set([...Object.keys(basePaths), ...Object.keys(headPaths)]);
  const changes = [];

  for (const pathKey of allPathKeys) {
    const inBase = pathKey in basePaths;
    const inHead = pathKey in headPaths;

    if (inBase && !inHead) {
      changes.push(
        makeChange({
          type: "path-removed",
          breaking: true,
          severity: "high",
          location: pathKey,
          message: `Path '${pathKey}' was removed entirely - any client calling it will get a 404`,
          meta: {},
        })
      );
      continue;
    }

    if (!inBase && inHead) {
      changes.push(
        makeChange({
          type: "path-added",
          breaking: false,
          severity: "none",
          location: pathKey,
          message: `New path '${pathKey}' added`,
          meta: {},
        })
      );
      continue;
    }

    changes.push(...diffOperations(basePaths[pathKey], headPaths[pathKey], pathKey));
  }

  return changes;
}

function diffOperations(baseOps, headOps, pathKey) {
  const allMethods = new Set([
    ...Object.keys(baseOps).filter((k) => HTTP_METHODS.includes(k)),
    ...Object.keys(headOps).filter((k) => HTTP_METHODS.includes(k)),
  ]);
  const changes = [];

  for (const method of allMethods) {
    const opLocation = `${method.toUpperCase()} ${pathKey}`;
    const inBase = method in baseOps;
    const inHead = method in headOps;

    if (inBase && !inHead) {
      changes.push(
        makeChange({
          type: "operation-removed",
          breaking: true,
          severity: "high",
          location: opLocation,
          message: `Operation '${opLocation}' was removed`,
          meta: {},
        })
      );
      continue;
    }

    if (!inBase && inHead) {
      changes.push(
        makeChange({
          type: "operation-added",
          breaking: false,
          severity: "none",
          location: opLocation,
          message: `New operation '${opLocation}' added`,
          meta: {},
        })
      );
      continue;
    }

    changes.push(...diffOneOperation(baseOps[method], headOps[method], opLocation));
  }

  return changes;
}

function diffOneOperation(baseOp, headOp, opLocation) {
  const changes = [];

  changes.push(
    ...diffParameters(baseOp.parameters, headOp.parameters, { location: opLocation })
  );

  changes.push(...diffRequestBody(baseOp.requestBody, headOp.requestBody, opLocation));
  changes.push(...diffResponses(baseOp.responses || {}, headOp.responses || {}, opLocation));

  return changes;
}

function diffRequestBody(baseBody, headBody, opLocation) {
  const baseSchema = getJsonSchema(baseBody);
  const headSchema = getJsonSchema(headBody);

  if (!baseSchema && !headSchema) return [];

  if (baseSchema && !headSchema) {
    return [
      makeChange({
        type: "request-body-removed",
        breaking: true,
        severity: "medium",
        location: opLocation,
        message: `Request body removed from ${opLocation}`,
        meta: {},
      }),
    ];
  }

  if (!baseSchema && headSchema) {
    const isRequired = !!headBody?.required;
    return [
      makeChange({
        type: isRequired ? "request-body-required-added" : "request-body-optional-added",
        breaking: isRequired,
        severity: isRequired ? "high" : "none",
        location: opLocation,
        message: isRequired
          ? `Request body is now required at ${opLocation} - existing clients that don't send one will be rejected`
          : `Optional request body added at ${opLocation}`,
        meta: {},
      }),
    ];
  }

  return diffSchema(baseSchema, headSchema, {
    direction: "request",
    location: `${opLocation} > request body`,
  });
}

function diffResponses(baseResponses, headResponses, opLocation) {
  const allStatusCodes = new Set([...Object.keys(baseResponses), ...Object.keys(headResponses)]);
  const changes = [];

  for (const status of allStatusCodes) {
    const respLocation = `${opLocation} > ${status} response`;
    const inBase = status in baseResponses;
    const inHead = status in headResponses;

    if (inBase && !inHead) {
      changes.push(
        makeChange({
          type: "response-removed",
          breaking: true,
          severity: "medium",
          location: respLocation,
          message: `Response '${status}' removed from ${opLocation}`,
          meta: {},
        })
      );
      continue;
    }

    if (!inBase && inHead) {
      changes.push(
        makeChange({
          type: "response-added",
          breaking: false,
          severity: "none",
          location: respLocation,
          message: `New response '${status}' added to ${opLocation}`,
          meta: {},
        })
      );
      continue;
    }

    const baseSchema = getJsonSchema(baseResponses[status]);
    const headSchema = getJsonSchema(headResponses[status]);
    if (baseSchema || headSchema) {
      changes.push(
        ...diffSchema(baseSchema || {}, headSchema || {}, {
          direction: "response",
          location: respLocation,
        })
      );
    }
  }

  return changes;
}

/** OpenAPI 3.x nests the actual schema under content['application/json'].schema */
function getJsonSchema(requestBodyOrResponse) {
  return requestBodyOrResponse?.content?.["application/json"]?.schema;
}
