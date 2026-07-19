export function buildAcknowledgeUrl({ publicUrl, installationId, owner, repo, prNumber, sha }) {
  return `${publicUrl}/acknowledge/${installationId}/${owner}/${repo}/${prNumber}/${sha}`;
}
