'use client';

/**
 * The last thing on the page: the same offer the hero made, restated to
 * somebody who has now read the whole thing.
 *
 * A closing band has one job — be noticed after a long scroll — so this is the
 * only surface that lights itself. A wide, soft sheen crosses the sand once
 * when the band arrives and then every several seconds, slow enough to read as
 * light moving across a wall rather than as a loading bar.
 */

import Link from 'next/link';
import { motion } from 'framer-motion';
import { Magnetic, Reveal, WordReveal, useLessMotion } from '@/components/motion/primitives';

export default function ClosingBand() {
  const reduce = useLessMotion();

  return (
    <section className="band tone-sand mt-20 text-center">
      {!reduce && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-white/45 to-transparent"
          initial={{ x: '0%' }}
          whileInView={{ x: ['0%', '400%'] }}
          viewport={{ once: false, amount: 0.4 }}
          transition={{ duration: 2.6, ease: 'easeInOut', repeat: Infinity, repeatDelay: 5.5 }}
        />
      )}

      <Reveal as="p" className="kicker mb-5 text-accent-800" y={14} duration={0.6}>
        Two minutes, no account
      </Reveal>

      <h2 className="display-sm mx-auto max-w-[18ch]">
        <WordReveal delay={0.12} segments={[{ text: 'Describe it once. Keep it when you sign up.' }]} />
      </h2>

      <Reveal className="mt-9" delay={0.35}>
        <Magnetic strength={0.35}>
          <Link href="/create" className="btn-dark">
            Create a chatbot
          </Link>
        </Magnetic>
      </Reveal>
    </section>
  );
}
