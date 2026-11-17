import { NextResponse } from 'next/server';
import { deliverAndMark, ensureRetryLoop, hasChannel, logOrder } from './_lib/deliver';
import { BadOrder, DuplicateOrder, parseOrder, type Order } from './_lib/parse';
import { markLogged, saveOrder } from './_lib/store';

/**
 * Приём заявки из конструктора.
 * 1. Заявка проверяется; повторная отправка той же заявки (тот же номер и содержимое) второй сделки не создаёт.
 * 2. Заявка с файлами сохраняется на диск (ORDER_STORE_DIR).
 * 3. Отправляется в канал: Битрикс24, иначе Telegram (см. _lib/deliver.ts).
 * Если канал не ответил, клиент всё равно получает номер: заявка лежит на диске и уходит при повторных
 * попытках. Без настроенных каналов (локальная разработка) заявка остаётся на диске и в логе сервера.
 */
export async function POST(req: Request) {
  ensureRetryLoop();
  let order: Order;
  try {
    order = await parseOrder(req);
  } catch (e) {
    if (e instanceof DuplicateOrder) return NextResponse.json({ ok: true, number: e.number, duplicate: true });
    if (e instanceof BadOrder) return NextResponse.json({ ok: false, error: e.code }, { status: e.status });
    throw e;
  }
  const done = (delivered: string, filesFailed = 0) =>
    NextResponse.json({ ok: true, number: order.number, delivered, filesFailed });

  let stored = true;
  try {
    await saveOrder(order);
  } catch (e) {
    // Диск недоступен — работаем как без хранилища: заявка считается принятой, только если дошла до канала.
    stored = false;
    console.error('[order]', order.number, 'not stored:', e);
  }

  if (!hasChannel()) {
    logOrder(order);
    if (stored) await markLogged(order.number).catch(() => undefined);
    return done('log');
  }
  try {
    const res = await deliverAndMark(order);
    return done(res.channel, res.filesFailed.length);
  } catch (e) {
    console.error('[order]', order.number, 'delivery failed:', e);
    if (stored) return done('stored');
    logOrder(order);
    return NextResponse.json({ ok: false, error: 'delivery_failed' }, { status: 502 });
  }
}
