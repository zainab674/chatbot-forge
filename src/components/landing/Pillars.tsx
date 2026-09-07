'use client';

/**
 * The numbered three-up.
 *
 * The cards already lift on hover in CSS; what they never had was an arrival.
 * They now deal in from the left with a beat between them, and each one carries
 * a light that follows the cursor across it — a card lit from wherever the
 * pointer is reads as a sheet of paper under a lamp, which is the whole
 * conceit of the palette.
 *
 * The numeral gets its own treatment: it counts up out of nothing and slides a
 * few pixels when the card is hovered, so the thing carrying the visual weight
 * is also the thing that answers the pointer first.
 */

import { motion } from 'framer-motion';
import { EASE, useSpotlight, useLessMotion } from '@/components/motion/primitives';

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
  const spot = useSpotlight(300);

  const card = (
    <>
      {/* The lamp. It sits under the content and above the card's own fill, and
          `.numcard`'s `overflow-hidden` is what keeps it inside the corners. */}
      {spot.enabled && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={spot.style}
          transition={{ duration: 0.3 }}
        />
      )}
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
        <p className="mt-3 text-[13.5px] font-light leading-[1.8] text-slate-600">{body}</p>
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
      {...spot.handlers}
    >
      {card}
    </motion.div>
  );
}
