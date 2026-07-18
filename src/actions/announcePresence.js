import { getInstallationOctokit } from "../github/auth.js";

/**
 * Phase 0 exit criteria: prove that receiving a webhook -> authenticating
 * as the installation -> calling the GitHub API actually works, end to end,
 * on a real deployed instance. This handler deliberately does nothing
 * "smart" yet - no diffing, no AI. That logic arrives in Phase 1+ once this
 * foundation is proven solid.
 */
export async function announcePresence({ installationId, owner, repo, prNumber }) {
  const octokit = await getInstallationOctokit(installationId);

  await octokit.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body: "👋 API Guardian is watching this PR. (Phase 0 - diff engine and AI review land in later phases.)",
  });
}
