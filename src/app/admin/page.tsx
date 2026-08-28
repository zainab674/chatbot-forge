import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Shell from '@/components/Shell';
import PageHeader from '@/components/PageHeader';
import AdminPanel from '@/components/AdminPanel';
import { verifySessionToken, SESSION_COOKIE } from '@/lib/auth';

export const metadata = { title: 'Admin | Chatbot Forge' };
export const dynamic = 'force-dynamic';

export default function AdminPage() {
  // Cheap first gate; the API re-checks the admin email on every call.
  if (!verifySessionToken(cookies().get(SESSION_COOKIE)?.value)) {
    redirect('/account?next=/admin');
  }
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
