import Link from 'next/link';
import Shell from '@/components/Shell';

/** A 404 with no nav is a dead end — the visitor's only move is the back
 *  button. Inside the Shell it is just another page of the site. */
export default function NotFound() {
  return (
    <Shell>
      <div className="card mx-auto max-w-xl py-14 text-center">
        <p className="text-5xl">🤷</p>
        {/* This handles every unknown URL, not just a missing bot, so the
            copy has to cover both without guessing which one happened. */}
        <h1 className="page-title mt-5">There is nothing at this address</h1>
        <p className="page-sub mx-auto">
          If you were opening a chatbot, it may have been deleted or paused by its owner. Otherwise the link is
          probably mistyped.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-2.5">
          <Link href="/bots" className="btn-primary">
            My bots
          </Link>
          <Link href="/create" className="btn-ghost">
            Build a new one
          </Link>
        </div>
      </div>
    </Shell>
  );
}
