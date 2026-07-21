import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import rateLimit from "express-rate-limit";
import crypto from "node:crypto";
import { config } from "./config.js";
import { webhooks } from "./webhooks.js";
import { getInstallationOctokit } from "./github/auth.js";
import { getAcknowledgmentsCollection, getChangesCollection, getUsersCollection } from "./db/mongo.js";
import { acknowledgeChange } from "./actions/acknowledgeChange.js";
import { buildAuthorizeUrl, exchangeCodeForUser } from "./auth/githubOAuth.js";
import { signSession } from "./auth/session.js";
import { requireAuth } from "./auth/middleware.js";
import { getRecentChanges, getStats, getTrackedRepos } from "./api/dashboardData.js";
import { log, logError } from "./logger.js";

const app = express();
app.use(cookieParser());
// credentials: true is required for the browser to send/receive the
// session cookie cross-origin (the dashboard on Vercel calling the API on
// Render are two different sites) - origin must be an exact match, not a
// wildcard, whenever credentials are involved.
app.use(cors({ origin: config.frontendUrl, credentials: true }));

// Defense in depth against abuse burning through paid/quota-limited
// resources (Groq calls, MongoDB writes, GitHub API calls). The webhook
// route is already protected by signature verification + idempotency, so
// it doesn't need this - these two limiters cover the routes a stranger
// could hit directly.
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 100 });
const acknowledgeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20 });

// Cookies need different settings depending on whether we're running
// locally (http://localhost, frontend and backend are "same-site" even on
// different ports) or deployed (two genuinely different domains, which
// requires SameSite=None + Secure - browsers reject SameSite=None cookies
// over plain http, so this can't just always be "none").
const isDeployed = config.publicUrl.startsWith("https://");
const crossSiteCookieOptions = isDeployed ? { sameSite: "none", secure: true } : { sameSite: "lax", secure: false };

// Health check - useful for Render's health monitoring and for confirming
// a fresh deploy is actually up before wiring the real GitHub webhook URL.
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// --- Login (Phase 5) ---
// Uses the same GitHub App's OAuth credentials - no separate OAuth App
// needed. `state` is a random value stored in a short-lived cookie and
// checked on callback, a standard CSRF protection for OAuth redirects.
app.get("/auth/github", (req, res) => {
  const state = crypto.randomBytes(16).toString("hex");
  res.cookie("oauth_state", state, { httpOnly: true, maxAge: 10 * 60 * 1000, ...crossSiteCookieOptions });
  const url = buildAuthorizeUrl({
    clientId: config.githubClientId,
    redirectUri: `${config.publicUrl}/auth/github/callback`,
    state,
  });
  res.redirect(url);
});

app.get("/auth/github/callback", async (req, res) => {
  const { code, state } = req.query;

  if (!state || state !== req.cookies?.oauth_state) {
    return res.status(400).send("Invalid or expired login attempt - please try logging in again.");
  }

  try {
    const user = await exchangeCodeForUser({
      code,
      clientId: config.githubClientId,
      clientSecret: config.githubClientSecret,
    });

    const usersCollection = await getUsersCollection();
    await usersCollection.updateOne(
      { githubId: user.id },
      { $set: { githubId: user.id, login: user.login, avatarUrl: user.avatarUrl, lastLoginAt: new Date() } },
      { upsert: true }
    );

    const token = signSession({ githubId: user.id, login: user.login, avatarUrl: user.avatarUrl }, config.sessionSecret);
    res.clearCookie("oauth_state");
    res.cookie("session", token, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000, ...crossSiteCookieOptions });
    res.redirect(config.frontendUrl);
  } catch (error) {
    logError("auth.login_failed", error);
    res.status(500).send("Login failed - please try again.");
  }
});

app.get("/auth/logout", (req, res) => {
  res.clearCookie("session");
  res.redirect(config.frontendUrl);
});

app.get("/api/me", apiLimiter, requireAuth, (req, res) => {
  res.json({ login: req.user.login, avatarUrl: req.user.avatarUrl });
});

