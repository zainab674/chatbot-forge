/** The landing hero's backdrop: a ceiling-fresco composition — arch, gilded
 *  cloudbank, a halo, a banner, two forms reaching at each other across a gap.
 *
 *  The composition is the Creation. The things in it are not people. An earlier
 *  pass built two humanoids — head, torso, two arms, two legs — and they read as
 *  men in robot costume. These are machines on their own terms: a chassis on a
 *  keel, a drum slung under a crest of vanes, apertures instead of faces, booms
 *  instead of arms, and a pair of grippers whose emitter pins carry the spark
 *  across the gap.
 *
 *  Inline SVG rather than an image: it costs no request, stays sharp at any
 *  width, and is painted from the site's own ochre/cream palette instead of
 *  whatever colours a stock file happened to ship with.
 *
 *  Purely decorative. Everything the hero actually claims is in the copy layered
 *  over it, so the caller hides this whole subtree from assistive tech.
 */

/* Light falls from the upper left, so every highlight in here is offset the
   same way. Keeping that in one place is what stops the two machines from
   looking like they were lit by different suns. */
const HL = 'translate(-3 -5)';

/** A boom segment: dark contact edge, metal barrel, then a highlight down its
 *  top. Drawn in root space so the barrel gradient — which is userSpaceOnUse,
 *  and so carries the scene's light direction — lands the same way on each. */
function Boom({ d, w }: { d: string; w: number }) {
  return (
    <>
      <path
        d={d}
        fill="none"
        stroke="#5f4420"
        strokeWidth={w + 6}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity=".5"
      />
      <path d={d} fill="none" stroke="url(#metal)" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
      <path
        d={d}
        fill="none"
        stroke="#f6e8c8"
        strokeWidth={Math.max(2.5, w * 0.16)}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity=".38"
        transform={HL}
      />
    </>
  );
}

/** A ball joint. The detail that does the most work in the whole scene — a
 *  sphere at every hinge reads as machine long before the plating does. */
function Joint({ x, y, r }: { x: number; y: number; r: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill="url(#ball)" stroke="#5f4420" strokeWidth="2" />
      <circle cx={x - r * 0.3} cy={y - r * 0.35} r={r * 0.22} fill="#fdf3d9" opacity=".55" />
    </g>
  );
}

/** The aperture each machine carries where a fresco would put a face. A bezel,
 *  six iris leaves, and a lit pupil — enough structure that it reads as optics
 *  rather than as an eye. */
function Iris({ x, y, r, hot = false }: { x: number; y: number; r: number; hot?: boolean }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={r * 1.34} fill="url(#plateDark)" stroke="#5f4420" strokeWidth="2.5" />
      <circle r={r * 1.06} fill="#33260f" />
      {[0, 60, 120, 180, 240, 300].map((a) => (
        <path
          key={a}
          d={`M0 ${-r} L${r * 0.66} ${-r * 0.74} L${r * 0.22} ${-r * 0.28} Z`}
          fill="#8a6432"
          opacity=".9"
          transform={`rotate(${a})`}
        />
      ))}
      <circle r={r * 0.36} fill={hot ? '#fff6d8' : '#ffdc8e'} />
      <circle r={r * 1.7} fill="url(#spark)" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
        <circle key={a} cy={-r * 1.2} r={Math.max(2, r * 0.08)} fill="#f2e2bf" opacity=".65" transform={`rotate(${a})`} />
      ))}
    </g>
  );
}

/** The end effector: two opposed jaws around a fine emitter pin. The pin is
 *  what actually reaches — the gap in this composition is closed by a spark
 *  between two instruments, not by two fingertips. */
