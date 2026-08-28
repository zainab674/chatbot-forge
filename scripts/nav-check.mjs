/**
 * Navigation check — proves you can get anywhere from anywhere, and that the
 * app tells you where you are while you do it.
 *
 *   node scripts/nav-check.mjs        (after: CF_FAKE_DB=1 next build)
 *
 * Boots the built app against the in-process store, then walks a real browser
 * through every routed surface asserting the header, the active state and the
 * back crumbs. Screenshots land in ./screenshots/nav.
 */
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs/promises';

const APP_PORT = 3314;
const BASE = `http://127.0.0.1:${APP_PORT}`;
const ADMIN = 'nav-admin@example.test';
const SHOTS = path.join(process.cwd(), 'screenshots', 'nav');

let pass = 0;
let fail = 0;
const check = (name, ok, extra = '') => {
  if (ok) {
    pass++;
    console.log(`  \x1b[32mPASS\x1b[0m ${name}`);
  } else {
    fail++;
    console.log(`  \x1b[31mFAIL ${name}\x1b[0m ${extra}`);
  }
};

const portFree = (port) =>
  new Promise((resolve) => {
    const s = net
      .createServer()
      .once('error', () => resolve(false))
      .once('listening', () => s.close(() => resolve(true)))
      .listen(port);
  });

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

/** The header link currently marked as the page you are on. */
const activeNav = (page) => page.locator('header nav[aria-label="Main"] a[aria-current="page"]');

