import { Suspense } from 'react';
import Shell from '@/components/Shell';
import PageHeader from '@/components/PageHeader';
import VerifyEmail from '@/components/VerifyEmail';

export const metadata = {
  title: 'Confirm email | Chatbot Forge',
  robots: { index: false, follow: false },
};

export default function VerifyPage() {
  return (
    <Shell>
      <PageHeader back={{ href: '/account', label: 'Account' }} kicker="Your account" title="Confirming your email" />
      <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
        <VerifyEmail />
      </Suspense>
    </Shell>
  );
}
