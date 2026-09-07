/**
 * The numbered three-up, set as columns rather than cards.
 *
 * It used to be three white sheets with a border, a radius and a shadow, and
 * they arrived one after another as you scrolled past. Both of those are the
 * house style of every generated landing page there is: the icon-box trio, and
 * the stagger. Neither was carrying meaning here.
 *
 * What replaces them is the treatment the rest of this page already uses — a
 * hairline rule, a hanging numeral in the display serif, and text on the same
 * measure as everything else. Three columns, no boxes, nothing to wait for.
 *
 * No 'use client' any more either: with the motion gone there is no state, no
 * effect and no event handler left, so this renders on the server.
 */

export type Pillar = readonly [string, string, string];

export default function Pillars({ pillars }: { pillars: readonly Pillar[] }) {
  return (
    <section className="mb-20 grid gap-x-10 gap-y-11 sm:grid-cols-3">
      {pillars.map(([num, title, body]) => (
        <div key={title} className="pillar">
          <span className="pillar-n">{num}</span>
          <h3 className="mt-4 font-serif text-[22px] font-normal">{title}</h3>
          <p className="mt-3 text-[13.5px] font-light leading-[1.8] text-slate-700">{body}</p>
        </div>
      ))}
    </section>
  );
}
