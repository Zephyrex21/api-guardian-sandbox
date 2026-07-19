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
