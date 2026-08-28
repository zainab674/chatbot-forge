import Link from 'next/link';
import { cookies } from 'next/headers';
import Shell from '@/components/Shell';
import BotForm from '@/components/BotForm';
import { verifySessionToken, SESSION_COOKIE } from '@/lib/auth';
import { ANON_TRIAL_MESSAGES } from '@/lib/platform';

export const metadata = { title: 'New chatbot | Chatbot Forge' };
export const dynamic = 'force-dynamic';

export default function CreatePage() {
  // No signup wall here: visitors build drafts anonymously and hit the account
  // ask only where keys are involved. The API enforces the same split.
  const loggedIn = Boolean(verifySessionToken(cookies().get(SESSION_COOKIE)?.value));
  return (
    <Shell wide>
      {/* The builder is the page. Its own rail carries the heading work, so all
          that belongs above it is a way back out and the one line about what
          this costs you — the crumb matching every other interior page. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link href="/bots" className="crumb">
          <span className="crumb-arrow" aria-hidden>
            ←
          </span>
          My bots
        </Link>
        <span className="pill">
          <span className="ping bg-emerald-500" />
          {loggedIn ? 'Signed in' : `Draft mode · ${ANON_TRIAL_MESSAGES} free trial messages, no account`}
        </span>
      </div>
      <BotForm mode="create" anonMode={!loggedIn} />
    </Shell>
  );
}
