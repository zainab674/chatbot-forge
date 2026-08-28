/**
 * Themes for the chat surface — the window visitors actually talk to.
 *
 * Each theme is a small token bag rather than a stylesheet, so the chat window,
 * the hosted page and the iframe embed can all dress themselves from the same
 * definition and never drift apart. Every theme still declares `dark`, because
 * a lot of the chrome (icon buttons, borders, error rows) only needs to know
 * which way the contrast runs.
 *
 * Kept free of Node-only imports: the builder previews these in the browser.
 */

export type ChatThemeId =
  | 'light'
  | 'dark'
  | 'aurora'
  | 'midnight'
  | 'ember'
  | 'robot'
  | 'nebula'
  | 'circuit'
  | 'lagoon';

/**
 * Which animated scene, if any, plays behind the conversation.
 *
 * The scene is decoration only: it is painted by <ChatScene />, sits behind
 * every message, takes no pointer events, and freezes flat under
 * prefers-reduced-motion. Themes without one stay perfectly still.
 */
export type ChatMotionId = 'robot' | 'stars' | 'circuit' | 'bubbles';

export interface ChatTheme {
  id: ChatThemeId;
  label: string;
  blurb: string;
  /** Which way the contrast runs. Drives the existing light/dark branches. */
  dark: boolean;
  /** Background painted behind the whole conversation. */
  surface: string;
  /** Background for the page or host area around the window. */
  page: string;
  /** Assistant bubble. Glass on the gradient themes, flat on the plain ones. */
  bubble: string;
  /** Separator colour for the header and composer. */
  border: string;
  /** The composer box. Picks up the surface rather than fighting it. */
  composer: string;
  /** Halo behind the avatar. Empty on the flat themes. */
  glow: string;
  /** Animated scene painted behind the conversation. Omitted = still theme. */
  motion?: ChatMotionId;
  /** Two-stop gradient for the picker swatch in the builder. */
  swatch: string;
}

