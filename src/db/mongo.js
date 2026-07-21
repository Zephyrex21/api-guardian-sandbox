import { MongoClient } from "mongodb";
import { config } from "../config.js";

let client = null;
let db = null;

/**
 * Lazily connects on first use and reuses the same connection for every
 * subsequent call - MongoDB drivers are designed to hold one long-lived
 * connection pool per process, not reconnect per request.
 */
async function getDb() {
  if (db) return db;

  client = new MongoClient(config.mongoUri);
  await client.connect();
  // Database name comes from the connection string itself (Atlas lets you
  // pick this when creating the cluster) - no need to hardcode one here.
  db = client.db();
  return db;
}

/**
 * The one collection this app currently needs. Kept as a named accessor
 * (rather than exposing getDb() everywhere) so if a second collection is
 * ever needed, there's an obvious place to add a matching function next to
 * this one.
 */
export async function getAcknowledgmentsCollection() {
  const database = await getDb();
  return database.collection("acknowledgments");
}

export async function getUsersCollection() {
  const database = await getDb();
  return database.collection("users");
}

/** Every diff run ever, regardless of whether it had breaking changes - this is the data the dashboard's timeline and stats are built from. */
export async function getChangesCollection() {
  const database = await getDb();
  return database.collection("changes");
}

let deliveriesIndexEnsured = false;

/**
 * Backs the idempotency check in idempotency/store.js. The unique index
 * on `deliveryId` is what makes that check atomically safe under
 * concurrent requests - createIndex() is safe to call repeatedly (it's a
 * no-op if the index already exists), but this only bothers calling it
 * once per process instead of on every single webhook.
 */
export async function getProcessedDeliveriesCollection() {
  const database = await getDb();
  const collection = database.collection("processedDeliveries");

  if (!deliveriesIndexEnsured) {
    await collection.createIndex({ deliveryId: 1 }, { unique: true });
    deliveriesIndexEnsured = true;
  }

  return collection;
}
