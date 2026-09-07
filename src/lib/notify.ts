import { users } from './mongodb';
import { sendMail, appUrl, mailConfigured } from './mail';
import { isAnonOwner } from './auth';
import type { BotDoc, BookingDoc } from './types';

/**
 * Telling a bot's owner that something happened.
 *
 * Bookings used to land in the database and wait to be noticed, which is fine
 * for a demo and useless for anyone actually taking appointments — the whole
 * value of the feature is knowing about it before the customer gives up.
 *
 * Anonymous drafts have no owner to email, which is another reason the booking
 * feature belongs to accounts.
 */
export async function notifyOwnerOfBooking(
  req: { headers: Headers },
  bot: Pick<BotDoc, 'id' | 'name' | 'ownerId'>,
  booking: BookingDoc,
): Promise<void> {
  if (!mailConfigured()) return;
  if (isAnonOwner(bot.ownerId)) return;

  const owner = await (await users()).findOne({ id: bot.ownerId });
  if (!owner?.email || owner.deletedAt) return;
  // An address nobody confirmed is as likely to be a stranger's inbox as the
  // owner's, and this email quotes what a visitor typed.
  if (!owner.emailVerifiedAt) return;

  const base = appUrl(req);
  const details = [
    `Contact: ${booking.contact}`,
    booking.when && `Asked for: ${booking.when}`,
    booking.note && `Note: ${booking.note}`,
  ].filter(Boolean);

  await sendMail({
    to: owner.email,
    subject: `New booking request from ${booking.name}`,
    text: [
      `${booking.name} asked for a booking through ${bot.name}.`,
      '',
      ...details,
      '',
      // This notification carries no token, so it degrades to a plain sentence
      // rather than being withheld when there is no trusted address to link to.
      base ? `Confirm or cancel it here: ${base}/bots/${bot.id}` : 'Open the manage screen for this bot to confirm it.',
    ].join('\n'),
  });
}

/**
 * Telling the admins that someone is waiting on them.
 *
 * Best-effort, like every other notification here: the request is already in
 * the database and visible in /admin before this runs, so a missing mailer or
 * a bounced address delays the answer rather than losing the request.
 *
 * The root ADMIN_EMAIL is included even when no account carries that address,
 * because on a fresh deployment it is the only admin there is.
 */
export async function notifyAdminsOfKeyRequest(
  req: { headers: Headers },
  request: { email: string; providerLabel: string; model: string; reason: string },
): Promise<void> {
  if (!mailConfigured()) return;

  const admins = await (await users())
    .find({ role: 'admin', deletedAt: { $exists: false } }, { projection: { _id: 0, email: 1 } })
    .limit(20)
    .toArray();

  const root = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const to = new Set(admins.map((a) => a.email).filter(Boolean));
  if (root) to.add(root);
  if (to.size === 0) return;

  const base = appUrl(req);
  const details = [`Provider: ${request.providerLabel}`, request.model && `Model: ${request.model}`].filter(Boolean);
  const body = [
    `${request.email} is asking for a key.`,
    '',
    ...details,
    '',
    'They wrote:',
    request.reason,
    '',
    base ? `Answer it here: ${base}/admin` : 'Open the admin panel to answer it.',
  ].join('\n');

  await Promise.all(
    [...to].map((address) =>
      sendMail({ to: address, subject: `Key request from ${request.email}`, text: body }).catch(() => undefined),
    ),
  );
}