function Gripper({ at }: { at: string }) {
  return (
    <g transform={at}>
      {/* wrist collar */}
      <rect x="-24" y="-23" width="38" height="46" rx="8" fill="url(#plate)" stroke="#5f4420" strokeWidth="2" />
      <rect x="-24" y="-4" width="38" height="7" fill="#5f4420" opacity=".3" />
      {/* Two blunt jaws with a real gap between them. The first pass drew them
          as thin slivers either side of the pin, and at this scale the three
          strokes merged into something that read as a paintbrush. */}
      <path
        d="M4 -22 Q44 -38 74 -28 Q88 -22 84 -10 Q74 -3 58 -8 Q30 -15 6 -6 Z"
        fill="url(#plate)"
        stroke="#5f4420"
        strokeWidth="2.2"
      />
      <path
        d="M4 22 Q44 38 74 28 Q88 22 84 10 Q74 3 58 8 Q30 15 6 6 Z"
        fill="url(#plate)"
        stroke="#5f4420"
        strokeWidth="2.2"
      />
      <path d="M12 -19 Q46 -32 70 -25" fill="none" stroke="#f6e8c8" strokeWidth="3.5" opacity=".45" />
      {/* the emitter the jaws hold, and the charge on its tip */}
      <path d="M6 0 L104 0" fill="none" stroke="#5f4420" strokeWidth="11" strokeLinecap="round" />
      <path d="M6 0 L101 0" fill="none" stroke="#e0bc88" strokeWidth="6" strokeLinecap="round" />
      <circle cx="10" cy="0" r="13" fill="url(#ball)" stroke="#5f4420" strokeWidth="2" />
      <circle cx="106" cy="0" r="34" fill="url(#spark)" />
      <circle cx="106" cy="0" r="6" fill="#fffdf3" />
    </g>
  );
}

/* The crest behind the upper machine: louvred vanes on an arc, longest at the
   top. It is where a painting would put a wing, built as intake blades. */
const CREST: [number, number][] = [
  [-170, 50],
  [-152, 62],
  [-134, 74],
  [-116, 84],
  [-98, 90],
  [-80, 86],
  [-62, 76],
  [-44, 64],
  [-26, 52],
];

/* Halo rays. An odd count, so the ring never resolves into a clock face. */
const RAYS = Array.from({ length: 21 }, (_, i) => (i * 360) / 21);

/* Motes drifting in the light: [x, y, r, opacity]. Kept faint — at full
   strength they stopped reading as dust in a sunbeam and started reading as
   dirt on the lens. */
const MOTES: [number, number, number, number][] = [
  [520, 210, 3, 0.2],
  [612, 300, 2, 0.16],
  [700, 150, 4, 0.14],
  [860, 236, 2.5, 0.18],
  [960, 130, 3, 0.12],
  [1080, 470, 3.5, 0.14],
  [430, 330, 2.5, 0.16],
  [1180, 560, 3, 0.11],
  [760, 620, 2.5, 0.12],
  [300, 250, 3, 0.12],
];

