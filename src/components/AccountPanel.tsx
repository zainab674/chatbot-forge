'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getOwnerId } from '@/lib/owner';
import { notifyAuthChanged } from '@/lib/auth-events';
import { PACKS, formatPrice, type Pack } from '@/lib/packs';

interface Me {
  email: string;
  credits: number;
  isAdmin: boolean;
  emailVerified?: boolean;
}

/**
 * Login / signup / balance in one panel. Signing in passes the browser's
 * anonymous owner id so bots created before the account existed move onto it.
 */
export default function AccountPanel() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [loaded, setLoaded] = useState(false);

  const [tab, setTab] = useState<'login' | 'signup'>('login');
  const [forgot, setForgot] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [buyingEnabled, setBuyingEnabled] = useState<boolean | null>(null);
  const [buying, setBuying] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((j) => setMe(j.user ?? null))
      .catch(() => {})
      .finally(() => setLoaded(true));

    // Whether card payment is switched on is a server-side question: the packs
    // render either way, but the buttons only work with Stripe configured.
    fetch('/api/billing/checkout')
      .then((r) => r.json())
      .then((j) => setBuyingEnabled(Boolean(j.enabled)))
      .catch(() => setBuyingEnabled(false));

    // Stripe sends the customer back here after checkout. The credits arrive by
    // webhook, which can land a moment later than the redirect does.
    const outcome = new URLSearchParams(window.location.search).get('purchase');
    if (outcome === 'success') {
      setNotice('Payment received — your credits will appear within a few seconds.');
      setTimeout(() => {
        fetch('/api/auth/me')
          .then((r) => r.json())
          .then((j) => setMe(j.user ?? null))
          .catch(() => {});
      }, 3_000);
    } else if (outcome === 'cancelled') {
      setNotice('Checkout cancelled — nothing was charged.');
    }
  }, []);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/${tab}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, ownerId: getOwnerId() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? 'Something went wrong.');
      setMe(json.user);
      setPassword('');
      notifyAuthChanged();
      // Sent here from a page that needed login? Go back to it.
      const next = new URLSearchParams(window.location.search).get('next');
      // A single leading slash is not enough: `//evil.example` is a
      // protocol-relative URL, so it passes that test and navigates straight
      // off the site — from a link that looks like a normal login prompt.
      if (next && next.startsWith('/') && !next.startsWith('//')) router.push(next);
      else router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function requestReset() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/auth/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? 'Something went wrong.');
      setNotice(json.message);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function resendVerification() {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch('/api/auth/resend-verification', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? 'Could not send it.');
      setNotice(json.alreadyVerified ? 'That address is already confirmed.' : 'Confirmation link sent.');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function buy(pack: Pack) {
    setBuying(pack.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packId: pack.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? 'Could not start checkout.');
      window.location.href = json.url;
    } catch (e: any) {
      setError(e.message);
      setBuying(null);
    }
  }

  async function deleteAccount() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: deletePassword }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? 'Could not delete the account.');
      setMe(null);
      notifyAuthChanged();
      router.push('/');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function logoutEverywhere() {
    if (!confirm('Sign out of this account on every device?')) return;
    await fetch('/api/auth/logout-all', { method: 'POST' }).catch(() => {});
    setMe(null);
    notifyAuthChanged();
    router.refresh();
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setMe(null);
    notifyAuthChanged();
    router.refresh();
  }

  if (!loaded) return <p className="text-sm text-slate-500">Loading…</p>;

  if (!me && forgot) {
    return (
      <div className="max-w-md space-y-5">
        <div className="card">
          <h2 className="text-sm font-semibold">Reset your password</h2>
          <p className="hint mt-1">
            Enter the address on the account. We will send a link that works once and expires in an hour.
          </p>

          <label className="label mt-4">Email</label>
          <input
            className="field"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && email) requestReset();
            }}
          />

          {error && (
            <p className="mt-3 rounded-control border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">{error}</p>
          )}
          {notice && (
            <p className="mt-3 rounded-control border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-800">
              {notice}
            </p>
          )}

          <div className="mt-4 flex gap-2.5">
            <button className="btn-primary" onClick={requestReset} disabled={busy || !email}>
              {busy ? 'Sending…' : 'Send reset link'}
            </button>
            <button
              className="btn-ghost"
              onClick={() => {
                setForgot(false);
                setError(null);
                setNotice(null);
              }}
            >
              Back to log in
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!me) {
    return (
      <div className="max-w-md space-y-5">
        <div className="card">
          <div className="mb-4 inline-flex rounded-control border border-slate-200 p-0.5">
            {(['login', 'signup'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setTab(t);
                  setError(null);
                }}
                className={`rounded-md px-4 py-1.5 text-sm transition ${
                  tab === t ? 'bg-slate-900 text-white' : 'text-slate-600'
                }`}
              >
                {t === 'login' ? 'Log in' : 'Sign up'}
              </button>
            ))}
          </div>

          <label className="label">Email</label>
          <input
            className="field"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
          />
          <label className="label mt-4">Password</label>
          <input
            className="field"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={tab === 'signup' ? 'at least 8 characters' : '••••••••'}
            autoComplete={tab === 'signup' ? 'new-password' : 'current-password'}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && email && password) submit();
            }}
          />

          {error && (
            <p className="mt-3 rounded-control border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">{error}</p>
          )}

          <button className="btn-primary mt-4" onClick={submit} disabled={busy || !email || !password}>
            {busy ? 'One moment…' : tab === 'login' ? 'Log in' : 'Create account'}
          </button>
          {tab === 'login' && (
            <button
              type="button"
              className="mt-3 text-xs text-slate-500 underline underline-offset-2 hover:text-slate-800"
              onClick={() => {
                setForgot(true);
                setError(null);
              }}
            >
              Forgot your password?
            </button>
          )}
          <p className="hint mt-3">
            The chatbots already in this browser move onto your account when you {tab === 'login' ? 'log in' : 'sign up'},
            so you can get to them from any device.
          </p>
        </div>

        <div className="card tone-sand">
          <h2 className="text-sm font-semibold">Why make an account?</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-relaxed text-slate-600">
            <li>Your bots stop living in one browser — log in anywhere and they are there.</li>
            <li>
              With credits, your bots can run on our API keys: leave the key field blank, pick an included model, done.
              One message costs one credit.
            </li>
            <li>Bring-your-own-key stays free either way.</li>
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md space-y-5">
      <div className="card">
        <p className="text-xs uppercase tracking-wide text-slate-400">Signed in as</p>
        <p className="mt-0.5 text-sm font-medium">{me.email}</p>

        {me.emailVerified === false && (
          <div className="mt-3 rounded-control border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-900">
            This address is not confirmed yet, so we cannot reach you about bookings or a top-up.{' '}
            <button className="underline underline-offset-2" onClick={resendVerification} disabled={busy}>
              Send the link again
            </button>
          </div>
        )}
        {notice && (
          <p className="mt-3 rounded-control border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-800">
            {notice}
          </p>
        )}
        {error && (
          <p className="mt-3 rounded-control border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">{error}</p>
        )}

        <div className="tone-ink mt-4 rounded-control px-4 py-4">
          <p className="kicker">Credits</p>
          <p className="mt-1 font-serif text-[34px] leading-none text-white">{me.credits}</p>
          <p className="mt-2.5 text-xs leading-relaxed text-slate-300">
            One credit = one message on our API keys, for bots saved without a key of their own (included models:
            GPT-4o mini, Gemini Flash, Claude Haiku, Llama on Groq). Bots using your own keys never spend credits.
          </p>
        </div>

        {buyingEnabled === false && (
          <div className="tone-sand mt-3 rounded-control px-4 py-3 text-xs leading-relaxed text-slate-800">
            <span className="font-medium text-slate-900">Need credits?</span> Card payment is not switched on for this
            deployment — ask an admin to load your account.
          </div>
        )}

        <div className="mt-5 flex flex-wrap gap-2.5">
          <Link href="/bots" className="btn-primary">
            My bots
          </Link>
          <button className="btn-ghost" onClick={logout}>
            Log out
          </button>
          <button className="btn-ghost" onClick={logoutEverywhere}>
            Log out everywhere
          </button>
        </div>
      </div>

      {buyingEnabled && (
        <div className="card">
          <h2 className="text-sm font-semibold">Add credits</h2>
          <p className="hint mt-1">
            Paid by card through Stripe. Credits never expire, and a bot running on your own API key never spends one.
          </p>

          <div className="mt-4 space-y-2.5">
            {PACKS.map((pack) => (
              <div
                key={pack.id}
                className="flex items-center justify-between gap-4 rounded-control border border-slate-200 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {pack.label} · {pack.credits.toLocaleString('en')} credits
                  </p>
                  <p className="hint mt-0.5">{pack.note}</p>
                </div>
                <button
                  className="btn-ghost shrink-0"
                  onClick={() => buy(pack)}
                  disabled={Boolean(buying) || me.emailVerified === false}
                >
                  {buying === pack.id ? 'Opening…' : formatPrice(pack.amount)}
                </button>
              </div>
            ))}
          </div>

          {me.emailVerified === false && (
            <p className="hint mt-3 text-amber-700">Confirm your email address before buying — the receipt goes there.</p>
          )}
        </div>
      )}

      <div className="card">
        <h2 className="text-sm font-semibold">Your data</h2>
        <p className="hint mt-1">
          Take a copy of everything stored about this account, or end it. See{' '}
          <Link href="/privacy" className="underline underline-offset-2">
            privacy
          </Link>{' '}
          for what is held and for how long.
        </p>

        <div className="mt-4 flex flex-wrap gap-2.5">
          <a className="btn-ghost" href="/api/auth/account" download>
            Download my data
          </a>
          {!confirmDelete && (
            <button className="btn-ghost" onClick={() => setConfirmDelete(true)}>
              Delete my account
            </button>
          )}
        </div>

        {confirmDelete && (
          <div className="mt-4 rounded-control border border-red-200 bg-red-50 px-4 py-3.5">
            <p className="text-xs leading-relaxed text-red-800">
              This erases your chatbots, their knowledge bases, stored conversations and the bookings your visitors
              left. Unspent credits are lost. It cannot be undone. Enter your password to confirm.
            </p>
            <input
              className="field mt-3"
              type="password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              placeholder="Your password"
              autoComplete="current-password"
            />
            <div className="mt-3 flex gap-2.5">
              <button
                className="btn-ghost border-red-300 text-red-700"
                onClick={deleteAccount}
                disabled={busy || !deletePassword}
              >
                {busy ? 'Deleting…' : 'Delete permanently'}
              </button>
              <button
                className="btn-ghost"
                onClick={() => {
                  setConfirmDelete(false);
                  setDeletePassword('');
                  setError(null);
                }}
              >
                Keep my account
              </button>
            </div>
          </div>
        )}
      </div>

      {me.isAdmin && (
        <div className="card tone-ink">
          <h2 className="text-sm font-semibold">You are the platform admin</h2>
          <p className="hint">Users, bots, credit grants and abuse controls live on the admin panel.</p>
          <Link href="/admin" className="btn-primary mt-3">
            Open admin panel
          </Link>
        </div>
      )}
    </div>
  );
}
