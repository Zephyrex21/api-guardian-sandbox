import { Webhooks } from "@octokit/webhooks";
import { config } from "./config.js";
import { getInstallationOctokit } from "./github/auth.js";
import { getAcknowledgmentsCollection, getChangesCollection, getProcessedDeliveriesCollection } from "./db/mongo.js";
import { isDuplicateDelivery } from "./idempotency/store.js";
import { reviewApiChanges } from "./actions/reviewApiChanges.js";
import { log } from "./logger.js";

/**
 * @octokit/webhooks handles two jobs for us:
 *  1. Signature verification (verifyAndReceive rejects anything not signed
 *     with our webhook secret, before any handler below ever runs)
 *  2. Event routing (dispatches to the right handler based on event name)
 *
 * Phase 6: now also checks the delivery ID against processed deliveries
 * FIRST, before any real work - a retried delivery (GitHub retries if it
 * doesn't get a fast 2xx) exits immediately here instead of triggering a
 * second AI call, comment, and status write.
 */
export const webhooks = new Webhooks({
  secret: config.webhookSecret,
});

async function handlePullRequestEvent({ id: deliveryId, payload }) {
  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;
  const prNumber = payload.pull_request.number;

  const deliveriesCollection = await getProcessedDeliveriesCollection();
  if (await isDuplicateDelivery(deliveriesCollection, deliveryId)) {
    log("webhook.duplicate_delivery_skipped", { deliveryId, owner, repo, prNumber });
    return;
  }

  const installationId = payload.installation?.id;
  const baseSha = payload.pull_request.base.sha;
  const headSha = payload.pull_request.head.sha;

  log("webhook.received", { deliveryId, action: payload.action, owner, repo, prNumber });

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
  log("webhook.handler_error", { message: error.message });
});
