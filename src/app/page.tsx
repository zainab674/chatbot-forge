import Shell from '@/components/Shell';
import BotList from '@/components/BotList';
import ChatMock from '@/components/landing/ChatMock';
import ClosingBand from '@/components/landing/ClosingBand';
import Dock from '@/components/landing/Dock';
import LandingHero from '@/components/landing/LandingHero';
import Pillars, { type Pillar } from '@/components/landing/Pillars';
import ShipBand from '@/components/landing/ShipBand';
import TrustRow from '@/components/landing/TrustRow';
import { Reveal, ScrollProgress } from '@/components/motion/primitives';

/** Same fallback ManageBot uses, so the snippet on the landing page and the
 *  snippet on the ship screen are never two different shapes. */
const ORIGIN = process.env.NEXT_PUBLIC_APP_URL || 'https://your-domain.com';

const WIDGET_SNIPPET = `<script
  src="${ORIGIN}/widget.js"
  data-bot-id="your-bot-id"
  data-position="right"
  defer
></script>`;

/** The providers a bot can actually run on, spelled the way /create spells them. */
const PROVIDERS = ['Groq', 'OpenAI', 'Google Gemini'];

const PILLARS: readonly Pillar[] = [
  ['01', 'Any model', 'Groq, OpenAI, or Gemini — bring your own key, or run on credits.'],
  ['02', 'Your prompt, your voice', 'Paste your FAQs and rules, then pick a talking style or write your own.'],
  ['03', 'Three ways to ship', 'A shareable link, an <iframe> snippet, or a one-line widget script.'],
];

/**
 * The landing page.
 *
 * The copy, the composition and the order of the sections are the same ones
 * this page has always had. What changed is that it now moves: the page is
 * assembled section by section as it is scrolled rather than arriving whole,
 * and the two things that are hardest to explain in a sentence — what the
 * product looks like in use, and how little work shipping it is — demonstrate
 * themselves instead.
 *
 * The motion lives in `@/components/landing`, one component per band, all of
 * them client components over Framer Motion. This file stays a server
 * component and keeps what it always kept: the copy, and the order.
 *
 * Two things to know before editing them:
 *
 *   - Every animated element carries `data-motion`. `globals.css` uses that to
 *     force the finished state under `prefers-reduced-motion`, which covers the
 *     paint before hydration; each component checks the preference again in JS
 *     and simply does not start.
 *   - The `<noscript>` block below is the same idea for a browser with
 *     JavaScript off, where nothing would ever animate in and a reveal would be
 *     a permanently invisible paragraph.
 */
export default function HomePage() {
  return (
    <>
      <noscript>
        <style>{`
          [data-motion] { opacity: 1 !important; transform: none !important; filter: none !important; }
          .tw-full { visibility: visible !important; }
          .tw-typed { display: none !important; }
          /* The hero's backdrop is chosen in JavaScript, and defaults to the
             gradient with no artwork on it. With no JavaScript to choose, the
             painted fresco is the answer. */
          .hero-poster { opacity: 1 !important; }
        `}</style>
      </noscript>

      <ScrollProgress />

      {/* Follows the visitor down the page once the hero's own button is gone. */}
      <Dock />

      <Shell wide bleed={<LandingHero />}>
        {/* The product itself, rising out of the cloudbank the hero ends on. It
            is the only place a visitor sees what they are buying before they
            sign up, which is why it overlaps rather than waits its turn — and
            why it is the one thing on the page that plays rather than sits. */}
        <ChatMock />

        {/* Proof the "any model" line is not marketing. */}
        <TrustRow providers={PROVIDERS} />

        {/* Three services, the way the template stacks them — but as sheets
            that lift, with the numeral carrying the weight the old hairline
            did. */}
        <Pillars pillars={PILLARS} />

        {/* The one place the page shows output rather than describing it — and
            the page's charcoal beat, sat between the cream three-up above and
            the cream bot list below so the eye gets a change of ground. */}
        <ShipBand snippet={WIDGET_SNIPPET} />

        <Reveal amount={0.15}>
          <BotList preview />
        </Reveal>

        <ClosingBand />
      </Shell>
    </>
  );
}
