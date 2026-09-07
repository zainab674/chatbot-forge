/**
 * Outbound email, over SMTP.
 *
 * This used to POST to Resend's REST API, which is one call and no dependency —
 * but Resend will not deliver to an arbitrary address until you have verified a
 * sending domain in its dashboard, and that requirement is what left this whole
 * feature switched off. SMTP takes any mailbox you already own: a Google
 * Workspace account, Fastmail, your host's relay, or the SMTP endpoint those
 * same transactional providers also expose.
 *
 * Set SMTP_HOST and MAIL_FROM to turn it on. SMTP_USER and SMTP_PASS are
 * optional, because an internal relay on a private network often wants neither.
 *
 * When it is not configured the app still works: a reset link is written to the
 * server log instead of being sent, which is what makes `npm run dev` possible
 * without an email account. That fallback is loud on purpose — a production
 * deployment with no mailer means nobody can recover an account.
 *
 * One note for serverless. AWS Lambda, which is what Netlify Functions run on,
 * blocks outbound port 25. Use 587 (STARTTLS) or 465 (implicit TLS); both are
 * open, and 587 is the default here.
 */

import nodemailer, { type Transporter } from 'nodemailer';

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

/** Port 465 is implicit TLS; everything else negotiates STARTTLS. */
function smtpPort(): number {
  const raw = parseInt(process.env.SMTP_PORT ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 587;
}

export function mailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST?.trim() && process.env.MAIL_FROM?.trim());
}

/**
 * The connection, made once and kept.
 *
 * Held at module scope so a warm serverless instance reuses it instead of
 * paying for a TCP handshake, a TLS handshake and an AUTH round trip on every
 * message. Cleared if creating it throws, so one bad startup does not poison
 * the process for as long as it lives — the same reasoning as the Mongo client.
 */
let transport: Transporter | null = null;

function transporter(): Transporter {
  if (transport) return transport;

  const port = smtpPort();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS;

  try {
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST!.trim(),
      port,
      // Implicit TLS on 465. On 587 the connection starts in the clear and is
      // upgraded — `requireTLS` makes that upgrade mandatory rather than
      // best-effort, so credentials are never sent over a plaintext socket
      // because a server declined to offer STARTTLS.
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
      requireTLS: port !== 465,
      // Deliberately no `tls: { rejectUnauthorized: false }`. It is the usual
      // copy-paste fix for a certificate error and it turns off the only thing
      // stopping someone between here and the mail server reading the password
      // and every reset token that goes through it.
      auth: user ? { user, pass } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    return transport;
  } catch (e) {
    transport = null;
    throw e;
  }
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
      `[chatbot-forge] no mailer configured (set SMTP_HOST and MAIL_FROM). Message for ${mail.to} not sent:\n` +
        `--- ${mail.subject} ---\n${mail.text}\n---`,
    );
    return { delivered: false, error: 'not-configured' };
  }

  try {
    /* Subject and recipient are both partly attacker-influenced — a booking
       notification puts a visitor's name in the subject line. nodemailer
       encodes both as MIME headers rather than concatenating them, so a
       newline cannot open a Bcc of somebody else's choosing. The booking route
       strips control characters as well; two locks on one door, deliberately. */
    const info = await transporter().sendMail({
      from: process.env.MAIL_FROM,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: toHtml(mail.text),
    });

    /* A 250 from the server means it accepted the message, not that a human
       will read it. `rejected` is how a relay says it took the envelope but
       will not attempt one of the recipients. */
    if (info.rejected?.length) {
      const detail = info.rejected.join(', ');
      console.error('[chatbot-forge] email rejected by the server:', detail);
      return { delivered: false, error: `rejected: ${detail}` };
    }
    return { delivered: true };
  } catch (e) {
    // Never log the error object wholesale: nodemailer puts the SMTP
    // conversation on it, and the AUTH line in that conversation is the
    // password in base64.
    const message = e instanceof Error ? e.message : String(e);
    console.error('[chatbot-forge] email send failed:', message);
    return { delivered: false, error: message };
  }
}


