export function buildAuthorizeUrl({ clientId, redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "read:user",
    state,
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

/**
 * Exchanges the one-time `code` GitHub redirected back with for an actual
 * access token, then immediately uses that token to fetch the user's
 * profile - these two calls always happen together in this app, so
 * they're combined into one function rather than making every caller
 * chain them manually.
 */
export async function exchangeCodeForUser({ code, clientId, clientSecret }, { fetchImpl = fetch } = {}) {
  const tokenResponse = await fetchImpl("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });

  if (!tokenResponse.ok) {
    throw new Error(`GitHub token exchange failed: ${tokenResponse.status}`);
  }

  const tokenData = await tokenResponse.json();
  if (!tokenData.access_token) {
    throw new Error(`GitHub token exchange returned no access_token: ${JSON.stringify(tokenData)}`);
  }

  const userResponse = await fetchImpl("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: "application/vnd.github+json",
    },
  });

  if (!userResponse.ok) {
    throw new Error(`Fetching GitHub user profile failed: ${userResponse.status}`);
  }

  const user = await userResponse.json();
  return { id: user.id, login: user.login, avatarUrl: user.avatar_url };
}
