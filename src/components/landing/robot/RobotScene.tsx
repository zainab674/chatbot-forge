'use client';

/**
 * The hero's 3D scene: one robot, a hazy floor, and a skyline of block towers
 * fading into the distance.
 *
 * It replaces the painted fresco that used to fill this space, and it inherits
 * two things from it deliberately — the light comes from the upper left, and
 * the far distance fades to `#f7eed9`, which is the exact colour the CSS
 * gradient behind the canvas ends on. Those two facts are what let a WebGL
 * canvas sit inside a cream editorial page without looking pasted on.
 *
 * Everything here is drawn from primitives and lit with three lights; there is
 * no model to download and no environment map to fetch, so the whole scene is
 * the JavaScript and nothing else. It is decorative, and the hero hides it from
 * assistive tech.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import { CanvasTexture, type Group, type Texture } from 'three';
import Robot from './Robot';
import { C } from './palette';

/**
 * The studio rig, and the reason the metal reads as metal.
 *
 * A `meshStandardMaterial` with `metalness: 0.5` and no environment map has
 * nothing to reflect, so it renders as flat mud — which is exactly what the
 * brass and bronze on this robot were doing. Physically based metal is almost
 * entirely reflection; without an environment there is no such thing as a
 * polished surface, only a grey one.
 *
 * These lightformers are the environment. They are shapes rendered into a small
 * cube map rather than an HDRI file, which matters twice over: nothing is
 * downloaded, and nothing is *fetched* — the page's Content-Security-Policy
 * pins `connect-src` to 'self', so drei's built-in presets (which pull an .hdr
 * from a CDN) would be blocked outright.
 *
 * The arrangement is an ordinary product-shot rig: a broad softbox overhead for
 * the long highlight down the shell, a warm fill on the key side, a tight cool
 * strip behind for the rim that separates the silhouette from the cream page,
 * and two small streaks that give curved metal something with structure to
 * catch. `frames={1}` bakes it once — nothing in it ever moves.
 */
function StudioRig() {
  return (
    <Environment resolution={256} frames={1}>
      {/* Overhead softbox: the primary highlight running down the shell. */}
      <Lightformer form="rect" intensity={3.4} color="#fff6e2" position={[0, 5, 1]} scale={[9, 5, 1]} rotation={[-Math.PI / 2, 0, 0]} />
      {/* Warm key fill from the upper left, matching the page's light. */}
      <Lightformer form="rect" intensity={3.2} color="#ffe9c4" position={[-5, 3, 3]} scale={[6, 6, 1]} rotation={[0, -Math.PI / 4, 0]} />
      {/* Cool rim from behind, so the silhouette lifts off a cream background. */}
      <Lightformer form="rect" intensity={2.4} color="#ffffff" position={[3, 2.5, -5]} scale={[5, 5, 1]} rotation={[0, Math.PI, 0]} />
      {/* Bounce off the floor — keeps undersides bronze rather than dead. */}
      <Lightformer form="rect" intensity={1.1} color={C.brass} position={[2, -2, 2]} scale={[7, 3, 1]} rotation={[Math.PI / 2, 0, 0]} />
      {/* Two thin streaks. Curved metal needs *structure* to reflect; a flat
          wash of light reads as plastic no matter how high the metalness. */}
      <Lightformer form="ring" intensity={2.6} color="#ffffff" position={[-2.5, 1.6, 3.5]} scale={[2, 2, 1]} />
      <Lightformer form="ring" intensity={1.8} color={C.brassLit} position={[2.8, 0.9, 3]} scale={[1.4, 1.4, 1]} />
    </Environment>
  );
}

/** The block towers on the horizon. Fixed rather than random so the scene is
 *  the same every visit — and confined to the outer thirds, because a tower
 *  behind the headline reads as a smudge on the type no matter how far into the
 *  fog it is. Each is [x, z, height, width, tint]. */
const TOWERS: [number, number, number, number, number][] = [
  [-7.2, -9, 2.4, 0.9, 0],
  [-9.8, -11, 1.6, 1.2, 1],
  [-5.9, -13, 3.2, 1.0, 1],
  [-12.4, -14, 2.0, 1.4, 0],
  [12.0, -12, 2.2, 1.2, 1],
];

/** Loose bricks scattered on the floor — the debris the reference has its robot
 *  building out of. [x, z, rotation]. */
const BRICKS: [number, number, number][] = [
  [2.6, 1.9, 0.4],
  [3.9, 2.9, -0.9],
  [6.1, 1.4, 0.2],
  [-3.9, 2.6, 1.1],
  [-2.4, 3.6, -0.3],
];

