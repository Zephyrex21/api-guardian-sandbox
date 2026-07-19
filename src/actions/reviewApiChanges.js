import { parse as parseYaml } from "yaml";
import { resolveSpecFile } from "../github/resolveSpecFile.js";
import { fetchFileAtRef } from "../github/fetchFile.js";
import { setCommitStatus } from "../github/commitStatus.js";
import { diffSpecs } from "../diff/index.js";
import { formatComment } from "../format/formatComment.js";
import { buildAcknowledgeUrl } from "../format/buildAcknowledgeUrl.js";
import { explainChanges } from "../ai/explainChanges.js";
import { createGroqProvider, createGeminiProvider } from "../ai/providers.js";
import { isAcknowledged } from "../acknowledgments/store.js";
import { config } from "../config.js";

/**
 * The real Phase 2+3+4 pipeline: find the spec file, fetch both versions,
 * diff them, ask AI to explain the result, post it, and gate the commit
 * status on whether any breaking change has been acknowledged.
 *
 * Status flow:
 *   1. As soon as we know there's a spec file to check, set "pending" -
 *      GitHub shows this immediately rather than leaving no status at all
 *      while the diff/AI work happens.
 *   2. No breaking changes -> "success".
 *   3. Breaking changes, already acknowledged for this exact commit SHA ->
 *      "success" (re-pushing a new commit gets a fresh SHA with no
 *      matching record, so this naturally re-locks on new pushes).
 *   4. Breaking changes, not yet acknowledged -> "failure", with an
 *      acknowledgment link in the comment.
 */
export async function reviewApiChanges({
  octokit,
  collection,
  owner,
  repo,
  prNumber,
  baseSha,
  headSha,
  installationId,
}) {
  const head = await resolveSpecFile(octokit, { owner, repo, ref: headSha });

  if (!head.content) {
    // No spec file in this PR's head state at all - nothing for this app
    // to check. Deliberately sets no commit status at all here (same as
    // Phase 2's silence) rather than "success", so this check only ever
    // appears on PRs it actually has something to say about.
    console.log(`[reviewApiChanges] no spec file found for ${owner}/${repo}#${prNumber}, skipping`);
    return;
  }

  await setCommitStatus(octokit, {
    owner,
    repo,
    sha: headSha,
    state: "pending",
    description: "Checking for breaking API changes...",
  });

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
    // but silently doing nothing would be confusing - say so, and mark the
    // check as errored rather than leaving it stuck on "pending".
    await setCommitStatus(octokit, {
      owner,
      repo,
      sha: headSha,
      state: "error",
      description: "Could not parse the OpenAPI spec",
    });
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: `⚠️ **API Guardian** couldn't parse \`${head.path}\`: ${error.message}. Skipping the breaking-change check until this is fixed.`,
    });
    return;
  }

  const result = diffSpecs(baseSpec, headSpec);

  if (result.breakingChanges.length === 0) {
    await setCommitStatus(octokit, {
      owner,
      repo,
      sha: headSha,
      state: "success",
      description: "No breaking API changes detected",
    });
    const comment = formatComment(result, head.path, null, null);
    await octokit.issues.createComment({ owner, repo, issue_number: prNumber, body: comment });
    console.log(`[reviewApiChanges] ${owner}/${repo}#${prNumber}: no breaking changes`);
    return;
  }

  const alreadyAcknowledged = await isAcknowledged(collection, { owner, repo, prNumber, sha: headSha });

  // Only bother calling the AI when there's something worth explaining -
  // no point spending API quota (and a few seconds of latency) explaining
  // a diff nobody needs described, e.g. one that's already acknowledged.
  const ai = !alreadyAcknowledged ? await tryExplainChanges(result) : null;

  const acknowledgeUrl = alreadyAcknowledged
    ? null
    : buildAcknowledgeUrl({ publicUrl: config.publicUrl, installationId, owner, repo, prNumber, sha: headSha });

  const comment = formatComment(result, head.path, ai, acknowledgeUrl);
  await octokit.issues.createComment({ owner, repo, issue_number: prNumber, body: comment });

  await setCommitStatus(octokit, {
    owner,
    repo,
    sha: headSha,
    state: alreadyAcknowledged ? "success" : "failure",
    description: alreadyAcknowledged
      ? "Breaking changes acknowledged"
      : `${result.breakingChanges.length} unacknowledged breaking change${result.breakingChanges.length === 1 ? "" : "s"}`,
  });

  console.log(
    `[reviewApiChanges] ${owner}/${repo}#${prNumber}: ${result.breakingChanges.length} breaking, ${result.nonBreakingChanges.length} non-breaking, acknowledged: ${alreadyAcknowledged}, AI explanation: ${ai ? "yes" : "no"}`
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
