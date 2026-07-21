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
import { recordChange } from "./recordChange.js";
import { config } from "../config.js";
import { log } from "../logger.js";

/**
 * The real Phase 2+3+4+5 pipeline: find the spec file, fetch both
 * versions, diff them, ask AI to explain the result, post it, gate the
 * commit status on acknowledgment, and log the run for the dashboard.
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
 *
 * `acknowledgmentsCollection` and `changesCollection` are two separate
 * MongoDB collections with two separate jobs - the former only tracks
 * "has this exact commit been acknowledged", the latter is a permanent
 * log of every run, used to build the dashboard's timeline and stats.
 */
export async function reviewApiChanges({
  octokit,
  acknowledgmentsCollection,
  changesCollection,
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
    // appears on PRs it actually has something to say about. Also not
    // logged to the changes collection - there's no diff to log.
    log("review.no_spec_file", { owner, repo, prNumber });
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
    // check as errored rather than leaving it stuck on "pending". Also not
    // logged to the changes collection - there's no valid diff to log.
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
    await recordChange(changesCollection, {
      owner,
      repo,
      prNumber,
      sha: headSha,
      specPath: head.path,
      breakingCount: 0,
      nonBreakingCount: result.nonBreakingChanges.length,
      acknowledged: true, // nothing to acknowledge - treated as "clear" for stats purposes
    });
    log("review.no_breaking_changes", { owner, repo, prNumber });
    return;
  }

  const alreadyAcknowledged = await isAcknowledged(acknowledgmentsCollection, {
    owner,
    repo,
    prNumber,
    sha: headSha,
  });

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

  await recordChange(changesCollection, {
    owner,
    repo,
    prNumber,
    sha: headSha,
    specPath: head.path,
    breakingCount: result.breakingChanges.length,
    nonBreakingCount: result.nonBreakingChanges.length,
    acknowledged: alreadyAcknowledged,
  });

  log("review.completed", {
    owner,
    repo,
    prNumber,
    breakingCount: result.breakingChanges.length,
    nonBreakingCount: result.nonBreakingChanges.length,
    alreadyAcknowledged,
    aiExplanationUsed: !!ai,
  });
}

async function tryExplainChanges(result) {
  const providers = [];
  if (config.groqApiKey) providers.push(createGroqProvider(config.groqApiKey));
  if (config.geminiApiKey) providers.push(createGeminiProvider(config.geminiApiKey));

  if (providers.length === 0) {
    log("review.ai_not_configured", {});
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
