'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AUTH_CHANGED } from '@/lib/auth-events';

interface NavUser {
  email: string;
  credits: number;
  isAdmin: boolean;
}

/** Prefix match, so /bots/abc/edit still lights "My bots" — a deep page that
 *  lights nothing reads as having fallen out of the site. */
function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The masthead nav. It knows three things the old static header did not: which
 * page you are on, whether you are signed in, and whether you can see /admin —
 * which until now was reachable only from a card buried inside /account.
 */
export default function SiteNav({ wide }: { wide: boolean }) {
  const pathname = usePathname() || '/';
  const [user, setUser] = useState<NavUser | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((j) => setUser(j.user ?? null))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    load();
    window.addEventListener(AUTH_CHANGED, load);
    return () => window.removeEventListener(AUTH_CHANGED, load);
  }, [load]);

  // A menu left hanging open over the page you just navigated to is the
  // classic mobile-nav bug; the route change closes it.
  useEffect(() => setOpen(false), [pathname]);

  // A signed-out visitor gets "Log in" on the right and nothing labelled
  // "Account" — two links to /account under different names is the kind of
  // thing that makes a nav feel unconsidered.
  const links: { href: string; label: string }[] = [
    { href: '/', label: 'Home' },
    { href: '/bots', label: 'My bots' },
  ];
  if (user?.isAdmin) links.push({ href: '/admin', label: 'Admin' });

  const measure = wide ? 'max-w-[1240px]' : 'max-w-5xl';

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-[#f4f0e8]/85 shadow-lift backdrop-blur-xl">
      <div className={`mx-auto flex items-center gap-2 px-5 py-3 sm:px-6 ${measure}`}>
        <Link href="/" className="group flex flex-none items-center gap-3" aria-label="Chatbot Forge home">
          <span className="grid h-8 w-8 place-items-center rounded-control bg-slate-900 font-serif text-[16px] text-white shadow-lift transition duration-300 ease-editorial group-hover:-translate-y-px">
            F
          </span>
          <span className="whitespace-nowrap font-serif text-[19px] tracking-[0.14em] text-slate-900">
            <span className="hidden sm:inline">CHATBOT </span>
            <span className="italic tracking-normal text-accent-700">Forge</span>
          </span>
        </Link>

        <nav className="ml-5 hidden items-center gap-0.5 md:flex" aria-label="Main">
          {links.map((l) => {
            const on = isActive(pathname, l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`navlink ${on ? 'navlink-on' : ''}`}
                aria-current={on ? 'page' : undefined}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex flex-none items-center gap-2 sm:gap-3">
          {/* Held back until /api/auth/me answers, so the header never flashes
              "Log in" at somebody who is already logged in. */}
          {loaded &&
            (user ? (
              <Link
                href="/account"
                className="navchip hidden md:inline-flex"
                title={`Signed in as ${user.email}`}
                aria-current={isActive(pathname, '/account') ? 'page' : undefined}
              >
                <span className="navchip-av" aria-hidden>
                  {user.email.slice(0, 1)}
                </span>
                <span className="min-w-0">
                  <span className="navchip-mail">{user.email}</span>
                  <span className="navchip-sub">
                    {user.credits} credit{user.credits === 1 ? '' : 's'}
                  </span>
                </span>
              </Link>
            ) : (
              <Link href="/account" className="navlink hidden md:inline-flex">
                Log in
              </Link>
            ))}

          <Link
            href="/create"
            className="btn-dark whitespace-nowrap !px-4 !py-2.5 sm:!px-5"
            aria-current={isActive(pathname, '/create') ? 'page' : undefined}
          >
            New bot
          </Link>

          <button
            type="button"
            className="navtoggle md:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="site-nav-sheet"
            aria-label={open ? 'Close menu' : 'Open menu'}
          >
            <span aria-hidden>{open ? '✕' : '☰'}</span>
          </button>
        </div>
      </div>

      {open && (
        <div id="site-nav-sheet" className={`navsheet md:hidden ${measure} mx-auto`}>
          {links.map((l) => {
            const on = isActive(pathname, l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`navsheet-link ${on ? 'is-on' : ''}`}
                aria-current={on ? 'page' : undefined}
              >
                {l.label}
                {on && <span aria-hidden>•</span>}
              </Link>
            );
          })}
          {loaded &&
            (user ? (
              <Link href="/account" className="navsheet-link">
                <span className="normal-case tracking-normal">{user.email}</span>
                <span className="whitespace-nowrap text-slate-500">{user.credits} cr</span>
              </Link>
            ) : (
              <Link href="/account" className="navsheet-link">
                Log in or sign up
              </Link>
            ))}
        </div>
      )}
    </header>
  );
}
