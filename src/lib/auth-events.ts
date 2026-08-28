/**
 * Logging in and out happens inside AccountPanel, but the header is what has
 * to show the result. Rather than have the nav poll /api/auth/me on every
 * route change, the panel announces the change and the nav listens.
 */
export const AUTH_CHANGED = 'cf:auth-changed';

export function notifyAuthChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(AUTH_CHANGED));
}
