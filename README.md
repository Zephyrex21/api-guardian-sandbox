# API Guardian

## Status

- **Phase 0 — Foundation:** code complete, tested locally with a dummy key. Manual steps (GitHub App registration + Render deploy) are still on you — see below.
- **Phase 1 — Diff Engine:** code complete, 20/20 tests passing (`npm test`). Fully standalone — no GitHub or AI involved yet, just pure `diffSpecs(base, head)` logic. Run `npm test` yourself to verify.

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
