export async function recordChange(collection, {
  owner,
  repo,
  prNumber,
  sha,
  specPath,
  breakingCount,
  nonBreakingCount,
  acknowledged,
}) {
  await collection.insertOne({
    owner,
    repo,
    prNumber,
    sha,
    specPath,
    breakingCount,
    nonBreakingCount,
    acknowledged,
    createdAt: new Date(),
  });
}
