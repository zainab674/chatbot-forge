'use client';

import type { ChatTheme } from '@/lib/themes';

/**
 * The animated backdrop for the themes that have one.
 *
 * Decoration only, and deliberately dumb: one absolutely-positioned layer that
 * takes no pointer events, sits behind every message, and is driven entirely by
 * CSS keyframes in globals.css (so it costs nothing per render and freezes flat
 * under prefers-reduced-motion). Themes without a `motion` render nothing.
 *
 * Every position here is a literal rather than a random one, because the chat
 * is server-rendered and the markup has to match on hydration.
 */

interface Props {
  theme: ChatTheme;
  /** The bot is answering: the scene leans in — the robot scans and thinks. */
  busy?: boolean;
  /** Shrunken variant for the theme picker's swatch tile. */
  mini?: boolean;
}

export default function ChatScene({ theme, busy = false, mini = false }: Props) {
  if (!theme.motion) return null;

  const scene =
    theme.motion === 'robot' ? (
      <RobotScene mini={mini} />
    ) : theme.motion === 'stars' ? (
      <StarScene mini={mini} />
    ) : theme.motion === 'circuit' ? (
      <CircuitScene mini={mini} />
    ) : (
      <BubbleScene mini={mini} />
    );

  return (
    <div
      className={`cf-scene pointer-events-none absolute inset-0 overflow-hidden ${busy ? 'cf-busy' : ''} ${
        mini ? 'cf-mini' : ''
      }`}
      aria-hidden
    >
      {scene}
    </div>
  );
}

/* ================= robot ================= */

/**
 * A little robot that floats in the corner, blinks on its own, and — while the
 * answer is streaming — scans its eyes and spins up its antenna.
 */
function RobotScene({ mini }: { mini: boolean }) {
  return (
    <>
      <div className="cf-grid absolute inset-0" />
      <svg
        viewBox="0 0 120 132"
        className={
          mini
            ? 'absolute left-1/2 top-1/2 h-[34px] w-[34px] -translate-x-1/2 -translate-y-1/2'
            : 'absolute bottom-[86px] right-4 h-[116px] w-[106px] opacity-[0.6] sm:h-[146px] sm:w-[133px]'
        }
      >
        <defs>
          <linearGradient id="cf-bot-shell" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#e2f5fb" />
            <stop offset="100%" stopColor="#8fb6c8" />
          </linearGradient>
          <radialGradient id="cf-bot-lamp">
            <stop offset="0%" stopColor="#a5f3fc" />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
          </radialGradient>
        </defs>

        <g className="cf-bot-bob">
          {/* antenna */}
          <line x1="60" y1="20" x2="60" y2="34" stroke="#67e8f9" strokeWidth="3" strokeLinecap="round" />
          <circle className="cf-bot-lamp" cx="60" cy="15" r="10" fill="url(#cf-bot-lamp)" />
          <circle className="cf-bot-bulb" cx="60" cy="15" r="5" fill="#22d3ee" />

          {/* head */}
          <rect x="26" y="32" width="68" height="50" rx="18" fill="url(#cf-bot-shell)" />
          <rect x="20" y="50" width="8" height="16" rx="4" fill="#67e8f9" />
          <rect x="92" y="50" width="8" height="16" rx="4" fill="#67e8f9" />
          {/* visor */}
          <rect x="34" y="42" width="52" height="30" rx="14" fill="#0b2534" />
          <g className="cf-bot-eyes">
            <rect className="cf-bot-eye" x="44" y="51" width="10" height="12" rx="5" fill="#22d3ee" />
            <rect className="cf-bot-eye" x="66" y="51" width="10" height="12" rx="5" fill="#22d3ee" />
          </g>
          {/* the mouth only shows up while it is thinking */}
          <rect className="cf-bot-mouth" x="52" y="76" width="16" height="3" rx="1.5" fill="#67e8f9" />

          {/* body */}
          <rect x="34" y="86" width="52" height="36" rx="14" fill="url(#cf-bot-shell)" />
          <circle className="cf-bot-core" cx="60" cy="104" r="8" fill="#22d3ee" />
          {/* arms */}
          <rect className="cf-bot-arm-l" x="20" y="90" width="12" height="26" rx="6" fill="#8fb6c8" />
          <rect className="cf-bot-arm-r" x="88" y="90" width="12" height="26" rx="6" fill="#8fb6c8" />
        </g>
      </svg>
    </>
  );
}

