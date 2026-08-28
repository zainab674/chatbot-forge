'use client';

import { useEffect } from 'react';

/**
 * Lets the chat inside the iframe talk to the widget loader on the host page.
 * Without this, Escape does nothing while the visitor is typing, because the
 * keydown never reaches the parent document.
 */
export default function EmbedBridge() {
  useEffect(() => {
    if (window.parent === window) return;

    const post = (type: string, payload: Record<string, unknown> = {}) => {
      // '*' is safe here: the message carries no secrets, and the widget only
      // acts on messages whose origin matches the script it was loaded from.
      window.parent.postMessage({ source: 'chatbot-forge', type, ...payload }, '*');
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') post('close');
    };

    window.addEventListener('keydown', onKey);
    post('ready');
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return null;
}