// --- Dashboard API (Phase 5) ---
// NOTE (known v1 scope limitation): these endpoints return data across
// ALL tracked repos, not scoped to the logged-in user specifically - this
// app doesn't yet map GitHub App installations to individual OAuth users.
// Fine for a solo/portfolio deployment; a genuinely multi-tenant version
// would need that mapping before this data could be considered private.
app.get("/api/changes", apiLimiter, requireAuth, async (req, res) => {
  const changesCollection = await getChangesCollection();
  const changes = await getRecentChanges(changesCollection, { limit: 50 });
  res.json(changes);
});

app.get("/api/stats", apiLimiter, requireAuth, async (req, res) => {
  const changesCollection = await getChangesCollection();
  const stats = await getStats(changesCollection);
  res.json(stats);
});

app.get("/api/repos", apiLimiter, requireAuth, async (req, res) => {
  const changesCollection = await getChangesCollection();
  const repos = await getTrackedRepos(changesCollection);
  res.json(repos);
});

// The link posted in PR comments when there's an unacknowledged breaking
// change. Deliberately a plain GET (clickable, no form/JS needed) - the
// tradeoff, worth knowing, is that anyone with the link can acknowledge.
// Acceptable for a v1/portfolio project; a real production version would
// want this to require the clicker to be authenticated as a repo
// collaborator first.
app.get("/acknowledge/:installationId/:owner/:repo/:prNumber/:sha", acknowledgeLimiter, async (req, res) => {
  const { installationId, owner, repo, prNumber, sha } = req.params;

  try {
    const octokit = await getInstallationOctokit(installationId);
    const collection = await getAcknowledgmentsCollection();

    await acknowledgeChange({
      octokit,
      collection,
      owner,
      repo,
      prNumber: Number(prNumber),
      sha,
      installationId,
    });

    res.status(200).send(
      `<html><body style="font-family: sans-serif; padding: 2rem;">` +
        `<h2>✅ Acknowledged</h2>` +
        `<p>The breaking change on ${owner}/${repo}#${prNumber} has been acknowledged. The status check has been updated - you can go back to the PR now.</p>` +
        `</body></html>`
    );
  } catch (error) {
    logError("acknowledge.failed", error, { owner, repo, prNumber });
    res.status(500).send(
      `<html><body style="font-family: sans-serif; padding: 2rem;">` +
        `<h2>❌ Something went wrong</h2>` +
        `<p>Couldn't acknowledge this change: ${error.message}</p>` +
        `</body></html>`
    );
  }
});

// IMPORTANT: signature verification needs the *raw* request body bytes,
// not JSON already parsed by a body-parser - the HMAC is computed over the
// exact bytes GitHub sent. So this route uses express.raw() instead of
// express.json(), and only on this one route.
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const id = req.headers["x-github-delivery"];
    const name = req.headers["x-github-event"];
    const signature = req.headers["x-hub-signature-256"];

    if (!id || !name || !signature) {
      log("webhook.rejected_missing_headers", {});
      return res.status(400).send("Missing required GitHub webhook headers");
    }

    try {
      // verifyAndReceive rejects (throws) if the signature doesn't match -
      // nothing below this line runs on a request that isn't really from
      // GitHub.
      await webhooks.verifyAndReceive({
        id,
        name,
        signature,
        payload: req.body.toString("utf8"),
      });

      // Acknowledge quickly. GitHub considers a delivery failed (and will
      // retry) if it doesn't get a 2xx response promptly - our actual work
      // already happened in the handler above before we reply here, which
      // is fine for Phase 0's single lightweight action but will need
      // rethinking once Phase 3's AI call could take several seconds.
      res.status(200).send("ok");
    } catch (error) {
      logError("webhook.verification_or_handling_failed", error, { deliveryId: id });
      res.status(401).send("Webhook signature verification failed");
    }
  }
);

app.listen(config.port, () => {
  log("server.started", { port: config.port });
});
