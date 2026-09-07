import Link from 'next/link';
import SiteNav from './SiteNav';

/** The links the footer repeats, so the bottom of a long page is an exit and
 *  not a dead end. */
const FOOTER_LINKS = [
  { href: '/', label: 'Home' },
  { href: '/create', label: 'New bot' },
  { href: '/bots', label: 'My bots' },
  { href: '/account', label: 'Account' },
  // Reachable from every page, which is where people look for them and, in
  // several jurisdictions, where they are required to be.
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
];

export default function Shell({
  children,
  wide = false,
  bleed,
}: {
  children: React.ReactNode;
  wide?: boolean;
  /** Rendered directly under the masthead, outside the gutter and the measure,
   *  so it spans the viewport. For a hero that is a painted surface rather than
   *  a card: inside <main> the shell's own padding frames it in cream, which
   *  reads as a gap rather than as a margin. */
  bleed?: React.ReactNode;
}) {
  const measure = wide ? 'max-w-[1240px]' : 'max-w-5xl';
  return (
    <div className="min-h-screen">
      {/* Keyboard users land on the nav on every page; this is the way past it. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-slate-900 focus:px-4 focus:py-2.5 focus:text-[11px] focus:font-medium focus:uppercase focus:tracking-label focus:text-white"
      >
        Skip to content
      </a>

      {/* The masthead moved into its own client component when it learned to
          track the current route and the session; the cream bar and the cast
          beneath it live there now. */}
      <SiteNav wide={wide} />

      {/* <main> spans the page so a bleed child can; the measure moved inside
          it. The skip link still lands here, above the bleed, which is what
          keeps a hero's own call to action reachable from the keyboard. */}
      <main id="main">
        {bleed}
        <div className={`mx-auto px-6 pb-12 ${bleed ? 'pt-0' : 'pt-12'} ${measure}`}>{children}</div>
      </main>

      {/* Same measure as the page body above, or the closing rule runs wider
          than the content it is closing. */}
      <footer className={`mx-auto px-6 pb-16 pt-8 ${measure}`}>
        <span className="mb-8 block h-px w-full bg-slate-200" aria-hidden />
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="text-center sm:text-left">
            <Link href="/" className="font-serif text-[15px] tracking-[0.14em] text-slate-900">
              CHATBOT FORGE
            </Link>
            <p className="mt-2 text-[11px] font-light uppercase tracking-label text-slate-600">
              Bring your own model, your own key, your own prompt
            </p>
          </div>
          <nav className="flex flex-wrap justify-center gap-x-5 gap-y-2" aria-label="Footer">
            {FOOTER_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="text-[11px] font-medium uppercase tracking-label text-slate-500 transition duration-200 ease-editorial hover:text-slate-900"
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
      </footer>
    </div>
  );
}
