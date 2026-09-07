'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

type Role = 'user' | 'admin';

/**
 * Two-step arming for an action that cannot be taken back from this screen.
 *
 * The first click arms, the second commits, and it disarms itself after a few
 * seconds so a stray arm is not left sitting there waiting for the next click
 * that lands near it.
 *
 * Deliberately not `window.confirm`: that blocks the whole tab, cannot be
 * styled to say which key or which account is about to go, and is invisible to
 * the Playwright checks unless every one of them installs a dialog handler.
 *
 * Note what is *not* armed — pausing a bot. That is the abuse lever, it wants
 * to be one click under pressure, and it is trivially reversible by clicking
 * again. Confirmation is for the things you cannot undo here.
 */
function useArmed(ms = 4000) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), ms);
    return () => clearTimeout(t);
  }, [armed, ms]);
  return { armed, arm: () => setArmed(true), disarm: () => setArmed(false) };
}

interface Overview {
  stats: {
    users: number;
    bots: number;
    messages: number;
    bookings: number;
    creditsOutstanding: number;
    admins: number;
  };
  users: {
    email: string;
    credits: number;
    createdAt: string;
    bots: number;
    role: Role;
    /** The ADMIN_EMAIL root admin: promotable to nothing, demotable to nothing. */
    isRoot: boolean;
    /** You. Changing your own role is refused server-side. */
    isSelf: boolean;
  }[];
  bots: {
    id: string;
    name: string;
    owner: string;
    provider: string;
    model: string;
    hasOwnKey: boolean;
    messages: number;
    isPublic: boolean;
    createdAt: string;
  }[];
}

