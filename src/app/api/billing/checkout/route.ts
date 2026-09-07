import { NextRequest, NextResponse } from 'next/server';
import { users } from '@/lib/mongodb';
import { sessionOf, sessionRevoked } from '@/lib/auth';
import { consume, clientKey } from '@/lib/ratelimit';
import { getPack, PACKS } from '@/lib/packs';
import { createCheckoutSession, stripeConfigured } from '@/lib/stripe';
import { appUrl } from '@/lib/mail';
import { serverError } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/billing/checkout — the packs on offer, and whether buying works. */
export async function GET() {
  return NextResponse.json({ packs: PACKS, enabled: stripeConfigured() });
}

/**
 * POST /api/billing/checkout — { packId }
 *
 * Returns a Stripe Checkout URL. Nothing here touches a balance: credits are
 * granted by the webhook, once Stripe confirms the money actually arrived.
 * Trusting this response instead would hand out credits to anyone who can open
 * a checkout page and close it again.
 */
export async function POST(req: NextRequest) {
  if (!stripeConfigured()) {
    return NextResponse.json(
      { error: 'Card payments are not switched on for this deployment. Ask an admin for a manual top-up.' },
      { status: 503 },
    );
  }

  const session = sessionOf(req);
  if (!session) return NextResponse.json({ error: 'Log in to buy credits.' }, { status: 401 });

  const limit = await consume(`checkout:${clientKey(req.headers)}`, { max: 10, windowSec: 600 });
  if (!limit.ok) {
    return NextResponse.json({ error: 'Too many checkout attempts. Give it a moment.' }, { status: 429 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const pack = getPack(body?.packId);
  if (!pack) return NextResponse.json({ error: 'Pick one of the listed credit packs.' }, { status: 400 });

  try {
    const col = await users();
    const user = await col.findOne({ id: session.userId });
    if (!user || user.deletedAt || sessionRevoked(session, user)) {
      return NextResponse.json({ error: 'Log in to buy credits.' }, { status: 401 });
    }
    // A receipt sent to an address nobody has confirmed is a support ticket
    // waiting to happen, and it is also how someone would put credits onto an
    // account that is not theirs.
    if (!user.emailVerifiedAt) {
      return NextResponse.json(
        { error: 'Confirm your email address first: the receipt and any refund go there.' },
        { status: 403 },
      );
    }

    // Stripe needs somewhere to send the customer back to, and that somewhere
    // must not come from a header the caller wrote.
    const origin = appUrl(req);
    if (!origin) {
      console.error('[chatbot-forge] NEXT_PUBLIC_APP_URL is not set; checkout cannot build its return URLs.');
      return NextResponse.json(
        { error: 'Card payments are not fully configured on this deployment yet.' },
        { status: 503 },
      );
    }

    const checkout = await createCheckoutSession({
      pack,
      userId: user.id,
      email: user.email,
      origin,
    });
    return NextResponse.json({ url: checkout.url });
  } catch (e) {
    return serverError(e);
  }
}
