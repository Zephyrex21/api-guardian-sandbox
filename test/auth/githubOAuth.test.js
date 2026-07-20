import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildAuthorizeUrl, exchangeCodeForUser } from "../../src/auth/githubOAuth.js";

function fakeFetch(responses) {
  let call = 0;
  return async (url) => {
    const response = responses[call];
    call += 1;
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: async () => response.body,
    };
  };
}

describe("buildAuthorizeUrl", () => {
  test("includes client id, redirect uri, and state", () => {
    const url = buildAuthorizeUrl({
      clientId: "abc123",
      redirectUri: "https://example.com/callback",
      state: "xyz",
    });
    assert.match(url, /^https:\/\/github\.com\/login\/oauth\/authorize\?/);
    assert.match(url, /client_id=abc123/);
    assert.match(url, /redirect_uri=https%3A%2F%2Fexample\.com%2Fcallback/);
    assert.match(url, /state=xyz/);
  });
});

describe("exchangeCodeForUser", () => {
  test("exchanges the code for a token, then fetches the user profile", async () => {
    const fetchImpl = fakeFetch([
      { status: 200, body: { access_token: "gho_faketoken" } },
      { status: 200, body: { id: 42, login: "venom", avatar_url: "https://example.com/avatar.png" } },
    ]);

    const user = await exchangeCodeForUser(
      { code: "abc", clientId: "id", clientSecret: "secret" },
      { fetchImpl }
    );

    assert.deepEqual(user, { id: 42, login: "venom", avatarUrl: "https://example.com/avatar.png" });
  });

  test("throws a clear error if the token exchange fails", async () => {
    const fetchImpl = fakeFetch([{ status: 401, body: { error: "bad_verification_code" } }]);
    await assert.rejects(
      () => exchangeCodeForUser({ code: "bad", clientId: "id", clientSecret: "secret" }, { fetchImpl }),
      /token exchange failed: 401/
    );
  });

  test("throws a clear error if GitHub returns no access_token", async () => {
    const fetchImpl = fakeFetch([{ status: 200, body: { error: "incorrect_client_credentials" } }]);
    await assert.rejects(
      () => exchangeCodeForUser({ code: "abc", clientId: "id", clientSecret: "secret" }, { fetchImpl }),
      /no access_token/
    );
  });

  test("throws a clear error if fetching the user profile fails", async () => {
    const fetchImpl = fakeFetch([
      { status: 200, body: { access_token: "gho_faketoken" } },
      { status: 403, body: {} },
    ]);
    await assert.rejects(
      () => exchangeCodeForUser({ code: "abc", clientId: "id", clientSecret: "secret" }, { fetchImpl }),
      /user profile failed: 403/
    );
  });
});
