# Chatbot Forge

A self-hostable platform where anyone can build a chatbot in a couple of minutes: pick an LLM, upload
what it should know, choose how it talks. Then ship it three ways, as a **share link**, an
**`<iframe>` embed**, or a **one-line widget script** that drops a chat bubble onto any website.

Answers are grounded in a real knowledge base (files, websites, sitemaps, pasted text, Q&A pairs)
with hybrid semantic plus keyword retrieval, and every answer carries citations back to the source
it came from.

Built with Next.js 14 (App Router), TypeScript, Tailwind and MongoDB.

---

## What it does

**For the person building a bot**

1. **Identity**: name, tagline, avatar, accent colour, light or dark.
2. **Model**: provider and model, their own API key, creativity, reply length, memory depth.
3. **Info and instructions**: the always-on rules and persona.
4. **Knowledge base**: embedding provider, how many chunks to retrieve, citations, strict grounding.
5. **Talking style**: 9 presets (Friendly, Professional, Concise, Detailed, Playful, Empathetic,
   Expert, Socratic tutor, Sales) or a custom voice they describe themselves.
6. **First impression**: greeting, input placeholder, up to 4 starter questions.
7. **Access**: live or paused, plus an optional allowed-domains list.

Hit **Create** and the next screen hands over the link, the copy-paste snippets, a live test chat,
and the knowledge base uploader.

**For the people using the bot**: a streaming chat with markdown rendering, starter chips, source
chips under each answer, a stop button, and a mobile-friendly layout.

## Screenshots

| File | Shows |
|---|---|
| `screenshots/1-builder.png` | the builder with live preview |
| `screenshots/3-widget-open.png` | the widget running on a third-party site |
| `screenshots/6-hosted-page.png` | the hosted share link |
| `screenshots/10-knowledge-filled.png` | the knowledge base manager |
| `screenshots/11-citations.png` | an answer with source chips |

---

