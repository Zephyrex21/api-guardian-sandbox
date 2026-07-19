import { buildPrompt } from "./prompt.js";

/**
 * Returns { summary, notes: Map<location, note> } on success, or `null` if
 * no AI explanation could be produced - callers treat `null` as "fall back
 * to Phase 2's raw diff comment", never as a reason to fail the whole
 * webhook. An AI outage should degrade the comment's quality, not break
 * the feature that actually matters (catching breaking changes).
 *
 * `providers` is an ordered list of (system, user) => Promise<text>
 * functions, tried in order until one succeeds. Passing this in (rather
 * than constructing Groq/Gemini clients here) is what makes this testable
 * with fake providers instead of real API keys.
 */
export async function explainChanges(diffResult, providers = []) {
  if (providers.length === 0) {
    return null;
  }

  const { system, user } = buildPrompt(diffResult);

  for (const provider of providers) {
    try {
      const rawText = await provider(system, user);
      const parsed = parseAiResponse(rawText);
      if (parsed) return parsed;
      console.warn("[explainChanges] provider returned unparseable JSON, trying next provider");
    } catch (error) {
      console.warn(`[explainChanges] provider failed: ${error.message}`);
    }
  }

  console.warn("[explainChanges] all providers failed or returned unusable output, falling back to raw diff");
  return null;
}

function parseAiResponse(rawText) {
  try {
    const parsed = JSON.parse(rawText);
    if (typeof parsed.summary !== "string" || !Array.isArray(parsed.notes)) {
      return null;
    }
    const notes = new Map(parsed.notes.map((n) => [n.location, n.note]));
    return { summary: parsed.summary, notes };
  } catch {
    return null;
  }
}
