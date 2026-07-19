import { parse as parseYaml } from "yaml";
import { resolveSpecFile } from "../github/resolveSpecFile.js";
import { fetchFileAtRef } from "../github/fetchFile.js";
import { diffSpecs } from "../diff/index.js";
import { formatComment } from "../format/formatComment.js";
import { explainChanges } from "../ai/explainChanges.js";
import { createGroqProvider, createGeminiProvider } from "../ai/providers.js";
import { config } from "../config.js";

/**
 * The real Phase 2+3 pipeline: find the spec file, fetch both versions,
 * diff them, ask AI to explain the result in plain English, post it.
 *
 * The AI step is additive and optional by design - if neither GROQ_API_KEY
 * nor GEMINI_API_KEY is set (or both providers fail), this still posts
 * Phase 2's exact raw-diff comment. A missing "nice to have" should never
 * take down the "actually catches breaking changes" core feature.
 */
export async function reviewApiChanges({ octokit, owner, repo, prNumber, baseSha, headSha }) {
  const head = await resolveSpecFile(octokit, { owner, repo, ref: headSha });

  if (!head.content) {
    // No spec file in this PR's head state at all - nothing for this app
    // to check. This is the normal case for the vast majority of PRs
    // (ones that don't touch the API contract), so this should stay quiet
    // rather than commenting "nothing to see here" on every unrelated PR.
    console.log(`[reviewApiChanges] no spec file found for ${owner}/${repo}#${prNumber}, skipping`);
    return;
  }

  // The spec might not have existed at all in the base branch (i.e. this
  // PR is the one that introduces it) - fetchFileAtRef returning null here
  // is expected and handled by parseSpec defaulting to an empty document.
  const baseContent = await fetchFileAtRef(octokit, {
    owner,
    repo,
    ref: baseSha,
    path: head.path,
  });

  let baseSpec, headSpec;
  try {
    baseSpec = baseContent ? parseSpec(baseContent) : { paths: {} };
    headSpec = parseSpec(head.content);
  } catch (error) {
    // A syntax error in the spec itself isn't this app's problem to fix,
    // but silently doing nothing would be confusing - say so.
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: `⚠️ **API Guardian** couldn't parse \`${head.path}\`: ${error.message}. Skipping the breaking-change check until this is fixed.`,
    });
    return;
  }

  const result = diffSpecs(baseSpec, headSpec);

  // Only bother calling the AI when there's something worth explaining -
  // no point spending API quota (and a few seconds of latency) explaining
  // an empty or all-safe diff.
  const ai = result.breakingChanges.length > 0 ? await tryExplainChanges(result) : null;

  const comment = formatComment(result, head.path, ai);

  await octokit.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body: comment,
  });

  console.log(
    `[reviewApiChanges] ${owner}/${repo}#${prNumber}: ${result.breakingChanges.length} breaking, ${result.nonBreakingChanges.length} non-breaking, AI explanation: ${ai ? "yes" : "no"}`
  );
}

async function tryExplainChanges(result) {
  const providers = [];
  if (config.groqApiKey) providers.push(createGroqProvider(config.groqApiKey));
  if (config.geminiApiKey) providers.push(createGeminiProvider(config.geminiApiKey));

  if (providers.length === 0) {
    console.log("[reviewApiChanges] no AI provider configured, posting raw diff only");
    return null;
  }

  return explainChanges(result, providers);
}

/**
 * YAML is a superset of JSON, so this one parser correctly handles both
 * openapi.yaml and openapi.json without needing separate code paths.
 */
function parseSpec(content) {
  return parseYaml(content);
}