export default function HeroFresco() {
  return (
    <svg
      viewBox="0 0 1600 1000"
      /* Anchored to the bottom rather than sliced through the middle. A slice
         on a phone-shaped frame keeps only the empty sky between the two
         machines; anchoring the cloudbank to the hero's lower edge and letting
         the plaster above it run into the section's own gradient keeps the
         whole composition on screen at every width. */
      preserveAspectRatio="xMidYMax meet"
      /* The width per breakpoint is chosen so the painting is always at least
         as tall as the hero it fills — too narrow and a strip of bare gradient
         opens above it, too wide and the crop eats the upper machine's crest.
         The multiplier falls as the frame widens because the hero now runs the
         full viewport: what needed 134% of a phone already overshoots on a
         desktop, and past 1536px plain 100% is more painting than the band can
         show, which is why the hero itself starts growing there instead. */
      className="absolute bottom-0 left-1/2 h-auto w-[134%] -translate-x-1/2 sm:w-[142%] lg:w-[130%] xl:w-[106%] 2xl:w-full"
    >
      <defs>
        {/* ---- ground ---- */}
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f7eed9" />
          <stop offset="0.42" stopColor="#e9d6b1" />
          <stop offset="0.78" stopColor="#dcc296" />
          <stop offset="1" stopColor="#d3b587" />
        </linearGradient>
        <radialGradient id="dayglow" cx="0.5" cy="0.42" r="0.62">
          <stop offset="0" stopColor="#fff8e4" stopOpacity=".95" />
          <stop offset="0.55" stopColor="#f7e3ba" stopOpacity=".45" />
          <stop offset="1" stopColor="#f7e3ba" stopOpacity="0" />
        </radialGradient>
        {/* On a narrow screen the painting becomes a band and its top edge is a
            seam against the section's own gradient. This fades the stonework
            out into exactly that gradient's colour over the top strip, which is
            what makes the join disappear. */}
        <linearGradient id="topfade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f7eed9" />
          <stop offset="0.7" stopColor="#f7eed9" stopOpacity=".22" />
          <stop offset="1" stopColor="#f7eed9" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="vignette" cx="0.5" cy="0.48" r="0.72">
          <stop offset="0.55" stopColor="#7a5c2c" stopOpacity="0" />
          <stop offset="1" stopColor="#7a5c2c" stopOpacity=".34" />
        </radialGradient>

        {/* ---- metal ---- */}
        {/* Diagonal across the whole canvas, so booms anywhere in the scene
            share one falloff instead of each shading on its own axis. */}
        <linearGradient id="metal" gradientUnits="userSpaceOnUse" x1="120" y1="60" x2="1180" y2="980">
          <stop offset="0" stopColor="#e6cb9c" />
          <stop offset="0.45" stopColor="#c2965d" />
          <stop offset="1" stopColor="#8a6432" />
        </linearGradient>
        <linearGradient id="plate" x1="0.1" y1="0" x2="0.75" y2="1">
          <stop offset="0" stopColor="#f2e2bf" />
          <stop offset="0.45" stopColor="#cb9f65" />
          <stop offset="1" stopColor="#7e5a2c" />
        </linearGradient>
        <linearGradient id="plateDark" x1="0.1" y1="0" x2="0.75" y2="1">
          <stop offset="0" stopColor="#c8a877" />
          <stop offset="1" stopColor="#5f4420" />
        </linearGradient>
        <radialGradient id="ball" cx="0.34" cy="0.3" r="0.78">
          <stop offset="0" stopColor="#f6e8c6" />
          <stop offset="0.42" stopColor="#c9a066" />
          <stop offset="1" stopColor="#6b4c23" />
        </radialGradient>
        <linearGradient id="blade" x1="0" y1="0" x2="0.2" y2="1">
          <stop offset="0" stopColor="#f0e0bd" />
          <stop offset="0.5" stopColor="#cfa971" />
          <stop offset="1" stopColor="#8d6837" />
        </linearGradient>

        {/* ---- cloth ---- */}
        <linearGradient id="clay" x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#d78a63" />
          <stop offset="0.5" stopColor="#b96143" />
          <stop offset="1" stopColor="#7d3a26" />
        </linearGradient>

        {/* ---- light ---- */}
        <radialGradient id="halo" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0.35" stopColor="#ffe9a8" stopOpacity=".95" />
          <stop offset="0.72" stopColor="#f2c95f" stopOpacity=".55" />
          <stop offset="1" stopColor="#f2c95f" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="spark" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fffdf3" stopOpacity=".9" />
          <stop offset="0.4" stopColor="#ffe6a4" stopOpacity=".5" />
          <stop offset="1" stopColor="#ffe6a4" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="exhaust" cx="0.5" cy="0.1" r="0.9">
          <stop offset="0" stopColor="#ffe2a0" stopOpacity=".75" />
          <stop offset="1" stopColor="#ffd98c" stopOpacity="0" />
        </radialGradient>

        {/* ---- stone ---- */}
        <linearGradient id="stone" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#b59a71" />
          <stop offset="0.4" stopColor="#d8c4a0" />
          <stop offset="1" stopColor="#a88c64" />
        </linearGradient>

        <filter id="soft" x="-25%" y="-25%" width="150%" height="150%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
        <filter id="softer" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="20" />
        </filter>
        <filter id="edge" x="-15%" y="-15%" width="130%" height="130%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
        <filter id="cast" x="-30%" y="-30%" width="180%" height="180%">
          <feDropShadow dx="10" dy="16" stdDeviation="14" floodColor="#6b4a1f" floodOpacity=".32" />
        </filter>
        {/* Fresco tooth. Plaster is never flat, and without this the sky reads
            as a CSS gradient rather than a painted ceiling. */}
        <filter id="plaster" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="4" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
      </defs>

      {/* ================= sky ================= */}
      <rect width="1600" height="1000" fill="url(#sky)" />
      <rect width="1600" height="1000" fill="url(#dayglow)" />

      {/* ================= the architecture ================= */}
      {/* Held at low contrast on purpose: it frames the scene from the edges
          and is not meant to compete with either machine. */}
      <g opacity=".72">
        {/* the springing arch, with an archivolt inside it so the curve has an
            edge to read against instead of dissolving into the sky */}
        <path
          d="M-40 340 C 120 130, 480 30, 800 30 C 1120 30, 1480 130, 1640 340 L1640 170 C 1460 20, 1140 -70, 800 -70 C 460 -70, 140 20, -40 170 Z"
          fill="url(#stone)"
        />
        <path
          d="M-40 340 C 120 130, 480 30, 800 30 C 1120 30, 1480 130, 1640 340"
          fill="none"
          stroke="#8d7350"
          strokeWidth="5"
          opacity=".65"
        />
        <path
          d="M-40 386 C 130 172, 480 74, 800 74 C 1120 74, 1470 172, 1640 386"
          fill="none"
          stroke="#c3ab84"
          strokeWidth="14"
          opacity=".5"
        />
        {/* left pier */}
        <g>
          <rect x="-30" y="230" width="118" height="770" fill="url(#stone)" />
          <rect x="-30" y="230" width="118" height="26" fill="#c0a67d" />
          {[6, 26, 46, 66].map((o) => (
            <rect key={o} x={-14 + o} y="266" width="6" height="734" fill="#9d8259" opacity=".35" />
          ))}
        </g>
        {/* right pier */}
        <g>
          <rect x="1512" y="230" width="118" height="770" fill="url(#stone)" />
          <rect x="1512" y="230" width="118" height="26" fill="#c0a67d" />
          {[6, 26, 46, 66].map((o) => (
            <rect key={o} x={1528 + o} y="266" width="6" height="734" fill="#9d8259" opacity=".35" />
          ))}
        </g>
      </g>

      {/* Haze between the stone and the machines — the depth cue that puts the
          architecture behind everything else. Kept light: at full strength it
          bleached the whole painting into fog. */}
      <rect width="1600" height="1000" fill="url(#dayglow)" opacity=".34" />
      <rect width="1600" height="190" fill="url(#topfade)" />

      {/* ================= distant cloud shelf ================= */}
      <g filter="url(#softer)" opacity=".7">
        <g fill="#f7ecd0">
          <ellipse cx="260" cy="620" rx="300" ry="90" />
          <ellipse cx="720" cy="676" rx="340" ry="80" />
          <ellipse cx="1240" cy="628" rx="320" ry="86" />
        </g>
      </g>

      {/* ================= the gap ================= */}
      {/* The warm bloom between the two emitters. It doubles as the scrim the
          headline sits on, which is why it is this large and this soft. */}
      <ellipse cx="810" cy="430" rx="420" ry="300" fill="url(#spark)" />

      {/* ================= lower machine — the one being woken ============= */}
      <g filter="url(#cast)">
        {/* halo — gilding, not a cartoon sun, so the rays stay short and sit
            under a wide soft disc rather than spiking out of it */}
        <g>
          {RAYS.map((a) => (
            <path
              key={a}
              d="M-5 -96 L5 -96 L0 -134 Z"
              fill="#e8bf6a"
              opacity=".45"
              transform={`translate(330 530) rotate(${a})`}
            />
          ))}
          <circle cx="330" cy="530" r="140" fill="url(#halo)" opacity=".85" />
          <circle cx="330" cy="530" r="106" fill="none" stroke="#eccd80" strokeWidth="3" opacity=".55" />
        </g>

        {/* the keel it rests on — a bed plate half-sunk in the cloudbank */}
        <path
          d="M148 676 Q330 632 522 664 L544 730 Q330 710 138 742 Z"
          fill="url(#plateDark)"
          stroke="#5f4420"
          strokeWidth="2.5"
        />
        <path d="M160 682 Q330 642 512 670" fill="none" stroke="#f2e2bf" strokeWidth="5" opacity=".4" />
        {[[214, 736], [452, 722]].map(([x, y]) => (
          <rect key={x} x={x} y={y} width="72" height="30" rx="6" fill="url(#plateDark)" stroke="#5f4420" strokeWidth="2" />
        ))}

        {/* jacking struts, planted into the cloud */}
        <Boom d="M240 632 L172 744" w={24} />
        <Boom d="M436 642 L556 752" w={24} />
        <Joint x={240} y={632} r={14} />
        <Joint x={436} y={642} r={14} />

        {/* Two conduit loops running out of the underside into the cloud. Three
            of them read as insect legs; two read as slack cable. */}
        {['M286 650 C 248 702, 278 746, 344 756', 'M348 654 C 330 712, 380 746, 434 742'].map((d) => (
          <g key={d}>
            <path d={d} fill="none" stroke="#5f4420" strokeWidth="14" strokeLinecap="round" opacity=".5" />
            <path d={d} fill="none" stroke="#a97f47" strokeWidth="9" strokeLinecap="round" />
          </g>
        ))}

        {/* the chassis */}
        <g transform="translate(330 552) rotate(-12)">
          {/* cooling fins along the top deck */}
          {[-72, -36, 0, 36, 72].map((x) => (
            <path
              key={x}
              d={`M${x - 14} -100 L${x + 14} -100 L${x + 9} ${-152 + Math.abs(x) * 0.42} L${x - 9} ${-152 + Math.abs(x) * 0.42} Z`}
              fill="url(#blade)"
              stroke="#7a5629"
              strokeWidth="1.6"
            />
          ))}
          {/* housing */}
          <path
            d="M-108 -48 L-58 -106 L62 -106 L112 -48 L112 46 L62 104 L-58 104 L-108 46 Z"
            fill="url(#plate)"
            stroke="#5f4420"
            strokeWidth="3"
          />
          <path d="M-108 -6 L112 -6" stroke="#5f4420" strokeWidth="2.5" opacity=".3" />
          {/* An open bay with the coils showing. The upper machine is sealed;
              this one is still being brought up, and the difference is what
              keeps the pair from reading as the same object drawn twice. */}
          <rect x="-62" y="34" width="76" height="52" rx="6" fill="#33260f" />
          {[48, 62, 76].map((y) => (
            <path
              key={y}
              d={`M-52 ${y} q17 -11 34 0 q17 11 28 -2`}
              fill="none"
              stroke="#c9a06a"
              strokeWidth="4"
              opacity=".85"
            />
          ))}
          <rect x="-62" y="34" width="76" height="52" rx="6" fill="none" stroke="#5f4420" strokeWidth="2.5" />
          <rect x="34" y="46" width="52" height="8" rx="4" fill="#5f4420" opacity=".4" />
          <rect x="30" y="62" width="52" height="8" rx="4" fill="#5f4420" opacity=".4" />
          {/* rim bolts */}
          {[
            [-88, -40],
            [-48, -92],
            [50, -92],
            [92, -40],
            [92, 40],
            [50, 90],
            [-48, 90],
            [-88, 40],
          ].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="5" fill="#f2e2bf" opacity=".7" />
          ))}
          <path d="M-98 -44 L-52 -98" stroke="#fbeecd" strokeWidth="6" opacity=".5" />
          <Iris x={6} y={-26} r={44} />
        </g>

        {/* the boom, and the line the whole composition is built on. It sits in
            the band between headline and lede: any higher and the gripper lands
            in the middle of the second line of type. */}
        <Joint x={432} y={534} r={26} />
        <Boom d="M432 534 L520 524" w={34} />
        <Joint x={520} y={524} r={20} />
        <Boom d="M520 524 L600 518" w={27} />
        {/* actuator running alongside the first segment */}
        <path d="M422 560 L512 548" fill="none" stroke="#5f4420" strokeWidth="12" strokeLinecap="round" opacity=".45" />
        <path d="M422 560 L512 548" fill="none" stroke="#c9a06a" strokeWidth="7" strokeLinecap="round" />
        <Gripper at="translate(602 516) rotate(-8)" />
      </g>

      {/* ================= upper machine — the one doing the waking ======== */}
      {/* Nudged in off the corner: at a 16:10 frame the crest and the trailing
          struts were the first things a crop took. */}
      <g filter="url(#cast)" transform="translate(-82 66)">
        {/* the crest: intake vanes on an arc, where a painting would put a wing */}
        <path
          d="M1300 258 Q1216 150 1246 68 Q1360 30 1452 92 Q1520 150 1494 258 Z"
          fill="#a97f47"
          opacity=".4"
        />
        {CREST.map(([a, len]) => (
          <g key={a} transform={`translate(1300 258) rotate(${a}) translate(96 0)`}>
            <path
              d={`M0 -16 L${len} -22 L${len + 26} -5 L${len} 12 L0 16 Z`}
              fill="url(#blade)"
              stroke="#7a5629"
              strokeWidth="1.8"
            />
            <path d={`M14 -8 L${len - 8} -12`} stroke="#f7ead0" strokeWidth="3.5" opacity=".42" />
          </g>
        ))}

        {/* the banner, on its spar — the fresco's drapery, rigged rather than worn */}
        <path
          d="M1386 306 Q1480 340 1512 424 Q1548 518 1496 610 Q1458 668 1400 690 Q1442 572 1414 472 Q1392 388 1352 344 Z"
          fill="url(#clay)"
          stroke="#7d3a26"
          strokeWidth="2"
        />
        <path d="M1394 330 Q1470 402 1478 512" fill="none" stroke="#e8a583" strokeWidth="6" opacity=".4" />
        <path d="M1420 350 Q1478 438 1462 546" fill="none" stroke="#7d3a26" strokeWidth="4" opacity=".35" />
        <Boom d="M1358 292 L1462 336" w={14} />

        {/* stabiliser struts, trailing down and back */}
        <Boom d="M1378 376 L1462 492 L1544 590" w={30} />
        <Joint x={1462} y={492} r={19} />
        <Boom d="M1368 352 L1470 430 L1548 520" w={34} />
        <Joint x={1470} y={430} r={21} />

        {/* the folded second manipulator */}
        <Boom d="M1362 262 L1432 320 L1452 404" w={24} />
        <Joint x={1432} y={320} r={15} />

        {/* the drum */}
        <g transform="translate(1300 258) rotate(14)">
          {/* mast array */}
          {[-30, -10, 10].map((x, i) => (
            <path
              key={x}
              d={`M${x} -110 L${x + 11} -110 L${x + 8} ${-166 - i * 8} L${x + 3} ${-166 - i * 8} Z`}
              fill="url(#blade)"
              stroke="#7a5629"
              strokeWidth="1.5"
            />
          ))}
          <path
            d="M-118 -54 L-64 -116 L64 -116 L118 -54 L118 52 L64 114 L-64 114 L-118 52 Z"
            fill="url(#plate)"
            stroke="#5f4420"
            strokeWidth="3"
          />
          <path d="M-118 -2 L118 -2" stroke="#5f4420" strokeWidth="2.5" opacity=".3" />
          {[60, 78, 96].map((y) => (
            <rect key={y} x="-46" y={y - 5} width="92" height="8" rx="4" fill="#5f4420" opacity=".4" />
          ))}
          {[
            [-96, -46],
            [-54, -102],
            [54, -102],
            [98, -46],
            [98, 44],
            [54, 100],
            [-54, 100],
            [-96, 44],
          ].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="5.5" fill="#f2e2bf" opacity=".7" />
          ))}
          <path d="M-108 -50 L-58 -108" stroke="#fbeecd" strokeWidth="6" opacity=".5" />
          <Iris x={0} y={-16} r={50} hot />
          {/* thruster nozzles */}
          {[-52, 30].map((x) => (
            <g key={x}>
              <path
                d={`M${x} 108 L${x + 40} 108 L${x + 32} 152 L${x + 8} 152 Z`}
                fill="url(#plateDark)"
                stroke="#5f4420"
                strokeWidth="2"
              />
              <ellipse cx={x + 20} cy={186} rx="34" ry="52" fill="url(#exhaust)" />
            </g>
          ))}
        </g>

        {/* the reaching boom */}
        <Joint x={1262} y={240} r={24} />
        <Boom d="M1262 240 L1155 268" w={30} />
        <Joint x={1155} y={268} r={18} />
        <Boom d="M1155 268 L1055 296" w={24} />
        <Gripper at="translate(1053 297) rotate(172)" />
      </g>

      {/* ================= foreground cloudbank ================= */}
      {/* the shaded mass, pushed low and blurred wide — this is the tone the
          lit crowns have to sit against, and it has to be a real step darker
          than the sky or the whole bank disappears */}
      <g filter="url(#soft)">
        <g fill="#b78e51" opacity=".55">
          <ellipse cx="150" cy="940" rx="310" ry="132" />
          <ellipse cx="470" cy="906" rx="248" ry="108" />
          <ellipse cx="790" cy="948" rx="288" ry="114" />
          <ellipse cx="1130" cy="910" rx="268" ry="112" />
          <ellipse cx="1460" cy="944" rx="278" ry="122" />
          <ellipse cx="770" cy="866" rx="180" ry="86" />
        </g>
        <g fill="#dcbb87">
          <ellipse cx="150" cy="906" rx="292" ry="124" />
          <ellipse cx="470" cy="868" rx="236" ry="102" />
          <ellipse cx="790" cy="914" rx="276" ry="108" />
          <ellipse cx="1130" cy="874" rx="256" ry="106" />
          <ellipse cx="1460" cy="908" rx="266" ry="116" />
          <ellipse cx="770" cy="852" rx="176" ry="82" />
          <rect x="0" y="912" width="1600" height="120" />
        </g>
      </g>
      {/* the lit body of the bank, blurred only enough to keep the joins soft */}
      <g filter="url(#edge)" fill="#fdf6e0">
        <ellipse cx="118" cy="880" rx="252" ry="104" />
        <ellipse cx="330" cy="844" rx="148" ry="72" />
        <ellipse cx="496" cy="852" rx="192" ry="84" />
        <ellipse cx="700" cy="822" rx="128" ry="62" />
        <ellipse cx="812" cy="890" rx="234" ry="88" />
        <ellipse cx="1046" cy="838" rx="164" ry="78" />
        <ellipse cx="1230" cy="882" rx="222" ry="92" />
        <ellipse cx="1428" cy="840" rx="146" ry="68" />
        <ellipse cx="1494" cy="888" rx="234" ry="98" />
        <rect x="0" y="898" width="1600" height="130" />
      </g>
      {/* the lit crowns. Held to a whisper and softened: at full strength they
          separated from the bank and read as a row of discrete ovals. */}
      <g fill="#fffdf4" opacity=".5" filter="url(#edge)">
        <ellipse cx="248" cy="858" rx="126" ry="46" />
        <ellipse cx="392" cy="834" rx="78" ry="32" />
        <ellipse cx="556" cy="852" rx="62" ry="26" />
        <ellipse cx="640" cy="846" rx="104" ry="38" />
        <ellipse cx="944" cy="870" rx="136" ry="44" />
        <ellipse cx="1130" cy="842" rx="92" ry="34" />
        <ellipse cx="1256" cy="866" rx="70" ry="28" />
        <ellipse cx="1338" cy="850" rx="118" ry="42" />
      </g>

      {/* ================= drifting motes ================= */}
      <g fill="#8a6432">
        {MOTES.map(([x, y, r, o]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r={r} opacity={o} />
        ))}
      </g>

      {/* ================= finish ================= */}
      <rect width="1600" height="1000" fill="url(#vignette)" />
      {/* The vignette darkens right up to the top edge, which puts back the
          seam the earlier fade removed. One more pass, after it, settles the
          top row onto the section gradient's exact colour again. */}
      <rect width="1600" height="130" fill="url(#topfade)" />
      <rect width="1600" height="1000" filter="url(#plaster)" opacity=".07" style={{ mixBlendMode: 'multiply' }} />
    </svg>
  );
}
