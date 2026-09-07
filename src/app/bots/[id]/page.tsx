import Shell from '@/components/Shell';
import ManageBot from '@/components/ManageBot';

export const metadata = {
  title: 'Chatbot | Chatbot Forge',
  robots: { index: false, follow: false },
};

export default function BotPage({ params }: { params: { id: string } }) {
  return (
    <Shell wide>
      <ManageBot id={params.id} />
    </Shell>
  );
}
