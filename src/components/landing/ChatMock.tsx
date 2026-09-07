'use client';

/**
 * The chat mock, playing itself.
 *
 * It was a still: a finished conversation printed into the page. A still is a
 * claim; a conversation that types itself out is a demonstration, and this is
 * the only place on the landing page where a visitor sees the product before
 * signing up. So it now runs the exchange on a timer, in view, on a loop.
 *
 * Two things keep it from being annoying. Every bubble is in the DOM from the
 * start and only its opacity and offset animate, so the card never resizes and
 * the page under it never jumps. And the timer only runs while the card is on
 * screen, so a visitor who has scrolled past is not paying for an animation
 * nobody is watching.
 *
 * Decoration: everything it says is said in prose elsewhere on the page, which
 * is why the whole subtree stays hidden from assistive tech.
 */

import { useEffect, useRef, useState } from 'react';
import { motion, useInView, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { EASE, useLessMotion } from '@/components/motion/primitives';

/**
 * When each beat lands, in ms from the moment the card comes into view.
 *
 * The gaps are not uniform: a question follows an answer quickly, an answer
 * follows a question slowly, and the pause on the last typing indicator is the
 * longest of all — it is the beat that makes the loop feel like a conversation
 * that is still going rather than a reel that has run out.
 */
const TIMELINE = [0, 850, 1500, 3300, 4500, 5100];

/** The state the transcript rests in: every bubble shown, the shop still
 *  composing its answer to the last question. It is what the page used to
 *  print statically, and it is what a reduced-motion visitor gets. */
const SETTLED = TIMELINE.length;

/** How long the finished exchange holds before the board clears and it runs
 *  again. Long enough to read the whole thing twice. */
const HOLD = 3400;

export default function ChatMock() {
  const reduce = useLessMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.4 });

  const [step, setStep] = useState(0);

  useEffect(() => {
    /* Reduced motion gets the finished conversation, printed — exactly what
       the page carried before any of this. The preference only resolves after
       hydration, so this cannot be a lazy initial state. */
    if (reduce) {
      setStep(SETTLED);
      return;
    }
    if (!inView) return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const play = () => {
      // The loop re-enters this function forever; without emptying the list
      // first it would collect a fresh set of ids on every pass and never let
      // the spent ones go.
      timers.length = 0;
      setStep(0);
      TIMELINE.forEach((at, i) => {
        timers.push(
          setTimeout(() => {
            if (!cancelled) setStep(i + 1);
          }, at),
        );
      });
      // Clear, breathe, run it again.
      timers.push(setTimeout(play, TIMELINE[TIMELINE.length - 1] + HOLD));
    };

    play();
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [inView, reduce]);

  /* A card that tilts a couple of degrees toward the cursor. Enough to say the
     surface is a screen sitting in space, not enough to make the type inside
     it hard to read. */
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const spring = { stiffness: 130, damping: 18, mass: 0.5 };
  const rotateX = useSpring(useTransform(my, [-0.5, 0.5], [6, -6]), spring);
  const rotateY = useSpring(useTransform(mx, [-0.5, 0.5], [-8, 8]), spring);

  const shown = (n: number) => step >= n;
  /* The dots show while an answer is being composed — between the question
     landing and the reply arriving — and again on the open question the loop
     ends on. */
  const typing = step === 3 || step >= SETTLED;

  const bubble = {
    rest: { opacity: 0, y: 12, scale: 0.96 },
    run: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.5, ease: EASE } },
  };

  return (
    <motion.div
      ref={ref}
      aria-hidden
      className="relative z-20 mx-auto -mt-16 mb-16 max-w-[560px] sm:-mt-24"
      style={{ perspective: 1200 }}
      initial={reduce ? false : { opacity: 0, y: 60, rotateX: 12, scale: 0.94 }}
      whileInView={{ opacity: 1, y: 0, rotateX: 0, scale: 1 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 1, ease: EASE }}
      onPointerMove={(e) => {
        if (reduce || e.pointerType !== 'mouse') return;
        const box = e.currentTarget.getBoundingClientRect();
        mx.set((e.clientX - box.left) / box.width - 0.5);
        my.set((e.clientY - box.top) / box.height - 0.5);
      }}
      onPointerLeave={() => {
        mx.set(0);
        my.set(0);
      }}
    >
      <motion.div
        className="mock"
        style={reduce ? undefined : { rotateX, rotateY, transformStyle: 'preserve-3d' }}
      >
        <div className="mock-bar">
          <span className="mock-dot" />
          <span className="mock-dot" />
          <span className="mock-dot" />
          <span className="mock-url">wickandwax.com</span>
        </div>

        <div className="mock-body">
          <motion.div className="mock-row" variants={bubble} animate={shown(1) ? 'run' : 'rest'} initial="rest">
            <span className="mock-av">🕯️</span>
            <div>
              <p className="mock-bot">Hi! Ask me anything about our candles, shipping, or returns.</p>
            </div>
          </motion.div>

          <motion.p className="mock-user" variants={bubble} animate={shown(2) ? 'run' : 'rest'} initial="rest">
            Do you ship to Canada?
          </motion.p>

          <motion.div className="mock-row" variants={bubble} animate={shown(4) ? 'run' : 'rest'} initial="rest">
            <span className="mock-av">🕯️</span>
            <div>
              <p className="mock-bot">
                We do — 3–5 business days, and shipping is free over $50. Returns stay open for 30 days.
              </p>
              {/* The citation is the one detail that says this answer came out
                  of the shop's own file rather than out of the model, so it
                  arrives a beat after the sentence it is footnoting. */}
              <motion.span
                className="mock-cite"
                initial={{ opacity: 0, x: -6 }}
                animate={shown(4) ? { opacity: 1, x: 0 } : { opacity: 0, x: -6 }}
                transition={{ duration: 0.45, delay: shown(4) ? 0.35 : 0, ease: EASE }}
              >
                <motion.span
                  className="h-px w-3 origin-left bg-accent-500"
                  initial={{ scaleX: 0 }}
                  animate={shown(4) ? { scaleX: 1 } : { scaleX: 0 }}
                  transition={{ duration: 0.4, delay: shown(4) ? 0.5 : 0, ease: EASE }}
                />
                from shipping-policy.pdf
              </motion.span>
            </div>
          </motion.div>

          <motion.p className="mock-user" variants={bubble} animate={shown(5) ? 'run' : 'rest'} initial="rest">
            And returns?
          </motion.p>

          {/* Every row above stays in the DOM whether or not it is showing, and
              so does this one. Mounting bubbles as they arrive would grow the
              card mid-animation and shove the page under it; only opacity and
              offset move here, so the layout is settled before the first beat
              plays. */}
          <motion.div
            className="mock-row"
            initial={{ opacity: 0, y: 8 }}
            animate={typing ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
            transition={{ duration: 0.35, ease: EASE }}
          >
            <span className="mock-av">🕯️</span>
            <div className="mock-typing">
              <i />
              <i />
              <i />
            </div>
          </motion.div>
        </div>

        <div className="mock-foot">
          <span className="mock-input">Ask me anything…</span>
          {/* The send key answers each question the visitor "asks" — the small
              press that makes the transcript above look driven rather than
              replayed. */}
          <motion.span
            className="mock-send"
            animate={step === 2 || step === 5 ? { scale: [1, 0.86, 1] } : { scale: 1 }}
            transition={{ duration: 0.4, ease: EASE }}
          >
            ↑
          </motion.span>
        </div>
      </motion.div>
    </motion.div>
  );
}
