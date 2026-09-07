'use client';

/**
 * The robot: a chassis on one wheel, a screen for a face, headphones, an
 * antenna, and two segmented arms holding a tablet.
 *
 * It is built entirely from primitives — rounded boxes, spheres, cylinders,
 * a torus — because a modelled asset would mean shipping a .glb, and the whole
 * point of this scene is that it costs one lazy chunk and no downloads. What
 * makes it read as a character rather than as a pile of shapes is the motion:
 * everything here is either following something else with a lag, or breathing.
 *
 * The rig, top to bottom:
 *
 *   antenna   trails the head, one beat behind it
 *   head      turns toward the pointer, tilts as it turns, blinks
 *   neck      fixed
 *   body      breathes, counter-rotates a fraction of the head's turn
 *   arms      undulate out of phase with each other
 *   wheel     spins by however far the whole rig has drifted sideways
 *
 * Light falls from the upper left, which is the direction the fresco this
 * replaced was lit from. Keeping it is what lets the two live in one page.
 */

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import type { Group, Mesh, MeshStandardMaterial } from 'three';
import { C } from './palette';

/** How far the head can turn, in radians. A face that tracks the pointer all
 *  the way to the edge of the screen looks possessed; a quarter of that reads
 *  as attention. */
const YAW = 0.42;
const PITCH = 0.2;

/** Seconds between blinks, and how long one lasts. Irregular on purpose — a
 *  metronome blink is the fastest way to make something look dead. */
const BLINK_EVERY = 3.4;
const BLINK_FOR = 0.13;

/** Tyre radius: the torus's ring radius plus its tube. The wheel has to turn by
 *  distance/radius or the robot visibly skates. */
const WHEEL_R = 0.73;

type Props = {
  /** Pointer position over the hero, -0.5..0.5 on each axis. The scene feeds
   *  this in already smoothed, so nothing here needs its own spring. */
  look: { x: number; y: number };
  /** Hold the rest pose: no bob, no blink, no tracking. The scene only draws
   *  one frame in this mode, so this is the pose that frame is caught in. */
  still?: boolean;
  /**
   * How fast the parent is driving this robot across the floor, in world units
   * per second. Supplied as a ref because it changes every frame and nothing
   * here should re-render for it.
   *
   * When it is present the robot stops doing its own sideways drift — something
   * above it owns where it is — and the wheel turns by the distance actually
   * covered instead of by a hardcoded sine.
   */
  travel?: { current: number };
  /** Fewer segments and no tablet. For the ones far enough back that the detail
   *  is costing draw calls to render something the fog is eating anyway. */
  simple?: boolean;
  /** Offset into the shared clock. Without it every robot on screen breathes,
   *  blinks and swings its arms on precisely the same frame, which is the
   *  fastest way to turn a crowd back into copies of one prop. */
  phase?: number;
};

