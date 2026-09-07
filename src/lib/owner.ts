'use client';

/**
 * Lightweight "who am I" for a no-login product: a random id kept in
 * localStorage that scopes the dashboard to this browser. Replace `getOwnerId`
 * with your session user id when you bolt on real auth — nothing else changes.
 */
import { randomId } from './random-id';

const KEY = 'chatbot-forge:owner';

export function getOwnerId(): string {
  if (typeof window === 'undefined') return '';
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = randomId();
    localStorage.setItem(KEY, id);
  }
  return id;
}

export function ownerHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { 'Content-Type': 'application/json', 'x-owner-id': getOwnerId(), ...extra };
}
