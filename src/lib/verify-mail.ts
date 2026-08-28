import { sendMail, appUrl } from './mail';

/**
 * The confirmation email, in one place because signup and the "resend" button
 * both send it and the wording should not drift between them.
 *
 * Verification is deliberately not a gate on logging in or building a bot: the
 * whole product is built around trying it before committing, and a hard wall
 * here would undo that. It gates the things where a wrong address actually
 * costs someone — buying credits, and being reachable about bookings.
 */
export async function sendVerification(
  req: { headers: Headers },
  email: string,
  token: string,
): Promise<void> {
  const link = `${appUrl(req)}/verify?token=${encodeURIComponent(token)}`;
  await sendMail({
    to: email,
    subject: 'Confirm your email for Chatbot Forge',
    text:
      `Welcome to Chatbot Forge.\n\n` +
      `Confirm this address so we can reach you about your chatbots and any credits you buy:\n\n` +
      `${link}\n\n` +
      `The link expires in 48 hours. If you did not sign up, ignore this email.`,
  });
}