## Getting started

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local`:

```ini
MONGODB_URI=mongodb://127.0.0.1:27017      # or your Atlas mongodb+srv://... string
MONGODB_DB=chatbot_forge
ENCRYPTION_SECRET=<32+ random chars>
```

Generate the encryption secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Then:

```bash
npm run dev     # http://localhost:3000
```

No MongoDB handy? [Atlas](https://www.mongodb.com/atlas) has a free tier, or run one locally with
`docker run -d -p 27017:27017 mongo:7`.

---

## The knowledge base

This is what separates a chatbot that recites a prompt from one that actually knows your business.

### What you can feed it

| Source | Notes |
|---|---|
| **Files** | `.pdf`, `.docx`, `.txt`, `.md`, `.csv`, `.tsv`, `.json`, `.html`. Up to 20MB each. |
| **Website** | Fetches a page, optionally following same-origin links up to 30 pages. |
| **Sitemap** | Reads `sitemap.xml`, including sitemap indexes, and crawls the listed pages. |
| **Text** | Paste anything: policies, transcripts, notes. |
| **Q&A pairs** | Each pair is indexed alone, so the question itself becomes the match key. Best for FAQs. |

Spreadsheets and CSVs are not dumped raw. Each row is rewritten as `Column: value` lines, because a
bare CSV embeds badly once the header row is far from the data. JSON is flattened to `path: value`
for the same reason. PDFs keep page markers so a citation can point at a page.

### How retrieval works

1. **Chunking** splits text at paragraph boundaries near a 1,600 character target with 200
   characters of overlap, and carries the nearest heading into each chunk. So a chunk reading
   "It costs $12" still knows that "it" is the Pro plan.
2. **Embedding** turns each chunk into a vector, using whichever provider the creator picked.
3. **At question time** the query is embedded and matched two ways at once:
   - **Semantic**, so "how much does it cost" finds a chunk that says "pricing starts at $12".
   - **BM25 keyword**, so exact product codes, names and numbers are not blurred away. Both sides
     run through a light stemmer, so "refunds" matches a document that only says "refund".
   The two rankings are merged with reciprocal rank fusion, which needs no score calibration
   between them.
4. **The top chunks** are numbered and placed in the system prompt, with instructions to cite them
   as `[1]`, `[2]`, to ignore irrelevant excerpts, and never to invent a citation number.
5. **Citations** come back to the browser and render as chips under the answer. Chips from a web
   page link to it; chips from a file reveal the excerpt they came from when clicked.

Follow-up questions like "and the price?" are resolved by folding in the previous user turn before
retrieval, so a short question still retrieves the right thing.

### Embedding providers

OpenAI, Google Gemini, Voyage, Mistral, Cohere, Together, Ollama, or any OpenAI-compatible
`/embeddings` URL.

When the embedding vendor matches the chat vendor, the same key covers both and the field can be
left blank. When the creator's only key is for a provider with no embedding API (Groq,
OpenRouter), the bot can run with embeddings set to **none** and retrieval falls back to keyword
search, which still works well on FAQs and product docs.

### Vector search on Atlas

By default, similarity is computed in-process, which is fine into the low thousands of chunks and
works on a plain local `mongod`. For larger collections, create an Atlas Vector Search index on the
`chunks` collection and set `MONGODB_VECTOR_INDEX` to its name:

```json
{
  "fields": [
    { "type": "vector", "path": "embedding", "numDimensions": 1536, "similarity": "cosine" },
    { "type": "filter", "path": "botId" }
  ]
}
```

Set `numDimensions` to match your embedding model (1536 for `text-embedding-3-small`, 1024 for
`voyage-3.5`, 3072 for `text-embedding-3-large`). The app detects the index and switches to
`$vectorSearch` automatically, falling back to in-process scoring if the query fails.

### Limits

Per bot: 4M characters total. Per source: 1.5M characters, 1,500 chunks, 30 crawled pages, 20MB per
file. All are constants at the top of `src/lib/knowledge/ingest.ts`.

---

## The three delivery surfaces

### 1. Floating widget, one script tag

```html
<script src="https://your-domain.com/widget.js" data-bot-id="BOT_ID" defer></script>
```

Drops a chat bubble in the corner of any page. The chat itself loads in a sandboxed iframe, so the
widget cannot read the host page and the host page cannot read the conversation. The iframe is only
created when someone opens the panel, so it costs nothing until it is used.

| Attribute | Default | Meaning |
|---|---|---|
| `data-bot-id` | required | which chatbot to load |
| `data-position` | `right` | `left` or `right` |
| `data-open` | `false` | start expanded |
| `data-label` | bot's name | tooltip and aria-label |
| `data-width` / `data-height` | `400` / `620` | panel size in px |
| `data-accent` | bot's accent | override the bubble colour |
| `data-offset` | `20` | distance from the page edge |
| `data-emoji` | none | use an emoji instead of the chat icon |
| `data-hide-on-mobile` | `false` | hide below 480px |

It also exposes `window.ChatbotForge.open() / .close() / .toggle()` so a host page can open the chat
from its own "Need help?" button. Escape closes it, even while typing inside the iframe.

### 2. Inline iframe

```html
<iframe src="https://your-domain.com/embed/BOT_ID"
        style="width:100%;height:600px;border:0;border-radius:16px"></iframe>
```

Add `?header=0` or `?footer=0` to strip the chrome.

### 3. Share link

`https://your-domain.com/chat/BOT_ID` is a full-page hosted chat with proper page metadata, good for
emails, QR codes, or a "Talk to us" button.

### Bonus: REST API

```bash
curl -N https://your-domain.com/api/chat/BOT_ID \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello!"}]}'
```

Streams the reply as plain text. Send the whole conversation each time to give it memory. Citations
come back in the `X-Citations` response header as base64-encoded JSON, and `X-Retrieval` reports how
many chunks were used, so the body stays a clean text stream.

---

## Supported chat providers

Eleven out of the box, plus anything else that speaks the OpenAI wire format:

OpenAI, Google Gemini, Groq, OpenRouter, Mistral, DeepSeek, xAI (Grok), Together AI, Fireworks,
Perplexity, Ollama (self-hosted), and **Custom** for any base URL.

One adapter covers all of them, because nearly every vendor now implements
`POST /chat/completions`. **Adding a provider is one entry in
`src/lib/providers.ts` and nothing else.** Every provider also lets you type a model id by hand, so
you are never blocked waiting for the list to be updated.

### Who pays

Each creator pastes their own API key, which is encrypted with AES-256-GCM before it touches the
database and only ever decrypted server-side, at request time. Visitors chatting with a bot never
see it, and neither does the dashboard, which only shows a `sk-a••••3210` mask.

Optionally, set `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY` or
`VOYAGE_API_KEY` in the environment as a platform-wide fallback, used only
when a creator leaves the key field blank.

A creator with neither a key nor credits is not stuck at that step. The model step offers **ask the
admin for a key**: a short note that lands in `/admin` with their address, the provider and model
they were on, and what they typed. One open request per provider, so nudging does not turn into a
second row on the list. Deciding one is bookkeeping, not a grant — approving records that the admin
agreed, and the key or the credits still arrive through *Platform keys* or *Grant credits*.