export default function Robot({ look, still = false, travel, simple = false, phase = 0 }: Props) {
  const root = useRef<Group>(null);
  const head = useRef<Group>(null);
  const antenna = useRef<Group>(null);
  const body = useRef<Group>(null);
  const wheel = useRef<Group>(null);
  const armL = useRef<Group>(null);
  const armR = useRef<Group>(null);
  const eyeL = useRef<Mesh>(null);
  const eyeR = useRef<Mesh>(null);
  const tip = useRef<Mesh>(null);

  /** The antenna lags the head rather than being parented to it, so it has to
   *  carry its own copy of the angle. */
  const lag = useRef(0);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime + phase;
    // Clamp: a tab that has been in the background hands back a huge delta,
    // and every lerp below would snap in one frame.
    const d = Math.min(delta, 1 / 30);

    /* Reduced motion is not no motion.
     *
     * This used to freeze the rig outright, which reads as a broken render
     * rather than as a still one — a character with open eyes and no pulse
     * looks switched off, and that is the state most visitors were seeing.
     *
     * What `prefers-reduced-motion` is actually asking us to drop is the
     * vestibular stuff: translation across the frame, parallax, anything
     * coupled to scroll. So those go, and what stays is a breath and a blink —
     * no travel, sub-pixel amplitude, nothing tied to the page moving. */
    if (still) {
      if (body.current) {
        const breath = 1 + Math.sin(t * 0.9) * 0.012;
        body.current.scale.set(breath, 2 - breath, breath);
      }
      blink(t, d);
      return;
    }

    /* --- the whole rig: a bob, and a lean --- */
    if (root.current) {
      // Only when nothing above is driving the position. A roaming robot gets
      // its x from its path; adding a drift on top makes it wobble off its line.
      if (!travel) root.current.position.x = Math.sin(t * 0.34) * 0.22;
      root.current.position.y = Math.sin(t * 1.15) * 0.055 - 0.02;
      // Leans into its own travel, like a scooter taking a corner.
      const lean = travel ? -travel.current * 0.05 : 0;
      root.current.rotation.z += (Math.sin(t * 0.62) * 0.022 + lean - root.current.rotation.z) * Math.min(1, d * 3);
    }

    /* --- wheel: turns by however far the rig actually moved --- */
    if (wheel.current) {
      // Distance over radius. Either from the path above, or — when the robot
      // is standing still and drifting on its own — from the derivative of that
      // drift, so the tyre never slides across the floor.
      const metres = travel ? travel.current * d : Math.cos(t * 0.34) * 0.34 * d * 0.75;
      wheel.current.rotation.z -= metres / WHEEL_R;
    }

    /* --- head: turns toward the pointer, and leans into the turn --- */
    if (head.current) {
      const yaw = look.x * YAW;
      const pitch = -look.y * PITCH;
      head.current.rotation.y += (yaw - head.current.rotation.y) * Math.min(1, d * 4);
      head.current.rotation.x += (pitch + Math.sin(t * 0.9) * 0.02 - head.current.rotation.x) * Math.min(1, d * 4);
      head.current.rotation.z += (-yaw * 0.35 - head.current.rotation.z) * Math.min(1, d * 4);
    }

    /* --- body: breathes, and gives back a little of the head's turn --- */
    if (body.current) {
      const breath = 1 + Math.sin(t * 1.15) * 0.018;
      body.current.scale.set(breath, 2 - breath, breath);
      body.current.rotation.y += (look.x * YAW * 0.3 - body.current.rotation.y) * Math.min(1, d * 3);
    }

    /* --- antenna: one beat behind the head, then a wobble of its own --- */
    if (antenna.current) {
      const target = look.x * YAW;
      lag.current += (target - lag.current) * Math.min(1, d * 1.6);
      antenna.current.rotation.z = -lag.current * 0.5 + Math.sin(t * 2.1) * 0.07;
      antenna.current.rotation.x = Math.sin(t * 1.7 + 1) * 0.05;
    }
    if (tip.current) {
      const mat = tip.current.material as MeshStandardMaterial;
      // The one light in the scene that pulses: a status lamp, not a glow.
      // Above 1 so the bloom threshold actually catches it — below that it is
      // a pale sphere, not a lamp.
      mat.emissiveIntensity = 1.9 + Math.sin(t * 2.6) * 0.7;
    }

    /* --- arms: the same undulation, half a cycle apart --- */
    if (armL.current) armL.current.rotation.z = 0.25 + Math.sin(t * 1.4) * 0.09;
    if (armR.current) armR.current.rotation.z = -0.3 + Math.sin(t * 1.4 + Math.PI) * 0.09;

    blink(t, d);
  });

  /** Squash both eyes, briefly. Shared by the full and reduced-motion paths —
   *  a blink is the one piece of life that costs nothing vestibular. */
  function blink(t: number, d: number) {
    const phase = t % BLINK_EVERY;
    // A second blink close behind the first, every other cycle: two blinks in
    // quick succession is what real eyes do and metronomes do not.
    const double = Math.floor(t / BLINK_EVERY) % 2 === 0 && phase > 0.22 && phase < 0.22 + BLINK_FOR;
    const shut = phase < BLINK_FOR || double;
    const sy = shut ? 0.08 : 1;
    for (const eye of [eyeL, eyeR]) {
      if (!eye.current) continue;
      eye.current.scale.y += (sy - eye.current.scale.y) * Math.min(1, d * 26);
    }
  }

  /** The arm segments, sampled along a quadratic bezier that leaves the
   *  shoulder outward and curls forward toward the camera. Beads on a curve
   *  rather than a tube: it bends without any of the skinning a real rig would
   *  need, and at this size the gaps read as knuckles. */
  const segments = useMemo(
    () => bead([0.16, 0.02, 0.06], [0.72, -0.16, 0.3], [0.62, -0.5, 0.72], simple ? 4 : 6),
    [simple],
  );

  return (
    <group ref={root} position={[0, 0, 0]}>
      {/* ---------------- wheel ---------------- */}
      <group ref={wheel} position={[0, 0.6, 0]}>
        {/* The tyre, left in the torus's own plane so the camera — which sits
            square in front of the robot — sees the face of the wheel and not
            its edge. A wheel edge-on to the viewer is a black pill, and no
            amount of spinning rescues it. */}
        <mesh castShadow receiveShadow>
          <torusGeometry args={[0.56, 0.17, 18, 44]} />
          <meshStandardMaterial color={C.ink800} roughness={0.76} metalness={0.04} />
        </mesh>
        {/* Hub. */}
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.24, 0.24, 0.26, 26]} />
          <meshStandardMaterial color={C.brass} roughness={0.19} metalness={1} envMapIntensity={1.5} />
        </mesh>
        {/* Spokes. The only thing on the wheel that is off-centre, and so the
            only reason the spin is visible at all. */}
        {[0, 1, 2, 3].map((i) => (
          <mesh key={i} rotation={[0, 0, (i * Math.PI) / 4]}>
            <boxGeometry args={[0.09, 1.02, 0.09]} />
            <meshStandardMaterial color={C.bronzeDeep} roughness={0.3} metalness={1} envMapIntensity={1.25} />
          </mesh>
        ))}
      </group>

      {/* ---------------- body ---------------- */}
      <group ref={body} position={[0, 1.05, 0]}>
        <mesh castShadow receiveShadow>
          <sphereGeometry args={[0.6, simple ? 20 : 44, simple ? 14 : 36]} />
          {/* Lacquered, not chalky: a clearcoat over a near-dielectric base is what
              a moulded product shell actually is, and it is where the long
              highlight down the front comes from. */}
          <meshPhysicalMaterial
            color={C.shellMid}
            roughness={0.36}
            metalness={0.05}
            clearcoat={0.7}
            clearcoatRoughness={0.26}
            envMapIntensity={1.15}
          />
        </mesh>
        {/* A bronze belt around the waist — the seam that says the shell is
            two pressed halves rather than one ball. */}
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -0.06, 0]}>
          <torusGeometry args={[0.585, 0.035, 12, 44]} />
          <meshStandardMaterial color={C.bronze} roughness={0.22} metalness={1} envMapIntensity={1.4} />
        </mesh>
        {/* Neck. */}
        <mesh position={[0, 0.6, 0]} castShadow>
          <cylinderGeometry args={[0.15, 0.19, 0.24, 22]} />
          <meshStandardMaterial color={C.bronze} roughness={0.22} metalness={1} envMapIntensity={1.4} />
        </mesh>
      </group>

      {/* ---------------- arms ---------------- */}
      <group ref={armL} position={[-0.44, 1.16, 0.16]} rotation={[0, 0, 0.25]}>
        <Arm segments={segments} flip simple={simple} />
      </group>
      <group ref={armR} position={[0.44, 1.16, 0.16]} rotation={[0, 0, -0.3]}>
        <Arm segments={segments} simple={simple} />
      </group>

      {/* The tablet the right arm is holding. Tilted toward the camera so the
          face of it catches the key light. Dropped on the background robots:
          it is seven meshes to render four legible pixels. */}
      {!simple && (
      <group position={[0.66, 0.72, 0.86]} rotation={[-1.0, 0.12, -0.16]}>
        <RoundedBox args={[0.92, 0.66, 0.045]} radius={0.045} smoothness={4} castShadow>
          <meshStandardMaterial color={C.bronze} roughness={0.26} metalness={1} envMapIntensity={1.35} />
        </RoundedBox>
        <mesh position={[0, 0, 0.026]}>
          <planeGeometry args={[0.8, 0.54]} />
          <meshStandardMaterial color={C.ink} roughness={0.32} metalness={0.1} />
        </mesh>
        {/* Three lines of "transcript" on the tablet. Purely a texture — at this
            size they read as text and cost three quads. */}
        {[0.14, 0.02, -0.1].map((y, i) => (
          <mesh key={y} position={[-0.12 + i * 0.04, y, 0.028]}>
            <planeGeometry args={[0.44 - i * 0.09, 0.045]} />
            <meshStandardMaterial color={i === 1 ? C.brassLit : C.shellDeep} roughness={0.5} />
          </mesh>
        ))}
      </group>
      )}

      {/* ---------------- head ---------------- */}
      <group ref={head} position={[0, 1.95, 0]}>
        <RoundedBox args={[1.42, 1.06, 0.72]} radius={0.24} smoothness={simple ? 2 : 5} castShadow receiveShadow>
          <meshPhysicalMaterial
            color={C.shell}
            roughness={0.34}
            metalness={0.05}
            clearcoat={0.8}
            clearcoatRoughness={0.22}
            envMapIntensity={1.2}
          />
        </RoundedBox>

        {/* The screen. Inset far enough that the shell's rounded edge casts a
            hairline of shadow onto it, which is what sells it as recessed. */}
        <RoundedBox args={[1.06, 0.7, 0.06]} radius={0.09} smoothness={4} position={[0, 0.02, 0.35]}>
          {/* Matte and unlit-looking on purpose. A glossy screen picks up the
              rim light and turns grey, and a grey screen has no eyes on it. */}
          {/* `envMapIntensity` near zero on purpose. A rough dielectric picks up
              the whole environment as diffuse light, and once there *was* an
              environment this went from near-black to mid-grey — which washed
              the eyes out, because a face needs a dark screen to sit on. */}
          <meshStandardMaterial
            color={C.ink}
            roughness={0.95}
            metalness={0}
            envMapIntensity={0.12}
            emissive={C.ink}
            emissiveIntensity={0.35}
          />
        </RoundedBox>

        {/* Eyes: two rounded bars, the left one taller — the asymmetry in the
            reference, and the thing that stops the face reading as a colon. */}
        <mesh ref={eyeL} position={[-0.2, 0.02, 0.4]}>
          <capsuleGeometry args={[0.072, 0.24, 4, 14]} />
          <meshStandardMaterial color={C.cream} emissive={C.cream} emissiveIntensity={2.4} toneMapped={false} roughness={0.4} />
        </mesh>
        <mesh ref={eyeR} position={[0.21, 0.02, 0.4]}>
          <capsuleGeometry args={[0.072, 0.1, 4, 14]} />
          <meshStandardMaterial color={C.cream} emissive={C.cream} emissiveIntensity={2.4} toneMapped={false} roughness={0.4} />
        </mesh>

        {/* Headphones: a band over the crown and a cup on each side.
            The torus is left unrotated on purpose. Its arc runs through its own
            XY plane, which is the vertical one — tip it onto XZ and the half
            ring stops being an arch over the head and becomes a blindfold. */}
        <mesh position={[0, 0.06, 0]} castShadow>
          <torusGeometry args={[0.8, 0.055, 12, 40, Math.PI]} />
          <meshStandardMaterial color={C.bronze} roughness={0.22} metalness={1} envMapIntensity={1.4} />
        </mesh>
        {[-1, 1].map((s) => (
          <group key={s} position={[s * 0.79, 0.02, 0]}>
            <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
              <cylinderGeometry args={[0.24, 0.24, 0.2, 26]} />
              <meshStandardMaterial color={C.brass} roughness={0.24} metalness={1} envMapIntensity={1.45} />
            </mesh>
            <mesh position={[s * 0.105, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.16, 0.16, 0.02, 22]} />
              <meshStandardMaterial color={C.ink800} roughness={0.6} />
            </mesh>
          </group>
        ))}

        {/* Antenna. Its pivot is at the crown, so the whole mast swings from
            where it is bolted rather than from the middle of the head. */}
        <group ref={antenna} position={[0.3, 0.5, 0]}>
          <mesh position={[0, 0.33, 0]} castShadow>
            <cylinderGeometry args={[0.022, 0.03, 0.66, 12]} />
            <meshStandardMaterial color={C.bronzeDeep} roughness={0.28} metalness={1} envMapIntensity={1.3} />
          </mesh>
          <mesh ref={tip} position={[0, 0.71, 0]}>
            <sphereGeometry args={[0.085, 22, 18]} />
            <meshStandardMaterial
              color={C.brassLit}
              emissive={C.brassLit}
              emissiveIntensity={2.2}
              toneMapped={false}
              roughness={0.25}
              metalness={0.3}
            />
          </mesh>
        </group>
      </group>
    </group>
  );
}

