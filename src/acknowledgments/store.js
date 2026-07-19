/**
 * Acknowledgments are keyed by the exact commit SHA, not just the PR
 * number. This is what makes re-pushes "just work" without any extra
 * logic: if someone pushes a new commit after acknowledging, the new SHA
 * has no matching record, so isAcknowledged() correctly returns false
 * again - the old acknowledgment doesn't silently cover changes it never
 * actually saw.
 */
export async function isAcknowledged(collection, { owner, repo, prNumber, sha }) {
  const doc = await collection.findOne({ owner, repo, prNumber, sha });
  return !!doc;
}

export async function recordAcknowledgment(collection, { owner, repo, prNumber, sha, installationId }) {
  await collection.updateOne(
    { owner, repo, prNumber, sha },
    { $set: { owner, repo, prNumber, sha, installationId, acknowledgedAt: new Date() } },
    { upsert: true }
  );
}
