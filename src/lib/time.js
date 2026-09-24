// Date/time helpers. Everything is computed in the venue's time zone (IST) so the
// site shows the same slots as the database, whatever time zone the visitor is in.
import { VENUE } from '../config/site';

const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: VENUE.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const pad2 = n => String(n).padStart(2, '0');

/** { y, m, d, h, min } of the given instant, in venue time. */
export function venueParts(ms = Date.now()) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, min: +p.minute };
}

export function todayKey(ms = Date.now()) {
  const p = venueParts(ms);
  return `${p.y}-${pad2(p.m)}-${pad2(p.d)}`;
}

export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function dateKeys(ms = Date.now(), n = VENUE.windowDays) {
  const t = todayKey(ms);
  return Array.from({ length: n }, (_, i) => addDays(t, i));
}

function keyParts(key) {
  const [y, m, d] = key.split('-').map(Number);
  return { y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

/** "Thu 24 Sep" */
export function dNice(key) {
  const { m, d, dow } = keyParts(key);
  return DOW[dow][0] + DOW[dow].slice(1).toLowerCase() + ' ' + d + ' ' + MON[m - 1];
}

export function dayChip(key, index) {
  const { m, d, dow } = keyParts(key);
  return { top: index === 0 ? 'TODAY' : index === 1 ? 'TMRW' : DOW[dow], day: d + ' ' + MON[m - 1] };
}

/** 13 → "1:00 PM" */
export const hLabel = h => (h % 12 || 12) + ':00 ' + (h < 12 || h === 24 ? 'AM' : 'PM');
/** 13 → "1p" */
export const hShort = h => (h % 12 || 12) + (h < 12 || h === 24 ? 'a' : 'p');

export const inr = n => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

export const HOURS = Array.from({ length: VENUE.lastStartHour - VENUE.openHour + 1 }, (_, i) => VENUE.openHour + i);

/** A slot is "past" once it started more than the grace period ago (same rule as the DB). */
export function isPast(dateKey, h, ms = Date.now()) {
  const today = todayKey(ms);
  if (dateKey !== today) return dateKey < today;
  const p = venueParts(ms);
  return h * 60 + VENUE.graceMinutes <= p.h * 60 + p.min;
}

export function isOpenNow(ms = Date.now()) {
  const { h } = venueParts(ms);
  return h >= VENUE.openHour && h <= VENUE.lastStartHour;
}

export function countdown(msLeft) {
  const s = Math.max(0, Math.floor(msLeft / 1000));
  return pad2(Math.floor(s / 60)) + ':' + pad2(s % 60);
}
