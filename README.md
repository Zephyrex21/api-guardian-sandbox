# API Guardian

## Status

- **Phase 0 — Foundation:** done. Proven end to end on your local machine (signature verification, GitHub App auth, posting a comment) — deploying to Render (below) is the one remaining step.
- **Phase 1 — Diff Engine:** done, 20/20 tests passing.
- **Phase 2 — Wire the diff engine into real PRs:** done, 32/32 tests passing.
- **Phase 3 — AI explanation layer:** done, 47/47 tests passing overall. Turns the raw breaking-change list into a plain-English summary + per-change migration note. Fully optional — no API keys, no crash, just falls back to Phase 2's raw output.
- **Phase 4 — Commit status gating & acknowledgment:** done, 55/55 tests passing overall. This is the phase that makes the app an actual *guardian* rather than just a commenter — it sets a real commit status that can block a merge, and only unblocks once a human clicks an acknowledgment link.
- **Phase 5a — Login + dashboard backend:** done, 69/69 tests passing overall. GitHub login, and every diff run now gets logged to a `changes` collection with JSON API endpoints to read it back.
- **Phase 5b — Dashboard UI:** done. A real React (Vite) frontend in `frontend/` — login screen, live stats, tracked repos, and a redline-style activity log. Design direction: an ink-navy "watch room" with brass accents and legal-redline markup (red for breaking, sage for clean) rather than a generic dashboard template, since this tool is literally marking up contract changes.
- **Phase 6 — Production hardening:** done, 72/72 tests passing overall. Duplicate webhook deliveries are now detected and skipped, dashboard/acknowledge routes are rate-limited, GitHub API calls auto-retry on rate limits, logs are structured JSON, and CI runs the full suite on every push.
- **Phase 7 — GraphQL schema diffing:** done, 93/93 tests passing overall. The app now detects and reviews GraphQL schema files (`schema.graphql`/`schema.graphqls`) with the exact same review pipeline (AI explanation, commit-status gating, acknowledgment, dashboard logging) that OpenAPI specs get — nothing downstream had to change to support a second spec format.
- **Phase 8 — Slack notifications:** done, 105/105 tests passing overall. A new, genuinely unacknowledged breaking change now optionally posts to a Slack channel via an Incoming Webhook — fully optional, same graceful-degradation pattern as the AI keys, and a Slack outage never breaks the actual review pipeline.

---

## Phase 8 — Slack notifications

**Why an Incoming Webhook, not a full Slack bot/app with OAuth:** this app only ever needs to push a one-way notification into one pre-chosen channel — it never needs to update a message, read channel history, or post to a dynamically-chosen channel. Incoming Webhooks are exactly the tool for that: one URL, no OAuth flow to manage, no token to refresh. A bot token with `chat:write` would be the right call if this ever needed to post to different channels per repo or edit messages after the fact — not needed here.

**When it fires:** only for a genuinely new, unacknowledged breaking change — not for clean PRs, and not for a change that's already been acknowledged. A notification that fires on every PR regardless of whether it needs attention trains people to ignore the channel, so this is deliberately narrow.

**To set it up:**
1. Go to api.slack.com/apps → **Create New App** → **From scratch** → name it (e.g. "API Guardian") → pick your workspace
2. In the app's settings, click **Incoming Webhooks** in the left sidebar, toggle it **On**
3. Click **Add New Webhook to Workspace**, choose the channel you want notifications in, click **Allow**
4. Copy the URL it gives you (starts with `https://hooks.slack.com/services/...`)
5. Paste it into `.env` as `SLACK_WEBHOOK_URL=...`
6. Restart `npm run dev`

