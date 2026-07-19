const STATUS_CONTEXT = "api-guardian/breaking-changes";

/**
 * Sets a commit status - the small pass/fail indicator GitHub shows next
 * to a commit/PR. If a repo's branch protection marks this context as a
 * required check, a "failure" state here actually blocks the merge button
 * - this is the mechanic that makes the app a guardian rather than just a
 * commenter.
 *
 * GitHub truncates (or rejects) descriptions over 140 characters, so this
 * trims defensively rather than risking an API error over a long message.
 */
export async function setCommitStatus(octokit, { owner, repo, sha, state, description, targetUrl }) {
  await octokit.repos.createCommitStatus({
    owner,
    repo,
    sha,
    state, // "pending" | "success" | "failure" | "error"
    description: description.slice(0, 140),
    context: STATUS_CONTEXT,
    target_url: targetUrl,
  });
}
