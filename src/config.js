import "dotenv/config";

/**
 * Central place to read + validate environment variables.
 * Fails loud and early if something required is missing, rather than
 * letting a half-configured app start and fail mysteriously on the
 * first webhook delivery.
 */
function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Check your .env file against .env.example.`
    );
  }
  return value;
}

// Render (and most PaaS providers) store multi-line PEM keys as a single
// env var with literal "\n" sequences instead of real newlines. Convert
// back to real newlines so the JWT signer can parse the key correctly.
function normalizePrivateKey(raw) {
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

export const config = {
  get port() {
    return process.env.PORT || 3000;
  },
  get appId() {
    return required("GITHUB_APP_ID");
  },
  get privateKey() {
    return normalizePrivateKey(required("GITHUB_APP_PRIVATE_KEY"));
  },
  get webhookSecret() {
    return required("GITHUB_WEBHOOK_SECRET");
  },
  // Required (unlike the AI keys) - Phase 4's whole point is persisted
  // acknowledgment state, so there's no sensible "degrade gracefully"
  // behavior if this is missing, unlike the AI layer which is purely
  // additive on top of an already-working feature.
  get mongoUri() {
    return required("MONGODB_URI");
  },
  // Used to build the acknowledgment link posted in PR comments. Defaults
  // to localhost for local dev - you can copy that link out of a comment
  // and open it in your own browser on the same machine to test it, even
  // though GitHub/other people couldn't reach it. Update this to your real
  // Render URL once deployed so the link works for anyone.
  get publicUrl() {
    return process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;
  },
  // Optional on purpose: the AI layer (Phase 3) should degrade gracefully
  // to Phase 2's raw diff output if neither key is set, rather than
  // crashing the whole app over a missing "nice to have" feature.
  get groqApiKey() {
    return process.env.GROQ_API_KEY || null;
  },
  get geminiApiKey() {
    return process.env.GEMINI_API_KEY || null;
  },
  // Required for Phase 5's login - these come from the SAME GitHub App
  // you already created (its settings page has a Client ID and a
  // "Generate a new client secret" button under "Client secrets") - no
  // need to register a second, separate OAuth App.
  get githubClientId() {
    return required("GITHUB_CLIENT_ID");
  },
  get githubClientSecret() {
    return required("GITHUB_CLIENT_SECRET");
  },
  // Signs the session cookie issued after login. Any long random string
  // works - generate one the same way you generated the webhook secret.
  get sessionSecret() {
    return required("SESSION_SECRET");
  },
  // The dashboard frontend's URL - needed for CORS (the API and the
  // dashboard live on different domains once deployed: Render for the
  // API, Vercel for the frontend) and to know which origin is allowed to
  // send credentials (cookies) with its requests. Defaults to Vite's
  // local dev server port for local testing.
  get frontendUrl() {
    return process.env.FRONTEND_URL || "http://localhost:5173";
  },
  // Optional, same pattern as the AI keys: the app works fully without
  // this, it just doesn't post to Slack. An Incoming Webhook URL, not a
  // bot token - this app only ever pushes one-way notifications to a
  // single pre-chosen channel, which is exactly what Incoming Webhooks
  // are for, and needs no OAuth flow or token refresh to manage.
  //
  // NOTE ON WHY EVERY FIELD ABOVE IS A GETTER, NOT A PLAIN VALUE: getters
  // read process.env fresh on every access. A plain object literal would
  // read process.env exactly once, the moment this module is first
  // imported, and freeze that value for the process's whole lifetime -
  // in production this distinction rarely matters, but it's what makes
  // this module correctly testable (a test that sets
  // process.env.SLACK_WEBHOOK_URL and then imports/calls code depending
  // on config.slackWebhookUrl needs that change to actually be seen).
  get slackWebhookUrl() {
    return process.env.SLACK_WEBHOOK_URL || null;
  },
};
