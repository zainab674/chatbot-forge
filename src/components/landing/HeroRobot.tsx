'use client';

/**
 * The hero's backdrop, and the decision about which backdrop it is.
 *
 * Three things can fill this space: the 3D scene, the painted fresco, or
 * nothing at all — the plate's own cream gradient, which is also the scene's
 * sky and floor colour. Which one you get, and in what order, is the whole job
 * of this file.
 *
 * The rule it follows is: never show one finished artwork and then replace it
 * with a different finished artwork. An earlier pass did exactly that — the
 * server sent the fresco, it painted, and about a second later the robot faded
 * in over the top of it. Two paintings in a row reads as a mistake, no matter
 * how smooth the crossfade is. So the fresco is no longer the thing that fills
 * the gap while the scene loads; the gap is filled by the gradient, which is
 * not a picture and so cannot look like the wrong one.
 *
 * The order of events on a normal visit:
 *
 *   1. the server sends the plate's gradient and no artwork at all
 *   2. this module is evaluated, tests for WebGL, and — if it is there — starts
 *      fetching the scene's chunk immediately, in parallel with hydration
 *   3. a layout effect commits the decision before the first paint
 *   4. the canvas reports its first frame and fades up out of the gradient
 *
 * The fresco is still here, and still the answer whenever the scene is not:
 * no WebGL, a driver that refuses the context, a chunk that never arrives, a
 * scene that throws. It also covers JavaScript being off entirely — the page's
 * `<noscript>` block forces `.hero-poster` visible, which is why the poster is
 * always in the markup even when it is not being shown.
 *
 * Asking for less motion is deliberately NOT one of the fallback cases. The
 * preference is a request to stop things moving, not a request for different
 * art. So the robot still renders — it simply holds still: the scene draws one
 * frame and then stops, and nothing bobs, blinks, or follows the cursor.
 */

import dynamic from 'next/dynamic';
import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { motion, type MotionValue } from 'framer-motion';
import HeroFresco from '@/components/HeroFresco';
import { EASE, useIsoLayoutEffect, useLessMotion } from '@/components/motion/primitives';

/** Kept out of the page's bundle: three.js and the scene are a chunk of their
 *  own. `ssr: false` because there is no WebGL context on a server. */
const RobotScene = dynamic(() => import('./robot/RobotScene'), { ssr: false });

/** Can this browser give us a context at all? Cheap, synchronous, and the only
 *  reliable answer — a browser can advertise `WebGLRenderingContext` and still
 *  refuse the context on a blocklisted driver. The context is handed straight
 *  back afterwards; asking the question should not cost a GPU allocation for
 *  the life of the page. */