/* ================= nebula ================= */

/** Fixed so the server and the browser agree: [left%, top%, size px, delay s]. */
const STARS: [number, number, number, number][] = [
  [6, 12, 2, 0], [14, 44, 1.5, 1.4], [21, 78, 2.5, 0.7], [28, 22, 1.5, 2.1],
  [34, 61, 2, 3.2], [41, 8, 2.5, 1.1], [47, 88, 1.5, 2.6], [53, 35, 2, 0.4],
  [59, 68, 1.5, 3.6], [66, 15, 2.5, 1.8], [72, 50, 2, 2.9], [78, 82, 1.5, 0.9],
  [84, 28, 2, 3.9], [90, 58, 2.5, 1.6], [95, 9, 1.5, 2.4], [11, 92, 2, 3.1],
];

function StarScene({ mini }: { mini: boolean }) {
  return (
    <>
      <div className="cf-drift absolute inset-0" />
      {(mini ? STARS.slice(0, 6) : STARS).map(([left, top, size, delay], i) => (
        <span
          key={i}
          className="cf-star absolute rounded-full bg-white"
          style={{
            left: `${left}%`,
            top: `${top}%`,
            width: `${size}px`,
            height: `${size}px`,
            animationDelay: `${delay}s`,
          }}
        />
      ))}
      {!mini && <span className="cf-comet absolute" />}
    </>
  );
}

/* ================= circuit ================= */

/** Traces, and the pulse that runs down each one. */
const TRACES = [
  { d: 'M-10 26 H40 L58 44 H150', delay: '0s' },
  { d: 'M-10 92 H28 L46 74 H150', delay: '1.9s' },
  { d: 'M-10 150 H74 L92 132 H150', delay: '3.4s' },
  { d: 'M18 -10 V52 L36 70 V210', delay: '2.6s' },
  { d: 'M124 -10 V88 L106 106 V210', delay: '4.6s' },
];

function CircuitScene({ mini }: { mini: boolean }) {
  const traces = mini ? TRACES.slice(0, 3) : TRACES;
  return (
    <svg viewBox="0 0 140 200" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
      {traces.map((t, i) => (
        <g key={i}>
          <path d={t.d} fill="none" stroke="rgba(16,192,138,0.16)" strokeWidth="1.5" />
          <path
            className="cf-trace"
            d={t.d}
            fill="none"
            stroke="#34d399"
            strokeWidth="1.8"
            strokeLinecap="round"
            style={{ animationDelay: t.delay }}
          />
        </g>
      ))}
    </svg>
  );
}

/* ================= lagoon ================= */

/** [left%, size px, duration s, delay s] */
const BUBBLES: [number, number, number, number][] = [
  [8, 10, 9, 0], [17, 6, 6.5, 1.4], [26, 14, 11, 0.7], [37, 8, 7.5, 2.6],
  [45, 5, 5.5, 0.3], [54, 12, 10, 1.9], [63, 7, 7, 3.2], [71, 16, 12, 1.1],
  [80, 6, 6, 2.2], [89, 11, 8.5, 0.2], [95, 8, 10.5, 1.6],
];

function BubbleScene({ mini }: { mini: boolean }) {
  return (
    <>
      {(mini ? BUBBLES.slice(0, 5) : BUBBLES).map(([left, size, dur, delay], i) => (
        <span
          key={i}
          className="cf-bubble absolute rounded-full"
          style={{
            left: `${left}%`,
            width: `${size}px`,
            height: `${size}px`,
            animationDuration: `${dur}s`,
            animationDelay: `${delay}s`,
          }}
        />
      ))}
    </>
  );
}
