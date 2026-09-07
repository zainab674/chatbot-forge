'use client';

/**
 * The floating dock: a call to action that follows the visitor down the page.
 *
 * The masthead's "New bot" button scrolls away with the masthead, so from the
 * three-up onward there is nothing on screen to act on until the closing band
 * at the very bottom. This is that missing thing — a glass pill that rises once
 * the hero is behind you and then stays.
 *
 * It sits under the header's z-index rather than over it, so the mobile menu
 * sheet still wins if the two ever meet, and it is a real `<nav>` with real
 * links rather than a decorative flourish: it duplicates two destinations the
 * page already offers, which is the point.
 */

import Link from 'next/link';
import { useState } from 'react';
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from 'framer-motion';
import { EASE, Magnetic, useLessMotion } from '@/components/motion/primitives';

/** Roughly the point where the hero's own call to action has left the screen.
 *  Deliberately a scroll distance and not an observer on the hero: the hero is
 *  a different height at every breakpoint, and this only has to be about right. */
const SHOW_AFTER = 620;

export default function Dock() {
  const reduce = useLessMotion();
  const { scrollY } = useScroll();
  const [past, setPast] = useState(false);

  useMotionValueEvent(scrollY, 'change', (y) => setPast(y > SHOW_AFTER));

  return (
    <nav
      aria-label="Quick actions"
      className="pointer-events-none fixed inset-x-0 bottom-5 z-30 flex justify-center px-4 sm:bottom-7"
    >
      {/* Mounted only while it is on screen. Hiding it with opacity alone
          would leave three links in the tab order that nobody can see, and
          `inert` is not available on this React version. */}
      <AnimatePresence>
        {past && (
          <motion.div
            className="pointer-events-auto flex items-center gap-2 rounded-full border border-slate-200/70 bg-[#f4f0e8]/85 p-2 shadow-lift-lg backdrop-blur-xl"
            initial={{ opacity: 0, y: 26, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.96 }}
            transition={reduce ? { duration: 0.15 } : { duration: 0.55, ease: EASE }}
          >
            <Link
              href="/"
              aria-label="Chatbot Forge home"
              className="grid h-9 w-9 flex-none place-items-center rounded-full bg-slate-900 font-serif text-[13px] text-white transition duration-200 ease-editorial hover:bg-slate-700"
            >
              F
            </Link>

            <Magnetic strength={0.22}>
              <Link href="/create" className="btn-dark !rounded-full !px-7 !py-3">
                Create a chatbot
              </Link>
            </Magnetic>

            <Link
              href="/account"
              className="rounded-full px-4 py-2 text-[10.5px] font-medium uppercase tracking-label text-slate-600 transition duration-200 ease-editorial hover:text-slate-900"
            >
              Log in
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}