type Bead = { i: number; r: number; p: [number, number, number] };

/** Samples a quadratic bezier into evenly spaced beads that taper toward the
 *  far end — the shoulder is thick, the wrist is thin. */
function bead(
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
  count: number,
): Bead[] {
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1);
    const u = 1 - t;
    const at = (n: number) => u * u * a[n] + 2 * u * t * b[n] + t * t * c[n];
    return { i, r: 0.095 - t * 0.038, p: [at(0), at(1), at(2)] as [number, number, number] };
  });
}

/** One segmented arm, plus the gripper on the end of it. */
function Arm({ segments, flip = false, simple = false }: { segments: Bead[]; flip?: boolean; simple?: boolean }) {
  const s = flip ? -1 : 1;
  const last = segments[segments.length - 1];
  return (
    <group>
      {segments.map(({ i, r, p }) => (
        <mesh key={i} position={[s * p[0], p[1], p[2]]} castShadow>
          <sphereGeometry args={[r, simple ? 8 : 16, simple ? 6 : 12]} />
          <meshStandardMaterial
            color={i % 2 === 0 ? C.shellDeep : C.brass}
            roughness={i % 2 === 0 ? 0.36 : 0.24}
            metalness={i % 2 === 0 ? 0.1 : 1}
            envMapIntensity={1.3}
          />
        </mesh>
      ))}
      {/* The gripper: two short prongs off the last bead. */}
      <group position={[s * last.p[0], last.p[1] - 0.02, last.p[2] + 0.06]}>
        {[-1, 1].map((prong) => (
          <mesh key={prong} rotation={[0.5, 0, s * prong * 0.4]} castShadow>
            <capsuleGeometry args={[0.02, 0.14, 3, 8]} />
            <meshStandardMaterial color={C.bronzeDeep} roughness={0.26} metalness={1} envMapIntensity={1.3} />
          </mesh>
        ))}
      </group>
    </group>
  );
}
