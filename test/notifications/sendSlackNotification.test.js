import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { sendSlackNotification } from "../../src/notifications/sendSlackNotification.js";

function fakeFetch({ ok = true, status = 200 } = {}) {
  const calls = [];
  const fn = async (url, options) => {
    calls.push({ url, options });
    return { ok, status };
  };
  fn.calls = calls;
  return fn;
}

function fakeFetchThatThrows(message) {
  return async () => {
    throw new Error(message);
  };
}

describe("sendSlackNotification", () => {
  test("posts the message as JSON to the webhook URL and returns true on success", async () => {
    const fetchImpl = fakeFetch({ ok: true });
    const result = await sendSlackNotification(
      "https://hooks.slack.com/services/fake",
      { text: "hello" },
      { fetchImpl }
    );

    assert.equal(result, true);
    assert.equal(fetchImpl.calls.length, 1);
    assert.equal(fetchImpl.calls[0].url, "https://hooks.slack.com/services/fake");
    assert.deepEqual(JSON.parse(fetchImpl.calls[0].options.body), { text: "hello" });
  });

  test("returns false (not a throw) on a non-2xx response", async () => {
    const fetchImpl = fakeFetch({ ok: false, status: 404 });
    const result = await sendSlackNotification("https://hooks.slack.com/services/fake", { text: "hi" }, { fetchImpl });
    assert.equal(result, false);
  });

  test("CRITICAL: returns false (not a throw) when the network call itself fails", async () => {
    const fetchImpl = fakeFetchThatThrows("network unreachable");
    // This must not throw - a Slack outage should never break the review
    // pipeline that's already done its real job by this point.
    const result = await sendSlackNotification("https://hooks.slack.com/services/fake", { text: "hi" }, { fetchImpl });
    assert.equal(result, false);
  });
});
