import { parse as parseYaml } from "yaml";
import { fetchFileAtRef } from "./fetchFile.js";

// Root-level filenames we check, in order, if no config override exists.
// (Decided at planning time: keep v1 simple - root-level convention only,
// no recursive repo search. A .guardian.yml override covers the case
// where a repo keeps its spec somewhere else.) Each entry carries its
// `kind` so the caller knows which diff engine to hand the content to,
// without needing to guess from the file extension itself.
const DEFAULT_SPEC_FILES = [
  { path: "openapi.yaml", kind: "openapi" },
  { path: "openapi.yml", kind: "openapi" },
  { path: "openapi.json", kind: "openapi" },
  { path: "schema.graphql", kind: "graphql" },
  { path: "schema.graphqls", kind: "graphql" },
];

/**
 * Figures out which file is "the" API spec for this repo (OpenAPI or
 * GraphQL), and fetches it at the given ref in the same pass (no point
 * finding a path and then fetching it again separately).
 *
 * Resolution order:
 *   1. If a `.guardian.yml` file exists at this ref with a `specPath`
 *      field, use exactly that path (and only that path - no fallback to
 *      defaults if it's wrong, since a misconfigured override should be
 *      visible/debuggable, not silently ignored). If the config doesn't
 *      also specify `type`, the kind is inferred from the path's
 *      extension.
 *   2. Otherwise, try each of DEFAULT_SPEC_FILES in order and use the
 *      first one that exists.
 *
 * Returns { path, kind, content } where content is `null` if nothing was
 * found (path/kind are also `null` in that case unless a config override
 * pointed at a specific, still-missing path - which is worth
 * distinguishing when debugging a misconfigured repo).
 */
export async function resolveSpecFile(octokit, { owner, repo, ref }) {
  const configured = await getConfiguredSpec(octokit, { owner, repo, ref });

  if (configured) {
    const content = await fetchFileAtRef(octokit, { owner, repo, ref, path: configured.path });
    return {
      path: content !== null ? configured.path : null,
      kind: content !== null ? configured.kind : null,
      content,
    };
  }

  for (const file of DEFAULT_SPEC_FILES) {
    const content = await fetchFileAtRef(octokit, { owner, repo, ref, path: file.path });
    if (content !== null) {
      return { path: file.path, kind: file.kind, content };
    }
  }

  return { path: null, kind: null, content: null };
}

function inferKindFromPath(path) {
  return /\.graphqls?$/.test(path) ? "graphql" : "openapi";
}

async function getConfiguredSpec(octokit, { owner, repo, ref }) {
  const configContent = await fetchFileAtRef(octokit, {
    owner,
    repo,
    ref,
    path: ".guardian.yml",
  });

  if (!configContent) return null;

  try {
    const config = parseYaml(configContent);
    if (!config?.specPath) return null;
    return { path: config.specPath, kind: config.type || inferKindFromPath(config.specPath) };
  } catch (error) {
    // A malformed config shouldn't crash the whole check - fall back to
    // the default search instead, same as if no config existed at all.
    console.warn(`[resolveSpecFile] .guardian.yml exists but failed to parse: ${error.message}`);
    return null;
  }
}
