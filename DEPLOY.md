# Deploying to Netlify

Everything in the project is already configured for Netlify: `netlify.toml` sets the build, the Node
version, the upload ceiling and the ingestion time budget. What is left is running the deploy and
setting four environment variables.

Two paths below. The first is one command and takes about two minutes.

---

## Path A: deploy from your machine (fastest)

You need Node 18+ installed. From inside the project folder:

```bash
npm install
npx netlify-cli deploy --build --prod
```

The first run opens a browser to log in, then asks two questions: create a new site (yes) and pick a
name. That is it.

Prefer not to log in through the browser? Use your personal access token instead:

```bash
NETLIFY_AUTH_TOKEN=<your token> npx netlify-cli deploy --build --prod
```

There is also `./scripts/deploy-netlify.sh`, which does the same thing and checks your environment
variables are set first.

---

## Path B: connect a Git repository

Gives you a deploy on every push, which is the better long-term setup.

```bash
git init
git add -A
git commit -m "Chatbot Forge"
git branch -M main
git remote add origin https://github.com/<you>/chatbot-forge.git
git push -u origin main
```

Then in Netlify: **Add new site → Import an existing project → GitHub → pick the repo**. The build
command and publish directory are read from `netlify.toml`, so leave them as detected.

---

## Environment variables

Set these under **Site configuration → Environment variables** in Netlify. Never commit them.

| Variable | Required | Value |
|---|---|---|
| `MONGODB_URI` | yes | Your Atlas connection string |
| `MONGODB_DB` | yes | `chatbot_forge` |
| `ENCRYPTION_SECRET` | yes | 32+ random characters, see below |
| `NEXT_PUBLIC_APP_URL` | yes | Your final site URL, e.g. `https://your-site.netlify.app` |
| `MONGODB_VECTOR_INDEX` | no | Name of an Atlas Vector Search index, if you create one |
| `OPENAI_API_KEY` and friends | no | Platform-wide fallback keys, used only when a creator leaves the key blank |

Generate the encryption secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Two notes on it: keep it somewhere safe, and never change it once bots exist. It encrypts every
creator's API key, so rotating it makes all of them unreadable and everyone has to paste theirs in
again.

`NEXT_PUBLIC_APP_URL` is read at build time, so after you set it, trigger one more deploy. Until
then the embed snippets on the manage screen will point at whatever origin you loaded the page from,
which is right in the browser but wrong when you copy it somewhere else.

---

## MongoDB Atlas checklist

1. **Network access.** Netlify functions do not have fixed IPs on the free and Pro plans, so add
   `0.0.0.0/0` under **Network Access** in Atlas. Without this every request fails with a server
   selection timeout, which is the single most common reason a deploy looks broken.
2. **Database user.** Needs read and write on the database in `MONGODB_DB`.
3. **Region.** Netlify runs functions in US East (Ohio) by default. An Atlas cluster in the same
   region keeps the round trip short. This only matters for perceived speed, not correctness.
4. **Indexes.** The app creates its own on first use. Nothing to do.

---

## What Netlify changes about how the app behaves

These are platform limits, not bugs, and the code already accounts for each one.

**Functions stop at 60 seconds** and this cannot be raised on any plan. Chat streams start well
inside that. Ingestion works to a 50 second budget (`INGEST_BUDGET_MS` in `netlify.toml`): when it
runs out it stops fetching, indexes the pages it already has, and marks the source with a warning
saying so. A 30-page sitemap will usually need to be added in two or three goes.

**Request bodies are capped at 6MB**, and binary uploads are base64-encoded on the way in, costing
about 30%. That leaves roughly 4MB of actual file, so `netlify.toml` sets
`NEXT_PUBLIC_MAX_UPLOAD_MB=4` and the uploader shows that limit. Larger documents need to be split,
or converted to text and pasted in. Raise the variable if you move to a host with a bigger body
limit.

