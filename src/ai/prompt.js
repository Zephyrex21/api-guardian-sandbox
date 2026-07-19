/**
 * IMPORTANT DESIGN DECISION: the AI never decides what's breaking or how
 * severe it is - that's Phase 1's deterministic diff engine, already
 * tested and correct. The AI's only job here is to translate an already-
 * correct structured verdict into plain English. Feeding it only the
 * compact change list (not the raw OpenAPI spec) also keeps token usage
 * low and keeps the model from "helpfully" re-analyzing the spec itself
 * and disagreeing with the diff engine's classification.
 */
const SYSTEM_PROMPT = `You are a precise technical writer helping API developers understand breaking changes in a pull request. You will be given a list of changes that have ALREADY been classified as breaking or non-breaking by a deterministic diffing tool - do not second-guess or re-classify them, only explain them.

For each breaking change, write a short, concrete note: who is affected (which kind of API client) and what they need to do about it. Be specific, not generic - reference the actual field/parameter names given.

Respond with ONLY valid JSON, no markdown fences, no preamble, in exactly this shape:
{
  "summary": "one sentence summarizing the overall impact of this PR on API consumers",
  "notes": [
    { "location": "<copy the exact location string from the input>", "note": "<your plain-English explanation and migration guidance, 1-2 sentences>" }
  ]
}

Only include a "notes" entry for changes where breaking is true. If there are no breaking changes, return an empty notes array and a short reassuring summary.`;

export function buildPrompt(diffResult) {
  const relevantChanges = diffResult.allChanges.map((c) => ({
    type: c.type,
    breaking: c.breaking,
    severity: c.severity,
    location: c.location,
    message: c.message,
  }));

  const userPrompt = `Changes detected in this PR:\n\n${JSON.stringify(relevantChanges, null, 2)}`;

  return { system: SYSTEM_PROMPT, user: userPrompt };
}
