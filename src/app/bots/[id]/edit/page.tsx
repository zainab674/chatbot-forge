import Shell from '@/components/Shell';
import EditBot from '@/components/EditBot';

export const metadata = { title: 'Edit chatbot — Chatbot Forge' };

export default function EditPage({ params }: { params: { id: string } }) {
  return (
    <Shell wide>
      <EditBot id={params.id} />
    </Shell>
  );
}
