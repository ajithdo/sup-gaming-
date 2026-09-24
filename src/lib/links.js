import { CONTACT } from '../config/site';
import { dNice, hLabel, inr } from './time';

export const waLink = text => 'https://wa.me/' + CONTACT.whatsapp + '?text=' + encodeURIComponent(text);

/** Pre-filled WhatsApp message for a booking row from the database. */
export function bookingWhatsApp(b, roomName) {
  const players = b.players + ' player' + (b.players > 1 ? 's' : '');
  const pay = b.pass_code ? 'Gaming pass ' + b.pass_code : 'Total ' + inr(b.total_amount);
  const food = b.foods?.length ? ' Food: ' + b.foods.join(', ') + '.' : '';
  const game = b.game_request ? ' Game request: ' + b.game_request + '.' : '';
  return waLink(
    `Hi NextLevel! Booking ${b.code}: ${roomName} · ${players} · ${dNice(b.booking_date)} · ${hLabel(b.start_hour)} (${b.duration_hours}h) · ${pay}.` +
    `${food}${game} Name: ${b.customer_name}, ${b.customer_phone}. Please confirm my slot!`,
  );
}

export const qrPayload = (b, roomName) => `${b.code}|${roomName}|${b.booking_date} ${hLabel(b.start_hour)}`;
