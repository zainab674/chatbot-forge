import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import ChatWindow from '@/components/ChatWindow';
import { getPublicBot } from '@/lib/bot-service';
import { getChatTheme } from '@/lib/themes';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  try {
    const bot = await getPublicBot(params.id);
    if (!bot) return { title: 'Chatbot not found' };
    return {
      title: bot.name,
      description: bot.tagline || `Chat with ${bot.name}`,
      openGraph: { title: bot.name, description: bot.tagline || `Chat with ${bot.name}` },
    };
  } catch {
    return { title: 'Chat' };
  }
}

/** Full-page hosted chat — the "share link" surface. */
export default async function ChatPage({ params }: { params: { id: string } }) {
  let bot = null;
  try {
    bot = await getPublicBot(params.id);
  } catch (e: any) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-center text-sm text-slate-500">
        {e?.message ?? 'Could not load this chatbot.'}
      </div>
    );
  }
  if (!bot) notFound();

  const theme = getChatTheme(bot.theme);
  const dark = theme.dark;

  /*
   * Every ancestor of the window carries a *definite* height, and that is not
   * decoration. `min-h-screen` leaves the flex chain indefinite, so the
   * window's own `height: 100%` had nothing to resolve against and it
   * collapsed to its content — the composer floated mid-page with a dead band
   * under it. `h-dvh` (which also survives a mobile URL bar) makes the chain
   * definite the whole way down, and `min-h-0` lets the conversation scroll
   * inside it rather than pushing the composer off the bottom.
   */
  return (
    <div className="flex h-dvh flex-col overflow-hidden" style={{ background: theme.page }}>
      <div className="mx-auto flex h-full w-full max-w-3xl flex-col p-0 sm:px-6 sm:pb-2 sm:pt-6">
        <div
          className={`flex min-h-0 flex-1 overflow-hidden sm:rounded-2xl sm:border sm:shadow-xl ${
            dark ? 'sm:border-slate-800' : 'sm:border-slate-200'
          }`}
        >
          <ChatWindow bot={bot} fill />
        </div>
        <p className={`hidden py-3 text-center text-xs sm:block ${dark ? 'text-slate-600' : 'text-slate-400'}`}>
          Powered by Chatbot Forge
        </p>
      </div>
    </div>
  );
}