/** The world half-height the camera sees at the robot's depth: the tangent of
 *  half the vertical field of view, times the distance to the robot. Recompute
 *  it if the camera's `fov` or `position` below ever change. */
const HALF_W = Math.tan((34 * Math.PI) / 360) * 8.6;

export default function RobotScene({
  active = true,
  still = false,
  onPainted,
}: {
  active?: boolean;
  /** The visitor has asked for less motion. The scene is still drawn — one
   *  frame of it — and then the loop stops for good. */
  still?: boolean;
  /** Fired once the renderer exists and the first frame is on its way, which is
   *  the hero's cue that it can take the poster away. */
  onPainted?: () => void;
}) {
  return (
    <Canvas
      // Transparent, so the plate's gradient is the sky and the canvas only
      // adds what is standing in front of it.
      gl={{ alpha: true, antialias: true }}
      /* Capped at 1.5 rather than 1.75. Every one of these pixels is paid for
         three times over — the scene, the bloom's downsample chain, and the
         composite — and on a 2x display the difference between the two is
         about a quarter of the fill rate for a soft, hazy scene where nobody
         can see the extra samples. */
      dpr={[1, 1.5]}
      // Rendering a scene nobody is looking at is the most expensive thing this
      // page could do; the hero stops the loop the moment it scrolls away.
      /* The loop runs whenever the hero is on screen, including under reduced
         motion — see the note in Robot.tsx: that mode still breathes and
         blinks, it simply never travels. `never` parks it the moment the hero
         scrolls away, which is the expensive case worth caring about. */
      frameloop={active ? 'always' : 'never'}
      camera={{ position: [0, 1.5, 8.6], fov: 34, near: 0.1, far: 60 }}
      shadows={false}
      onCreated={({ gl }) => {
        // One frame is requested before this returns, so by the time the hero
        // reacts there is something to cross-fade to.
        gl.setClearAlpha(0);
        onPainted?.();
      }}
    >
      {/* Pushed back off the robot. At 7 the fog started biting at roughly the
          robot's own depth, which is what bleached it into the background —
          the haze is meant to eat the skyline, not the subject. */}
      <fog attach="fog" args={[C.haze, 13, 30]} />

      {/* The reflections. Everything metal in this scene is lit by this and not
          by the directionals below — see the note on StudioRig. */}
      <StudioRig />

      {/* The directionals survive alongside it for the things an environment
          map is bad at: a crisp key direction, and a definite shadow side.
          Turned down from what they were, because they are no longer carrying
          the whole scene on their own. */}
      <ambientLight intensity={0.18} color={C.haze} />
      <directionalLight position={[-5, 7, 5]} intensity={1.7} color={'#fff6e2'} />
      {/* The bounce off the cream floor, which is what keeps the shadowed side
          bronze instead of grey. */}
      <directionalLight position={[6, 1, 3]} intensity={0.5} color={C.brass} />
      {/* A rim from behind picks the shell's silhouette off the sky. */}
      <directionalLight position={[1, 4, -6]} intensity={0.7} color={'#ffffff'} />

      <Stage still={still} />

      {/* Bloom, and only on the genuinely bright things. The threshold sits
          above the cream shell on purpose: drop it and the whole robot hazes
          over, which is the difference between a lit lamp and a soft-focus
          filter. What blooms is the eyes, the antenna tip and the screen —
          the three surfaces with an emissive above 1. */}
      <EffectComposer multisampling={0} enableNormalPass={false}>
        <Bloom mipmapBlur intensity={0.5} luminanceThreshold={1.25} luminanceSmoothing={0.2} radius={0.6} />
      </EffectComposer>
    </Canvas>
  );
}

/**
 * Everything inside the canvas that has to know how big the canvas is: the
 * framing, the pointer, and the scroll.
 */
