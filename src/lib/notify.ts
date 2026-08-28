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
