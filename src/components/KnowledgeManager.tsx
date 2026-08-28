'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ownerHeaders, getOwnerId } from '@/lib/owner';
import { SUPPORTED_EXTENSIONS, MAX_UPLOAD_MB } from '@/lib/knowledge/constants';
import type { SourceDoc, SourceType } from '@/lib/types';

type Tab = 'files' | 'url' | 'sitemap' | 'text' | 'qa';

const TABS: [Tab, string][] = [
  ['files', 'Files'],
  ['url', 'Website'],
  ['sitemap', 'Sitemap'],
  ['text', 'Text'],
  ['qa', 'Q&A'],
];

const ICONS: Record<SourceType, string> = {
  file: '📄',
  url: '🌐',
  sitemap: '🗺️',
  text: '📝',
  qa: '💬',
};

export default function KnowledgeManager({ botId, hasEmbeddings }: { botId: string; hasEmbeddings: boolean }) {
  const [sources, setSources] = useState<SourceDoc[] | null>(null);
  const [tab, setTab] = useState<Tab>('files');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/bots/${botId}/sources`, { headers: ownerHeaders() });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? 'Could not load sources.');
      setSources(json.sources);
    } catch (e: any) {
      setError(e.message);
      setSources([]);
    }
  }, [botId]);

  useEffect(() => {
    load();
  }, [load]);

  const afterAdd = (json: any, res: Response) => {
    if (!res.ok && !json?.source) throw new Error(json?.error ?? 'Could not add that source.');
    if (json?.source?.status === 'error') throw new Error(json.source.error || 'Ingestion failed.');
    setNotice(
      json?.warning ??
        `Added ${json.source.chunkCount} chunk${json.source.chunkCount === 1 ? '' : 's'} from ${json.source.title}.`,
    );
    load();
  };

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    setNotice(null);
    for (const file of Array.from(files)) {
      setBusy(`Reading ${file.name}…`);
      try {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch(`/api/bots/${botId}/sources`, {
          method: 'POST',
          headers: { 'x-owner-id': getOwnerId() }, // no Content-Type: the browser sets the multipart boundary
          body: form,
        });
        afterAdd(await res.json(), res);
      } catch (e: any) {
        setError(`${file.name}: ${e.message}`);
      }
    }
    setBusy(null);
  }

  async function addJson(body: Record<string, unknown>, label: string) {
    setError(null);
    setNotice(null);
    setBusy(label);
    try {
      const res = await fetch(`/api/bots/${botId}/sources`, {
        method: 'POST',
        headers: ownerHeaders(),
        body: JSON.stringify(body),
      });
      afterAdd(await res.json(), res);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    setError(null);
    setBusy('Removing…');
    try {
      const res = await fetch(`/api/bots/${botId}/sources/${id}`, {
        method: 'DELETE',
        headers: ownerHeaders(),
      });
      if (!res.ok) throw new Error((await res.json())?.error ?? 'Could not delete.');
      setSources((prev) => prev?.filter((s) => s.id !== id) ?? null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  const totalChunks = sources?.reduce((n, s) => n + (s.chunkCount ?? 0), 0) ?? 0;

  return (
    <section className="card">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold">Knowledge base</h2>
        {sources?.length ? (
          <span className="text-xs text-slate-500">
            {sources.length} source{sources.length === 1 ? '' : 's'} · {totalChunks} chunks
          </span>
        ) : null}
      </div>
      <p className="mb-4 text-xs leading-relaxed text-slate-500">
        Upload documents or point at a website. The text is split up, indexed, and the most relevant pieces are put in
        front of the model on every question, with a citation back to where the answer came from.
        {!hasEmbeddings && (
          <>
            {' '}
            <span className="text-amber-600">
              This bot has no embedding provider, so retrieval is keyword-only. Set one in Edit for semantic matching.
            </span>
          </>
        )}
      </p>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`rounded-control border px-3.5 py-2 text-[10.5px] font-medium uppercase tracking-wide transition ${
              tab === key
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-300 text-slate-600 hover:border-slate-900 hover:text-slate-900'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'files' && <FileDrop onFiles={addFiles} disabled={Boolean(busy)} />}
      {tab === 'url' && <UrlForm onSubmit={addJson} disabled={Boolean(busy)} />}
      {tab === 'sitemap' && <SitemapForm onSubmit={addJson} disabled={Boolean(busy)} />}
      {tab === 'text' && <TextForm onSubmit={addJson} disabled={Boolean(busy)} />}
      {tab === 'qa' && <QaForm onSubmit={addJson} disabled={Boolean(busy)} />}

      {busy && (
        <p className="mt-3 flex items-center gap-2 text-xs text-slate-500">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
          {busy}
        </p>
      )}
      {error && <p className="mt-3 rounded-control bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      {notice && !error && <p className="mt-3 rounded-control bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{notice}</p>}

      <div className="mt-5">
        {sources === null ? (
          <div className="h-16 animate-pulse rounded-control bg-slate-100" />
        ) : sources.length === 0 ? (
          <p className="rounded-control border border-dashed border-slate-200 px-4 py-6 text-center text-xs text-slate-400">
            Nothing indexed yet. The bot answers from its instructions alone until you add something here.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {sources.map((s) => (
              <li key={s.id} className="flex items-start gap-3 py-2.5">
                <span className="mt-0.5 text-base" aria-hidden>
                  {ICONS[s.type] ?? '📄'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{s.title}</span>
                    {s.status === 'error' && (
                      <span className="shrink-0 border border-red-300 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-red-700">
                        failed
                      </span>
                    )}
                    {s.status === 'processing' && (
                      <span className="shrink-0 border border-amber-300 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800">
                        indexing
                      </span>
                    )}
                  </div>
                  {s.url && (
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate text-[11px] text-slate-400 underline underline-offset-2"
                    >
                      {s.url}
                    </a>
                  )}
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {s.status === 'error'
                      ? s.error
                      : `${s.chunkCount} chunks · ${formatChars(s.chars)}${
                          s.pageCount > 1 ? ` · ${s.pageCount} pages` : ''
                        }`}
                  </p>
                  {s.status !== 'error' && s.warning && (
                    <p className="mt-0.5 text-[11px] leading-relaxed text-amber-600">{s.warning}</p>
                  )}
                </div>
                <button
                  onClick={() => remove(s.id)}
                  className="shrink-0 rounded-control px-2 py-1 text-xs text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                  aria-label={`Remove ${s.title}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function formatChars(n: number): string {
  if (!n) return '0 chars';
  if (n < 1000) return `${n} chars`;
  if (n < 1_000_000) return `${Math.round(n / 100) / 10}k chars`;
  return `${Math.round(n / 100_000) / 10}M chars`;
}

/* ---------------- input forms ---------------- */

function FileDrop({ onFiles, disabled }: { onFiles: (f: FileList | null) => void; disabled: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!disabled) onFiles(e.dataTransfer.files);
      }}
      onClick={() => !disabled && inputRef.current?.click()}
      className={`cursor-pointer rounded-control border-2 border-dashed px-4 py-8 text-center transition ${
        over ? 'border-slate-400 bg-slate-50' : 'border-slate-200 hover:bg-slate-50'
      } ${disabled ? 'pointer-events-none opacity-50' : ''}`}
    >
      <p className="text-sm font-medium">Drop files here, or click to choose</p>
      <p className="mt-1 text-xs text-slate-500">
        {SUPPORTED_EXTENSIONS.join(' · ')}, up to {MAX_UPLOAD_MB}MB each
      </p>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={SUPPORTED_EXTENSIONS.join(',')}
        className="sr-only"
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}

function UrlForm({
  onSubmit,
  disabled,
}: {
  onSubmit: (body: Record<string, unknown>, label: string) => void;
  disabled: boolean;
}) {
  const [url, setUrl] = useState('');
  const [follow, setFollow] = useState(false);
  const [maxPages, setMaxPages] = useState(10);
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          className="field"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://acme.com/pricing"
          disabled={disabled}
        />
        <button
          className="btn-primary shrink-0"
          disabled={disabled || !url.trim()}
          onClick={() => {
            onSubmit({ type: 'url', url: url.trim(), followLinks: follow, maxPages }, 'Fetching the page…');
            setUrl('');
          }}
        >
          Add
        </button>
      </div>
      <label className="flex items-center gap-2 text-xs text-slate-600">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-slate-300"
          checked={follow}
          onChange={(e) => setFollow(e.target.checked)}
        />
        Also index pages linked from it
        {follow && (
          <>
            , up to
            <input
              type="number"
              min={2}
              max={30}
              value={maxPages}
              onChange={(e) => setMaxPages(Number(e.target.value))}
              className="w-16 rounded-control border border-slate-200 px-2 py-1"
            />
            pages
          </>
        )}
      </label>
    </div>
  );
}

function SitemapForm({
  onSubmit,
  disabled,
}: {
  onSubmit: (body: Record<string, unknown>, label: string) => void;
  disabled: boolean;
}) {
  const [url, setUrl] = useState('');
  const [maxPages, setMaxPages] = useState(25);
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          className="field"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://acme.com/sitemap.xml"
          disabled={disabled}
        />
        <button
          className="btn-primary shrink-0"
          disabled={disabled || !url.trim()}
          onClick={() => {
            onSubmit({ type: 'sitemap', url: url.trim(), maxPages }, 'Crawling the sitemap…');
            setUrl('');
          }}
        >
          Add
        </button>
      </div>
      <label className="flex items-center gap-2 text-xs text-slate-600">
        Index up to
        <input
          type="number"
          min={1}
          max={30}
          value={maxPages}
          onChange={(e) => setMaxPages(Number(e.target.value))}
          className="w-16 rounded-control border border-slate-200 px-2 py-1"
        />
        pages. This can take a minute.
      </label>
    </div>
  );
}

function TextForm({
  onSubmit,
  disabled,
}: {
  onSubmit: (body: Record<string, unknown>, label: string) => void;
  disabled: boolean;
}) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  return (
    <div className="space-y-2">
      <input
        className="field"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title, e.g. Refund policy"
        disabled={disabled}
      />
      <textarea
        className="field min-h-[140px]"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste anything: policies, transcripts, product notes, a knowledge article."
        disabled={disabled}
      />
      <button
        className="btn-primary"
        disabled={disabled || !text.trim()}
        onClick={() => {
          onSubmit({ type: 'text', title: title.trim() || 'Pasted text', text }, 'Indexing…');
          setTitle('');
          setText('');
        }}
      >
        Add text
      </button>
    </div>
  );
}

function QaForm({
  onSubmit,
  disabled,
}: {
  onSubmit: (body: Record<string, unknown>, label: string) => void;
  disabled: boolean;
}) {
  const [pairs, setPairs] = useState<{ q: string; a: string }[]>([{ q: '', a: '' }]);
  const valid = pairs.filter((p) => p.q.trim() && p.a.trim());
  const update = (i: number, key: 'q' | 'a', v: string) =>
    setPairs((prev) => prev.map((p, idx) => (idx === i ? { ...p, [key]: v } : p)));

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Each pair is indexed on its own, so the question itself becomes the match key. Best for FAQs.
      </p>
      {pairs.map((p, i) => (
        <div key={i} className="space-y-1.5 rounded-control border border-slate-200 p-3">
          <input
            className="field"
            value={p.q}
            onChange={(e) => update(i, 'q', e.target.value)}
            placeholder="Do you offer refunds?"
            disabled={disabled}
          />
          <textarea
            className="field min-h-[70px]"
            value={p.a}
            onChange={(e) => update(i, 'a', e.target.value)}
            placeholder="Yes, within 30 days of purchase, no questions asked."
            disabled={disabled}
          />
          {pairs.length > 1 && (
            <button
              className="text-xs text-slate-400 underline underline-offset-2"
              onClick={() => setPairs((prev) => prev.filter((_, idx) => idx !== i))}
            >
              Remove this pair
            </button>
          )}
        </div>
      ))}
      <div className="flex gap-2">
        <button className="btn-ghost" onClick={() => setPairs((p) => [...p, { q: '', a: '' }])} disabled={disabled}>
          Add another
        </button>
        <button
          className="btn-primary"
          disabled={disabled || !valid.length}
          onClick={() => {
            onSubmit({ type: 'qa', title: 'Q&A', pairs: valid }, 'Indexing…');
            setPairs([{ q: '', a: '' }]);
          }}
        >
          Save {valid.length || ''} pair{valid.length === 1 ? '' : 's'}
        </button>
      </div>
    </div>
  );
}
