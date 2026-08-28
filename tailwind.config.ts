import type { Config } from 'tailwindcss';

/**
 * Clarity palette — charcoal, sand and cream.
 *
 * An editorial wellness look: warm neutrals, a bronze-through-sand accent, and
 * four muted support hues that sit beside them without shouting. The built-in
 * `slate`, `emerald`, `red`, `amber` and `sky` scales are overridden rather
 * than aliased, so every class already written against them across the app
 * lands on this palette without being touched. `accent` is the sand ramp used
 * for anything that needs warmth; anything actionable is charcoal.
 */

/** Neutrals, warmed and greened so cream and charcoal share one family. */
const ink = {
  50: '#FAF8F4',
  100: '#F4F0E8',
  200: '#E7E1D5',
  300: '#D3CCBE',
  400: '#ABA598',
  500: '#807B70',
  600: '#615E54',
  700: '#4A4841',
  800: '#373B37',
  900: '#2A302C',
  950: '#1C211E',
};

/** Sand at the light end, bronze at the dark end so text on cream still reads. */
const sand = {
  50: '#FBF6ED',
  100: '#F7EEDD',
  200: '#EFDFC3',
  300: '#E3C89B',
  400: '#D8B37A',
  500: '#C79A55',
  600: '#9C7238',
  700: '#7E5C2D',
  800: '#654A26',
  900: '#523C20',
  950: '#2C1F10',
};

const sage = {
  50: '#F1F4ED',
  100: '#E3E9DB',
  200: '#CCD8BF',
  300: '#AFBF9D',
  400: '#8CA377',
  500: '#6E875A',
  600: '#546B44',
  700: '#425538',
  800: '#36442E',
  900: '#2C3727',
  950: '#161E14',
};

const clay = {
  50: '#FBF1EC',
  100: '#F6E2D9',
  200: '#EDC8B7',
  300: '#DFA488',
  400: '#CC7E5F',
  500: '#B96143',
  600: '#9B4A32',
  700: '#7E3B28',
  800: '#663023',
  900: '#53291F',
  950: '#2B1410',
};

const ochre = {
  50: '#FCF7E9',
  100: '#F8ECD1',
  200: '#F0DAA6',
  300: '#E4C375',
  400: '#D5AA4C',
  500: '#BF9134',
  600: '#9E7429',
  700: '#7E5A22',
  800: '#664820',
  900: '#543B1D',
  950: '#2E1F0E',
};

const dusk = {
  50: '#F0F4F5',
  100: '#E0E9EB',
  200: '#C4D4D9',
  300: '#9EB7BF',
  400: '#7596A1',
  500: '#587A86',
  600: '#46616B',
  700: '#3B4F57',
  800: '#33434A',
  900: '#2E393F',
  950: '#182022',
};

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        slate: ink,
        accent: sand,
        emerald: sage,
        red: clay,
        amber: ochre,
        sky: dusk,
      },
      fontFamily: {
        // Body and UI: a geometric sans that takes wide uppercase tracking well.
        sans: ['var(--font-jost)', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        // Display: the high-contrast serif that carries every heading.
        serif: ['var(--font-playfair)', 'ui-serif', 'Georgia', 'Times New Roman', 'serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      // Clarity is a squared-edge template: these are hairline radii, not curves.
      borderRadius: {
        card: '3px',
        panel: '2px',
        control: '2px',
      },
      /**
       * Elevation, warmed.
       *
       * The shadow colour is the ink, not black, so a lifted surface reads as
       * paper on paper rather than as a hole. Each step pairs a 1px contact
       * shadow (the sheet actually touching the ground) with a wide, very soft
       * cast — that pairing is what separates white from cream without a
       * heavier border.
       */
      boxShadow: {
        lift: '0 1px 1px rgba(42,48,44,.04), 0 6px 18px -10px rgba(42,48,44,.14)',
        'lift-md': '0 1px 2px rgba(42,48,44,.05), 0 14px 32px -16px rgba(42,48,44,.20)',
        'lift-lg': '0 2px 4px rgba(42,48,44,.06), 0 28px 56px -24px rgba(42,48,44,.26)',
        press: 'inset 0 1px 2px rgba(42,48,44,.12)',
      },
      /**
       * The display scale the old build never had. Headings sat at 2x body and
       * everything felt like one flat voice; these fluid steps put the top of
       * the page at 3-5x, which is where the editorial reference actually sits.
       */
      fontSize: {
        display: ['clamp(46px, 7vw, 78px)', { lineHeight: '1.02', letterSpacing: '-0.03em' }],
        'display-sm': ['clamp(34px, 4.4vw, 48px)', { lineHeight: '1.08', letterSpacing: '-0.022em' }],
        lede: ['clamp(15px, 1.4vw, 17.5px)', { lineHeight: '1.75' }],
      },
      transitionTimingFunction: {
        // One easing for everything that moves: fast out, long settle.
        editorial: 'cubic-bezier(.22,1,.36,1)',
      },
      letterSpacing: {
        // The uppercase label tracking used on eyebrows, buttons and nav.
        label: '0.18em',
        wide: '0.14em',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-down': {
          '0%': { opacity: '0', transform: 'translateY(-8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'step-in': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        blink: { '0%,80%,100%': { opacity: '0.25' }, '40%': { opacity: '1' } },
        'pulse-slow': {
          '0%,100%': { opacity: '1' },
          '50%': { opacity: '0.45' },
        },
        // Hero entrance: used with a stagger so the block assembles itself.
        rise: {
          '0%': { opacity: '0', transform: 'translateY(14px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        // The typing dots in the landing-page chat mock.
        'dot-bounce': {
          '0%,60%,100%': { transform: 'translateY(0)', opacity: '.35' },
          '30%': { transform: 'translateY(-3px)', opacity: '1' },
        },
      },
      animation: {
        'fade-up': 'fade-up .18s ease-out',
        'fade-down': 'fade-down .18s ease-out',
        'step-in': 'step-in .3s cubic-bezier(.22,1,.36,1)',
        'pulse-slow': 'pulse-slow 2.4s ease-in-out infinite',
        blink: 'blink 1.2s infinite',
        rise: 'rise .7s cubic-bezier(.22,1,.36,1) both',
        'dot-bounce': 'dot-bounce 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
