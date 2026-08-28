import Shell from '@/components/Shell';
import BotList from '@/components/BotList';
import HeroFresco from '@/components/HeroFresco';
import Link from 'next/link';

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
const PROVIDERS = ['OpenAI', 'Anthropic', 'Google Gemini', 'Groq'];

const PILLARS = [
  ['01', 'Any model', 'OpenAI, Anthropic, Gemini, or Groq — bring your own key, or run on credits.'],
  ['02', 'Your prompt, your voice', 'Paste your FAQs and rules, then pick a talking style or write your own.'],
  ['03', 'Three ways to ship', 'A shareable link, an <iframe> snippet, or a one-line widget script.'],
] as const;

export default function HomePage() {
  return (
    <Shell wide>
      {/* The hero carries the whole first impression, so it says the one thing
          the product does and gets out of the way. The painting behind it is
          the Creation, recast: a machine reaching for the spark rather than a
          man. Everything it means is in the copy, so it is decoration only. */}
      {/* The mobile height is deliberate: it is the copy block plus the height
          of the painting's band, so the fine print lands just above the clouds
          rather than across a robot's chest. */}
      <section className="hero-fresco min-h-[880px] px-6 pb-0 pt-14 sm:min-h-[700px] sm:px-12 sm:py-28 lg:min-h-[800px] lg:py-36">
        <div className="fresco-plate" aria-hidden>
          <HeroFresco />
        </div>

        <div className="mx-auto max-w-[760px]">
          <p className="mb-7 inline-flex animate-rise items-center gap-3 text-[11px] font-medium uppercase tracking-label text-accent-800">
            <span className="h-px w-8 bg-accent-700/60" aria-hidden />
            No signup needed
            <span className="h-px w-8 bg-accent-700/60" aria-hidden />
          </p>
          <h1 className="display fresco-ink animate-rise text-slate-900 [animation-delay:80ms]">
            Build a chatbot in about <span className="italic text-accent-800">two minutes.</span>
          </h1>
          <p className="lede fresco-ink mx-auto mt-7 animate-rise text-slate-700 [animation-delay:160ms]">
            Pick a model from any provider, paste in what it should know, choose how it talks. You get a hosted chat
            page, an iframe embed, and a one-line widget script.
          </p>
          <div className="mt-11 flex animate-rise flex-col items-center gap-5 [animation-delay:240ms]">
            <Link href="/create" className="btn-dark !rounded-full !px-9">
              Create a chatbot
            </Link>
            <Link href="/account" className="link fresco-ink !text-accent-900">
              Log in
            </Link>
          </div>
          <p className="fresco-ink mt-9 animate-rise text-[12px] font-light text-slate-700 [animation-delay:300ms]">
            10 free trial messages before you make an account. Keep the bot when you sign up.
          </p>
        </div>
      </section>

      {/* The product itself, rising out of the cloudbank the hero ends on. It
          is the only place a visitor sees what they are buying before they
          sign up, which is why it overlaps rather than waits its turn. */}
      <div className="relative z-20 mx-auto -mt-16 mb-16 max-w-[560px] animate-rise sm:-mt-24" aria-hidden>
        <div className="mock">
          <div className="mock-bar">
            <span className="mock-dot" />
            <span className="mock-dot" />
            <span className="mock-dot" />
            <span className="mock-url">wickandwax.com</span>
          </div>
          <div className="mock-body">
            <div className="mock-row">
              <span className="mock-av">🕯️</span>
              <div>
                <p className="mock-bot">Hi! Ask me anything about our candles, shipping, or returns.</p>
              </div>
            </div>
            <p className="mock-user">Do you ship to Canada?</p>
            <div className="mock-row">
              <span className="mock-av">🕯️</span>
              <div>
                <p className="mock-bot">
                  We do — 3–5 business days, and shipping is free over $50. Returns stay open for 30 days.
                </p>
                <span className="mock-cite">
                  <span className="h-px w-3 bg-accent-500" />
                  from shipping-policy.pdf
                </span>
              </div>
            </div>
            <p className="mock-user">And returns?</p>
            <div className="mock-row">
              <span className="mock-av">🕯️</span>
              <div className="mock-typing">
                <i />
                <i />
                <i />
              </div>
            </div>
          </div>
          <div className="mock-foot">
            <span className="mock-input">Ask me anything…</span>
            <span className="mock-send">↑</span>
          </div>
        </div>
      </div>

      {/* Proof the "any model" line is not marketing. */}
      <section className="trust mb-16">
        <span className="text-[10.5px] font-medium uppercase tracking-label text-slate-500">Runs on</span>
        {PROVIDERS.map((p) => (
          <b key={p}>{p}</b>
        ))}
      </section>

      {/* Three services, the way the template stacks them — but as sheets that
          lift, with the numeral carrying the weight the old hairline did. */}
      <section className="mb-20 grid gap-5 sm:grid-cols-3">
        {PILLARS.map(([num, title, body]) => (
          <div key={title} className="numcard">
            <span className="numcard-n">{num}</span>
            <h3 className="mt-5 font-serif text-[22px] font-normal">{title}</h3>
            <p className="mt-3 text-[13.5px] font-light leading-[1.8] text-slate-600">{body}</p>
          </div>
        ))}
      </section>

      {/* The one place the page shows output rather than describing it — and
          the page's charcoal beat, sat between the cream three-up above and the
          cream bot list below so the eye gets a change of ground. */}
      <section className="band tone-ink mb-20 grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
        <div>
          <div className="section-head">
            <span className="kicker">Shipping</span>
            <span className="section-rule" aria-hidden />
            <h2 className="display-sm">One line on your site, and it is live.</h2>
          </div>
          <p className="lede">
            Paste the script tag anywhere in your HTML. The bubble sits in the corner, loads on demand, and follows the
            colours you picked in the builder. Prefer no script at all? Take the hosted link or the iframe instead.
          </p>
          <Link href="/create" className="btn-primary mt-8">
            Start building
          </Link>
        </div>
        <div className="codeblk shadow-lift-md">
          <pre>{WIDGET_SNIPPET}</pre>
        </div>
      </section>

      <BotList preview />

      <section className="band tone-sand mt-20 text-center">
        <p className="kicker mb-5 text-accent-800">Two minutes, no account</p>
        <h2 className="display-sm mx-auto max-w-[18ch]">Describe it once. Keep it when you sign up.</h2>
        <Link href="/create" className="btn-dark mt-9">
          Create a chatbot
        </Link>
      </section>
    </Shell>
  );
}