---

## Project layout

```
src/
  app/
    page.tsx                       dashboard and landing
    create/                        the builder
    bots/[id]/                     manage: embed snippets, knowledge base, live test
    bots/[id]/edit/                edit
    chat/[id]/                     hosted share-link page
    embed/[id]/                    iframe view (framing allowed)
    api/bots/                      CRUD, owner-scoped
    api/bots/[id]/public/          theme and copy for the chat UI, no secrets
    api/bots/[id]/sources/         knowledge base: add, list, delete
    api/chat/[id]/                 streaming proxy, the only place keys are used
    api/key-requests/              creators asking the admin to cover them
    api/admin/key-requests/        who asked, and answering them
  components/
    BotForm.tsx                    the builder with live preview
    ChatWindow.tsx                 the chat UI, shared by every surface
    KnowledgeManager.tsx           upload, crawl, list, delete sources
    ManageBot.tsx                  share and embed panel
    Markdown.tsx                   tiny escape-first markdown renderer
    EmbedBridge.tsx                iframe to host page messaging
    AdminPanel.tsx                 platform overview, keys, credits, key requests
    KeyRequest.tsx                 "ask the admin for a key", inside the builder
  lib/
    providers.ts                   chat provider catalog     <- add providers here
    styles.ts                      talking-style presets     <- add voices here
    prompt.ts                      system-prompt composer
    llm.ts                         the two streaming adapters
    crypto.ts                      AES-256-GCM for API keys
    contrast.ts                    WCAG-safe colours for any accent
    validate.ts                    input validation and domain allow-list
    mongodb.ts                     connection, collections, indexes
    key-requests.ts                filing and deciding key requests
    knowledge/
      constants.ts                 shared file-type limits
      extract.ts                   PDF, DOCX, CSV, JSON, HTML to text
      html.ts                      HTML to readable text
      crawl.ts                     page and sitemap fetching, SSRF guard
      chunk.ts                     paragraph-aware chunking
      embed.ts                     embedding provider catalog and adapter
      retrieve.ts                  BM25, vector search, rank fusion
      ingest.ts                    the pipeline that ties it together
public/widget.js                   the embeddable loader, no build step
```

---

## Security notes

- **API keys** are encrypted at rest (AES-256-GCM, random IV per write, auth tag verified on read)
  and never serialised to any client response.
- **The browser never talks to the model provider.** All calls go through `/api/chat/:id`.
- **Crawling cannot reach your internal network.** Every outbound request goes through one
  `safeFetch`, which refuses `localhost`, private IPv4 and IPv6 ranges and the cloud metadata
  endpoint `169.254.169.254`; resolves DNS and checks the actual address, so a public-looking
  hostname pointing at loopback is rejected; and follows redirects manually so each hop is
  re-validated rather than trusting the first one. Response bodies are capped while they stream, so
  a hostile server cannot exhaust memory.
- **Prompt injection into the page is not possible.** Model output is HTML-escaped before the
  markdown renderer introduces a single tag.
- **Domain allow-list**, an optional per-bot list (`acme.com`, `*.acme.com`). Because the iframe is
  served from this app, its own `Origin` says nothing about which site embedded it, so the embed
  reports the page that framed it and the list is checked against that. Setting a list also blocks
  calls that carry no browser origin at all, which means a server-side script using the REST API
  needs its own domain added. Treat it as a control on honest embedding rather than a hard boundary:
  the header is only as trustworthy as the browser that sent it.
- **Rate limiting**, two shared windows per request. One per visitor (20 a minute) stops a single
  person hammering the widget; one per chatbot (240 a minute) is what actually caps spend, since a
  client identifier is spoofable and rotating it would otherwise sidestep the first limit entirely.
  A bot-wide rejection refunds the visitor's own window, so it cannot lock them out of a chatbot
  that has already recovered. The counters live in MongoDB, not in the process: on a serverless host
  an in-process counter resets exactly when it is needed.
- **A platform API key never leaves the vendor's endpoint.** A bot's custom base URL is honoured
  only when the request carries the creator's own key, or no key at all — otherwise a bot pointed at
  `https://attacker.example/v1` would be handed the platform's key in an `Authorization` header.
  Creator-supplied endpoints get the same DNS and redirect checks as the crawler.
- **Passwords** are scrypt-hashed with a random salt per account, and reset links are stored only as
  a SHA-256 hash, so a database dump does not hand over the ability to take accounts. Links built
  into emails come from `NEXT_PUBLIC_APP_URL` rather than the request's `Host` header, which the
  requester writes.
