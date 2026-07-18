/**
 * Every diff function in this module returns an array of Change objects
 * with this exact shape. Keeping it consistent means the AI layer (Phase 3)
 * and the dashboard (Phase 5) can both consume the same structure without
 * caring which part of the spec produced it.
 *
 * @param {object} params
 * @param {string} params.type - machine-readable kind, e.g. "field-removed"
 * @param {boolean} params.breaking - the actual verdict this whole engine exists to produce
 * @param {"high"|"medium"|"low"|"none"} params.severity
 * @param {string} params.location - human-readable path to where this happened, e.g. "POST /users > request body > email"
 * @param {string} params.message - a complete, human-readable sentence explaining the change
 * @param {object} [params.meta] - extra structured detail (old/new values etc.) for the AI layer to use
 */
export function makeChange({ type, breaking, severity, location, message, meta = {} }) {
  return { type, breaking, severity, location, message, meta };
}