**To test it:** open a PR with a real breaking change (same as any earlier phase's test) — within a few seconds you should see a message in your chosen Slack channel with the repo, PR number, breaking count, and links to both the PR and the acknowledgment page.

---

## Phase 7 — GraphQL schema diffing

**How the diffing actually works:** rather than hand-writing a GraphQL type-system differ, this wraps `findSchemaChanges()` from `graphql-js` (the official reference implementation's own schema-comparison utility, stable as of v17). GraphQL's breaking-change rules — interfaces, unions, directives, argument covariance — are genuinely complex and already correctly implemented and spec-tested upstream; the real engineering work here was mapping graphql-js's own `BreakingChangeType`/`DangerousChangeType` categories onto this project's existing `{breaking, severity, location, message}` shape, so every downstream step (AI explanation, PR comment formatting, commit-status gating, dashboard recording) works identically for GraphQL as it already does for OpenAPI — none of that code needed to change.

**Classification:**
- `BreakingChangeType` changes (field/type removed, new required argument, etc.) → breaking, high severity — these error at query time for at least some clients
- `DangerousChangeType` changes (value added to an enum, new optional argument, etc.) → breaking, medium severity — these won't error, but can silently change runtime behavior for a client that didn't expect the new possibility (the same reasoning as the OpenAPI differ's response-side enum-widening case)
- Everything else (new field, new type) → non-breaking

**Detection:** same convention-then-override pattern as OpenAPI — checks `schema.graphql` then `schema.graphqls` at the repo root by default, or an exact path from `.guardian.yml`:
```yaml
specPath: contracts/schema.graphql
type: graphql   # optional - inferred from a .graphql/.graphqls extension if omitted
```
If a repo happens to have both an OpenAPI spec and a GraphQL schema at their respective default paths, the OpenAPI one is checked first (a deliberate, documented tie-break — most repos will only have one or the other).

**To test this on your sandbox repo:** commit a `schema.graphql` to `main`, e.g.:
```graphql
type User {
  id: ID!
  name: String
}

type Query {
  viewer: User
}
```
Then open a PR that removes the `name` field (or makes any other breaking change) — you should get the same style of AI-explained, acknowledgment-gated PR comment you've already seen for OpenAPI.

---

## Phase 6 — Production hardening

**Idempotency (the fix for a gap flagged all the way back at the planning stage):** GitHub retries a webhook delivery if it doesn't get a fast response. Without a fix, a retry would re-run the whole pipeline — a second AI call, a second PR comment, a second commit-status write. Every delivery's ID is now recorded in a `processedDeliveries` collection with a **unique index**, and the check uses MongoDB's own duplicate-key error as the source of truth (not a "check, then insert" pattern, which has a race condition under concurrent requests). A retried delivery now exits in milliseconds, before touching AI, GitHub, or anything else.

**Rate limiting:** `/api/*` (100 requests/15min) and `/acknowledge/*` (20/15min) are rate-limited per IP. The `/webhook` route doesn't need this — it's already protected by signature verification plus the idempotency check above.

**GitHub API retries:** the Octokit client now uses `@octokit/plugin-retry`, so transient rate-limit or server errors from GitHub's API are retried with backoff automatically, instead of failing the whole review.

**Structured logging:** the key operational events (webhook received, duplicate skipped, review completed, errors) now log as single-line JSON via `src/logger.js` — the format most hosting platforms (including Render) expect for log search/filtering. Applied to the important outcome lines, not swapped in everywhere — a few reliable, greppable lines beat blanket replacement.

**CI:** `.github/workflows/ci.yml` runs the full test suite on every push and pull request to `main`. Push this repo to GitHub and you'll see a ✅/❌ next to every commit automatically — no setup needed beyond having the repo on GitHub.

---

## Phase 5b — Dashboard UI

Lives entirely in `frontend/` — a separate Vite project from the backend, meant to be deployed separately too (frontend on Vercel, backend on Render), which is why it has its own `package.json`.

**Run it locally:**
```bash
cd frontend
npm install
npm run dev
```
This starts a dev server at `http://localhost:5173`. It talks to your backend at `http://localhost:3000` by default (no `.env` needed locally) — just make sure `npm run dev` is also running in the main project folder at the same time.

**Before it'll show real data, two backend settings need to match:**
1. In the main project's `.env`, `FRONTEND_URL` should be `http://localhost:5173` (this is the default if you leave it blank, so likely no change needed)
2. Open `http://localhost:5173` in your browser, click "Sign in with GitHub" — this redirects through the backend's OAuth flow and back

**What you'll see:**
- Not logged in → a centered login screen
- Logged in → four stat cards (total/breaking/pending/clean), a list of tracked repos on the left, and a chronological log of every diff run on the right — each entry tagged Breaking or Clean, with the commit SHA, spec path, and acknowledgment status

**Deploying to Vercel (once you're ready):**
1. Push the `frontend/` folder to GitHub (can be the same repo as the backend, or a separate one — either works)
2. On vercel.com: New Project → import the repo → if backend and frontend share a repo, set "Root Directory" to `frontend`
3. Add one environment variable in Vercel's project settings: `VITE_API_URL` = your real Render URL (e.g. `https://api-guardian.onrender.com`)
4. Deploy
5. Back in the backend's `.env` (or Render's environment settings), update `FRONTEND_URL` to your real Vercel URL, and update your GitHub App's callback URL to `https://your-render-url.onrender.com/auth/github/callback` if it isn't already

---

## Phase 5a — Login and dashboard backend (no UI yet)

**What's new:**
- `GET /auth/github` → redirects to GitHub's login page
- `GET /auth/github/callback` → GitHub redirects back here after login; creates/updates a `users` record and sets a session cookie
- `GET /auth/logout` → clears the session
- Three JSON API endpoints, all requiring login (`requireAuth` middleware checks the session cookie):
  - `GET /api/changes` — the 50 most recent diff runs, newest first
  - `GET /api/stats` — total changes, breaking count, pending acknowledgments, clean count
  - `GET /api/repos` — every repo the app has ever checked, with last-checked time

**Known v1 scope limitation, worth knowing honestly:** these API endpoints return data across *all* tracked repos, not scoped to the specific logged-in user — the app doesn't yet map GitHub App installations to individual OAuth accounts. That's fine for a solo/portfolio deployment (you're the only user), but a genuinely multi-tenant version would need that mapping before this data could be considered private per-user.

**To set this up:**
1. Go to your GitHub App's settings page (github.com/settings/apps/zephyrex21-api-guardian)
2. Near the top, copy the **Client ID** → paste into `.env` as `GITHUB_CLIENT_ID`
3. Scroll to **Client secrets** → click **Generate a new client secret** → copy it → paste into `.env` as `GITHUB_CLIENT_SECRET` (this is different from the `.pem` private key file — don't confuse the two)
4. Find **Callback URL** (or "User authorization callback URL") on the same settings page and set it to `http://localhost:3000/auth/github/callback` for local testing
5. Generate a random string for `SESSION_SECRET` the same way you did for the webhook secret
6. Restart `npm run dev`

**To test the backend API directly (optional, useful for debugging):**
1. Open `http://localhost:3000/auth/github` directly in your browser
2. Log in with GitHub, approve access — you'll land on your dashboard at `http://localhost:5173`
3. Open `http://localhost:3000/api/stats` directly — you should see real JSON back, not a 401

---

## Phase 4 — Commit status gating

On every PR with a spec file, the app now sets a real GitHub commit status
(shows up as a check next to the PR's merge button):
- **Pending** as soon as the webhook fires
- **Success** if there are no breaking changes
- **Failure** if there are unacknowledged breaking changes — if this
  context is marked as a "required check" in the repo's branch protection
  settings, this literally blocks the merge button
- Back to **Success** once someone clicks the acknowledgment link in the
  PR comment

Acknowledgments are stored in MongoDB, keyed by the exact commit SHA — so
pushing a new commit after acknowledging automatically re-locks the PR
(the new SHA has no matching record), without any extra code needed for
that case.

**To set this up, you need a free MongoDB Atlas cluster:**
1. Go to mongodb.com/cloud/atlas, sign up (free, no card required for the free tier)
2. Create a free (M0) cluster
3. Under "Database Access", create a database user with a username/password
4. Under "Network Access", add `0.0.0.0/0` (allow from anywhere) — fine for a personal/portfolio project, not something you'd do for a real production database with sensitive data
5. Click "Connect" on your cluster → "Drivers" → copy the connection string
6. Paste it into `.env` as `MONGODB_URI=mongodb+srv://...`, filling in the username/password you created

**To test the merge-blocking for real** (optional but worth seeing once):
1. On your sandbox repo, go to Settings → Branches → add a branch protection rule for `main`
2. Enable "Require status checks to pass before merging", search for and select `api-guardian/breaking-changes`
3. Open a PR with a real breaking change — the merge button will show as blocked
4. Click the acknowledgment link in the bot's comment — refresh the PR — the merge button unblocks

---

## Phase 3 — AI explanation layer

When there's at least one breaking change, the app now asks an AI model to
write a one-sentence summary and a short migration note per breaking
change — the AI never decides *what's* breaking (that's still Phase 1's
deterministic diff engine, unchanged), it only explains an already-correct
verdict in plain English.

**To turn this on:**
1. Get a free Groq key: console.groq.com/keys (no credit card)
2. Optionally also get a free Gemini key: aistudio.google.com/apikey (used only as a fallback if Groq fails)
3. Add both to `.env`:
   ```
   GROQ_API_KEY=your-key-here
   GEMINI_API_KEY=your-key-here
   ```
4. Restart `npm run dev`

With no keys set, comments look exactly like Phase 2's. With a key set,
open a PR with a real breaking change (see the Phase 2 section above for a
sample spec) and the comment will include a summary line and a 💡 note
under each breaking change.

**Worth knowing:** the AI call only happens when there's at least one
breaking change — a clean PR never spends API quota on an explanation
nobody needs.

---

## Phase 2 — Real diff pipeline

On every `pull_request.opened`/`synchronize`, the app now:
1. Looks for an OpenAPI spec file in the repo (`openapi.yaml`, `openapi.yml`, or `openapi.json` at the root by default — or wherever a `.guardian.yml` with a `specPath:` field points)
2. Fetches that file's content at both the PR's base and head commit
3. Runs Phase 1's `diffSpecs()` on the two versions
4. Posts the result as a PR comment — grouped into breaking (always visible) and non-breaking (collapsed by default)

**To test this for real** (not just the unit tests), your sandbox repo needs
an actual `openapi.yaml`. A simple starting point:

```yaml
openapi: 3.0.0
info:
  title: Sandbox API
  version: "1.0"
paths:
  /users:
    post:
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                name:
                  type: string
              required: [name]
      responses:
        "201":
          content:
            application/json:
              schema:
                type: object
                properties:
                  id:
                    type: string
```

Commit that to `main` on your sandbox repo first. Then open a PR that
changes it — e.g. add `required: [name, email]` with a new `email`
property — and you should get a comment flagging it as breaking.

**One thing worth knowing:** the app fetches the spec at the exact commit
SHA GitHub sends in the webhook payload. If you push a new commit to an
existing PR, GitHub sends a fresh `synchronize` event with a new head SHA,
so re-running the check on new pushes works automatically — no special
handling needed on your end for that.

---

## Phase 1 — Diff Engine

Lives entirely in `src/diff/`. Import and call directly:

```js
import { diffSpecs } from "./src/diff/index.js";

const result = diffSpecs(baseOpenApiSpec, headOpenApiSpec);
// result.breakingChanges    - array of Change objects, breaking: true
// result.nonBreakingChanges - array of Change objects, breaking: false
// result.allChanges         - everything, in case you want the full picture
```

**The one thing worth understanding before touching this code:** the same
kind of change (a field being removed, an enum growing, a field becoming
required) can be safe on one side of an API and breaking on the other,
depending on whether it's a *request* (client → server) or *response*
(server → client). `src/diff/schema-diff.js` has a full comment block at
the top explaining this asymmetry — read that before modifying the
severity rules, or you'll likely "fix" something that was correct.

Run the tests any time you touch this logic:
```bash
npm test
```

20 tests currently cover: path/operation add-remove, request-side field
rules, response-side field rules (including the asymmetric enum/required
cases), parameters, rename detection, and one end-to-end scenario modeled
on a realistic multi-change PR.

**Known gap, worth knowing about:** rename detection only catches renames
where the old and new field names are the same word under a naming
convention change (`full_name` → `fullName`). A genuine rename to an
unrelated word (`customerId` → `clientId`) will be reported as a separate
removal + addition instead — which is the safer failure mode (you still
get told about both changes), just not labeled as a rename.

---

## Phase 0 — Foundation

Phase 0 exit criteria: opening a PR on a sandbox repo results in a real
comment posted by your bot, end to end, on a **deployed** instance (not
localhost).

The code in this folder is done and tested — signature verification
correctly rejects forged requests and correctly passes real ones through to
the GitHub auth step (verified locally with a dummy key). What's left are a
few steps that only you can do, since they require your own GitHub and
Render accounts.

### 1. Create a sandbox repo

Create a new, empty **public** repo under your account, e.g.
`Zephyrex21/api-guardian-sandbox`. This is what you'll open test PRs
against for every phase from here on — nothing in this repo needs to be
real, it just needs to exist.

### 2. Register the GitHub App

Go to **github.com/settings/apps/new** and fill in:

| Field | Value |
|---|---|
| GitHub App name | `<yourusername>-api-guardian` (must be globally unique) |
| Homepage URL | your sandbox repo's URL (placeholder is fine for now) |
| Webhook → Active | ✅ checked |
| Webhook URL | see step 3 — use the smee.io URL for now, you'll swap this for your real Render URL after deploying |
| Webhook secret | generate a random string yourself (e.g. `openssl rand -hex 20`) and save it — you'll need it in `.env` |
| Permissions → Pull requests | **Read & write** (needed to post comments) |
| Permissions → Contents | **Read-only** (needed later, in Phase 2, to fetch spec files — fine to set now) |
| Subscribe to events | ✅ Pull request |
| Where can this app be installed | "Only on this account" is fine for now |

After creating it:
- Note the **App ID** shown at the top of the settings page
- Scroll down and click **Generate a private key** — this downloads a `.pem` file. Keep it safe, it's the credential that lets your server act as this App.

### 3. Local development tunnel

GitHub needs a real public URL to send webhooks to, even during local dev.
Go to **smee.io**, click **Start a new channel**, and copy the URL it gives
you — paste that as your Webhook URL in step 2 (you can edit it later).

Then run a tunnel locally:
```bash
npx smee-client --url <your-smee-url> --target http://localhost:3000/webhook
```

### 4. Configure and run locally

```bash
npm install
cp .env.example .env
```

Fill in `.env`:
- `GITHUB_APP_ID` — from step 2
- `GITHUB_APP_PRIVATE_KEY` — open the downloaded `.pem` file, paste its full contents (all lines) as the value
- `GITHUB_WEBHOOK_SECRET` — the secret you generated in step 2

```bash
npm run dev
```

### 5. Install the App and test

On your GitHub App's settings page, click **Install App**, choose your
sandbox repo. Then open any PR on that repo (even a trivial one-line
change to a random file). Within a few seconds you should see your bot
comment: *"👋 API Guardian is watching this PR."*

If it doesn't show up, check the terminal running `npm run dev` — every
webhook delivery and any errors are logged there.

### 6. Deploy to Render (makes Phase 0 actually "done")

1. Push this code to a new repo (or a folder within your main project repo)
2. On Render: **New → Web Service**, connect the repo
3. Build command: `npm install` — Start command: `npm start`
4. Add the same three environment variables from your `.env` in Render's dashboard (for `GITHUB_APP_PRIVATE_KEY`, paste it as one line — `src/config.js` already handles converting escaped `\n` back to real newlines)
5. Deploy, then copy your live Render URL (e.g. `https://api-guardian.onrender.com`)
6. Go back to your GitHub App settings and change the Webhook URL from the smee.io URL to `https://<your-render-url>/webhook`
7. Open one more test PR on your sandbox repo — this time the comment should arrive via your real deployed server, no tunnel involved

Once that comment shows up, Phase 0 is genuinely done — the whole
authentication chain (GitHub → your server → back to GitHub) is proven on
a real deployment, and Phase 1 (the diff engine) can be built with
confidence that the plumbing underneath it works.
