/**
 * Slack's Block Kit lets a message have real structure (a bold header,
 * distinct fields, a clickable link) instead of one wall of plain text.
 * Deliberately built as a pure function separate from the actual send
 * call, the same split used for formatComment.js - the message content
 * can be fully tested without touching the network.
 */
export function buildSlackMessage({ owner, repo, prNumber, breakingCount, prUrl, acknowledgeUrl }) {
  const changeWord = breakingCount === 1 ? "change" : "changes";

  return {
    // `text` is a required fallback Slack uses for notification previews
    // and any client that doesn't render blocks - always send both.
    text: `API Guardian: ${breakingCount} unacknowledged breaking ${changeWord} on ${owner}/${repo} #${prNumber}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "🚨 Unacknowledged breaking change", emoji: true },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Repo:*\n${owner}/${repo}` },
          { type: "mrkdwn", text: `*Pull request:*\n#${prNumber}` },
          { type: "mrkdwn", text: `*Breaking ${changeWord}:*\n${breakingCount}` },
        ],
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `<${prUrl}|View the PR> · <${acknowledgeUrl}|Acknowledge and unblock the merge>`,
        },
      },
    ],
  };
}
