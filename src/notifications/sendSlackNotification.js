/**
 * Posts to a Slack Incoming Webhook URL. Deliberately swallows failures
 * (logs and returns false, never throws) - the actual job that matters
 * (catching the breaking change, gating the merge) is already done by the
 * time this runs. A Slack outage or misconfigured webhook should degrade
 * this one notification, not the whole review.
 *
 * fetchImpl is injectable so this is testable without a real network call
 * or a real Slack workspace, same pattern as ai/providers.js.
 */
export async function sendSlackNotification(webhookUrl, message, { fetchImpl = fetch } = {}) {
  try {
    const response = await fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      console.warn(`[slack] notification failed: ${response.status}`);
      return false;
    }

    return true;
  } catch (error) {
    console.warn(`[slack] notification failed: ${error.message}`);
    return false;
  }
}
