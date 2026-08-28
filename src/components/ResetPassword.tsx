'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { notifyAuthChanged } from '@/lib/auth-events';

/**
 * The other half of the reset flow: the link from the email lands here with a
 * token in the query, and this exchanges it for a new password.
 *
 * Setting the password signs this browser in, so the trip does not end at
 * "now go and log in" — the person came here because they could not.
 */
export default function ResetPassword() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const mismatch = confirm.length > 0 && password !== confirm;
  const tooShort = password.length > 0 && password.length < 8;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? 'Something went wrong.');
      setDone(true);
      notifyAuthChanged();
      setTimeout(() => router.push('/bots'), 1200);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="card max-w-md">
        <p className="text-sm">That link is missing its token — it may have been cut in half by an email client.</p>
        <Link href="/account" className="btn-primary mt-4">
          Ask for a new link
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="card max-w-md">
        <h2 className="text-sm font-semibold">Password changed</h2>
        <p className="hint mt-1">
          You are signed in on this device, and every other session on the account has been signed out. Taking you to
          your bots…
        </p>
      </div>
    );
  }

  return (
    <div className="card max-w-md">
      <label className="label">New password</label>
      <input
        className="field"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="at least 8 characters"
        autoComplete="new-password"
      />
      <label className="label mt-4">Repeat it</label>
      <input
        className="field"
        type="password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        autoComplete="new-password"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && password && password === confirm) submit();
        }}
      />

      {tooShort && <p className="hint mt-2 text-amber-700">A little longer — eight characters minimum.</p>}
      {mismatch && <p className="hint mt-2 text-amber-700">Those two do not match.</p>}
      {error && (
        <p className="mt-3 rounded-control border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">{error}</p>
      )}

      <button
        className="btn-primary mt-4"
        onClick={submit}
        disabled={busy || password.length < 8 || password !== confirm}
      >
        {busy ? 'Saving…' : 'Set new password'}
      </button>
      <p className="hint mt-3">
        Every other device signed into this account will be signed out, which is the point of resetting.
      </p>
    </div>
  );
}
