import { randomInt } from 'node:crypto';

/** Без похожих символов (0/O, 1/I/L) — номер диктуют менеджеру голосом. */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const ORDER_NUMBER = /^PH-\d{4}-[2-9A-HJKMNP-Z]{4}$/;

/** Номер заказа: дата (ММДД, московское время) и случайный хвост, например PH-1112-4K7Q. */
export function newOrderNumber(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  let tail = '';
  for (let i = 0; i < 4; i++) tail += ALPHABET[randomInt(ALPHABET.length)];
  return `PH-${get('month')}${get('day')}-${tail}`;
}
