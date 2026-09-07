import Link from 'next/link';
import Shell from '@/components/Shell';
import PageHeader from '@/components/PageHeader';
import BotList from '@/components/BotList';

export const metadata = {
  title: 'My bots | Chatbot Forge',
  robots: { index: false, follow: false },
};

/** The dashboard. The homepage sells the product; this page manages what you built. */
export default function BotsPage() {
  return (
    <Shell>
      <PageHeader
        back={{ href: '/', label: 'Home' }}
        kicker="Dashboard"
        title="My bots"
        sub="Everything you have built, newest first. Open one to get its embed snippets, edit it, or watch it answer."
        actions={
          <Link href="/create" className="btn-primary">
            New bot
          </Link>
        }
      />
      <BotList />
    </Shell>
  );
}
