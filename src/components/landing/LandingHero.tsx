'use client';

/**
 * The landing hero, animated.
 *
 * The composition and the copy are unchanged — a fresco of a machine reaching
 * for the spark, with the one claim the product makes set over it. What is new
 * is depth: three layers that move at three speeds.
 *
 *   the painting  — swells as the page scrolls and drifts a few pixels toward
 *                   the cursor, so it sits behind the glass rather than on it
 *   the copy      — rises word by word on load, then lifts and blurs away as
 *                   the hero leaves, which is what hands the page to the mock
 *                   below instead of just scrolling past it
 *   the scroll cue— the only looping thing above the fold
 *
 * All three collapse to a still hero under `prefers-reduced-motion`; the
 * primitives handle that, and the two scroll transforms below are skipped
 * outright rather than merely shortened.
 */

import Link from 'next/link';
import { useCallback, useRef } from 'react';
import { motion, useMotionValue, useScroll, useSpring, useTransform } from 'framer-motion';
import HeroRobot from '@/components/landing/HeroRobot';
import { EASE, Magnetic, WordReveal, useLessMotion } from '@/components/motion/primitives';

/** The entrance stack. One parent so the beats stay in step even if the copy
 *  above a line changes length; the headline runs on its own word timer and is
 *  slotted into the same sequence by hand. */
const LIFT = {
  rest: { opacity: 0, y: 18 },
  run: { opacity: 1, y: 0, transition: { duration: 0.8, ease: EASE } },
};