async function main() {
  if (!(await portFree(APP_PORT))) {
    console.error(`Port ${APP_PORT} is in use.`);
    process.exit(1);
  }
  await fs.mkdir(SHOTS, { recursive: true });

  const win = process.platform === 'win32';
  const nextBin = path.join(process.cwd(), 'node_modules', '.bin', win ? 'next.cmd' : 'next');
  const app = spawn(nextBin, ['start', '-p', String(APP_PORT)], {
    detached: !win,
    shell: win,
    env: {
      ...process.env,
      CF_FAKE_DB: '1',
      MONGODB_DB: 'nav',
      ENCRYPTION_SECRET: 'nav-check-secret-not-for-production',
      NEXT_PUBLIC_APP_URL: BASE,
      ADMIN_EMAIL: ADMIN,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  app.stdout.on('data', () => {});
  app.stderr.on('data', (d) => process.env.VERBOSE && process.stderr.write(d));

  const kill = () => {
    if (win) {
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

  let browser;
  try {
    if (!(await waitFor(`${BASE}/`))) throw new Error('App did not start.');

    const signup = await fetch(`${BASE}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ADMIN, password: 'nav-password-1', ownerId: 'nav-owner-0123456789' }),
    });
    const session = (signup.headers.get('set-cookie') ?? '').match(/cf_session=([^;]+)/)?.[1] ?? '';
    check('signed up the admin test account', signup.ok && Boolean(session));

    const created = await (
      await fetch(`${BASE}/api/bots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: `cf_session=${session}` },
        body: JSON.stringify({
          name: 'Wick and Wax',
          tagline: 'Candles, shipping and returns',
          info: 'Shipping is free over $50.',
          style: 'friendly',
          provider: 'openai',
          model: 'gpt-4o-mini',
          accent: '#9C7238',
          avatarEmoji: 'C',
        }),
      })
    ).json();
    const botId = created.bot?.id;
    check('created a chatbot to navigate to', Boolean(botId), JSON.stringify(created));
    if (!botId) throw new Error('setup failed');

    browser = await chromium.launch({
      executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });

    /* ---------------- logged out ---------------- */
    console.log('\nLogged out');
    const anon = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await anon.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    check('the header offers Log in when signed out', await anon.locator('header a.navlink[href="/account"]').isVisible());
    check('the header does not link the account twice', (await anon.locator('header a[href="/account"]').count()) === 1);
    check('no admin link is shown to a visitor', (await anon.locator('header a[href="/admin"]').count()) === 0);
    check('home is marked as the current page', (await activeNav(anon).textContent())?.trim() === 'Home');
    await anon.screenshot({ path: path.join(SHOTS, '1-home-logged-out.png') });

    await anon.locator('header a[href="/create"]').click();
    await anon.waitForURL('**/create');
    check('the header New bot button routes to the builder', anon.url().endsWith('/create'));
    check('the builder offers a crumb back to My bots', await anon.locator('a.crumb[href="/bots"]').isVisible());
    await anon.screenshot({ path: path.join(SHOTS, '2-create-logged-out.png') });
    await anon.close();

    /* ---------------- mobile ---------------- */
    console.log('\nMobile');
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await phone.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    check('the desktop nav is hidden on a phone', !(await phone.locator('header nav[aria-label="Main"]').isVisible()));
    const toggle = phone.getByRole('button', { name: 'Open menu' });
    check('a menu button is offered instead', await toggle.isVisible());
    await toggle.click();
    check('the sheet opens', await phone.locator('#site-nav-sheet').isVisible());
    const sheet = phone.locator('#site-nav-sheet');
    check('the sheet carries the main links', await sheet.locator('a[href="/"]').isVisible() && await sheet.locator('a[href="/bots"]').isVisible());
    check('the sheet offers a way to sign in', await sheet.locator('a[href="/account"]').isVisible());
    check('the sheet does not link the same page twice', (await sheet.locator('a[href="/account"]').count()) === 1);
    await phone.screenshot({ path: path.join(SHOTS, '3-mobile-menu.png') });
    await phone.locator('#site-nav-sheet a[href="/bots"]').click();
    await phone.waitForURL('**/bots');
    check('the sheet closes after navigating', (await phone.locator('#site-nav-sheet').count()) === 0);
    // The list loads client-side; an empty dashboard must still offer a move.
    await phone.locator('main .card').waitFor({ state: 'visible', timeout: 10_000 });
    check('an empty dashboard is not a dead end', (await phone.locator('main .card a').count()) >= 1);
    await phone.screenshot({ path: path.join(SHOTS, '4-mobile-bots.png') });
    await phone.close();

    /* ---------------- signed in ---------------- */
    console.log('\nSigned in as admin');
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.context().addCookies([{ name: 'cf_session', value: session, domain: '127.0.0.1', path: '/' }]);

    await page.goto(`${BASE}/bots`, { waitUntil: 'networkidle' });
    check('the account chip shows who is signed in', await page.locator('header .navchip').isVisible());
    check('the chip carries the email', ((await page.locator('.navchip-mail').textContent()) ?? '').includes(ADMIN));
    check('the admin link appears for an admin', await page.locator('header a[href="/admin"]').isVisible());
    check('My bots is marked as the current page', (await activeNav(page).textContent())?.trim() === 'My bots');
    check('the dashboard has a crumb home', await page.locator('a.crumb[href="/"]').isVisible());
    check('the dashboard has exactly one page title', (await page.locator('h1.page-title').count()) === 1);
    await page.screenshot({ path: path.join(SHOTS, '5-bots.png') });

    await page.locator(`a[href="/bots/${botId}"]`).first().click();
    await page.waitForURL(`**/bots/${botId}`);
    check('a bot card opens the bot', page.url().endsWith(botId));
    await page.locator('h1.page-title').waitFor({ state: 'visible', timeout: 10_000 });
    check('the bot screen has a crumb back to My bots', await page.locator('a.crumb[href="/bots"]').isVisible());
    check('My bots stays lit on a nested route', (await activeNav(page).textContent())?.trim() === 'My bots');
    check('the bot screen leads its actions with Edit', await page.locator('.page-actions a').first().isVisible());
    await page.screenshot({ path: path.join(SHOTS, '6-bot.png') });

    await page.locator(`.page-actions a[href="/bots/${botId}/edit"]`).click();
    await page.waitForURL('**/edit');
    check('Edit routes to the editor', page.url().endsWith('/edit'));
    await page.locator('h1.page-title').waitFor({ state: 'visible', timeout: 10_000 });
    check('the editor crumbs back to the bot', await page.locator(`a.crumb[href="/bots/${botId}"]`).isVisible());
    await page.screenshot({ path: path.join(SHOTS, '7-edit.png') });

    await page.locator('a.crumb').first().click();
    await page.waitForURL(`**/bots/${botId}`);
    check('the crumb returns to the bot', page.url().endsWith(botId));

    await page.locator('header a[href="/admin"]').click();
    await page.waitForURL('**/admin');
    check('admin is reachable from the header', page.url().endsWith('/admin'));
    check('admin is marked as the current page', (await activeNav(page).textContent())?.trim() === 'Admin');
    check('admin crumbs back to the account', await page.locator('a.crumb[href="/account"]').isVisible());
    await page.screenshot({ path: path.join(SHOTS, '8-admin.png') });

    await page.locator('header .navchip').click();
    await page.waitForURL('**/account');
    check('the chip routes to the account', page.url().endsWith('/account'));
    await page.screenshot({ path: path.join(SHOTS, '9-account.png') });

    /* Logging out happens in the panel; the header is a different component. */
    // `exact` matters now that "Log out everywhere" sits next to it.
    await page.getByRole('button', { name: 'Log out', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('header .navchip'), null, { timeout: 5000 });
    check('logging out updates the header without a reload', (await page.locator('header .navchip').count()) === 0);
    check('the admin link disappears on logout', (await page.locator('header a[href="/admin"]').count()) === 0);

    /* ---------------- dead ends ---------------- */
    console.log('\nDead ends');
    await page.goto(`${BASE}/no-such-page`, { waitUntil: 'networkidle' });
    check('the 404 page keeps the header', await page.locator('header a[href="/create"]').isVisible());
    check('the 404 page offers a way back in', (await page.locator('main a.btn-primary').count()) >= 1);
    await page.screenshot({ path: path.join(SHOTS, '10-not-found.png') });
  } finally {
    if (browser) await browser.close().catch(() => {});
    kill();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  console.log(`Screenshots: ${SHOTS}`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
