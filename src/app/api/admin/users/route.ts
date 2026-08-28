import { NextRequest, NextResponse } from 'next/server';
import { users } from '@/lib/mongodb';
import { normalizeEmail, isAdminEmail } from '@/lib/auth';
import { requireAdmin } from '@/lib/admin';
import { serverError } from '@/lib/http';
import type { UserRole } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROLES: UserRole[] = ['user', 'admin'];

/**
 * PATCH /api/admin/users — { email, role }
 *
 * Promote an account to admin, or demote it back. Three refusals are
 * deliberate, and all three exist to keep the panel reachable:
 *
 *   - You cannot change your own role. Demoting yourself is the quickest way
 *     to lock yourself out, and there is no self-service way back in.
 *   - You cannot demote the ADMIN_EMAIL root admin. That account is the
 *     bootstrap: if it could be demoted from here, a platform with no other
 *     admin would have no way back except editing the database by hand.
 *   - Anything outside the known role set is rejected rather than stored, so a
 *     typo can never write a role that `isAdmin` will not recognise.
 */
export async function PATCH(req: NextRequest) {
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
    const role = body?.role;
    if (!email) return NextResponse.json({ error: 'Which account? Pass an email.' }, { status: 400 });
    if (!ROLES.includes(role)) {
      return NextResponse.json({ error: 'Role must be "user" or "admin".' }, { status: 400 });
    }

    const col = await users();
    const target = await col.findOne({ email });
    if (!target) return NextResponse.json({ error: `No account with email ${email}.` }, { status: 404 });

    if (target.id === guard.admin.id) {
      return NextResponse.json(
        { error: 'You cannot change your own role. Ask another admin to do it.' },
        { status: 400 },
      );
    }
    if (isAdminEmail(target.email) && role !== 'admin') {
      return NextResponse.json(
        { error: 'This is the root admin from ADMIN_EMAIL. Change that environment variable instead.' },
        { status: 400 },
      );
    }

    await col.updateOne({ id: target.id }, { $set: { role } });
    return NextResponse.json({ email: target.email, role });
  } catch (e) {
    return serverError(e);
  }
}
