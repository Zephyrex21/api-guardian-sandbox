/**
 * GitHub retries a webhook delivery if it doesn't get a fast 2xx response
 * (e.g. if the AI call is slow and the response comes back after GitHub's
 * timeout). Without this check, a retried delivery would run the whole
 * pipeline again - a second AI call burning quota, a second PR comment,
 * a second commit-status write.
 *
 * The correct way to detect "have I seen this before" under concurrent
 * requests is NOT "check if it exists, then insert if not" - that has a
 * race window between the check and the insert. Instead, this relies on
 * MongoDB's own unique index to make the insert itself atomic: if two
 * requests for the same delivery ID arrive at the same instant, exactly
 * one insertOne() succeeds and the other throws a duplicate-key error
 * (code 11000), which is what we check for.
 *
 * This requires a unique index on `deliveryId` to actually exist on the
 * collection - see db/mongo.js, which creates it automatically.
 */
export async function isDuplicateDelivery(collection, deliveryId) {
  try {
    await collection.insertOne({ deliveryId, processedAt: new Date() });
    return false; // insert succeeded - this is the first time we've seen it
  } catch (error) {
    if (error.code === 11000) {
      return true; // duplicate key - we've already processed this exact delivery
    }
    throw error;
  }
}
