import { NextResponse } from 'next/server';
import { sendToBitrix } from './_lib/bitrix';
import { BadOrder, orderText, parseOrder, type Order } from './_lib/parse';
import { sendToTelegram } from './_lib/telegram';

/**
 * Приём заявки из конструктора. Канал выбирается переменными окружения:
 *   ORDER_BITRIX_WEBHOOK                — сделка в Битрикс24 с файлами;
 *   ORDER_TELEGRAM_BOT_TOKEN + CHAT_ID  — сообщение и файлы в чат Telegram;
 *   ничего не задано                    — заявка пишется в лог сервера.
 * Если Битрикс недоступен, заявка уходит в следующий настроенный канал — она не должна потеряться.
 */
export async function POST(req: Request) {
  let order: Order;
  try {
    order = await parseOrder(req);
  } catch (e) {
    if (e instanceof BadOrder) return NextResponse.json({ ok: false, error: e.code }, { status: e.status });
    throw e;
  }
  const done = (delivered: string, filesFailed: string[] = []) => {
    if (filesFailed.length) console.error('[order]', order.number, 'files not delivered:', filesFailed);
    return NextResponse.json({ ok: true, number: order.number, delivered, filesFailed: filesFailed.length });
  };

  const webhook = process.env.ORDER_BITRIX_WEBHOOK;
  if (webhook) {
    try {
      return done('bitrix', await sendToBitrix(order, webhook, process.env.ORDER_BITRIX_CATEGORY_ID));
    } catch (e) {
      console.error('[order]', order.number, 'bitrix failed, falling back:', e);
    }
  }

  const token = process.env.ORDER_TELEGRAM_BOT_TOKEN;
  const chat = process.env.ORDER_TELEGRAM_CHAT_ID;
  if (token && chat) {
    try {
      return done('telegram', await sendToTelegram(order, token, chat));
    } catch (e) {
      console.error('[order]', order.number, 'telegram failed:', e);
      return NextResponse.json({ ok: false, error: 'delivery_failed' }, { status: 502 });
    }
  }

  // Каналы не настроены (локальная разработка) или Битрикс упал без запасного канала: заявка остаётся в логе.
  console.log('[order]', orderText(order), order.files.map((f) => `${f.name}: ${f.file.size}b`));
  if (webhook) return NextResponse.json({ ok: false, error: 'delivery_failed' }, { status: 502 });
  return done('log');
}
