import { recordAcknowledgment } from "../acknowledgments/store.js";
import { setCommitStatus } from "../github/commitStatus.js";

/**
 * Called when someone clicks the acknowledgment link from a PR comment.
 * Order matters here: we persist the record BEFORE touching the commit
 * status, so if the GitHub API call fails, the acknowledgment isn't lost -
 * a retry (or the person re-clicking the link) will find it already
 * recorded and just retry the status update.
 */
export async function acknowledgeChange({ octokit, collection, owner, repo, prNumber, sha, installationId }) {
  await recordAcknowledgment(collection, { owner, repo, prNumber, sha, installationId });

  await setCommitStatus(octokit, {
    owner,
    repo,
    sha,
    state: "success",
    description: "Breaking changes acknowledged - merge unblocked",
  });
}
