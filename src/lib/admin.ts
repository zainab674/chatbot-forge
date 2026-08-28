import { NextRequest, NextResponse } from 'next/server';
import { users } from './mongodb';
import { sessionOf, sessionRevoked, isAdmin } from './auth';
import type { UserDoc } from './types';

/**
 * Admin = the logged-in account carrying `role: 'admin'`, or the root admin
 * named by ADMIN_EMAIL (see `isAdmin`). A 404 (not 403) for non-admins, so the
 * panel's existence is not advertised to people probing the API.
 */
export async function requireAdmin(
  req: NextRequest,
): Promise<{ admin: UserDoc } | { error: NextResponse }> {
  const session = sessionOf(req);
  if (!session) return { error: NextResponse.json({ error: 'Not found.' }, { status: 404 }) };
  const col = await users();
  const user = await col.findOne({ id: session.userId });
  if (!user || user.deletedAt || sessionRevoked(session, user) || !isAdmin(user)) {
    return { error: NextResponse.json({ error: 'Not found.' }, { status: 404 }) };
  }
  return { admin: user };
}
