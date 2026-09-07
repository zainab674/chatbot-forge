/**
 * The robot's colours, taken from the Tailwind ramps rather than picked by eye,
 * so the scene and the page around it are painted out of one tin.
 *
 * These are the `sand` and `ink` ramps from `tailwind.config.ts`. They are
 * repeated here as plain hex because three.js materials cannot read Tailwind
 * classes — if a ramp changes there, change it here too.
 */
export const C = {
  /** sand-50 — the brightest highlight, and the whites of the eyes. */
  cream: '#FBF6ED',
  /** sand-100 — the shell's lit face. */
  shell: '#F7EEDD',
  /** sand-200 — the shell's body colour. */
  shellMid: '#EFDFC3',
  /** sand-300 — shadowed shell, and the far-off blocks. */
  shellDeep: '#E3C89B',
  /** sand-400 / ochre-400 — polished brass on the joints and the wheel hub. */
  brass: '#D8B37A',
  brassLit: '#D5AA4C',
  /** sand-500 / sand-600 — the darker bronze the headphones and tyre take. */
  bronze: '#C79A55',
  bronzeDeep: '#9C7238',
  /** ink-900 — the screen, and the tyre's rubber. */
  ink: '#2A302C',
  ink800: '#373B37',
  /** The ground and the air. Matches `.fresco-plate`'s gradient so the canvas
   *  and the CSS behind it meet without a seam. */
  floor: '#F2E5CB',
  haze: '#F7EED9',
} as const;