**Functions are stateless and there may be several of them.** The rate limiter therefore keeps its
counters in MongoDB rather than in memory — an in-process counter resets whenever a function is
recycled, which is exactly when it is needed. It falls back to a local counter if the database is
unreachable, so a Mongo blip degrades the limiter instead of taking chat down.

**Cold starts.** The first request after a quiet spell takes a second or two longer while the
function boots and reconnects to Mongo.

---

## After the first deploy

1. Open the site, create a chatbot, and send it a message. If it answers, the database and the
   provider key are both fine.
2. If chats fail with a server error, check the function log under **Logs → Functions**. A server
   selection timeout means Atlas network access, not the app.
3. Set `NEXT_PUBLIC_APP_URL` and redeploy so the embed snippets are correct.
4. Rotate any credential that has been pasted into a chat window or a terminal history.

---

## Going live with real customers

The steps above get the app running. These are the ones that matter once other people's money and
data are involved.

### 1. Set the mailer, or nobody can recover an account

`RESEND_API_KEY` and `MAIL_FROM`. Without them, password-reset links are written to the function log
instead of being sent, and a customer who forgets their password has no way back in except you
editing the database. Booking notifications and purchase receipts go quiet too.

Check it by using **Forgot your password?** on /account and confirming the mail arrives.

### 2. Check the unique email index actually built

Accounts are protected against duplicate signups by a unique index on `users.email`. It is created
automatically on first use — but **if the collection already contains two accounts with the same
address, the index silently fails to build** and the app logs a warning rather than crashing.

    db.users.aggregate([{ $group: { _id: "$email", n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }])

If that returns anything, merge or delete the duplicates and restart, then confirm:

    db.users.getIndexes()   // expect an entry for { email: 1 } with unique: true

### 3. Payments

Set `STRIPE_SECRET_KEY`, then add a webhook endpoint in the Stripe dashboard pointing at
`https://your-domain.com/api/billing/webhook`, subscribed to `checkout.session.completed`, and put
its signing secret in `STRIPE_WEBHOOK_SECRET`.

Credits are granted **by the webhook and nothing else** — the browser being redirected back to
/account proves nothing about whether a payment succeeded. An unsigned or replayed webhook is
refused, and each Stripe event id can only pay out once.

Test with Stripe's test keys and a `4242 4242 4242 4242` card before switching to live keys.

**Do step 1 first.** Buying credits requires a confirmed email address, and confirming one requires
a working mailer — so Stripe configured without email means nobody can complete a purchase.

### 4. Fill in the legal pages

/privacy and /terms are accurate about what the software does, and carry bracketed placeholders
until `NEXT_PUBLIC_OPERATOR_NAME`, `NEXT_PUBLIC_PRIVACY_EMAIL` and `NEXT_PUBLIC_SUPPORT_EMAIL` are
set. They are a starting point, not legal advice — have someone qualified read them against the law
where you operate.

### 5. Keep ALLOW_PRIVATE_ENDPOINTS off

It exists so someone self-hosting can point a bot at `http://localhost:11434/v1`. On a hosted
deployment it only ever lets a bot reach your internal network. Leave it unset.

### 6. Know what one credit costs you

A credit buys a bounded amount of work (`TOKENS_PER_CREDIT` in `src/lib/credits.ts`, currently
4,000 tokens), and a larger message costs proportionally more. Price the packs in `src/lib/packs.ts`
against your actual model spend before selling any.

---

## Operational notes

**Nothing runs on a schedule.** Expiring data — rate-limit windows, reset tokens, old bookings,
stored transcripts — is removed by MongoDB TTL indexes, which the app creates on first use. Atlas
sweeps them roughly once a minute. Abandoned anonymous drafts are swept opportunistically when
someone else creates a bot.

**Credits are reserved before the model is called** and refunded if it fails, so a burst of
simultaneous messages cannot overdraw a balance. Every movement is written to a `ledger` collection,
which is what /account's history reads and what to check when a customer queries their balance.

**Sessions are signed cookies with an issue time.** "Log out everywhere" and a password reset both
move an account's `sessionsValidFrom` forward, which invalidates every token issued before that
moment. There is no session table to clear.