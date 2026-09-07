'use client';

/**
 * The numbered three-up.
 *
 * The cards lift on hover in CSS, and the numeral slides a few pixels with
 * them, so the thing carrying the visual weight is the thing that answers the
 * pointer first.
 *
 * There used to be a lamp here too — a radial glow tracking the cursor across
 * each card. It was removed on purpose. Whatever it once signalled, a
 * cursor-following gradient now reads as the house style of every generated
 * landing page on the internet, and a design this specific about its type and
 * its palette should not be wearing the one effect everybody recognises. The
 * hover lift does the same job without the tell.
 */

import { motion } from 'framer-motion';
import { EASE, useLessMotion } from '@/components/motion/primitives';

export type Pillar = readonly [string, string, string];

export default function Pillars({ pillars }: { pillars: readonly Pillar[] }) {
  const reduce = useLessMotion();

  return (
    <motion.section
      className="mb-20 grid gap-5 sm:grid-cols-3"
      initial={reduce ? undefined : 'rest'}
      whileInView={reduce ? undefined : 'run'}
      viewport={{ once: true, amount: 0.2 }}
      variants={{ run: { transition: { staggerChildren: 0.12, delayChildren: 0.05 } } }}
    >
      {pillars.map(([num, title, body]) => (
        <Card key={title} num={num} title={title} body={body} />
      ))}
    </motion.section>
  );
}

function Card({ num, title, body }: { num: string; title: string; body: string }) {
  const reduce = useLessMotion();

  const card = (
    <>
      <div className="relative">
        <motion.span
          className="numcard-n block"
          variants={{
            rest: { opacity: 0, y: 16 },
            run: { opacity: 1, y: 0, x: 0, transition: { duration: 0.8, ease: EASE } },
            // Inherited from the card's hover, not bound to the numeral: the
            // whole sheet is the hover target, and only the numeral answers.
            hover: { x: 7, transition: { duration: 0.45, ease: EASE } },
          }}
        >
          {num}
        </motion.span>
        <h3 className="mt-5 font-serif text-[22px] font-normal">{title}</h3>
        <p className="mt-3 text-[13.5px] font-light leading-[1.8] text-slate-700">{body}</p>
      </div>
    </>
  );

  if (reduce) return <div className="numcard">{card}</div>;

  return (
    <motion.div
      data-motion
      className="numcard"
      variants={{
        rest: { opacity: 0, y: 28 },
        run: { opacity: 1, y: 0, transition: { duration: 0.8, ease: EASE } },
        /* `.numcard:hover` lifts the sheet in CSS, but the moment this element
           is animated its transform is written inline, and an inline transform
           outranks the hover rule's. The lift is restated here so it survives;
           the shadow it pairs with is still the stylesheet's. */
        hover: { y: -4, transition: { duration: 0.3, ease: EASE } },
      }}
      whileHover="hover"
    >
      {card}
    </motion.div>
  );
}
