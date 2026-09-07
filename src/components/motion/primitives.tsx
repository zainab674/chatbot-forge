'use client';

/**
 * The motion vocabulary the landing page is written in.
 *
 * Everything here is a thin wrapper over Framer Motion that already knows two
 * things the rest of the app assumes: the site's one easing curve
 * (`cubic-bezier(.22,1,.36,1)` — fast out, long settle), and that a visitor who
 * has asked their OS for less motion gets the finished state immediately rather
 * than a shorter version of the animation. Every export below checks
 * `useLessMotion` and degrades to a plain element, which is why no
 * landing-page component has to remember to.
 *
 * The pieces are deliberately small and composable: a section is built by
 * nesting a Reveal inside a Parallax inside a Stagger, not by reaching for a
 * bespoke component per band.
 */

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from 'react';
import {
  motion,
  useMotionValue,
  useScroll,
  useSpring,
  useTransform,
  type Variants,
} from 'framer-motion';

/* ------------------------------------------------------------ reduced motion */

/** `useLayoutEffect` in the browser, `useEffect` on the server — the usual
 *  dance to keep React from warning about a layout effect during SSR. Exported
 *  because the hero needs to commit its choice of backdrop before the first
 *  paint, not after it. */
export const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * "Has this visitor asked for less motion?" — answered in a way that survives
 * hydration.
 *
 * Framer's own `useReducedMotion` reports the real answer on the very first
 * client render, which is a render the server has already produced with the
 * opposite answer: for a visitor who wants less motion, every wrapper here
 * would render different markup on the client than came down the wire, and
 * React would spend the first paint patching it. This one deliberately lies
 * for exactly one render — false, the same thing the server assumed — and
 * tells the truth in a layout effect, before the browser has painted.
 *
 * The gap that leaves is the pre-hydration paint, where a reduced-motion
 * visitor is looking at markup with `opacity: 0` on it. That is closed in CSS,
 * not here: `globals.css` forces every `[data-motion]` element to its finished
 * state under the same media query, with `!important` so it outranks the
 * inline styles Framer writes.
 */
