import Shell from '@/components/Shell';
import PageHeader from '@/components/PageHeader';
import AccountPanel from '@/components/AccountPanel';

export const metadata = { title: 'Account | Chatbot Forge' };

export default function AccountPage() {
  return (
    <Shell>
      <PageHeader
        back={{ href: '/', label: 'Home' }}
        kicker="Your account"
        title="Account"
        sub="Free with your own API keys, forever. Or add credits and run your bots on ours — no key hunting."
      />
      <AccountPanel />
    </Shell>
  );
}
