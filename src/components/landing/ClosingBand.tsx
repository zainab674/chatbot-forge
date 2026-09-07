/**
 * The last thing on the page: the same offer the hero made, restated to
 * somebody who has now read the whole thing.
 *
 * It used to light itself — a soft sheen crossing the sand on arrival and then
 * every few seconds, forever. Two problems with that. A highlight sweeping
 * across a panel on a loop is the same gesture as the cursor-lamp that used to
 * sit on the cards, and it never stops, so it competes with the button for the
 * rest of the visit. A closing band is noticed because of where it sits and
 * what it says, not because it glints.
 *
 * Static markup now, so this renders on the server like the copy around it.
 */

import Link from 'next/link';

export default function ClosingBand() {
  return (
    <section className="band tone-sand mt-20 text-center">
      <p className="kicker mb-5 text-accent-800">Two minutes, no account</p>

      <h2 className="display-sm mx-auto max-w-[18ch]">Describe it once. Keep it when you sign up.</h2>

      <div className="mt-9">
        <Link href="/create" className="btn-dark">
          Create a chatbot
        </Link>
      </div>
    </section>
  );
}
