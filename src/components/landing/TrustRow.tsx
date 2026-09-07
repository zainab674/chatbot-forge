/**
 * The provider row under the hero. Names only, tracked out: proof that the
 * "any model" line is a fact and not a slogan.
 *
 * Static, and that is the point. The row is evidence, and evidence that
 * performs is less convincing. The names used to deal in one at a time on a
 * stagger, which is the gesture every generated landing page makes at its logo
 * strip, and it delayed the one thing on this row a reader actually wants:
 * the names.
 */

export default function TrustRow({ providers }: { providers: readonly string[] }) {
  return (
    <section className="trust mb-16">
      <span className="text-[10.5px] font-medium uppercase tracking-label text-slate-700">Runs on</span>
      {providers.map((p) => (
        <b key={p}>{p}</b>
      ))}
    </section>
  );
}
