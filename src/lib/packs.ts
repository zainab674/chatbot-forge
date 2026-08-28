/**
 * What credits cost.
 *
 * Kept in code rather than in Stripe's dashboard so the app can show prices
 * without a network call, and so a deployment cannot end up offering a pack
 * that its own credit logic does not recognise. Stripe is told the amount at
 * checkout time (`price_data`), which means there is nothing to keep in sync.
 *
 * A credit is one message on the platform's keys, sized by `TOKENS_PER_CREDIT`
 * in lib/credits.ts. Set the prices to something that covers your own model
 * spend with room to spare — these are a starting point, not advice.
 */

export interface Pack {
  id: string;
  label: string;
  credits: number;
  /** In the smallest currency unit, e.g. cents. */
  amount: number;
  /** Shown under the price to explain who it suits. */
  note: string;
}

export const CURRENCY = (process.env.NEXT_PUBLIC_CURRENCY || 'usd').toLowerCase();

export const PACKS: Pack[] = [
  { id: 'starter', label: 'Starter', credits: 1_000, amount: 900, note: 'A small site widget for a month or so.' },
  { id: 'standard', label: 'Standard', credits: 5_000, amount: 3_900, note: 'A busy support bot. Best value per credit.' },
  { id: 'scale', label: 'Scale', credits: 20_000, amount: 12_900, note: 'Several bots, or one that gets real traffic.' },
];

export function getPack(id: unknown): Pack | undefined {
  return typeof id === 'string' ? PACKS.find((p) => p.id === id) : undefined;
}

/** "$9.00" — for display only; Stripe renders its own totals at checkout. */
export function formatPrice(amount: number, currency = CURRENCY): string {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: currency.toUpperCase() }).format(amount / 100);
  } catch {
    return `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}
