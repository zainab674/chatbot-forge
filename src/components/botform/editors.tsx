'use client';

/**
 * The builder's list and file editors: importing a document into the info box,
 * and the two repeat-field editors.
 */
import { useRef, useState } from 'react';
import { LIMITS } from '@/lib/validate';
import { SUPPORTED_EXTENSIONS, MAX_UPLOAD_MB } from '@/lib/knowledge/constants';



/**
 * Pulls the text out of a document straight into the prompt.
 *
 * Parsed server-side by /api/extract and dropped into the editor as ordinary
 * editable text: no storage, no embeddings, no model, and it works before the
 * chatbot exists.
 */
export function InfoImport({
  onText,
  onError,
}: {
  onText: (text: string, name: string) => void;
  onError: (message: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<{ name: string; note: string } | null>(null);
  const [over, setOver] = useState(false);

  async function importFiles(files: FileList | null) {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      setBusy(file.name);
      try {
        const form = new FormData();
        form.append('file', file);
        // No Content-Type header: the browser sets the multipart boundary.
        const res = await fetch('/api/extract', { method: 'POST', body: form });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? 'Could not read that file.');
        onText(json.text, json.title || file.name);
        setDone({
          name: file.name,
          note:
            `${json.chars.toLocaleString()} characters` +
            (json.truncated ? `, trimmed to the ${LIMITS.info.toLocaleString()} limit` : ''),
        });
      } catch (e: any) {
        onError(`${file.name}: ${e.message}`);
        break;
      }
    }
    setBusy(null);
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!busy) importFiles(e.dataTransfer.files);
        }}
        className={`drop ${over ? 'drop-over' : ''} ${busy ? 'opacity-60' : ''}`}
      >
        <span className="drop-ic" aria-hidden>
          {busy ? '⏳' : '📄'}
        </span>
        <div className="min-w-0">
          <h4 className="m-0 text-[14.5px] font-extrabold tracking-tight">
            {busy ? `Reading ${busy}…` : 'Feed it a document'}
          </h4>
          <p className="m-0 text-[12.5px] text-slate-500">
            {SUPPORTED_EXTENSIONS.join(', ')} · up to {MAX_UPLOAD_MB} MB
          </p>
        </div>
        <button
          type="button"
          className="btn-ghost ml-auto !px-4 !py-2.5 !text-[13px]"
          onClick={() => !busy && inputRef.current?.click()}
          disabled={Boolean(busy)}
        >
          Browse
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={SUPPORTED_EXTENSIONS.join(',')}
          className="sr-only"
          onChange={(e) => {
            importFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      {done && (
        <div className="filerow">
          <span className="grid h-[30px] w-[30px] flex-none place-items-center rounded-[9px] bg-sky-100 text-sm" aria-hidden>
            📄
          </span>
          <span className="min-w-0 truncate text-[13.5px] font-bold">{done.name}</span>
          <span className="ml-auto whitespace-nowrap text-xs font-semibold text-slate-500">read, {done.note}</span>
        </div>
      )}
    </div>
  );
}

export function QAPairEditor({
  value,
  onChange,
}: {
  value: { q: string; a: string }[];
  onChange: (v: { q: string; a: string }[]) => void;
}) {
  const update = (i: number, field: 'q' | 'a', text: string) =>
    onChange(value.map((p, idx) => (idx === i ? { ...p, [field]: text } : p)));

  return (
    <div>
      {value.map((p, i) => (
        <div key={i} className="qa">
          <div className="flex items-center gap-2">
            <span className="qa-tag">Q</span>
            <input
              className="min-w-0 flex-1 border-0 bg-transparent text-[13.5px] font-bold outline-none placeholder:font-medium placeholder:text-slate-400"
              value={p.q}
              onChange={(e) => update(i, 'q', e.target.value)}
              placeholder="Do you ship to Canada?"
              maxLength={300}
            />
            <button
              type="button"
              className="flex-none rounded-control px-2 py-1 text-xs font-bold text-slate-400 transition hover:bg-red-50 hover:text-red-600"
              onClick={() => onChange(value.filter((_, idx) => idx !== i))}
              aria-label={`Remove pinned answer ${i + 1}`}
            >
              Remove
            </button>
          </div>
          <textarea
            className="mt-1.5 block w-full resize-y border-0 bg-transparent pl-[34px] text-[13px] leading-relaxed text-slate-700 outline-none placeholder:text-slate-400"
            value={p.a}
            onChange={(e) => update(i, 'a', e.target.value)}
            placeholder="Yes. Canada is $12 flat and takes 5 to 8 business days."
            maxLength={2000}
            rows={2}
          />
        </div>
      ))}
      {value.length < 50 && (
        <button type="button" className="addrow" onClick={() => onChange([...value, { q: '', a: '' }])}>
          + Add a pinned answer
        </button>
      )}
      <p className="hint">Shown to the model word for word — no indexing, no retrieval involved.</p>
    </div>
  );
}

export function SuggestionEditor({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    if (draft.trim() && value.length < 4) {
      onChange([...value, draft.trim()]);
      setDraft('');
    }
  };
  return (
    <div>
      <div className="flex gap-2.5">
        <input
          className="input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Track my order"
          disabled={value.length >= 4}
        />
        <button type="button" className="btn-ghost flex-none !px-4" disabled={!draft.trim() || value.length >= 4} onClick={add}>
          Add
        </button>
      </div>
      {value.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {value.map((s, i) => (
            <button
              key={`${s}-${i}`}
              type="button"
              onClick={() => onChange(value.filter((_, idx) => idx !== i))}
              className="inline-flex items-center gap-1.5 rounded-control border border-slate-300 bg-white px-3 py-1.5 text-[10.5px] font-medium uppercase tracking-wide text-slate-700 transition hover:border-red-600 hover:text-red-700"
            >
              {s} <span className="text-slate-400">×</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
