import Shell from '@/components/Shell';
import PageHeader from '@/components/PageHeader';
import Link from 'next/link';

export const metadata = { title: 'Privacy | Chatbot Forge' };

/**
 * A starting point, not legal advice.
 *
 * It describes what this codebase actually does — which is the part a template
 * off the internet always gets wrong — but the operator's name, jurisdiction
 * and contact address have to be filled in, and a lawyer should read it before
 * a real customer does. The placeholders are deliberately obvious.
 */
const OPERATOR = process.env.NEXT_PUBLIC_OPERATOR_NAME || '[your company name]';
const CONTACT = process.env.NEXT_PUBLIC_PRIVACY_EMAIL || '[privacy@yourdomain.com]';
const RETENTION_DAYS = process.env.BOOKING_RETENTION_DAYS || '365';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="mt-2 space-y-2 text-xs leading-relaxed text-slate-600">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <Shell>
      <PageHeader
        back={{ href: '/', label: 'Home' }}
        kicker="Legal"
        title="Privacy"
        sub={`How ${OPERATOR} handles the data that passes through Chatbot Forge.`}
      />

      <div className="max-w-2xl space-y-4">
        <Section title="Who we are">
          <p>
            Chatbot Forge is operated by {OPERATOR}. Questions about anything on this page go to {CONTACT}.
          </p>
        </Section>

        <Section title="What we store about you">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Your account:</strong> email address, a scrypt hash of your password (never the password), your
              credit balance, and when the account was created.
            </li>
            <li>
              <strong>Your chatbots:</strong> everything you configure — name, instructions, knowledge base contents,
              and the files or pages you add to it.
            </li>
            <li>
              <strong>Provider API keys,</strong> if you save one. Encrypted at rest with AES-256-GCM. They are used
              only to call the provider you chose, and are never shown back to you in full or sent to your visitors.
            </li>
            <li>
              <strong>Payment records:</strong> the credits you bought and when. Card details are handled entirely by
              Stripe and never reach our servers.
            </li>
          </ul>
        </Section>

        <Section title="What your visitors' data does">
          <p>
            Messages sent to your chatbots are forwarded to the model provider you selected in order to generate a
            reply. Transcripts are stored only if you switch conversation logging on for that bot, and are deleted
            automatically on the retention period you set.
          </p>
          <p>
            Booking requests hold whatever the visitor typed — usually a name and an email address or phone number.
            They are kept for {RETENTION_DAYS} days and then deleted automatically.
          </p>
          <p>
            If you run a bot on your own API key, your provider&apos;s privacy terms apply to those messages as well as
            ours. You are the controller of your visitors&apos; data; we process it on your behalf.
          </p>
        </Section>

        <Section title="Anonymous drafts">
          <p>
            You can build a chatbot before making an account. That draft is tied to a random identifier stored in your
            browser, not to you. Drafts nobody claims are deleted after 30 days.
          </p>
        </Section>

        <Section title="Who else sees it">
          <ul className="list-disc space-y-1 pl-5">
            <li>The AI provider you choose, for the messages needed to answer.</li>
            <li>Stripe, for payments.</li>
            <li>Our email provider, for password resets, receipts and booking notifications.</li>
            <li>Our hosting and database providers, who store it on our behalf.</li>
          </ul>
          <p>We do not sell your data, and we do not use your conversations to train models.</p>
        </Section>

        <Section title="Your control over it">
          <p>
            From your <Link href="/account" className="underline underline-offset-2">account page</Link> you can export
            everything we hold as a JSON file, or delete your account outright. Deletion removes your bots, their
            knowledge bases, stored transcripts, the bookings your visitors left, and your account record. It cannot be
            undone.
          </p>
          <p>
            If you are in the UK or EU, you also have the right to object to processing, to ask for a correction, and to
            complain to your data protection authority. Write to {CONTACT}.
          </p>
        </Section>

        <Section title="Security">
          <p>
            Passwords are hashed with scrypt. API keys are encrypted at rest. Sessions are signed cookies you can
            revoke on every device at once from your account page. No system is perfect, and we will tell affected
            users promptly if we ever learn of a breach.
          </p>
        </Section>

        <p className="hint">
          This page describes the software&apos;s actual behaviour. Before taking real customers, have someone
          qualified review it against the law where you operate, and replace the bracketed placeholders above.
        </p>
      </div>
    </Shell>
  );
}
