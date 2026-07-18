import { Webhooks } from "@octokit/webhooks";
import { config } from "./config.js";
import { announcePresence } from "./actions/announcePresence.js";

/**
 * @octokit/webhooks handles two jobs for us:
 *  1. Signature verification (verifyAndReceive rejects anything not signed
 *     with our webhook secret, before any handler below ever runs)
 *  2. Event routing (dispatches to the right handler based on event name)
 *
 * Phase 0 only listens for pull_request open/synchronize and takes the
 * single "announce presence" action. Diff logic replaces this in Phase 1-2.
 */
export const webhooks = new Webhooks({
  secret: config.webhookSecret,
});

async function handlePullRequestEvent({ payload }) {
  const installationId = payload.installation?.id;
  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;
  const prNumber = payload.pull_request.number;

  console.log(
    `[webhook] pull_request.${payload.action} on ${owner}/${repo}#${prNumber}`
  );

  await announcePresence({ installationId, owner, repo, prNumber });
}

webhooks.on("pull_request.opened", handlePullRequestEvent);
webhooks.on("pull_request.synchronize", handlePullRequestEvent);

// Surface handler errors with context instead of letting them vanish -
// webhook processing happens after we've already returned 200 to GitHub,
// so this is our only visibility into failures.
webhooks.onError((error) => {
  console.error(`[webhook] handler error: ${error.message}`, error);
});
