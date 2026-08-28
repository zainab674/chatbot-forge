/**
 * Outbound email.
 *
 * Deliberately dependency-free: Resend's REST API is one POST, and adding an
 * SMTP client for three transactional messages would be more moving parts than
 * the feature deserves. Set RESEND_API_KEY and MAIL_FROM to turn it on.
 *
 * When it is not configured the app still works — a reset link is written to
 * the server log instead of being sent, which is what makes local development
 * possible without an email account. That fallback is loud on purpose: a
 * production deployment with no mailer means nobody can recover an account.
 */

export interface Mail {
  to: string;
  subject: string;
  /** Plain text. The HTML part is generated from it; nobody needs a template engine here. */
  text: string;
}

export interface SendResult {
  delivered: boolean;
  /** Set when the message could not be handed to the provider. */
  error?: string;
}

export function mailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
}

/**
 * The address links in emails point at.
 *
 * Returns null rather than guessing in production, because the obvious guess —
 * the request's own Host header — is written by whoever sent the request. A
 * password reset is requested by an attacker and delivered to the victim, so a
 * Host of `evil.example` would put a real, working reset token into a link
 * pointing at the attacker's server, in an email the victim has every reason to
 * trust. Set NEXT_PUBLIC_APP_URL and there is nothing to guess.
 *
 * The Host fallback survives only outside production, where it is what makes
 * `npm run dev` work without configuration.
 */
export function appUrl(req?: { headers: Headers }): string | null {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '');
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') return null;

  const host = req?.headers.get('host');
  if (host) return `${host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https'}://${host}`;
  return 'http://localhost:3000';
}

function toHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  // Bare URLs become links; everything else stays as typed.
  const linked = escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" style="color:#4f46e5">$1</a>',
  );
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#111">${linked
    .split('\n\n')
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('')}</div>`;
}

export async function sendMail(mail: Mail): Promise<SendResult> {
  if (!mailConfigured()) {
    console.warn(
      `[chatbot-forge] no mailer configured (set RESEND_API_KEY and MAIL_FROM). Message for ${mail.to} not sent:\n` +
        `--- ${mail.subject} ---\n${mail.text}\n---`,
    );
    return { delivered: false, error: 'not-configured' };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: process.env.MAIL_FROM,
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
        html: toHtml(mail.text),
      }),
    });

    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      console.error('[chatbot-forge] email send failed:', res.status, detail);
      return { delivered: false, error: `provider returned ${res.status}` };
    }
    return { delivered: true };
  } catch (e) {
    console.error('[chatbot-forge] email send failed:', e);
    return { delivered: false, error: (e as Error).message };
  }
}
