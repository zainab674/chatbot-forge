import { NextRequest, NextResponse } from 'next/server';
import { users } from '@/lib/mongodb';
import { grantCredits } from '@/lib/credits';
import { getPack } from '@/lib/packs';
import { verifyWebhookSignature } from '@/lib/stripe';
import { sendMail } from '@/lib/mail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/billing/webhook — Stripe confirming that money arrived.
 *
 * This is the only thing that adds purchased credits. Three rules hold it up:
 *
 *   1. The raw body is verified against the signature before anything is read
 *      out of it. An unsigned request is indistinguishable from an attacker
 *      topping up their own account for free.
 *   2. The account comes from the event metadata, not from anything the
 *      customer typed into Stripe.
 *   3. The grant is keyed on the Stripe event id, so the retries Stripe sends
 *      after a timeout cannot pay out twice.
 */
export async function POST(req: NextRequest) {
  // Must be the exact bytes Stripe signed — parsing and re-serialising changes
  // them, and then no signature ever matches again.
  const raw = await req.text();

  const check = verifyWebhookSignature(raw, req.headers.get('stripe-signature'), process.env.STRIPE_WEBHOOK_SECRET);
  if (!check.ok) {
    console.warn('[chatbot-forge] rejected Stripe webhook:', check.error);
    return NextResponse.json({ error: 'Signature verification failed.' }, { status: 400 });
  }

  let event: any;
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  // Anything else is acknowledged and ignored: a 200 stops Stripe retrying
  // events this app has no opinion about.
  if (event?.type !== 'checkout.session.completed') {
    return NextResponse.json({ received: true, ignored: event?.type ?? 'unknown' });
  }

  const session = event?.data?.object ?? {};
  if (session.payment_status !== 'paid') {
    return NextResponse.json({ received: true, ignored: 'unpaid session' });
  }

  const userId: string = session?.metadata?.userId ?? session?.client_reference_id ?? '';
  const pack = getPack(session?.metadata?.packId);
  const credits = pack?.credits ?? parseInt(session?.metadata?.credits ?? '', 10);

  if (!userId || !Number.isFinite(credits) || credits <= 0) {
    console.error('[chatbot-forge] paid session with no usable metadata:', event.id);
    // 200, because retrying will not fix a malformed event — it needs a human.
    return NextResponse.json({ received: true, ignored: 'no account on event' });
  }

  try {
    const col = await users();
    const user = await col.findOne({ id: userId });
    if (!user) {
      console.error('[chatbot-forge] paid session for an unknown account:', userId, event.id);
      return NextResponse.json({ received: true, ignored: 'unknown account' });
    }

    const { credits: balance, alreadyApplied } = await grantCredits(
      userId,
      credits,
      'purchase',
      `${pack?.label ?? 'credits'} via Stripe`,
      event.id,
    );

    if (!alreadyApplied) {
      sendMail({
        to: user.email,
        subject: 'Your Chatbot Forge credits are ready',
        text:
          `Thanks. Your payment went through.\n\n` +
          `${credits.toLocaleString('en')} credits have been added. Your balance is now ${balance.toLocaleString('en')}.\n\n` +
          `Any bot saved without an API key of its own will now run on ours, on the included models.`,
      }).catch(() => {});
    }

    return NextResponse.json({ received: true, credits: balance, alreadyApplied });
  } catch (e) {
    console.error('[chatbot-forge] webhook failed:', e);
    // A 500 asks Stripe to retry, which is the right answer for a database
    // that was briefly down.
    return NextResponse.json({ error: 'Could not record the payment.' }, { status: 500 });
  }
}
