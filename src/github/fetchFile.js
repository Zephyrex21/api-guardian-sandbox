/**
 * Fetches a single file's content from a repo at a specific commit/branch
 * ref. Returns the decoded text content, or `null` if the file doesn't
 * exist at that ref - callers use that `null` to mean "this file wasn't
 * present here" rather than treating a 404 as an unexpected failure.
 *
 * octokit is passed in (not imported/created here) so this function can be
 * unit tested with a fake octokit object, no real GitHub API calls needed.
 */
export async function fetchFileAtRef(octokit, { owner, repo, path, ref }) {
  try {
    const response = await octokit.repos.getContent({ owner, repo, path, ref });

    // getContent returns an array if `path` is a directory - we only ever
    // want a single file here.
    if (Array.isArray(response.data)) {
      throw new Error(`Expected a file at '${path}' but found a directory`);
    }

    if (!response.data.content) {
      throw new Error(`No content returned for '${path}' at ${ref} (unexpected file type?)`);
    }

    return Buffer.from(response.data.content, "base64").toString("utf8");
  } catch (error) {
    if (error.status === 404) {
      return null;
    }
    throw error;
  }
}
