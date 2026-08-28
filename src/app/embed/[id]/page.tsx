import { notFound } from 'next/navigation';
import ChatWindow from '@/components/ChatWindow';
import EmbedBridge from '@/components/EmbedBridge';
import { getPublicBot } from '@/lib/bot-service';
import { getChatTheme } from '@/lib/themes';

export const dynamic = 'force-dynamic';

/**
 * Chrome-free chat, sized to fill whatever iframe it is dropped into.
 * Framing is allowed for this route in next.config.mjs.
 */
export default async function EmbedPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { header?: string; footer?: string };
}) {
  let bot = null;
  try {
    bot = await getPublicBot(params.id);
  } catch {
    bot = null;
  }
  if (!bot) notFound();

  return (
    <div className="h-screen w-screen overflow-hidden" style={{ background: getChatTheme(bot.theme).surface }}>
      <EmbedBridge />
      <ChatWindow
        bot={bot}
        fill
        showHeader={searchParams.header !== '0'}
        showFooter={searchParams.footer !== '0'}
      />
    </div>
  );
}
