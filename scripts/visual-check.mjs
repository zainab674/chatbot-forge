/**
 * Browser check — proves the three delivery surfaces actually work in a real
 * page, not just at the HTTP level.
 *
 *   npm run test:visual
 *
 * Boots the app against the in-process store and a fake model, creates a
 * chatbot, then drives Chromium through:
 *   1. the builder (/create)
 *   2. a third-party host page with the <script> widget — bubble → panel → chat
 *   3. the hosted /chat/:id page
 * Screenshots land in ./screenshots.
 */
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs/promises';

const APP_PORT = 3312;
const MODEL_PORT = 4312;
const HOST_PORT = 5312;
const BASE = `http://127.0.0.1:${APP_PORT}`;
const OWNER = 'visual-owner-0123456789';
const SHOTS = path.join(process.cwd(), 'screenshots');

let pass = 0;
let fail = 0;
const check = (name, ok, extra = '') => {
  if (ok) {
    pass++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    fail++;
    console.log(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`);
  }
};

const portFree = (port) =>
  // Wildcard bind on purpose: a stale server listens on ::, which a 127.0.0.1
  // probe would miss.
  new Promise((resolve) => {
    const s = net
      .createServer()
      .once('error', () => resolve(false))
      .once('listening', () => s.close(() => resolve(true)))
      .listen(port);
  });

function fakeEmbedding(text, dims = 96) {
  const vec = new Array(dims).fill(0);
  for (const token of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    let h = 0;
    for (let i = 0; i < token.length; i++) h = (h * 31 + token.charCodeAt(i)) >>> 0;
    vec[h % dims] += 1;
  }
  return vec;
}

function fakeModel() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const parsed = JSON.parse(body || '{}');

        if (req.url?.includes('/embeddings')) {
          const input = Array.isArray(parsed.input) ? parsed.input : [parsed.input];
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({ data: input.map((t, i) => ({ index: i, embedding: fakeEmbedding(String(t)) })) }),
          );
          return;
        }

        const last = parsed.messages?.at(-1)?.content ?? '';
        const grounded = /Retrieved sources/.test(parsed.messages?.[0]?.content ?? '');
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const reply = grounded
          ? 'Returns are accepted within 30 days [1]. Widgets cost **$9** each [2].'
          : `You said **${last}**. Widgets cost $9 each.`;
        for (const word of reply.split(' ')) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: word + ' ' } }] })}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });
    server.listen(MODEL_PORT, '127.0.0.1', () => resolve(server));
  });
}

/** A pretend customer website that embeds the widget with one script tag. */
function hostSite(botId) {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Acme Widgets — Home</title>
<style>
  body{font-family:ui-sans-serif,system-ui,sans-serif;margin:0;color:#0f172a;background:#fff}
  header{border-bottom:1px solid #e2e8f0;padding:18px 40px;font-weight:600}
  main{max-width:720px;margin:0 auto;padding:64px 24px}
  h1{font-size:40px;line-height:1.1;margin:0 0 16px}
  p{color:#475569;line-height:1.7}
</style></head>
<body>
  <header>ACME WIDGETS</header>
  <main>
    <h1>The finest widgets, since 1998.</h1>
    <p>This is a pretend customer website. The only thing it knows about Chatbot Forge is the
    single script tag at the bottom of this page — everything else is the widget doing its job.</p>
    <p>Click the bubble in the corner to talk to the bot.</p>
  </main>
  <script src="${BASE}/widget.js" data-bot-id="${botId}" data-label="Chat with Acme" defer></script>
</body></html>`;
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    });
    server.listen(HOST_PORT, '127.0.0.1', () => resolve(server));
  });
}