export function useLessMotion() {
  const [less, setLess] = useState(false);

  useIsoLayoutEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setLess(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  return less;
}

/** The site's easing, as the cubic-bezier array Framer reads. */
export const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** Which element a wrapper renders as. Kept to the tags the page actually
 *  needs, so a `<section>` stays a `<section>` and the outline is not all divs. */
type Tag = 'div' | 'section' | 'span' | 'p' | 'li';

const TAGS = {
  div: motion.div,
  section: motion.section,
  span: motion.span,
  p: motion.p,
  li: motion.li,
} as const;

/** The tags a masked headline can be set as. Separate from `TAGS` because a
 *  headline is the one place the wrapper needs to be a heading element. */
const WORD_TAGS = {
  h1: motion.h1,
  h2: motion.h2,
  span: motion.span,
} as const;

/* ------------------------------------------------------------------ reveal */

/**
 * The workhorse: rises and un-blurs the first time it scrolls into view, then
 * stays put. Playing once is deliberate — a page where everything re-animates
 * on the way back up reads as broken rather than as alive.
 */
export function Reveal({
  children,
  className,
  style,
  delay = 0,
  y = 26,
  blur = false,
  duration = 0.85,
  amount = 0.25,
  as = 'div',
  ...rest
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  delay?: number;
  /** Distance travelled, in px. Negative drops in from above. */
  y?: number;
  /** Adds a focus-pull. Costs a filter repaint, so it is opt-in and reserved
   *  for small blocks of type rather than for whole sections. */
  blur?: boolean;
  duration?: number;
  /** How much of the element must be on screen before it plays. */
  amount?: number;
  as?: Tag;
  'aria-hidden'?: boolean;
}) {
  const reduce = useLessMotion();
  const El = TAGS[as];

  if (reduce) {
    return (
      <El className={className} style={style} {...rest}>
        {children}
      </El>
    );
  }

  return (
    <El
      data-motion
      className={className}
      style={style}
      initial={{ opacity: 0, y, filter: blur ? 'blur(8px)' : 'blur(0px)' }}
      whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      viewport={{ once: true, amount }}
      transition={{ duration, delay, ease: EASE }}
      {...rest}
    >
      {children}
    </El>
  );
}

/* ----------------------------------------------------------------- stagger */

/**
 * A parent that deals its children in one after another. Pair it with
 * `<StaggerItem>`; the timing lives on the parent so adding a card in the
 * middle of a list does not mean renumbering every delay after it.
 */
export function Stagger({
  children,
  className,
  gap = 0.09,
  delay = 0.05,
  amount = 0.25,
  as = 'div',
}: {
  children: ReactNode;
  className?: string;
  gap?: number;
  delay?: number;
  amount?: number;
  as?: Tag;
}) {
  const reduce = useLessMotion();
  const El = TAGS[as];

  if (reduce) return <El className={className}>{children}</El>;

  return (
    <El
      className={className}
      initial="rest"
      whileInView="run"
      viewport={{ once: true, amount }}
      variants={{ run: { transition: { staggerChildren: gap, delayChildren: delay } } }}
    >
      {children}
    </El>
  );
}

const ITEM: Variants = {
  rest: { opacity: 0, y: 24 },
  run: { opacity: 1, y: 0, transition: { duration: 0.75, ease: EASE } },
};

export function StaggerItem({
  children,
  className,
  as = 'div',
  variants = ITEM,
}: {
  children: ReactNode;
  className?: string;
  as?: Tag;
  variants?: Variants;
}) {
  const reduce = useLessMotion();
  const El = TAGS[as];

  if (reduce) return <El className={className}>{children}</El>;
  return (
    <El data-motion className={className} variants={variants}>
      {children}
    </El>
  );
}

/* ------------------------------------------------------------- word reveal */

/** One run of words that share a style — the italic half of a headline is its
 *  own segment, so it can carry its own class without breaking the stagger. */
export type Segment = { text: string; className?: string };

/**
 * A headline that comes up out of the floor, word by word, each behind its own
 * mask. The mask is the whole trick: without `overflow-hidden` per word the
 * line slides instead of rising, and it stops reading as type being set.
 *
 * The padding/negative-margin pair on the mask is there so descenders — the y
 * in "minutes" — are not sheared off by the very clip that makes it work.
 *
 * The `whileInView` sits on the wrapper, not on the words, and that placement
 * is load-bearing. A word starts translated fully below its own mask, and an
 * IntersectionObserver honours the ancestor's `overflow: hidden` — so a word
 * watching for itself is watching something clipped to nothing, reports zero
 * every time, and never plays. Framer's variant context reaches the words
 * through the plain mask spans, so the wrapper can see the viewport on their
 * behalf and hand each of them its own delay.
 */
export function WordReveal({
  segments,
  className,
  delay = 0,
  gap = 0.055,
  as = 'span',
}: {
  segments: Segment[];
  className?: string;
  delay?: number;
  gap?: number;
  as?: 'h1' | 'h2' | 'span';
}) {
  const reduce = useLessMotion();

  const words = segments.flatMap((seg, si) =>
    seg.text
      .split(/\s+/)
      .filter(Boolean)
      .map((word, wi) => ({ word, className: seg.className, key: `${si}-${wi}` })),
  );

  if (reduce) {
    const Plain = as;
    return (
      <Plain className={className}>
        {segments.map((seg, i) => (
          <span key={i} className={seg.className}>
            {i > 0 ? ' ' : ''}
            {seg.text}
          </span>
        ))}
      </Plain>
    );
  }

  const Wrapper = WORD_TAGS[as];

  return (
    <Wrapper className={className} initial="rest" whileInView="run" viewport={{ once: true, amount: 0.2 }}>
      {words.map((w, i) => (
        <Fragment key={w.key}>
          {/* The mask. `align-bottom` keeps a line of these sitting on one
              baseline once each of them is an inline-block. */}
          <span className="inline-block overflow-hidden align-bottom pb-[0.18em] [margin-bottom:-0.18em]">
            <motion.span
              data-motion
              className={`inline-block ${w.className ?? ''}`}
              variants={{
                rest: { y: '118%' },
                run: { y: '0%', transition: { duration: 0.95, delay: delay + i * gap, ease: EASE } },
              }}
            >
              {w.word}
            </motion.span>
          </span>
          {i < words.length - 1 ? ' ' : null}
        </Fragment>
      ))}
    </Wrapper>
  );
}

/* --------------------------------------------------------------- parallax */

/**
 * Moves its children against the scroll so the layer reads as further away.
 * `distance` is half the total travel in px across the element's pass through
 * the viewport; positive lags behind the page, negative runs ahead of it.
 */
export function Parallax({
  children,
  className,
  distance = 60,
}: {
  children: ReactNode;
  className?: string;
  distance?: number;
}) {
  const reduce = useLessMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const raw = useTransform(scrollYProgress, [0, 1], [distance, -distance]);
  const y = useSpring(raw, { stiffness: 120, damping: 26, mass: 0.35 });

  if (reduce) {
    return <div className={className}>{children}</div>;
  }

  return (
    <div ref={ref} className={className}>
      <motion.div style={{ y }}>{children}</motion.div>
    </div>
  );
}

/* --------------------------------------------------------------- magnetic */

/**
 * A control that leans toward the cursor and springs back when it leaves. It
 * is used on the calls to action only: it is a strong signal, and a page where
 * every link does it feels like a fairground.
 */
export function Magnetic({
  children,
  className,
  strength = 0.3,
}: {
  children: ReactNode;
  className?: string;
  strength?: number;
}) {
  const reduce = useLessMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const spring = { stiffness: 260, damping: 20, mass: 0.4 };
  const sx = useSpring(x, spring);
  const sy = useSpring(y, spring);

  const track = useCallback(
    (e: PointerEvent<HTMLSpanElement>) => {
      const box = ref.current?.getBoundingClientRect();
      if (!box) return;
      x.set((e.clientX - (box.left + box.width / 2)) * strength);
      y.set((e.clientY - (box.top + box.height / 2)) * strength);
    },
    [strength, x, y],
  );

  const release = useCallback(() => {
    x.set(0);
    y.set(0);
  }, [x, y]);

  if (reduce) return <span className={`inline-block ${className ?? ''}`}>{children}</span>;

  return (
    <motion.span
      ref={ref}
      className={`inline-block ${className ?? ''}`}
      style={{ x: sx, y: sy }}
      onPointerMove={track}
      onPointerLeave={release}
      onPointerCancel={release}
      whileHover={{ scale: 1.045 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: 'spring', ...spring }}
    >
      {children}
    </motion.span>
  );
}

/* --------------------------------------------------------- scroll progress */

/** A hairline of bronze across the top of the window that fills as the page
 *  does. The only thing on the page that reports state rather than decorates. */
export function ScrollProgress() {
  const reduce = useLessMotion();
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 140, damping: 26, mass: 0.3 });

  if (reduce) return null;

  return (
    <motion.div
      aria-hidden
      className="fixed inset-x-0 top-0 z-[60] h-[2px] origin-left bg-gradient-to-r from-accent-400 via-accent-600 to-accent-800"
      style={{ scaleX }}
    />
  );
}
