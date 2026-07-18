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
  port: process.env.PORT || 3000,
  appId: required("GITHUB_APP_ID"),
  privateKey: normalizePrivateKey(required("GITHUB_APP_PRIVATE_KEY")),
  webhookSecret: required("GITHUB_WEBHOOK_SECRET"),
};