async function waitFor(url, timeoutMs = 60_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return true;
    } catch {
      /* not up */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function main() {
  for (const p of [APP_PORT, MODEL_PORT, HOST_PORT]) {
    if (!(await portFree(p))) {
      console.error(`Port ${p} is in use.`);
      process.exit(1);
    }
  }
  await fs.mkdir(SHOTS, { recursive: true });

  const model = await fakeModel();
  // On Windows the .bin entry is a .cmd shim, which only a shell can execute
  // (and detached process groups do not exist there).
  const win = process.platform === 'win32';
  const nextBin = path.join(process.cwd(), 'node_modules', '.bin', win ? 'next.cmd' : 'next');
  const app = spawn(nextBin, ['start', '-p', String(APP_PORT)], {
    detached: !win,
    shell: win,
    env: {
      ...process.env,
      CF_FAKE_DB: '1',
      // The fake model server runs on loopback, which the endpoint guard
      // refuses by default. The guard is the fix for a bot being pointed at an
      // internal address, so the suite opts out of it rather than weakening it.
      ALLOW_PRIVATE_ENDPOINTS: '1',
      MONGODB_DB: 'visual',
      ENCRYPTION_SECRET: 'visual-check-secret-not-for-production',
      NEXT_PUBLIC_APP_URL: BASE,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  app.stdout.on('data', () => {});
  app.stderr.on('data', (d) => process.env.VERBOSE && process.stderr.write(d));

  const kill = () => {
    if (win) {
      // Synchronous: this also runs from 'exit', where async work is abandoned.
      try {
        spawnSync('taskkill', ['/pid', String(app.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch {
        /* gone */
      }
      return;
    }
    try {
      process.kill(-app.pid, 'SIGKILL');
    } catch {
      /* gone */
    }
  };
  process.on('exit', kill);

  let host;
  let browser;
  try {
    if (!(await waitFor(`${BASE}/`))) throw new Error('App did not start.');

    // Saving an API key requires an account, so the fixture bot gets one.
    const signup = await fetch(`${BASE}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'visual@example.test', password: 'visual-password-1', ownerId: OWNER }),
    });
    const session = (signup.headers.get('set-cookie') ?? '').match(/cf_session=([^;]+)/)?.[1] ?? '';
    check('signed up a test account', signup.ok && Boolean(session));
    /** Owner-scoped pages need the session cookie in the browser too. */
    const logIn = (page) =>
      page.context().addCookies([{ name: 'cf_session', value: session, domain: '127.0.0.1', path: '/' }]);

    const created = await (
      await fetch(`${BASE}/api/bots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: `cf_session=${session}` },
        body: JSON.stringify({
          name: 'Acme Helper',
          tagline: 'Answers questions about widgets',
          info: 'Widgets cost $9 each. Shipping is free over $50.',
          style: 'friendly',
          provider: 'custom',
          customBaseUrl: `http://127.0.0.1:${MODEL_PORT}/v1`,
          model: 'fake-model-1',
          apiKey: 'visual-test-key',
          embeddingProvider: 'custom',
          embeddingModel: 'fake-embed-1',
          greeting: 'Hi! Ask me anything about our widgets.',
          suggestions: ['How much is a widget?', 'Do you ship free?'],
          accent: '#0ea5e9',
          avatarEmoji: '🛒',
        }),
      })
    ).json();
    const botId = created.bot?.id;
    check('created a chatbot to test with', Boolean(botId), JSON.stringify(created));
    if (!botId) throw new Error('setup failed');

    host = await hostSite(botId);

    // PLAYWRIGHT_CHROMIUM lets a CI image point at a preinstalled browser.
    browser = await chromium.launch({
      executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

    console.log('\nBuilder');
    // These assertions were written against the pre-wizard builder, and every
    // string they looked for had since been renamed — so the suite failed here
    // and never reached the widget checks below. They now follow the six-step
    // flow the builder actually has.
    await page.goto(`${BASE}/create`, { waitUntil: 'networkidle' });
    check('the builder opens on the first step', await page.getByText('Tell me what your bot does.').isVisible());
    check('all six steps are listed', (await page.locator('nav[aria-label="Builder steps"] .rail-step').count()) === 6);
    check('a starting point is offered', await page.getByText('Shop support').first().isVisible());

    await page.getByText('Skip and start from blank').click();
    check('skipping reaches the identity step', await page.getByText('Give it a face.').isVisible());
    await page.getByPlaceholder('Wax Assistant').fill('Demo Bot');
    check('typing a name updates the preview', await page.getByText('Demo Bot').first().isVisible());

    await page.getByRole('button', { name: /Next: Brain/ }).click();
    check('the knowledge step explains itself', await page.getByText('What does it know?').isVisible());

    await page.getByRole('button', { name: /Next: Voice/ }).click();
    check('the voice step is reachable', await page.getByText('How should it talk?').isVisible());

    await page.getByRole('button', { name: /Next: Model/ }).click();
    check('the model step is reachable', await page.getByText('Which brain runs it?').isVisible());
    check('a model can be chosen', await page.locator('#cf-model').isVisible());
    check('guardrails are shown alongside it', await page.getByText('Guardrails').first().isVisible());
    check('conversation logging is offered', await page.getByText('Saves conversations').isVisible());
    await page.screenshot({ path: path.join(SHOTS, '1-builder.png'), fullPage: false });

    console.log('\nWidget on a third-party site');
    await page.goto(`http://127.0.0.1:${HOST_PORT}/`, { waitUntil: 'networkidle' });
    const bubble = page.locator('.cf-bubble');
    await bubble.waitFor({ state: 'visible', timeout: 10_000 });
    check('the bubble is injected into the host page', await bubble.isVisible());
    check(
      'the bubble picks up the bot accent colour',
      (await bubble.evaluate((el) => getComputedStyle(el).backgroundColor)) === 'rgb(14, 165, 233)',
    );
    check('no iframe is loaded before the bubble is clicked', (await page.locator('.cf-panel iframe').count()) === 0);
    await page.screenshot({ path: path.join(SHOTS, '2-widget-closed.png') });

    await bubble.click();
    const frame = page.frameLocator('.cf-panel iframe');
    await frame.getByText('Ask me anything about our widgets').waitFor({ timeout: 15_000 });
    check('clicking the bubble opens the chat panel', true);
    check('the greeting renders inside the panel', true);
    check('starter questions are offered', await frame.getByRole('button', { name: 'How much is a widget?' }).isVisible());
    await page.screenshot({ path: path.join(SHOTS, '3-widget-open.png') });

    await frame.getByRole('button', { name: 'How much is a widget?' }).click();
    await frame.getByText('Widgets cost $9 each.').waitFor({ timeout: 15_000 });
    check('clicking a starter question streams a reply', true);
    check('markdown in the reply is rendered', (await frame.locator('.msg strong').count()) > 0);
    await page.screenshot({ path: path.join(SHOTS, '4-widget-chat.png') });

    await frame.getByRole('textbox').fill('Do you ship to Karachi?');
    await frame.getByRole('textbox').press('Enter');
    await frame.getByText('Do you ship to Karachi?').first().waitFor({ timeout: 15_000 });
    check('typing a message sends it', true);
    check('the reply echoes the question', await frame.getByText(/You said/).first().isVisible());
    await page.screenshot({ path: path.join(SHOTS, '5-widget-conversation.png') });

    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    check('Escape closes the panel', (await page.locator('#cf-widget-' + botId + '.cf-open').count()) === 0);

    console.log('\nHosted share link');
    const chatPage = await browser.newPage({ viewport: { width: 1000, height: 900 } });
    await chatPage.goto(`${BASE}/chat/${botId}`, { waitUntil: 'networkidle' });
    check('the hosted page renders the bot', await chatPage.getByText('Acme Helper').first().isVisible());
    check('the tagline is shown', await chatPage.getByText('Answers questions about widgets').first().isVisible());
    await chatPage.getByRole('textbox').fill('Hello there');
    await chatPage.getByRole('textbox').press('Enter');
    await chatPage.getByText(/You said/).first().waitFor({ timeout: 15_000 });
    check('the hosted page can hold a conversation', true);
    await chatPage.screenshot({ path: path.join(SHOTS, '6-hosted-page.png') });

    console.log('\nKnowledge base');
    const kb = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
    await logIn(kb);
    await kb.goto(`${BASE}/bots/${botId}`, { waitUntil: 'networkidle' });

    check('the knowledge panel is on the manage screen', await kb.getByRole('heading', { name: 'Knowledge base' }).isVisible());
    check('it starts empty', await kb.getByText('Nothing indexed yet').isVisible());
    await kb.screenshot({ path: path.join(SHOTS, '9-knowledge-empty.png') });

    // Add a text source through the real UI.
    await kb.getByRole('button', { name: 'Text' }).click();
    await kb.getByPlaceholder('Title, e.g. Refund policy').fill('Returns policy');
    await kb
      .getByPlaceholder(/Paste anything/)
      .fill(
        'Returns policy. Any widget can be returned within 30 days of delivery for a full refund. ' +
          'Shipping is not refunded. Email returns@acme.test to start a return.',
      );
    await kb.getByRole('button', { name: 'Add text' }).click();
    await kb.getByText(/chunk/).first().waitFor({ timeout: 20_000 });
    check('adding text indexes it', await kb.getByText('Returns policy').first().isVisible());

    // And a Q&A pair.
    await kb.getByRole('button', { name: 'Q&A' }).click();
    await kb.getByPlaceholder('Do you offer refunds?').fill('How much is a widget?');
    await kb.getByPlaceholder(/Yes, within 30 days/).fill('A single widget costs $9.');
    await kb.getByRole('button', { name: /Save 1 pair/ }).click();
    await kb.locator('li', { hasText: 'Q&A' }).first().waitFor({ timeout: 20_000 });
    check('adding a Q&A pair indexes it', (await kb.locator('li', { hasText: 'Q&A' }).count()) > 0);
    check('chunk counts are shown', (await kb.getByText(/\d+ chunks/).count()) > 0);
    await kb.screenshot({ path: path.join(SHOTS, '10-knowledge-filled.png') });

    // Ask a grounded question in the live test panel and look for citation chips.
    await kb.getByRole('textbox').last().fill('how do returns work?');
    await kb.getByRole('textbox').last().press('Enter');
    await kb.getByText('Sources').first().waitFor({ timeout: 20_000 });
    check('answers show source chips', await kb.getByText('Sources').first().isVisible());
    check(
      'the right source is cited',
      (await kb.getByRole('button', { name: /Returns policy/ }).count()) > 0 ||
        (await kb.getByText('Returns policy').count()) > 1,
    );
    await kb.screenshot({ path: path.join(SHOTS, '11-citations.png') });

    // Clicking a chip reveals the excerpt it came from.
    const chip = kb.locator('button[title="Show the excerpt this came from"]').first();
    if (await chip.count()) {
      await chip.click();
      check('clicking a chip shows the excerpt', await kb.getByText(/30 days of delivery|widget costs/).first().isVisible());
    } else {
      check('clicking a chip shows the excerpt', false, 'no chip rendered');
    }

    // Remove a source and confirm it disappears.
    await kb.locator('button[aria-label^="Remove"]').first().click();
    await kb.waitForTimeout(1200);
    check('a source can be removed', (await kb.locator('li button[aria-label^="Remove"]').count()) === 1);

    console.log('\nManage screen');
    const manage = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await logIn(manage);
    await manage.goto(`${BASE}/bots/${botId}`, { waitUntil: 'networkidle' });
    check('the manage screen loads the bot', await manage.getByRole('heading', { name: 'Acme Helper' }).isVisible());
    check('embed snippets are shown', (await manage.getByText('data-bot-id').count()) > 0);
    await manage.getByRole('button', { name: 'Share link' }).click();
    check('the share-link tab shows the URL', (await manage.getByText(`${BASE}/chat/${botId}`).count()) > 0);
    await manage.getByRole('button', { name: 'Inline iframe' }).click();
    check('the iframe tab shows an iframe snippet', (await manage.getByText('<iframe').count()) > 0);
    await manage.getByRole('button', { name: 'Floating widget' }).click();
    await manage.screenshot({ path: path.join(SHOTS, '7-manage.png') });

    console.log('\nDashboard');
    const dash = await browser.newPage({ viewport: { width: 1280, height: 950 } });
    await logIn(dash);
    await dash.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    check('the dashboard lists the bot', await dash.getByText('Acme Helper').first().isVisible());
    await dash.screenshot({ path: path.join(SHOTS, '8-dashboard.png') });
  } finally {
    if (browser) await browser.close();
    if (host) host.close();
    model.close();
    kill();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  console.log(`Screenshots in ${SHOTS}\n`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('\nVisual check crashed:', e);
  process.exit(1);
});