export default function AdminPanel() {
  const [data, setData] = useState<Overview | null>(null);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch('/api/admin/overview')
      .then(async (r) => {
        if (r.status === 404) {
          setDenied(true);
          return null;
        }
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error ?? 'Could not load the overview.');
        return j;
      })
      .then((j) => j && setData(j))
      .catch((e) => setError(e.message));
  }, []);

  useEffect(load, [load]);

  if (denied) {
    return (
      <div className="card">
        <p className="text-sm text-slate-600">This page is for the platform admin.</p>
        <p className="mt-1 text-xs text-slate-600">
          Log in with the account whose email matches <code>ADMIN_EMAIL</code>.
        </p>
        <Link href="/account" className="btn-ghost mt-4">
          Go to account
        </Link>
      </div>
    );
  }
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <div className="h-40 animate-pulse rounded-control bg-slate-100" />;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Users" value={data.stats.users} />
        <Stat label="Admins" value={data.stats.admins} />
        <Stat label="Chatbots" value={data.stats.bots} />
        <Stat label="Messages" value={data.stats.messages} />
        <Stat label="Bookings" value={data.stats.bookings} />
        <Stat label="Credits outstanding" value={data.stats.creditsOutstanding} />
      </div>

      <KeyRequests />

      <PlatformKeys />

      <GrantCredits onDone={load} />

      <section className="card">
        <h2 className="mb-3 text-base font-semibold">Users</h2>
        {data.users.length === 0 && <p className="text-sm text-slate-600">Nobody has signed up yet.</p>}
        {data.users.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-600">
                  <th className="py-2 pr-4 font-medium">Email</th>
                  <th className="py-2 pr-4 font-medium">Role</th>
                  <th className="py-2 pr-4 font-medium">Credits</th>
                  <th className="py-2 pr-4 font-medium">Bots</th>
                  <th className="py-2 font-medium">Joined</th>
                </tr>
              </thead>
              <tbody>
                {data.users.map((u) => (
                  <UserRow key={u.email} user={u} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="hint mt-3">
          Admins see this panel and everything on it. The root admin comes from the <code>ADMIN_EMAIL</code>{' '}
          environment variable and cannot be demoted here; you cannot change your own role either, so there is always a
          way back in.
        </p>
      </section>

      <section className="card">
        <h2 className="mb-3 text-base font-semibold">Chatbots</h2>
        {data.bots.length === 0 && <p className="text-sm text-slate-600">No chatbots yet.</p>}
        {data.bots.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-600">
                  <th className="py-2 pr-4 font-medium">Bot</th>
                  <th className="py-2 pr-4 font-medium">Owner</th>
                  <th className="py-2 pr-4 font-medium">Model</th>
                  <th className="py-2 pr-4 font-medium">Key</th>
                  <th className="py-2 pr-4 font-medium">Msgs</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.bots.map((b) => (
                  <BotRow key={b.id} bot={b} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="hint mt-3">
          &ldquo;credits&rdquo; in the Key column means the bot has no key of its own, so its messages spend the
          owner&rsquo;s credits on platform keys. Pausing takes a bot offline everywhere without touching its setup.
        </p>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="card !p-4">
      <p className="text-xs uppercase tracking-wide text-slate-600">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value.toLocaleString()}</p>
    </div>
  );
}

/**
 * One account, with its role as the only editable thing.
 *
 * The button is disabled for exactly the two cases the API refuses — yourself
 * and the root admin — so a click never turns into a request that was always
 * going to fail. The reason shows up as the tooltip rather than an error after
 * the fact.
 */
function UserRow({ user }: { user: Overview['users'][number] }) {
  const [role, setRole] = useState<Role>(user.role);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locked = user.isSelf || user.isRoot;
  const next: Role = role === 'admin' ? 'user' : 'admin';
  const { armed, arm, disarm } = useArmed();

  async function toggle() {
    // Handing someone the admin panel — or taking it away — on a single stray
    // click is not a thing this table should allow.
    if (!armed) return arm();
    disarm();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email, role: next }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? 'Could not change the role.');
      setRole(json.role);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="border-b border-slate-100">
      <td className="py-2 pr-4">
        {user.email}
        {user.isSelf && <span className="ml-2 text-[10px] uppercase tracking-wide text-slate-600">you</span>}
        {user.isRoot && <span className="ml-2 text-[10px] uppercase tracking-wide text-slate-600">root</span>}
        {error && <span className="ml-2 text-[11px] text-red-700">{error}</span>}
      </td>
      <td className="py-2 pr-4">
        <button
          onClick={toggle}
          disabled={busy || locked}
          className={`rounded-control border px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide transition disabled:cursor-not-allowed disabled:opacity-60 ${
            role === 'admin'
              ? 'border-accent-400 bg-accent-100 text-accent-800 hover:bg-accent-200'
              : 'border-slate-300 text-slate-700 hover:border-slate-900 hover:text-slate-900'
          }`}
          title={
            user.isRoot
              ? 'The root admin is set by ADMIN_EMAIL and cannot be changed here.'
              : user.isSelf
                ? 'You cannot change your own role.'
                : armed
                  ? `Click again to confirm: make this account ${next === 'admin' ? 'an admin' : 'a regular user'}`
                  : `Make this account ${next === 'admin' ? 'an admin' : 'a regular user'}`
          }
        >
          {busy ? '…' : armed ? `make ${next}?` : role}
        </button>
      </td>
      <td className="py-2 pr-4 tabular-nums">{user.credits}</td>
      <td className="py-2 pr-4 tabular-nums">{user.bots}</td>
      <td className="py-2 text-xs text-slate-600">{new Date(user.createdAt).toLocaleDateString()}</td>
    </tr>
  );
}

function BotRow({ bot }: { bot: Overview['bots'][number] }) {
  const [isPublic, setIsPublic] = useState(bot.isPublic);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The failure path matters more here than anywhere else on this screen.
   *
   * This used to swallow the error and simply not move the toggle, which is the
   * worst possible behaviour for the one control an admin reaches for when a
   * bot is burning platform credits: it looks like nothing happened, and the
   * bot is still live. Now a failure says so and the state is left alone.
   */
  async function toggle() {
    setBusy(true);
    setError(null);
    const next = !isPublic;
    try {
      const res = await fetch(`/api/admin/bots/${bot.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPublic: next }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? `Could not ${next ? 'resume' : 'pause'} this bot.`);
      setIsPublic(next);
    } catch (e: any) {
      setError(e?.message ?? 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="border-b border-slate-100">
      <td className="max-w-[180px] truncate py-2 pr-4">
        <a href={`/chat/${bot.id}`} target="_blank" rel="noreferrer" className="hover:underline">
          {bot.name}
        </a>
      </td>
      <td className="max-w-[180px] truncate py-2 pr-4 text-xs text-slate-600">{bot.owner}</td>
      <td className="py-2 pr-4 text-xs">
        {bot.provider} · {bot.model}
      </td>
      <td className="py-2 pr-4 text-xs">{bot.hasOwnKey ? 'own' : 'credits'}</td>
      <td className="py-2 pr-4 tabular-nums">{bot.messages}</td>
      <td className="py-2">
        <button
          onClick={toggle}
          disabled={busy}
          className={`rounded-control border px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide transition disabled:opacity-50 ${
            isPublic
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
              : 'border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100'
          }`}
          title={isPublic ? 'Click to pause this bot everywhere' : 'Click to bring it back online'}
        >
          {busy ? '…' : isPublic ? 'live' : 'paused'}
        </button>
        {error && <p className="mt-1 max-w-[160px] text-[11px] leading-tight text-red-700">{error}</p>}
      </td>
    </tr>
  );
}

interface PlatformKeyRow {
  id: string;
  label: string;
  keyUrl: string;
  mask: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
  servesIncludedModels: boolean;
}

/**
 * The platform's own provider keys — what the credits tier and the anonymous
 * trial spend. These replaced the OPENAI_API_KEY environment variables, so
 * adding a provider or rotating a key no longer needs a redeploy.
 *
 * A stored key is never sent back to the browser, so the input always starts
 * empty and a saved row shows only its mask. "Replace" is therefore the same
 * operation as "set" — there is nothing to edit in place.
 */
function PlatformKeys() {
  const [rows, setRows] = useState<PlatformKeyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch('/api/admin/platform-keys')
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error ?? 'Could not load the platform keys.');
        return j;
      })
      .then((j) => setRows(j.providers))
      .catch((e) => setError(e.message));
  }, []);

  useEffect(load, [load]);

  return (
    <section className="card tone-ink">
      <h2 className="text-base font-semibold">Platform keys</h2>
      <p className="hint">
        The keys the platform pays with: bots saved without a key of their own run on these, spending their
        owner&rsquo;s credits. Stored encrypted, and never shown again after you save them.
      </p>
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      {!rows && !error && <div className="mt-4 h-24 animate-pulse rounded-control bg-slate-100" />}
      {rows && (
        <div className="mt-4 space-y-2.5">
          {rows.map((row) => (
            <PlatformKeyRowForm key={row.id} row={row} onDone={load} />
          ))}
        </div>
      )}
      <p className="hint mt-3">
        Removing a key does not touch bots that carry their own; it only stops the credits tier and the free trial for
        that provider.
      </p>
    </section>
  );
}

function PlatformKeyRowForm({ row, onDone }: { row: PlatformKeyRow; onDone: () => void }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { armed: armedRemove, arm: armRemove, disarm: disarmRemove } = useArmed();

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/platform-keys', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: row.id, apiKey: value }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? 'Could not save the key.');
      setValue('');
      onDone();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    // Removing this stops every bot running on platform credits for this
    // provider, and the anonymous trial with them. Worth a second click.
    if (!armedRemove) return armRemove();
    disarmRemove();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/platform-keys?provider=${encodeURIComponent(row.id)}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? 'Could not remove the key.');
      onDone();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-control border border-slate-300 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-sm font-medium">{row.label}</span>
        {row.mask ? (
          <span className="font-mono text-xs text-slate-600">{row.mask}</span>
        ) : (
          <span className="text-[10px] uppercase tracking-wide text-slate-600">not set</span>
        )}
        {!row.servesIncludedModels && (
          <span
            className="border border-amber-300 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800"
            title="No model from this provider is in PLATFORM_MODELS, so a key here will not be spent until that list is extended."
          >
            unused
          </span>
        )}
        {row.keyUrl && (
          <a
            href={row.keyUrl}
            target="_blank"
            rel="noreferrer"
            className="ml-auto text-[11px] text-slate-600 underline underline-offset-2"
          >
            get a key
          </a>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap gap-2">
        <input
          className="field !w-auto min-w-[240px] flex-1 !py-2 font-mono !text-xs"
          type="password"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={row.mask ? 'Paste a new key to replace it' : 'Paste a key'}
        />
        <button className="btn-primary shrink-0 !px-5 !py-2" onClick={save} disabled={busy || !value.trim()}>
          {busy ? '…' : row.mask ? 'Replace' : 'Save'}
        </button>
        {row.mask && (
          <button
            className="btn-danger shrink-0 !px-5 !py-2"
            onClick={remove}
            disabled={busy}
            title={
              armedRemove
                ? `Click again to remove the ${row.label} key`
                : `Remove the ${row.label} key. Every bot on platform credits for this provider stops`
            }
          >
            {armedRemove ? 'Really remove?' : 'Remove'}
          </button>
        )}
      </div>

      {row.updatedBy && row.updatedAt && (
        <p className="mt-2 text-[11px] text-slate-600">
          Set by {row.updatedBy} on {new Date(row.updatedAt).toLocaleDateString()}
        </p>
      )}
      {error && <p className="mt-2 text-[11px] text-red-700">{error}</p>}
    </div>
  );
}

function GrantCredits({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [amount, setAmount] = useState('100');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function grant() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch('/api/admin/credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, amount: Number(amount) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? 'Could not grant credits.');
      setNote(`${json.email} now has ${json.credits} credits.`);
      setEmail('');
      onDone();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card tone-sand">
      <h2 className="text-base font-semibold">Grant credits</h2>
      <p className="hint">After taking a payment, load the buyer&rsquo;s account. Negative amounts correct mistakes.</p>
      <div className="mt-3 flex max-w-md gap-2">
        <input
          className="field"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="buyer@example.com"
        />
        <input className="field !w-28" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <button className="btn-primary shrink-0" onClick={grant} disabled={busy || !email || !amount}>
          {busy ? '…' : 'Grant'}
        </button>
      </div>
      {error && (
        <p className="mt-3 rounded-control border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">{error}</p>
      )}
      {note && <p className="mt-3 text-xs text-emerald-700">{note}</p>}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Key requests                                                         */
/* ------------------------------------------------------------------ */

type RequestStatus = 'pending' | 'approved' | 'declined';

interface KeyRequestRow {
  id: string;
  email: string;
  provider: string;
  providerLabel: string;
  model: string;
  reason: string;
  status: RequestStatus;
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  adminNote: string;
}

/**
 * Who has asked for a key, and what you said.
 *
 * Deciding one is bookkeeping: approving records that you agreed, and it moves
 * neither a key nor a credit. The two sections below this one are where the
 * grant actually happens — set the provider's platform key, or top the account
 * up — and then you come back here and mark the request answered. A button in a
 * list that quietly handed out spend would be far too easy to press.
 */
function KeyRequests() {
  const [rows, setRows] = useState<KeyRequestRow[] | null>(null);
  const [pending, setPending] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch('/api/admin/key-requests')
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error ?? 'Could not load the key requests.');
        return j;
      })
      .then((j) => {
        setRows(j.requests);
        setPending(j.pending);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(load, [load]);

  const visible = rows?.filter((r) => showAll || r.status === 'pending') ?? [];

  return (
    <section className="card">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold">
          Key requests
          {pending > 0 && (
            <span className="ml-2 border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800">
              {pending} waiting
            </span>
          )}
        </h2>
        {rows && rows.length > 0 && (
          <button
            className="text-[11px] text-slate-600 underline underline-offset-2 hover:text-slate-900"
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? 'Show only what is waiting' : `Show all ${rows.length}`}
          </button>
        )}
      </div>
      <p className="hint">
        Creators with no key of their own asking you to cover them. Approving records your decision; it does not hand
        out anything. Set the key under &ldquo;Platform keys&rdquo; or top the account up under &ldquo;Grant
        credits&rdquo;, then mark the request here.
      </p>

      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      {!rows && !error && <div className="mt-4 h-24 animate-pulse rounded-control bg-slate-100" />}
      {rows && rows.length === 0 && <p className="mt-3 text-sm text-slate-600">Nobody has asked for a key yet.</p>}
      {rows && rows.length > 0 && visible.length === 0 && (
        <p className="mt-3 text-sm text-slate-600">Nothing waiting. Every request has been answered.</p>
      )}

      {visible.length > 0 && (
        <div className="mt-4 space-y-2.5">
          {visible.map((row) => (
            <KeyRequestCard key={row.id} row={row} onDone={load} />
          ))}
        </div>
      )}
    </section>
  );
}

function KeyRequestCard({ row, onDone }: { row: KeyRequestRow; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<RequestStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(status: 'approved' | 'declined') {
    setBusy(status);
    setError(null);
    try {
      const res = await fetch('/api/admin/key-requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, status, note }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? 'Could not record the decision.');
      onDone();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  const badge =
    row.status === 'pending'
      ? 'border-amber-300 bg-amber-50 text-amber-800'
      : row.status === 'approved'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
        : 'border-slate-300 bg-slate-50 text-slate-700';

  return (
    <div className="rounded-control border border-slate-300 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-sm font-medium">{row.email}</span>
        <span className="text-xs text-slate-600">
          {row.providerLabel}
          {row.model && ` · ${row.model}`}
        </span>
        <span className={`border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${badge}`}>
          {row.status}
        </span>
        <span className="ml-auto text-[11px] text-slate-600">{new Date(row.createdAt).toLocaleDateString()}</span>
      </div>

      {/* Whatever the requester typed, shown as typed. Rendered as text, never
          as markup — this is a stranger's string on an admin's screen. */}
      <p className="mt-2 whitespace-pre-wrap border-l-2 border-slate-200 pl-3 text-[13px] leading-relaxed text-slate-700">
        {row.reason}
      </p>

      {row.status === 'pending' ? (
        <div className="mt-2.5 flex flex-wrap gap-2">
          <input
            className="field !w-auto min-w-[220px] flex-1 !py-2 !text-xs"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Reply they will see in the builder (optional)"
          />
          <button
            className="btn-primary shrink-0 !px-5 !py-2"
            onClick={() => decide('approved')}
            disabled={busy !== null}
            title="Records that you agreed. Grant the credits or set the platform key separately."
          >
            {busy === 'approved' ? '…' : 'Approve'}
          </button>
          <button className="btn-ghost shrink-0 !px-5 !py-2" onClick={() => decide('declined')} disabled={busy !== null}>
            {busy === 'declined' ? '…' : 'Decline'}
          </button>
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-slate-600">
          {row.status === 'approved' ? 'Approved' : 'Declined'}
          {row.decidedBy && ` by ${row.decidedBy}`}
          {row.decidedAt && ` on ${new Date(row.decidedAt).toLocaleDateString()}`}
          {row.adminNote && `: “${row.adminNote}”`}
        </p>
      )}

      {error && <p className="mt-2 text-[11px] text-red-700">{error}</p>}
    </div>
  );
}