- **Sessions can be ended.** The cookie is a signed token carrying its issue time; a password reset
  or "log out everywhere" moves the account's cutoff forward and every earlier token stops working,
  on every device.
- **Payments are confirmed by Stripe, not by the browser.** Credits are granted only by a webhook
  whose signature is verified against the raw body, and each Stripe event id can pay out once.
- **Personal data expires.** Booking requests, stored transcripts, reset tokens and rate-limit
  windows all carry a TTL, and an account can export or delete everything from `/account`.
- **Iframe isolation.** The widget cannot read the host page or vice versa. The only channel is a
  narrow `postMessage` whose origin is verified.
- **Contrast.** Text on the accent colour picks white or near-black by luminance, and nudges the
  background if neither clears WCAG AA, so a pale accent never produces unreadable text.

### Before going to production

Accounts, shared rate limiting, password recovery, payments and data retention are all in place —
see **Going live with real customers** in [DEPLOY.md](DEPLOY.md) for the settings each one needs.
The short version:

1. Set `NEXT_PUBLIC_APP_URL`. Emailed links and Stripe return URLs refuse to fall back to the
   request's `Host` header in production, so without it password resets do not send.
2. Set `RESEND_API_KEY` and `MAIL_FROM`, or nobody can recover a forgotten password.
3. Check the unique index on `users.email` actually built — it silently fails if the collection
   already holds duplicate addresses. The query is in DEPLOY.md.
4. Configure the Stripe webhook, or leave Stripe unset and keep top-ups manual through `/admin`.
5. Fill in the operator placeholders on `/privacy` and `/terms`, and have both reviewed.

Still open, and worth knowing about:

- **Anonymous drafts are still identified by a random id in `localStorage`**, sent as `x-owner-id`.
  That is what lets someone build a bot before signing up, and it means anyone who learns a draft's
  owner id can edit that draft. Registered accounts use a signed session cookie instead, and API
  keys, uploads and credits are account-only for exactly this reason.
- Ingestion runs inside the request rather than as a background job, so a very large sitemap crawl
  is bounded by the host's function timeout (60 seconds on Netlify).
- There are no per-bot monthly caps, only per-minute rate limits and the credit balance. Consider
  adding one if creators are strangers.
- Passwords need eight characters and nothing else — no breach-list check.

---

## Tests

```bash
npm run typecheck      # tsc --noEmit
npm test               # 237 unit and adapter tests, no DB needed
npm run test:knowledge # 128 knowledge base tests
npm run test:e2e       # 120 end-to-end HTTP checks against a real server
npm run test:visual    # 41 browser checks in Chromium, writes screenshots/
npm run test:nav       # 37 navigation checks in Chromium
npm run test:all       # all of the above
```

`test` covers key encryption, prompt assembly, config validation, the domain allow-list, rate
limiting, colour contrast, and both streaming adapters, run against a local fake provider so no API
keys and no network are involved.

`test:knowledge` covers HTML extraction, the SSRF guard, chunking, CSV and JSON parsing, the
stemmer, BM25, rank fusion, vector maths, context assembly, and the embedding adapter. It includes
regression cases for every bug found in review: adversarial HTML that used to freeze the parser,
comment syntax that used to truncate a page, heading-dense documents that used to be shredded,
duplicate chunks, and stray quotes that used to swallow CSV rows.

`test:e2e` and `test:visual` boot the real app against an in-process store (`CF_FAKE_DB=1`, see
`src/lib/mongodb.fake.ts`) plus a fake model and embedding server, so the whole path from create to
ingest to retrieve to cite to embed to delete is exercised without a database or a single token of
spend. Set `MONGODB_URI` before `test:e2e` to run the same checks against real MongoDB instead.

`test:visual` needs Chromium: `npx playwright install chromium`, or point `PLAYWRIGHT_CHROMIUM` at
an existing binary.

---

## Deploying

Works anywhere Next.js runs. On Vercel: import the repo, set `MONGODB_URI`, `MONGODB_DB`,
`ENCRYPTION_SECRET` and `NEXT_PUBLIC_APP_URL`, then deploy. Use MongoDB Atlas and allow-list
Vercel's egress, or `0.0.0.0/0` for a quick start.

Streaming replies and sitemap crawls can run long, so watch the function timeout on serverless
platforms. `maxDuration` is 60 seconds for chat and 300 seconds for ingestion.

> **Note:** changing `ENCRYPTION_SECRET` makes every stored API key unreadable, and creators will
> need to paste theirs again.