function Stage({ still }: { still: boolean }) {
  const group = useRef<Group>(null);
  const { size } = useThree();

  /* The robot is framed against the lower part of a hero whose height and
     aspect change a lot between a phone and a wide desktop. Rather than fight
     that with media queries outside the canvas, the whole rig is scaled and
     dropped by how wide the frame is. */
  const { scale, y, aim, bots } = useMemo(() => {
    const aspect = size.width / Math.max(1, size.height);

    /* How far out "the margin" is depends on how wide the frame is in world
       units, not in pixels — the camera's field of view is vertical, so a
       viewport that is merely taller makes everything bigger and pushes a fixed
       offset off the edge. HALF_W is the world half-width at the robots' depth
       for a square frame; scaling it by the aspect gives this frame's. */
    const halfW = HALF_W * aspect;

    /* The copy is centred and runs to a 760px measure, so the robots cannot be.
       Every lane is anchored out in the margin beside it, which is the
       composition the painted hero used — figures at the sides, copy in the gap
       between them — and the roaming radii are picked to keep them there. A
       robot that wanders under the headline is not charming, it is a
       legibility bug.

       How many depends on the room available. A portrait phone gets one,
       because there is no margin to roam in and three would be a traffic jam
       behind the text. */
    if (aspect < 0.8) {
      return {
        scale: 0.56,
        y: -3.95,
        aim: 0,
        // Centred below the copy rather than beside it, so it is the one lane
        // that can sway both ways without threatening anything.
        bots: [{ key: 'solo', cx: 0, cz: 0, rx: 0.9, rz: 0.4, dir: 0 as const, w: 0.26, ph: 0, s: 1, simple: false }],
      };
    }

    if (aspect < 1.2) {
      const aim = 0.4;
      const margin = (aim + halfW * 0.55) / 0.6;
      return {
        scale: 0.6,
        y: -2.7,
        aim,
        bots: [
          { key: 'lead', cx: margin, cz: 0, rx: 0.8, rz: 0.5, dir: 1 as const, w: 0.24, ph: 0, s: 1, simple: false },
          { key: 'far', cx: -margin * 1.05, cz: -3.2, rx: 1.5, rz: 0.7, dir: -1 as const, w: 0.19, ph: 3.1, s: 0.6, simple: true },
        ],
      };
    }

    const scale = aspect < 1.75 ? 0.72 : 0.8;
    const aim = 0.35;
    const margin = (aim + halfW * 0.62) / scale;

    return {
      scale,
      y: -2.15,
      aim,
      bots: [
        // The lead: nearest the camera, full detail, the one the eye lands on.
        { key: 'lead', cx: margin, cz: 0, rx: 0.85, rz: 0.55, dir: 1 as const, w: 0.23, ph: 0, s: 1, simple: false },
        // Two more on the far side, stacked in depth — smaller, further out,
        // on slower and wider loops so the group never falls into step. Both
        // draw the cheap variant; at this size and this far into the haze,
        // nobody is counting their arm segments.
        //
        { key: 'left', cx: -margin * 1.06, cz: -3.6, rx: 1.3, rz: 0.8, dir: -1 as const, w: 0.17, ph: 2.4, s: 0.55, simple: true },
        { key: 'back', cx: -margin * 1.5, cz: -6.4, rx: 1.6, rz: 1.0, dir: -1 as const, w: 0.13, ph: 4.8, s: 0.4, simple: true },
      ],
    };
  }, [size.width, size.height]);

  /* Pointer, smoothed. Tracked on the window rather than on the canvas: the
     canvas sits under a `pointer-events: none` plate so that the hero's own
     links stay clickable, which means it never receives a pointer event of its
     own. */
  const look = useRef({ x: 0, y: 0 });
  const target = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (still) return;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      target.current.x = (e.clientX / window.innerWidth - 0.5) * 2;
      // Only the top of the window is the hero, so the vertical range is
      // measured against that rather than against the whole page.
      target.current.y = Math.max(-1, Math.min(1, (e.clientY / window.innerHeight - 0.35) * 2));
    };
    const onLeave = () => {
      target.current.x = 0;
      target.current.y = 0;
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerout', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerout', onLeave);
    };
  }, [still]);

  useFrame((state, delta) => {
    const d = Math.min(delta, 1 / 30);

    if (!still) {
      look.current.x += (target.current.x - look.current.x) * Math.min(1, d * 2.6);
      look.current.y += (target.current.y - look.current.y) * Math.min(1, d * 2.6);
    }

    /* Scroll: the rig sinks and recedes as the hero leaves, the same gesture
       the painted version made when it swelled. Reading `scrollY` per frame is
       cheap — it is a cached value, not a forced reflow. */
    const p = still ? 0 : Math.min(1, window.scrollY / Math.max(1, window.innerHeight));
    if (group.current) {
      group.current.position.y = y - p * 1.6;
      group.current.position.z = -p * 3.4;
      group.current.rotation.y = p * 0.5;
    }

    // A hair of camera drift, opposite the pointer, so the whole frame has
    // parallax rather than just the character in it.
    if (!still) {
      state.camera.position.x += (look.current.x * -0.55 - state.camera.position.x) * Math.min(1, d * 1.8);
    }
    /* Deliberately outside the guard: in `still` mode this runs exactly once,
       on the single frame the scene draws, and it is what aims the camera at
       the robot. Skip it and the still frame is a shot of empty floor. */
    state.camera.lookAt(aim, 1.15 + y * scale, 0);
  });

  return (
    <group ref={group} position={[0, y, 0]} scale={scale}>
      {/* The robots. The floor and the skyline stay put, so driving these
          around does not drag the horizon with them. */}
      {bots.map((lane) => (
        <RoamingBot key={lane.key} lane={lane} look={look.current} still={still} />
      ))}

      {/* The floor. Far larger than the fog can reach, so it dissolves into the
          haze long before its own edge could come into frame — which is what
          gives the horizon no line to draw. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial color={C.floor} roughness={0.95} metalness={0} />
      </mesh>

      {/* The contact shadow does the job a shadow map would, for a fraction of
          the cost, and is softer than a shadow map at this scale anyway. */}
      {/* `frames` matters more than it looks. Left at its default the shadow
          re-renders every tick and asks for another frame each time, which
          quietly holds the on-demand loop open forever — so a "still" scene
          would keep the GPU busy for as long as the page is on screen. One
          frame is all a shadow under a robot that never moves needs. */}

      {TOWERS.map(([x, z, h, w, tint], i) => (
        <Tower key={i} x={x} z={z} h={h} w={w} tint={tint} />
      ))}

      {BRICKS.map(([x, z, r], i) => (
        <mesh key={i} position={[x, 0.075, z]} rotation={[0, r, 0]}>
          <boxGeometry args={[0.62, 0.15, 0.24]} />
          <meshStandardMaterial
            color={i % 3 === 0 ? C.brass : i % 3 === 1 ? C.shellDeep : C.bronze}
            roughness={0.55}
            metalness={0.12}
          />
        </mesh>
      ))}

      {/* Three bricks in mid-air, drifting — the thing the robot is building
          with, caught between the floor and the tower. */}
      {[0, 1, 2].map((i) => (
        <FloatingBrick key={i} i={i} still={still} />
      ))}
    </group>
  );
}

