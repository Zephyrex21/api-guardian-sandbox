/**
 * Kept deliberately simple: fetch and reduce in JS rather than a MongoDB
 * aggregation pipeline. At personal/portfolio scale (hundreds, not
 * millions, of change records) this is plenty fast and much easier to
 * read, test, and modify than a pipeline stage list would be.
 */

export async function getRecentChanges(collection, { limit = 50 } = {}) {
  return collection.find({}).sort({ createdAt: -1 }).limit(limit).toArray();
}

export async function getStats(collection) {
  const all = await collection.find({}).toArray();

  const totalChanges = all.length;
  const withBreaking = all.filter((c) => c.breakingCount > 0);
  const pendingAcknowledgments = withBreaking.filter((c) => !c.acknowledged).length;

  return {
    totalChanges,
    breakingChangeCount: withBreaking.length,
    pendingAcknowledgments,
    cleanChangeCount: totalChanges - withBreaking.length,
  };
}

export async function getTrackedRepos(collection) {
  const all = await collection.find({}).toArray();
  const seen = new Map();

  for (const change of all) {
    const key = `${change.owner}/${change.repo}`;
    const existing = seen.get(key);
    if (!existing || change.createdAt > existing.lastCheckedAt) {
      seen.set(key, {
        owner: change.owner,
        repo: change.repo,
        lastCheckedAt: change.createdAt,
      });
    }
  }

  return [...seen.values()].sort((a, b) => b.lastCheckedAt - a.lastCheckedAt);
}
