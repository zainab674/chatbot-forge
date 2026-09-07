import { NextRequest, NextResponse } from 'next/server';
import { users } from '@/lib/mongodb';
import { normalizeEmail, validEmail } from '@/lib/auth';
import { consume, clientKey, PER_AUTH } from '@/lib/ratelimit';
import { issueToken } from '@/lib/reset';
import { sendMail, appUrl, mailConfigured } from '@/lib/mail';
import { serverError } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/forgot — { email }
 *
 * Always answers the same way, whether or not the address has an account.
 * Anything else turns this into a free "does this person use your product"
 * lookup, which is exactly the list an attacker wants before trying passwords.
 */
export async function POST(req: NextRequest) {
  const same = NextResponse.json({
    ok: true,
    message: 'If that email has an account, a reset link is on its way. Check your spam folder too.',
  });

  const ip = clientKey(req.headers);
  const limit = await consume(`forgot:${ip}`, PER_AUTH);
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Too many reset requests. Give it a few minutes.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const email = normalizeEmail(body?.email);
  if (!validEmail(email)) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });

  try {
    // Also counted per address, so one inbox cannot be buried in reset mail.
    const perEmail = await consume(`forgot:email:${email}`, { max: 5, windowSec: 3_600 });
    if (!perEmail.ok) return same;

    const col = await users();
    const user = await col.findOne({ email });
    if (!user || user.deletedAt) return same;

    // No trustworthy address to build the link from means no email: sending
    // one built from the request's Host header would mail a working token to
    // wherever the requester asked. The caller still gets the same answer as
    // everyone else, and the operator gets a log line telling them what to fix.
    const base = appUrl(req);
    if (!base) {
      console.error(
        '[chatbot-forge] NEXT_PUBLIC_APP_URL is not set, so no reset link can be built safely. ' +
          'Password resets are disabled until it is configured.',
      );
      return same;
    }

    const token = await issueToken(user, 'reset');
    const link = `${base}/reset?token=${encodeURIComponent(token)}`;

    await sendMail({
      to: user.email,
      subject: 'Reset your Chatbot Forge password',
      text:
        `Someone asked to reset the password for this account.\n\n` +
        `${link}\n\n` +
        `The link works once and expires in an hour. If this was not you, ignore this email. ` +
        `Nothing has changed, and your current password still works.`,
    });

    if (!mailConfigured()) {
      // Loud, because a deployment in this state cannot recover accounts.
      console.error('[chatbot-forge] password reset requested but no mailer is configured.');
    }
    return same;
  } catch (e) {
    return serverError(e);
  }
}
