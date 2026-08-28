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

/** The address links in emails point at. */
export function appUrl(req?: { headers: Headers }): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '');
  if (configured) return configured;
  const host = req?.headers.get('host');
  if (host) return `${host.startsWith('localhost') ? 'http' : 'https'}://${host}`;
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
