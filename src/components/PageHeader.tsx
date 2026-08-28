import Link from 'next/link';

/**
 * The one opening every interior page uses: a way back, what this page is, and
 * the actions that belong to it — in that order, on that measure. Before this
 * each page invented its own heading, so /bots, /account, /admin and the two
 * bot screens all announced themselves at different sizes and put their
 * primary action in a different place.
 */
export default function PageHeader({
  back,
  kicker,
  title,
  sub,
  icon,
  actions,
}: {
  /** Where "up" is. Every page below the top level should set it. */
  back?: { href: string; label: string };
  /** The small tracked caption above the title. */
  kicker?: string;
  title: React.ReactNode;
  sub?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-8">
      {back && (
        <Link href={back.href} className="crumb mb-4">
          <span className="crumb-arrow" aria-hidden>
            ←
          </span>
          {back.label}
        </Link>
      )}
      <div className="page-head">
        <div className="flex min-w-0 items-start gap-4">
          {icon}
          <div className="min-w-0">
            {kicker && <p className="kicker mb-2.5">{kicker}</p>}
            <h1 className="page-title">{title}</h1>
            {sub && <p className="page-sub">{sub}</p>}
          </div>
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
    </div>
  );
}
