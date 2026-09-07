import { Suspense } from 'react';
import Shell from '@/components/Shell';
import PageHeader from '@/components/PageHeader';
import ResetPassword from '@/components/ResetPassword';

export const metadata = {
  title: 'Reset password | Chatbot Forge',
  robots: { index: false, follow: false },
};

export default function ResetPage() {
  return (
    <Shell>
      <PageHeader
        back={{ href: '/account', label: 'Account' }}
        kicker="Account recovery"
        title="Choose a new password"
        sub="This link works once. After it is used, everything signed into this account is signed out."
      />
      {/* useSearchParams needs a boundary, or the whole route opts out of static rendering. */}
      <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
        <ResetPassword />
      </Suspense>
    </Shell>
  );
}
