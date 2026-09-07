import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import Shell from '@/components/Shell';
import PageHeader from '@/components/PageHeader';
import AdminPanel from '@/components/AdminPanel';
import { users } from '@/lib/mongodb';
import { isAdmin, sessionRevoked, verifySession, SESSION_COOKIE } from '@/lib/auth';

export const metadata = {
  title: 'Admin | Chatbot Forge',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

/**
 * The page gate, and it now matches the one on the API behind it.
 *
 * It used to check only that *some* valid session cookie existed, so any signed
 * in visitor could open /admin, read the heading and watch the data fail to
 * load. That quietly gave away the thing `requireAdmin` goes out of its way to
 * hide — it answers non-admins with 404 rather than 403 precisely so the
 * panel's existence is not advertised to anyone probing. A page that renders
 * its own title to those same people undoes that.
 *
 * So: 404 for everyone who is not a verified admin, signed in or not. Admins
 * reach it from the header link, which only appears when the account qualifies.
 *
 * It fails closed. If the account lookup throws — the database is down, say —
 * admin status cannot be established, so the answer is the same 404 rather than
 * a panel rendered on the strength of a cookie alone.
 */
export default async function AdminPage() {
  const session = verifySession(cookies().get(SESSION_COOKIE)?.value);

  let allowed = false;
  if (session) {
    try {
      const user = await (await users()).findOne({ id: session.userId });
      allowed = Boolean(user && !user.deletedAt && !sessionRevoked(session, user) && isAdmin(user));
    } catch {
      allowed = false;
    }
  }
  // Outside the try: notFound() works by throwing, and a catch would eat it.
  if (!allowed) notFound();

  return (
    <Shell wide>
      <PageHeader
        back={{ href: '/account', label: 'Account' }}
        kicker="Platform"
        title="Admin"
        sub="Everyone and everything on the platform. Promote a teammate to admin, grant credits after taking a payment, or pause a bot to cut off abuse."
      />
      <AdminPanel />
    </Shell>
  );
}
