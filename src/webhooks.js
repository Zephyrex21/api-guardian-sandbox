import { Webhooks } from "@octokit/webhooks";
import { config } from "./config.js";
import { getInstallationOctokit } from "./github/auth.js";
import { getAcknowledgmentsCollection, getChangesCollection } from "./db/mongo.js";
import { reviewApiChanges } from "./actions/reviewApiChanges.js";

/**
 * @octokit/webhooks handles two jobs for us:
 *  1. Signature verification (verifyAndReceive rejects anything not signed
 *     with our webhook secret, before any handler below ever runs)
 *  2. Event routing (dispatches to the right handler based on event name)
 *
 * Phase 5: now also fetches the changes collection (for the dashboard's
 * history log), alongside the acknowledgments collection from Phase 4.
 */
export const webhooks = new Webhooks({
  secret: config.webhookSecret,
});

async function handlePullRequestEvent({ payload }) {
  const installationId = payload.installation?.id;
  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;
  const prNumber = payload.pull_request.number;
  const baseSha = payload.pull_request.base.sha;
  const headSha = payload.pull_request.head.sha;

  console.log(
    `[webhook] pull_request.${payload.action} on ${owner}/${repo}#${prNumber}`
  );

  const octokit = await getInstallationOctokit(installationId);
  const acknowledgmentsCollection = await getAcknowledgmentsCollection();
  const changesCollection = await getChangesCollection();
  await reviewApiChanges({
    octokit,
    acknowledgmentsCollection,
    changesCollection,
    owner,
    repo,
    prNumber,
    baseSha,
    headSha,
    installationId,
  });
}

webhooks.on("pull_request.opened", handlePullRequestEvent);
webhooks.on("pull_request.synchronize", handlePullRequestEvent);

// Surface handler errors with context instead of letting them vanish -
// webhook processing happens after we've already returned 200 to GitHub,
// so this is our only visibility into failures.
webhooks.onError((error) => {
  console.error(`[webhook] handler error: ${error.message}`, error);
});
