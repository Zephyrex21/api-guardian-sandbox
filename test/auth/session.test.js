import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { signSession, verifySession } from "../../src/auth/session.js";

describe("session tokens", () => {
  test("a token signed with a secret verifies successfully with the same secret", () => {
    const token = signSession({ githubId: 123, login: "venom" }, "secret-a");
    const payload = verifySession(token, "secret-a");
    assert.equal(payload.githubId, 123);
    assert.equal(payload.login, "venom");
  });

  test("a token verified with the wrong secret returns null, not a throw", () => {
    const token = signSession({ githubId: 123 }, "secret-a");
    const payload = verifySession(token, "wrong-secret");
    assert.equal(payload, null);
  });

  test("garbage input returns null instead of crashing the caller", () => {
    assert.equal(verifySession("not-a-real-token", "secret-a"), null);
    assert.equal(verifySession("", "secret-a"), null);
  });
});
