'use client';

/**
 * The charcoal beat: what shipping actually looks like.
 *
 * The snippet types itself when the band scrolls in. It is the one literal
 * animation on the page — everything else is arrival and depth — and it earns
 * that because the claim being made is "one line and it is live". Watching the
 * line get written is the shortest possible proof of it.
 *
 * Typing text is a layout hazard: a block that grows from one character to six
 * lines shoves everything under it down the page. So the snippet is rendered
 * twice, stacked in one grid cell — a full-size copy holding the space open,
 * and the typed copy drawn over it. The block is its final size before the
 * first character lands.
 */

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { motion, useInView } from 'framer-motion';
import { useLessMotion } from '@/components/motion/primitives';

/** Characters per tick. Two is a typist, one is a teletype, and at this length
 *  a teletype outstays its welcome before the band has finished scrolling in. */
const PER_TICK = 2;
const TICK_MS = 16;

export default function ShipBand({ snippet }: { snippet: string }) {
  const reduce = useLessMotion();
  const codeRef = useRef<HTMLDivElement>(null);
  const inView = useInView(codeRef, { amount: 0.4, once: true });
  const [typed, setTyped] = useState(0);

  useEffect(() => {
    if (reduce) {
      setTyped(snippet.length);
      return;
    }
    if (!inView) return;
    let i = 0;
    const id = setInterval(() => {
      i += PER_TICK;
      setTyped(i);
      if (i >= snippet.length) clearInterval(id);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [inView, reduce, snippet]);

  const done = typed >= snippet.length;

  return (
    <section className="band tone-ink mb-20 grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
      <div>
        {/* Static. The kicker, the rule, the heading, the lede and the button
            each used to animate themselves into place on scroll, which is five
            separate arrivals for one paragraph of copy. The typing in the code
            block below is the only thing in this band that is actually showing
            you something, so it is the only thing left that moves. */}
        <div className="section-head">
          <span className="kicker">Shipping</span>
          <span className="section-rule" aria-hidden />
          <h2 className="display-sm">One line on your site, and it is live.</h2>
        </div>
        <p className="lede">
          Paste the script tag anywhere in your HTML. The bubble sits in the corner, loads on demand, and follows the
          colours you picked in the builder. Prefer no script at all? Take the hosted link or the iframe instead.
        </p>
        <div className="mt-8">
          <Link href="/create" className="btn-primary">
            Start building
          </Link>
        </div>
      </div>

      <div>
        <div ref={codeRef} className="codeblk shadow-lift-md">
          <div className="grid">
            {/* The spacer. It carries the real, complete snippet for anyone
                copying it or reading with JavaScript off — see the noscript
                rule on the page, which swaps the two. */}
            <pre className="tw-full invisible col-start-1 row-start-1 select-none" aria-hidden>
              {snippet}
            </pre>
            <pre className="tw-typed col-start-1 row-start-1">
              {snippet.slice(0, typed)}
              {!reduce && (
                <motion.span
                  aria-hidden
                  className="ml-px inline-block h-[1.05em] w-[7px] translate-y-[2px] bg-accent-400"
                  animate={{ opacity: done ? [1, 1, 0, 0] : 1 }}
                  transition={done ? { duration: 1.1, repeat: Infinity, times: [0, 0.45, 0.5, 1] } : { duration: 0 }}
                />
              )}
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}
