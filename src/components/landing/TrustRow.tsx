'use client';

/**
 * The provider row under the hero. Names only, tracked out — proof that the
 * "any model" line is a fact and not a slogan.
 *
 * The animation is the smallest one on the page on purpose: the row is
 * evidence, and evidence that performs is less convincing. The names deal in
 * one at a time, the two rules draw themselves across, and hovering a name
 * lifts it a pixel. That is all.
 */

import { motion } from 'framer-motion';
import { EASE, useLessMotion } from '@/components/motion/primitives';

export default function TrustRow({ providers }: { providers: readonly string[] }) {
  const reduce = useLessMotion();

  if (reduce) {
    return (
      <section className="trust mb-16">
        <span className="text-[10.5px] font-medium uppercase tracking-label text-slate-500">Runs on</span>
        {providers.map((p) => (
          <b key={p}>{p}</b>
        ))}
      </section>
    );
  }

  return (
    <motion.section
      /* The border is drawn by `.trust` itself, so it cannot be animated from
         here — the row scales its own contents in instead and lets the rules
         arrive with them. */
      className="trust mb-16"
      initial="rest"
      whileInView="run"
      viewport={{ once: true, amount: 0.6 }}
      variants={{ run: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } } }}
    >
      <motion.span
        className="text-[10.5px] font-medium uppercase tracking-label text-slate-500"
        variants={{ rest: { opacity: 0, y: 8 }, run: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } } }}
      >
        Runs on
      </motion.span>
      {providers.map((p) => (
        <motion.span
          key={p}
          data-motion
          variants={{
            rest: { opacity: 0, y: 10 },
            run: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } },
          }}
          whileHover={{ y: -2 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        >
          <b>{p}</b>
        </motion.span>
      ))}
    </motion.section>
  );
}
