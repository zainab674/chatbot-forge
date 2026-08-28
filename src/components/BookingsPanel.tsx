'use client';

import { useCallback, useEffect, useState } from 'react';
import { ownerHeaders } from '@/lib/owner';
import type { BookingDoc, BookingStatus } from '@/lib/types';

const STATUS_STYLES: Record<BookingStatus, string> = {
  new: 'bg-amber-50 text-amber-700 border-amber-200',
  confirmed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  cancelled: 'bg-slate-50 text-slate-500 border-slate-200',
};

/** The owner's inbox of appointment requests, shown on the manage screen. */
export default function BookingsPanel({ botId }: { botId: string }) {
  const [list, setList] = useState<BookingDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/bots/${botId}/bookings`, { headers: ownerHeaders() })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error ?? 'Could not load bookings.');
        setList(j.bookings ?? []);
      })
      .catch((e) => setError(e.message));
  }, [botId]);

  useEffect(load, [load]);

  async function setStatus(bookingId: string, status: BookingStatus) {
    setList((l) => (l ? l.map((b) => (b.id === bookingId ? { ...b, status } : b)) : l));
    await fetch(`/api/bots/${botId}/bookings/${bookingId}`, {
      method: 'PATCH',
      headers: ownerHeaders(),
      body: JSON.stringify({ status }),
    }).catch(() => {});
  }

  async function remove(bookingId: string) {
    setList((l) => (l ? l.filter((b) => b.id !== bookingId) : l));
    await fetch(`/api/bots/${botId}/bookings/${bookingId}`, {
      method: 'DELETE',
      headers: ownerHeaders(),
    }).catch(() => {});
  }

  const fresh = list?.filter((b) => b.status === 'new').length ?? 0;

  return (
    <section className="card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold">
          Bookings{' '}
          {fresh > 0 && (
            <span className="ml-1 border border-amber-300 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800">
              {fresh} new
            </span>
          )}
        </h2>
        <button className="btn-ghost !py-1.5 !text-xs" onClick={load}>
          Refresh
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!error && list === null && <p className="text-sm text-slate-500">Loading…</p>}
      {!error && list?.length === 0 && (
        <p className="text-sm text-slate-500">
          No requests yet. When a visitor uses the 📅 Book button in the chat, it shows up here.
        </p>
      )}

      <div className="space-y-3">
        {list?.map((b) => (
          <div key={b.id} className="rounded-control border border-slate-200 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="font-medium">{b.name}</span>{' '}
                <span className="text-xs text-slate-500">· {b.contact}</span>
              </div>
              <span className={`border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${STATUS_STYLES[b.status] ?? STATUS_STYLES.new}`}>
                {b.status}
              </span>
            </div>
            {b.when && (
              <p className="mt-1 text-xs text-slate-600">
                <span className="text-slate-400">Wants:</span> {b.when}
              </p>
            )}
            {b.note && <p className="mt-1 text-xs leading-relaxed text-slate-600">{b.note}</p>}
            <div className="mt-2 flex items-center gap-2 text-xs">
              <span className="text-slate-400">{new Date(b.createdAt).toLocaleString()}</span>
              <span className="flex-1" />
              {b.status !== 'confirmed' && (
                <button className="text-emerald-600 hover:underline" onClick={() => setStatus(b.id, 'confirmed')}>
                  Confirm
                </button>
              )}
              {b.status !== 'cancelled' && (
                <button className="text-slate-500 hover:underline" onClick={() => setStatus(b.id, 'cancelled')}>
                  Cancel
                </button>
              )}
              <button className="text-red-500 hover:underline" onClick={() => remove(b.id)}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      <p className="hint mt-3">
        Confirming here only tracks it for you — the visitor is not notified automatically, so reply to them at the
        contact they left.
      </p>
    </section>
  );
}
