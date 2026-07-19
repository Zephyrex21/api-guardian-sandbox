import { parse as parseYaml } from "yaml";
import { fetchFileAtRef } from "./fetchFile.js";

// Root-level filenames we check, in order, if no config override exists.
// (Decided at planning time: keep v1 simple - root-level convention only,
// no recursive repo search. A .guardian.yml override covers the case
// where a repo keeps its spec somewhere else.)
const DEFAULT_SPEC_PATHS = ["openapi.yaml", "openapi.yml", "openapi.json"];

/**
 * Figures out which file is "the" OpenAPI spec for this repo, and fetches
 * it at the given ref in the same pass (no point finding a path and then
 * fetching it again separately).
 *
 * Resolution order:
 *   1. If a `.guardian.yml` file exists at this ref with a `specPath`
 *      field, use exactly that path (and only that path - no fallback to
 *      defaults if it's wrong, since a misconfigured override should be
 *      visible/debuggable, not silently ignored).
 *   2. Otherwise, try each of DEFAULT_SPEC_PATHS in order and use the
 *      first one that exists.
 *
 * Returns { path, content } where content is `null` if nothing was found
 * (path is also `null` in that case unless a config override pointed at a
 * specific, still-missing path - which is worth distinguishing when
 * debugging a misconfigured repo).
 */
export async function resolveSpecFile(octokit, { owner, repo, ref }) {
  const configuredPath = await getConfiguredSpecPath(octokit, { owner, repo, ref });

  if (configuredPath) {
    const content = await fetchFileAtRef(octokit, { owner, repo, ref, path: configuredPath });
    return { path: content !== null ? configuredPath : null, content };
  }

  for (const path of DEFAULT_SPEC_PATHS) {
    const content = await fetchFileAtRef(octokit, { owner, repo, ref, path });
    if (content !== null) {
      return { path, content };
    }
  }

  return { path: null, content: null };
}

async function getConfiguredSpecPath(octokit, { owner, repo, ref }) {
  const configContent = await fetchFileAtRef(octokit, {
    owner,
    repo,
    ref,
    path: ".guardian.yml",
  });

  if (!configContent) return null;

  try {
    const config = parseYaml(configContent);
    return config?.specPath || null;
  } catch (error) {
    // A malformed config shouldn't crash the whole check - fall back to
    // the default search instead, same as if no config existed at all.
    console.warn(`[resolveSpecFile] .guardian.yml exists but failed to parse: ${error.message}`);
    return null;
  }
}