function probeWebGL() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return false;
    (gl.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/**
 * Is this visitor on a connection where a 165 kB chunk is a reasonable thing to
 * ask for? `saveData` is an explicit request not to, and the slow effective
 * types are a good enough proxy for the rest. Both are advisory and both are
 * missing in Safari, where the answer is simply yes.
 */
function worthTheDownload() {
  const c = (navigator as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (!c) return true;
  if (c.saveData) return false;
  return c.effectiveType !== 'slow-2g' && c.effectiveType !== '2g';
}

/**
 * Answered once, at module evaluation, rather than once per mount — and on the
 * client only, so the server is never asked a question about a GPU.
 *
 * Doing it this early is the point: the chunk's download is the long pole in
 * getting the robot on screen, and starting it here means it overlaps hydration
 * instead of queueing up behind it. Waiting for an effect cost most of the gap
 * this file exists to close.
 */
const CAN_RENDER_3D = typeof window !== 'undefined' && worthTheDownload() && probeWebGL();

/* The preload is a hint and nothing more, so its failure must be swallowed
   here. Without the catch a blocked or missing chunk becomes an unhandled
   rejection in the console — and it is not even the copy of the failure that
   matters, because `next/dynamic` will ask for the same chunk again and that
   one is caught by the boundary below and turned into the fresco. */
if (CAN_RENDER_3D) void import('./robot/RobotScene').catch(() => {});

/**
 * Which backdrop is on screen.
 *
 * `deciding` is the state the server renders and the client's first pass
 * repeats, so the two agree; it shows the gradient and nothing else.
 * `poster` means 3D has been *ruled out* — no WebGL, a connection that asked us
 * not to, or the scene threw on the way up.
 *
 * It used to mean one more thing, and that was a bug worth naming. A timer gave
 * the scene 2.5 seconds and then switched this to `poster`, which unmounts the
 * canvas below — and nothing ever switched it back. So a chunk that arrived at
 * 2.6 seconds was thrown away half-downloaded and the visitor got the painting
 * for good. The rule it was enforcing ("one artwork per visit, never two") is
 * what cost the feature: in development the chunk never once beat the timer, so
 * the hero was a static SVG every single time.
 *
 * The poster now covers the wait instead of ending it. It holds the space until
 * the scene has actually drawn a frame, then crosses to it slowly enough not to
 * snatch away something the visitor is already looking at.
 */
type Mode = 'deciding' | 'scene' | 'poster';

export default function HeroRobot({
  scrollScale,
  drift,
}: {
  /** The swell the painted hero has always had on scroll. It is applied to the
   *  poster only — the 3D scene answers the scroll from inside its own render
   *  loop, where it can move the camera and the rig separately. */
  scrollScale?: MotionValue<number>;
  /** Pointer drift, likewise: the painting slides, the scene turns its head. */
  drift?: { x: MotionValue<number>; y: MotionValue<number> };
}) {
  const reduce = useLessMotion();
  const wrap = useRef<HTMLDivElement>(null);

  const [mode, setMode] = useState<Mode>('deciding');
  /** Whether the canvas has drawn. Until it has, the gradient is what is on
   *  screen, and fading the scene up before it has anything in it would show a
   *  transparent rectangle. */
  const [painted, setPainted] = useState(false);
  /** Whether the hero is on screen and the tab is in front. The scene's render
   *  loop is stopped otherwise — an idle animated canvas is the most expensive
   *  thing a landing page can leave running. */
  const [active, setActive] = useState(true);

  /* A layout effect, not a plain one: it commits before the browser paints, so
     the decision is on screen in the first frame the visitor sees rather than
     in the one after it. */
  useIsoLayoutEffect(() => {
    setMode(CAN_RENDER_3D ? 'scene' : 'poster');
  }, []);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;

    let onScreen = true;
    const sync = () => setActive(onScreen && document.visibilityState === 'visible');

    const io = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry.isIntersecting;
        sync();
      },
      { rootMargin: '120px' },
    );
    io.observe(el);
    document.addEventListener('visibilitychange', sync);

    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);

  return (
    <div ref={wrap} className="fresco-plate" aria-hidden>
      {/* The poster. Present in the markup at every stage — the page's
          `<noscript>` rule reveals it when there is no JavaScript to decide
          anything — but only actually shown once the scene has been ruled out.
          It fades in rather than appearing, because on a slow connection the
          ruling can land after the gradient is already on screen. */}
      {/* Shown from the moment 3D is ruled out *or* while the scene is still on
          its way, and taken away only once the canvas has really drawn. */}
      <motion.div
        className="hero-poster absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: mode !== 'deciding' && !painted ? 1 : 0 }}
        style={
          scrollScale
            ? { scale: scrollScale, x: drift?.x, y: drift?.y, transformOrigin: '50% 100%' }
            : undefined
        }
        transition={{ duration: reduce ? 0.2 : 0.5, ease: EASE }}
      >
        <HeroFresco />
      </motion.div>

      {mode === 'scene' && (
        <SceneBoundary onError={() => setMode('poster')}>
          <motion.div
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: painted ? 1 : 0 }}
            transition={{ duration: reduce ? 0.2 : 0.9, ease: EASE }}
          >
            <RobotScene active={active} still={reduce} onPainted={() => setPainted(true)} />
          </motion.div>
        </SceneBoundary>
      )}
    </div>
  );
}

/**
 * Catches anything the scene throws on the way up — a lost context, a driver
 * that dies mid-frame, a chunk that arrives corrupt — and tells the hero to go
 * back to the painting rather than taking the page down with it.
 */
class SceneBoundary extends Component<{ children: ReactNode; onError: () => void }, { dead: boolean }> {
  state = { dead: false };

  static getDerivedStateFromError() {
    return { dead: true };
  }

  componentDidCatch() {
    this.props.onError();
  }

  render() {
    return this.state.dead ? null : this.props.children;
  }
}