export default function LandingHero() {
  const reduce = useLessMotion();
  const ref = useRef<HTMLElement>(null);

  /* Scroll-linked: measured across the hero's own exit, not the whole page, so
     the copy is gone by the time the chat mock overlaps it. */
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const artScale = useTransform(scrollYProgress, [0, 1], [1, 1.14]);
  const copyY = useTransform(scrollYProgress, [0, 0.85], [0, -130]);
  const copyFade = useTransform(scrollYProgress, [0, 0.62], [1, 0]);
  const copyBlur = useTransform(scrollYProgress, [0.15, 0.7], [0, 7]);
  const copyFilter = useTransform(copyBlur, (v) => `blur(${v}px)`);
  const cueFade = useTransform(scrollYProgress, [0, 0.12], [1, 0]);

  /* Pointer-linked: a few pixels of drift, sprung so it trails the cursor
     rather than snapping to it. Small on purpose — a painting that follows the
     mouse hard reads as a gimmick, one that lags reads as parallax. */
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const driftX = useSpring(px, { stiffness: 60, damping: 22, mass: 0.6 });
  const driftY = useSpring(py, { stiffness: 60, damping: 22, mass: 0.6 });

  const track = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType !== 'mouse') return;
      const box = e.currentTarget.getBoundingClientRect();
      px.set(((e.clientX - box.left) / box.width - 0.5) * -26);
      py.set(((e.clientY - box.top) / box.height - 0.5) * -14);
    },
    [px, py],
  );

  const settle = useCallback(() => {
    px.set(0);
    py.set(0);
  }, [px, py]);

  return (
    <section
      ref={ref}
      onPointerMove={reduce ? undefined : track}
      onPointerLeave={reduce ? undefined : settle}
      /* The heights are a budget, not a shape: the copy block is ~480px, and
         each step adds the air around it. The old rule grew the hero with the
         viewport (`52vw`), because the painting behind it was a fixed image
         that had to be wide enough to fill — which on a 1880px screen bought a
         978px hero to hold 480px of type, with a quarter of the page empty
         above the first word. The 3D scene frames itself from the aspect ratio
         instead, so the hero is free to be only as tall as its contents.

         The air is deliberately not symmetric. The section centres its copy,
         so every pixel of min-height over the copy block is split top and
         bottom — which is how the top came to hold 134px of nothing under the
         masthead. Each step is now sized so that padding, not slack, sets the
         gap, and the top padding is the smaller half: the bottom is where the
         robot stands and where the chat mock climbs into the frame, and the
         top is a gap between two cream surfaces with nothing in it.

         The base step is the exception and stays tall: a phone stacks the copy
         rather than setting it beside the robot, so the height there is the
         copy block PLUS a band underneath for the robot to stand in, not the
         copy block plus air. */
      className="hero-fresco min-h-[900px] px-6 pb-0 pt-14 sm:min-h-[560px] sm:px-12 sm:pb-24 sm:pt-14 lg:min-h-[620px] lg:pb-28 lg:pt-16 2xl:min-h-[660px]"
    >
      {/* The backdrop decides for itself whether it is the 3D scene or the
          painting; either way it owns the plate, including the parallax the
          scroll used to drive from out here. The scene reads the scroll on its
          own inside the render loop, and the painting keeps the swell it
          always had. */}
      <HeroRobot scrollScale={reduce ? undefined : artScale} drift={reduce ? undefined : { x: driftX, y: driftY }} />

      <motion.div
        className="mx-auto max-w-[760px]"
        style={reduce ? undefined : { y: copyY, opacity: copyFade, filter: copyFilter }}
      >
        <motion.div initial="rest" animate="run" variants={{ run: { transition: { staggerChildren: 0.12 } } }}>
          <motion.p
            variants={LIFT}
            className="mb-7 inline-flex items-center gap-3 text-[11px] font-medium uppercase tracking-label text-accent-800"
          >
            {/* The two rules draw themselves outward from the label rather than
                fading in with it — the one flourish the eyebrow gets. */}
            <motion.span
              className="h-px w-8 origin-right bg-accent-700/60"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.7, delay: 0.35, ease: EASE }}
              aria-hidden
            />
            No signup needed
            <motion.span
              className="h-px w-8 origin-left bg-accent-700/60"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.7, delay: 0.35, ease: EASE }}
              aria-hidden
            />
          </motion.p>

          <h1 className="display fresco-ink text-slate-900">
            <WordReveal
              delay={0.18}
              segments={[
                { text: 'Build a chatbot in about' },
                { text: 'two minutes.', className: 'italic text-accent-800' },
              ]}
            />
          </h1>

          <motion.p variants={LIFT} className="lede fresco-ink mx-auto mt-7 text-slate-700">
            Pick a model from any provider, paste in what it should know, choose how it talks. You get a hosted chat
            page, an iframe embed, and a one-line widget script.
          </motion.p>

          <motion.div variants={LIFT} className="mt-11 flex flex-col items-center gap-5">
            <Magnetic>
              <Link href="/create" className="btn-dark !rounded-full !px-9">
                Create a chatbot
              </Link>
            </Magnetic>
            <Link href="/account" className="link fresco-ink !text-accent-900">
              Log in
            </Link>
          </motion.div>

          <motion.p variants={LIFT} className="fresco-ink mt-9 text-[12px] font-light text-slate-700">
            10 free trial messages before you make an account. Keep the bot when you sign up.
          </motion.p>
        </motion.div>
      </motion.div>

      {/* A hint that there is a page under the painting. It fades out on the
          first scroll, so it never nags somebody who has already moved, and it
          is hidden on a phone, where at this height it would land on a robot's
          chest rather than under the copy. */}
      {!reduce && (
        <motion.div
          aria-hidden
          /* Left, not centred. The chat mock overlaps the hero's bottom edge by
             design, it is 560px wide and centred, and it sits a layer above —
             so a centred cue here is a pill nobody can see. The mock's own
             peek above the fold is the stronger invitation anyway; this is the
             quieter second one, out of its way. */
          className="pointer-events-none absolute bottom-8 left-6 hidden w-fit items-center gap-2.5 rounded-full border border-accent-700/25 bg-[#fdf7e9]/70 px-4 py-2 backdrop-blur-[2px] sm:left-12 sm:flex"
          style={{ opacity: cueFade }}
        >
          <motion.span
            className="block h-[5px] w-[5px] rounded-full bg-accent-700"
            animate={{ opacity: [0.25, 1, 0.25], y: [0, 2, 0] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
          />
          <span className="text-[10px] font-medium uppercase tracking-label text-accent-800">Scroll</span>
        </motion.div>
      )}

    </section>
  );
}
