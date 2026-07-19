/**
 * Loaded via `node --test --import ./test/setup.js` BEFORE any test file
 * runs, so config.js's required() checks never fail during `npm test` -
 * tests should never depend on a real .env existing. These values are
 * fake on purpose; nothing here ever talks to a real GitHub App or
 * MongoDB cluster (every test that touches those uses a fake/injected
 * client instead).
 */
process.env.GITHUB_APP_ID ??= "test-app-id";
process.env.GITHUB_APP_PRIVATE_KEY ??= "-----BEGIN RSA PRIVATE KEY-----\ntest-key-for-unit-tests-only\n-----END RSA PRIVATE KEY-----";
process.env.GITHUB_WEBHOOK_SECRET ??= "test-webhook-secret";
process.env.MONGODB_URI ??= "mongodb://localhost:27017/test";
