'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

/** Where the confirmation link lands. Spends the token, then says what happened. */
export default function VerifyEmail() {
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = useState<'working' | 'done' | 'failed'>('working');
  const [message, setMessage] = useState('');
  // Strict mode runs effects twice in development, and the token is single-use.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    if (!token) {
      setState('failed');
      setMessage('That link is missing its token.');
      return;
    }

    fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json?.error ?? 'That link could not be used.');
        setState('done');
        setMessage(json.email ? `${json.email} is confirmed.` : 'Your email is confirmed.');
      })
      .catch((e) => {
        setState('failed');
        setMessage(e.message);
      });
  }, [token]);

  return (
    <div className="card max-w-md">
      {state === 'working' && <p className="text-sm text-slate-500">Confirming…</p>}
      {state === 'done' && (
        <>
          <h2 className="text-sm font-semibold">All set</h2>
          <p className="hint mt-1">{message}</p>
          <Link href="/bots" className="btn-primary mt-4">
            My bots
          </Link>
        </>
      )}
      {state === 'failed' && (
        <>
          <h2 className="text-sm font-semibold">That did not work</h2>
          <p className="hint mt-1">{message}</p>
          <Link href="/account" className="btn-primary mt-4">
            Send a new link
          </Link>
        </>
      )}
    </div>
  );
}
