import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { config } from "../config.js";

/**
 * GitHub Apps authenticate in two steps:
 *  1. Sign a short-lived JWT with the App's private key (proves "I am this App")
 *  2. Exchange that JWT for an installation access token (proves "I am this
 *     App, acting on this specific repo/org that installed me")
 *
 * @octokit/auth-app handles both steps and caches/refreshes tokens for us.
 * We create a fresh authenticated Octokit client per installation rather
 * than a single global client, since each installation has different repo
 * access.
 */
const appAuth = createAppAuth({
  appId: config.appId,
  privateKey: config.privateKey,
});

/**
 * Returns an Octokit instance authenticated as a specific installation
 * (i.e. scoped to whatever repo/org triggered the webhook).
 */
export async function getInstallationOctokit(installationId) {
  if (!installationId) {
    throw new Error(
      "getInstallationOctokit called without an installationId - every webhook payload should include one."
    );
  }

  const installationAuth = await appAuth({
    type: "installation",
    installationId,
  });

  return new Octokit({ auth: installationAuth.token });
}
