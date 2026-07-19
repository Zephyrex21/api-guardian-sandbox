# API Guardian

## Status

- **Phase 0 — Foundation:** done. Proven end to end on your local machine (signature verification, GitHub App auth, posting a comment) — deploying to Render (below) is the one remaining step.
- **Phase 1 — Diff Engine:** done, 20/20 tests passing.
- **Phase 2 — Wire the diff engine into real PRs:** done, 32/32 tests passing.
- **Phase 3 — AI explanation layer:** done, 47/47 tests passing overall. Turns the raw breaking-change list into a plain-English summary + per-change migration note. Fully optional — no API keys, no crash, just falls back to Phase 2's raw output.

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
