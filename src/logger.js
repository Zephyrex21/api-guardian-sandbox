/**
 * A single structured logger used for the operational log lines that
 * actually matter for debugging production issues (webhook received,
 * duplicate skipped, review outcome, errors). Deliberately not applied to
 * every console.log in the codebase - the goal is a few reliable,
 * greppable/parseable lines, not blanket replacement.
 *
 * Kept intentionally simple (no external logging library) - this prints
 * one JSON line per event, which is exactly the format most hosting
 * platforms (including Render) expect for structured log ingestion.
 */
export function log(event, data = {}) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), event, ...data }));
}

export function logError(event, error, data = {}) {
  console.error(
    JSON.stringify({ timestamp: new Date().toISOString(), event, error: error.message, ...data })
  );
}
