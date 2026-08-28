import { NextRequest, NextResponse } from 'next/server';
import { users } from '@/lib/mongodb';
import { grantCredits } from '@/lib/credits';
import { normalizeEmail } from '@/lib/auth';
import { requireAdmin } from '@/lib/admin';
import { serverError } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/credits — { email, amount }
 *
 * Manual top-ups: the admin takes a payment however they like, then grants the
 * credits here. Negative amounts correct mistakes; the balance never drops
 * below zero.
 */
export async function POST(req: NextRequest) {
  try {
    const guard = await requireAdmin(req);
    if ('error' in guard) return guard.error;

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
    }

    const email = normalizeEmail(body?.email);
    const amount = Math.round(Number(body?.amount));
    if (!email) return NextResponse.json({ error: 'Which account? Pass an email.' }, { status: 400 });
    if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 1_000_000) {
      return NextResponse.json({ error: 'Amount must be a non-zero number of credits.' }, { status: 400 });
    }

    const col = await users();
    const target = await col.findOne({ email });
    if (!target) return NextResponse.json({ error: `No account with email ${email}.` }, { status: 404 });

    // Through grantCredits so the movement lands in the ledger: a balance
    // nobody can explain is the first thing a paying customer asks about.
    const { credits } = await grantCredits(
      target.id,
      amount,
      'admin-grant',
      `by ${guard.admin.email}`,
    );
    return NextResponse.json({ email, credits });
  } catch (e) {
    return serverError(e);
  }
}