export const CHAT_THEMES: ChatTheme[] = [
  {
    id: 'light',
    label: 'Light',
    blurb: 'Plain and bright. Fits almost any site.',
    dark: false,
    surface: '#ffffff',
    page: '#f1f5f9',
    bubble: 'bg-slate-100 text-slate-800',
    border: 'rgb(226 232 240)',
    composer: 'border-slate-200 bg-slate-50 focus-within:ring-slate-900/5',
    glow: '',
    swatch: 'linear-gradient(135deg, #ffffff, #e2e8f0)',
  },
  {
    id: 'dark',
    label: 'Dark',
    blurb: 'Plain and dark. Fits dark sites.',
    dark: true,
    surface: '#0f172a',
    page: '#020617',
    bubble: 'bg-slate-800 text-slate-100',
    border: 'rgb(51 65 85)',
    composer: 'border-slate-700 bg-slate-800 focus-within:ring-white/5',
    glow: '',
    swatch: 'linear-gradient(135deg, #1e293b, #0f172a)',
  },
  {
    id: 'aurora',
    label: 'Aurora',
    blurb: 'Soft lavender glass. Light, calm, a little dreamy.',
    dark: false,
    surface:
      'radial-gradient(120% 80% at 15% 0%, #ede9fe 0%, transparent 55%),' +
      'radial-gradient(110% 75% at 95% 10%, #fae8ff 0%, transparent 50%),' +
      'radial-gradient(130% 90% at 50% 110%, #dbeafe 0%, transparent 55%),' +
      'linear-gradient(160deg, #faf5ff, #f5f3ff 60%, #fdf4ff)',
    page: 'linear-gradient(160deg, #f5f3ff, #fae8ff)',
    bubble: 'bg-white/70 text-slate-800 backdrop-blur-md ring-1 ring-white/60',
    border: 'rgba(167, 139, 250, 0.28)',
    composer: 'border-white/60 bg-white/70 backdrop-blur-md focus-within:ring-violet-400/20',
    glow: 'rgba(167, 139, 250, 0.55)',
    swatch: 'linear-gradient(135deg, #ede9fe, #fae8ff 55%, #dbeafe)',
  },
  {
    id: 'midnight',
    label: 'Midnight',
    blurb: 'Deep violet night with a soft glow.',
    dark: true,
    surface:
      'radial-gradient(110% 70% at 20% 0%, #4c1d95 0%, transparent 55%),' +
      'radial-gradient(100% 65% at 90% 15%, #6d28d9 0%, transparent 50%),' +
      'linear-gradient(165deg, #1e1b4b, #0f0a29 65%, #16082e)',
    page: 'linear-gradient(165deg, #0f0a29, #1e1b4b)',
    bubble: 'bg-white/10 text-violet-50 backdrop-blur-md ring-1 ring-white/10',
    border: 'rgba(167, 139, 250, 0.22)',
    composer: 'border-white/10 bg-white/10 backdrop-blur-md focus-within:ring-violet-400/20',
    glow: 'rgba(139, 92, 246, 0.75)',
    swatch: 'linear-gradient(135deg, #4c1d95, #1e1b4b 60%, #16082e)',
  },
  {
    id: 'ember',
    label: 'Ember',
    blurb: 'Near-black with a red glow. High drama.',
    dark: true,
    surface:
      'radial-gradient(100% 60% at 50% -5%, #7f1d1d 0%, transparent 55%),' +
      'radial-gradient(80% 50% at 50% 105%, #450a0a 0%, transparent 60%),' +
      'linear-gradient(180deg, #0c0a09, #1c0f0f 70%, #0c0a09)',
    page: 'linear-gradient(180deg, #0c0a09, #1c0f0f)',
    bubble: 'bg-white/[0.07] text-rose-50 backdrop-blur-md ring-1 ring-red-500/20',
    border: 'rgba(248, 113, 113, 0.2)',
    composer: 'border-red-500/20 bg-white/[0.06] backdrop-blur-md focus-within:ring-red-500/20',
    glow: 'rgba(239, 68, 68, 0.7)',
    swatch: 'linear-gradient(135deg, #7f1d1d, #1c0f0f 60%, #0c0a09)',
  },
  {
    id: 'robot',
    label: 'Robot',
    blurb: 'Steel and cyan. A little robot bobs along and thinks while it types.',
    dark: true,
    motion: 'robot',
    surface:
      'radial-gradient(110% 70% at 50% -10%, #0e7490 0%, transparent 55%),' +
      'radial-gradient(85% 55% at 10% 105%, #155e75 0%, transparent 60%),' +
      'linear-gradient(170deg, #0b1220, #101d30 60%, #070e18)',
    page: 'linear-gradient(170deg, #070e18, #101d30)',
    bubble: 'bg-white/[0.08] text-cyan-50 backdrop-blur-md ring-1 ring-cyan-300/20',
    border: 'rgba(34, 211, 238, 0.22)',
    composer: 'border-cyan-300/20 bg-white/[0.07] backdrop-blur-md focus-within:ring-cyan-400/20',
    glow: 'rgba(34, 211, 238, 0.6)',
    swatch: 'linear-gradient(135deg, #0e7490, #101d30 60%, #070e18)',
  },
  {
    id: 'nebula',
    label: 'Nebula',
    blurb: 'Deep space. Stars drift and twinkle, a comet crosses now and then.',
    dark: true,
    motion: 'stars',
    surface:
      'radial-gradient(110% 70% at 80% 0%, #3b0764 0%, transparent 55%),' +
      'radial-gradient(90% 60% at 10% 90%, #0c4a6e 0%, transparent 55%),' +
      'linear-gradient(165deg, #05010f, #0b0620 55%, #05010f)',
    page: 'linear-gradient(165deg, #05010f, #0b0620)',
    bubble: 'bg-white/[0.09] text-indigo-50 backdrop-blur-md ring-1 ring-indigo-300/20',
    border: 'rgba(129, 140, 248, 0.22)',
    composer: 'border-indigo-300/20 bg-white/[0.07] backdrop-blur-md focus-within:ring-indigo-400/25',
    glow: 'rgba(129, 140, 248, 0.7)',
    swatch: 'linear-gradient(135deg, #3b0764, #0b0620 55%, #05010f)',
  },
  {
    id: 'circuit',
    label: 'Circuit',
    blurb: 'Terminal green on near-black. Pulses run along the traces.',
    dark: true,
    motion: 'circuit',
    surface:
      'radial-gradient(100% 60% at 50% 0%, #064e3b 0%, transparent 60%),' +
      'linear-gradient(180deg, #04120c, #071a12 65%, #030d09)',
    page: 'linear-gradient(180deg, #030d09, #071a12)',
    bubble: 'bg-emerald-400/[0.08] text-emerald-50 backdrop-blur-md ring-1 ring-emerald-400/25',
    border: 'rgba(52, 211, 153, 0.22)',
    composer: 'border-emerald-400/25 bg-emerald-400/[0.06] backdrop-blur-md focus-within:ring-emerald-400/20',
    glow: 'rgba(16, 192, 138, 0.65)',
    swatch: 'linear-gradient(135deg, #064e3b, #071a12 60%, #030d09)',
  },
  {
    id: 'lagoon',
    label: 'Lagoon',
    blurb: 'Bright aqua daylight with bubbles rising through it.',
    dark: false,
    motion: 'bubbles',
    surface:
      'radial-gradient(120% 80% at 20% 0%, #cffafe 0%, transparent 55%),' +
      'radial-gradient(110% 70% at 95% 15%, #dbeafe 0%, transparent 50%),' +
      'linear-gradient(170deg, #f0fdfa, #ecfeff 55%, #e0f2fe)',
    page: 'linear-gradient(170deg, #ecfeff, #e0f2fe)',
    bubble: 'bg-white/75 text-slate-800 backdrop-blur-md ring-1 ring-white/70',
    border: 'rgba(45, 212, 191, 0.3)',
    composer: 'border-white/70 bg-white/75 backdrop-blur-md focus-within:ring-teal-400/20',
    glow: 'rgba(45, 212, 191, 0.5)',
    swatch: 'linear-gradient(135deg, #cffafe, #e0f2fe 55%, #f0fdfa)',
  },
];

const BY_ID = new Map(CHAT_THEMES.map((t) => [t.id, t]));

/** Unknown or missing ids fall back to Light rather than rendering nothing. */
export function getChatTheme(id: string | undefined): ChatTheme {
  return BY_ID.get((id ?? '') as ChatThemeId) ?? CHAT_THEMES[0];
}

export function isChatThemeId(id: unknown): id is ChatThemeId {
  return typeof id === 'string' && BY_ID.has(id as ChatThemeId);
}