/**
 * The soft round patch each robot stands on, drawn once and shared by all of
 * them.
 *
 * This replaced a `<ContactShadows>`, which is a lovely thing and completely
 * the wrong tool once the robots started moving. It works by re-rendering the
 * whole scene from underneath into a texture — so with three robots wandering
 * it had to redo that every single frame, over an area wide enough to hold all
 * of them, which is a second full draw of everything on screen for a smudge on
 * the floor. This is one quad each, and at this scale it is indistinguishable.
 */
function useBlobTexture(): Texture {
  return useMemo(() => {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    // White with a falling alpha; the mesh tints it. Squared-off in the middle
    // so there is a definite core to the shadow rather than a wash.
    g.addColorStop(0, 'rgba(255,255,255,0.62)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.26)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return new CanvasTexture(canvas);
  }, []);
}

/**
 * One robot's patrol: where its loop is centred, how far it wanders, how fast,
 * and how big it is drawn.
 *
 * Positions are in the scaled group's own units — divide a world offset by
 * `scale` before putting it in here, because these are applied inside the group
 * that scale sits on.
 */
type Lane = {
  key: string;
  /** The anchor: the innermost point of the patrol, nearest the copy. */
  cx: number;
  cz: number;
  /** How far it wanders from the anchor, along each axis. */
  rx: number;
  rz: number;
  /**
   * Which way the sideways wander goes: `1` outward to the right, `-1` outward
   * to the left, `0` symmetric about the anchor.
   *
   * This is the whole reason the lanes hold. With a plain sine the excursion is
   * symmetric, so half of every loop is spent travelling *toward* the middle of
   * the frame — and the middle of the frame is the headline. Anchoring at the
   * inner edge and only ever moving away from it means the text column is safe
   * by construction rather than by picking radii carefully and hoping.
   */
  dir: -1 | 0 | 1;
  /** Loop speed in radians per second, and where in the loop it begins. */
  w: number;
  ph: number;
  s: number;
  simple: boolean;
};

/**
 * One robot, driving its lane.
 *
 * The two axes run at different frequencies, so the path is a Lissajous figure
 * rather than an ellipse — it crosses itself and takes a while to repeat, which
 * is what stops three robots on three loops reading as three things on rails.
 *
 * Velocity comes from the analytic derivative of the path rather than from
 * differencing last frame's position: it is exact, it costs two cosines, and it
 * cannot spike into a wild heading on the first frame after a stall.
 */
function RoamingBot({ lane: L, look, still }: { lane: Lane; look: { x: number; y: number }; still: boolean }) {
  const group = useRef<Group>(null);
  /** Handed to the robot so its wheel turns by the distance actually covered. */
  const speed = useRef(0);
  const yaw = useRef(0);
  const blob = useBlobTexture();

  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;

    /* Reduced motion: parked on the centre of its lane. The character itself
       still breathes and blinks — see Robot.tsx — it simply goes nowhere. */
    if (still) {
      g.position.set(L.cx, 0, L.cz);
      g.rotation.y = 0;
      speed.current = 0;
      return;
    }

    const d = Math.min(delta, 1 / 30);
    const t = state.clock.elapsedTime + L.ph;
    const a = t * L.w;
    const b = t * L.w * 0.7;

    /* `0.5 - 0.5*cos` runs 0 -> 1 -> 0, so a directed lane leaves its anchor,
       swings out, and comes back — never crossing to the inner side. A
       symmetric lane keeps the plain sine. */
    const swing = L.dir === 0 ? Math.sin(a) : L.dir * (0.5 - 0.5 * Math.cos(a));
    g.position.x = L.cx + swing * L.rx;
    g.position.z = L.cz + Math.sin(b) * L.rz;

    const vx = (L.dir === 0 ? Math.cos(a) : L.dir * 0.5 * Math.sin(a)) * L.rx * L.w;
    const vz = Math.cos(b) * L.rz * L.w * 0.7;
    speed.current = Math.hypot(vx, vz);

    /* Faces the way it is going — but the bias in the denominator keeps the
       answer in front, so it never turns far enough to show the reader its
       back. The face is the whole character; a robot driving away is a shape.
       It also keeps the angle continuous, where a plain atan2 would flip by a
       half turn every time the z velocity crossed zero. */
    const want = Math.atan2(vx, Math.abs(vz) + 0.6);
    yaw.current += (want - yaw.current) * Math.min(1, d * 2.2);
    g.rotation.y = yaw.current;
  });

  return (
    <group ref={group} position={[L.cx, 0, L.cz]} scale={L.s}>
      <Robot look={look} still={still} travel={speed} simple={L.simple} phase={L.ph} />
      {/* Inside the group, so it follows the robot for free. `depthWrite` off
          keeps it from cutting a hole in whatever is drawn after it. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.014, 0.1]}>
        <planeGeometry args={[3.1, 3.1]} />
        <meshBasicMaterial map={blob} color={C.bronzeDeep} transparent depthWrite={false} opacity={0.75} />
      </mesh>
    </group>
  );
}

/** A stack of slabs, narrowing as it rises. Deliberately crude: at this
 *  distance the fog eats the detail, and every one of these is silhouette. */
function Tower({ x, z, h, w, tint }: { x: number; z: number; h: number; w: number; tint: number }) {
  const slabs = Math.max(2, Math.round(h * 2.2));
  return (
    <group position={[x, 0, z]}>
      {Array.from({ length: slabs }, (_, i) => {
        const t = i / slabs;
        const width = w * (1 - t * 0.32);
        return (
          <mesh key={i} position={[0, (i + 0.5) * (h / slabs), 0]}>
            <boxGeometry args={[width, h / slabs - 0.03, width * 0.8]} />
            <meshStandardMaterial
              color={i % 2 === 0 ? (tint ? C.shellDeep : C.brass) : tint ? C.bronze : C.shellMid}
              roughness={0.7}
              metalness={0.06}
            />
          </mesh>
        );
      })}
    </group>
  );
}

/** One brick hanging in the air on its own slow orbit. */
function FloatingBrick({ i, still }: { i: number; still: boolean }) {
  const ref = useRef<Group>(null);
  useFrame((state) => {
    // The one frame a still scene draws still has to place these, or they all
    // stack at the origin — so this runs, it just runs off a frozen clock.
    const t = (still ? 0 : state.clock.elapsedTime) + i * 2.1;
    if (!ref.current) return;
    // Kept out to the sides: the middle of the frame belongs to the headline.
    const lane = [2.3, 6.4, -3.4][i];
    ref.current.position.set(
      lane + Math.sin(t * 0.5) * 0.3,
      1.15 + i * 0.34 + Math.sin(t * 0.8) * 0.16,
      1.1 + Math.cos(t * 0.4) * 0.3,
    );
    ref.current.rotation.set(t * 0.28, t * 0.42, Math.sin(t * 0.5) * 0.3);
  });
  return (
    <group ref={ref}>
      <mesh>
        <boxGeometry args={[0.46, 0.13, 0.2]} />
        <meshStandardMaterial color={i === 1 ? C.brassLit : C.brass} roughness={0.42} metalness={0.25} />
      </mesh>
    </group>
  );
}
