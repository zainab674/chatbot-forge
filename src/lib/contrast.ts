/**
 * Picks a readable foreground for an arbitrary accent colour.
 *
 * Creators can choose any accent, including pale yellows and cyans. Hard-coding
 * white text on top of those drops the contrast ratio to around 2:1, well under
 * the WCAG AA threshold of 4.5:1 for body text, so the label is computed from
 * the accent's relative luminance instead.
 */

export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').trim();
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  const n = parseInt(full.slice(0, 6), 16);
  if (!Number.isFinite(n)) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const channels = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const WHITE = '#ffffff';
const INK = '#0f172a'; // slate-900

/** White or near-black, whichever reads better on the given background. */
export function readableOn(background: string): string {
  return contrastRatio(background, WHITE) >= contrastRatio(background, INK) ? WHITE : INK;
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * A background/foreground pair for text on the accent colour, guaranteed to
 * clear WCAG AA (4.5:1).
 *
 * Mid-tone accents like indigo land just under the threshold against both white
 * and near-black, so the accent is nudged darker (or lighter) in small steps
 * until the pair passes. The hue is preserved, so it still reads as the
 * creator's colour; untouched whenever the accent already passes, which is most
 * of the time.
 */
export function accessibleSurface(accent: string, minRatio = 4.5): { background: string; foreground: string } {
  const foreground = readableOn(accent);
  if (contrastRatio(accent, foreground) >= minRatio) return { background: accent, foreground };

  const rgb = hexToRgb(accent);
  // White text needs a darker background; dark text needs a lighter one.
  const towardsBlack = foreground === WHITE;

  for (let step = 1; step <= 20; step++) {
    const t = step * 0.04;
    const adjusted: [number, number, number] = towardsBlack
      ? [rgb[0] * (1 - t), rgb[1] * (1 - t), rgb[2] * (1 - t)]
      : [rgb[0] + (255 - rgb[0]) * t, rgb[1] + (255 - rgb[1]) * t, rgb[2] + (255 - rgb[2]) * t];
    const candidate = toHex(adjusted);
    if (contrastRatio(candidate, foreground) >= minRatio) return { background: candidate, foreground };
  }
  // Should be unreachable, but never return something unreadable.
  return { background: towardsBlack ? INK : WHITE, foreground: towardsBlack ? WHITE : INK };
}
