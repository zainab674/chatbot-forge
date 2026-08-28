import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { getProvider, PROVIDERS } from '@/lib/providers';
import { listPlatformKeys, setPlatformKey, clearPlatformKey } from '@/lib/platform-keys';
import { PLATFORM_MODELS } from '@/lib/platform';
import { serverError } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Longest key any provider issues, with room to spare. */
const MAX_KEY_LENGTH = 400;

/**
 * The platform's own provider keys — what the credits tier and the anonymous
 * trial spend. These replaced the OPENAI_API_KEY-style environment variables,
 * so a new provider or a rotated key no longer needs a redeploy.
 *
 * A stored key is never returned by any of these handlers, only its mask. The
 * plaintext leaves the database in exactly one place: the server-side grant
 * path in lib/credits.ts, on its way to the provider.
 */

/** GET — every provider, with the mask of its key when one is set. */
export async function GET(req: NextRequest) {
  try {
    const guard = await requireAdmin(req);
    if ('error' in guard) return guard.error;

    const stored = new Map((await listPlatformKeys()).map((k) => [k.provider, k]));

    return NextResponse.json({
      providers: PROVIDERS.map((p) => {
        const key = stored.get(p.id);
        return {
          id: p.id,
          label: p.label,
          keyUrl: p.keyUrl,
          mask: key?.mask ?? null,
          updatedBy: key?.updatedBy ?? null,
          updatedAt: key?.updatedAt ?? null,
          // Whether a key here can actually be spent yet. PLATFORM_MODELS is a
          // separate gate: a provider with no included model accepts a key and
          // then never uses it, which is worth saying out loud in the panel.
          servesIncludedModels: p.models.some((m) => PLATFORM_MODELS.has(m.id)),
        };
      }),
    });
  } catch (e) {
    return serverError(e);
  }
}

/** PUT — { provider, apiKey } stores or replaces one provider's key. */
export async function PUT(req: NextRequest) {
  try {
    const guard = await requireAdmin(req);
    if ('error' in guard) return guard.error;

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
    }

    const providerId = typeof body?.provider === 'string' ? body.provider.trim() : '';
    const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';
    const provider = getProvider(providerId);
    if (!provider) return NextResponse.json({ error: `Unknown provider "${providerId}".` }, { status: 400 });
    if (!apiKey) return NextResponse.json({ error: 'Paste a key, or use DELETE to remove one.' }, { status: 400 });
    if (apiKey.length > MAX_KEY_LENGTH) {
      return NextResponse.json({ error: 'That does not look like an API key.' }, { status: 400 });
    }

    const saved = await setPlatformKey(provider.id, apiKey, guard.admin.email);
    return NextResponse.json({
      provider: saved.provider,
      mask: saved.apiKeyMask,
      updatedBy: saved.updatedBy,
      updatedAt: saved.updatedAt,
    });
  } catch (e) {
    return serverError(e);
  }
}

/** DELETE — ?provider=openai removes that key. Bots with their own keys are unaffected. */
export async function DELETE(req: NextRequest) {
  try {
    const guard = await requireAdmin(req);
    if ('error' in guard) return guard.error;

    const providerId = req.nextUrl.searchParams.get('provider')?.trim() ?? '';
    const provider = getProvider(providerId);
    if (!provider) return NextResponse.json({ error: `Unknown provider "${providerId}".` }, { status: 400 });

    const removed = await clearPlatformKey(provider.id);
    if (!removed) return NextResponse.json({ error: 'No key was stored for that provider.' }, { status: 404 });
    return NextResponse.json({ provider: provider.id, mask: null });
  } catch (e) {
    return serverError(e);
  }
}
