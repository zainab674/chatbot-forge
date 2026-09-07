'use client';

/**
 * Small presentational controls shared across the builder's steps.
 */
import { useEffect } from 'react';



/* ============================ shared bits ============================ */

export function StepHead({ n, total, title, sub }: { n: number; total: number; title: string; sub: string }) {
  return (
    <div className="mb-7">
      <p className="eyebrow">
        <span className="eyebrow-bar" />
        Step {n} of {total}
      </p>
      <h2 className="h-step">{title}</h2>
      <p className="sub-step">{sub}</p>
    </div>
  );
}

export function TogglePill({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className={`pill ${on ? 'pill-on' : ''}`}>
      <span aria-hidden>{on ? '✓' : '＋'}</span>
      {label}
    </button>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  left,
  right,
  caption,
}: {
  label?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  left: string;
  right: string;
  caption?: string;
}) {
  // The filled part of the track is painted by a gradient stop, so the input
  // has to know how far along it is.
  const pct = max === min ? 0 : ((value - min) / (max - min)) * 100;
  return (
    <div>
      {label && <span className="field-label">{label}</span>}
      <input
        type="range"
        className="slider"
        style={{ ['--pct' as any]: `${pct}%` }}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        aria-label={label}
      />
      <div className="slider-ends">
        <span>{left}</span>
        {caption && <span className="font-mono text-slate-700">{caption}</span>}
        <span>{right}</span>
      </div>
    </div>
  );
}

/**
 * Errors surface here rather than as a banner in the page, because a failed
 * save is often triggered from the footer with the offending field scrolled out
 * of view. Announces itself, and clears after a few seconds.
 */
export function ErrorToast({ toast, onClose }: { toast: { id: number; message: string } | null; onClose: () => void }) {
  // Only the id, not the whole object: the countdown should restart when a new
  // error arrives and not merely because the parent re-rendered and handed down
  // a fresh object. Reading it out here keeps the effect's dependencies honest,
  // which is what the exhaustive-deps rule was pointing at.
  const toastId = toast?.id;
  useEffect(() => {
    if (toastId === undefined) return;
    const timer = setTimeout(onClose, 7000);
    return () => clearTimeout(timer);
    // toastId changes on every new error, which restarts the countdown even
    // when the same message comes back twice.
  }, [toastId, onClose]);

  if (!toast) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-20 z-50 flex justify-center px-4">
      <div
        role="alert"
        aria-live="assertive"
        className="animate-fade-down pointer-events-auto flex max-w-md items-start gap-3 rounded-panel border-2 border-red-200 bg-white px-4 py-3.5"
        style={{ boxShadow: '0 24px 60px -28px rgba(41,15,80,.5)' }}
      >
        <span className="grid h-6 w-6 flex-none place-items-center rounded-full bg-red-50 text-xs font-black text-red-600">
          !
        </span>
        <p className="m-0 min-w-0 text-sm font-semibold text-red-700">{toast.message}</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss"
          className="-mr-1 flex-none rounded-control px-1.5 text-lg leading-none text-slate-400 transition hover:text-slate-700"
        >
          ×
        </button>
      </div>
    </div>
  );
}
