import { NextResponse } from 'next/server';

/**
 * Приём заявки из конструктора.
 * Прототип: если заданы ORDER_TELEGRAM_* — шлём сообщение и файлы в Telegram, иначе пишем в лог.
 * Финальный канал (Битрикс24 / Telegram / бэкенд сайта) настраивается через env.
 */
const SIDE_NAME: Record<string, string> = {
  front: 'перед', back: 'спина', sleeve_left: 'левый рукав', sleeve_right: 'правый рукав',
};
const METHODS = ['dtf', 'dtg'];
/** Файлы заявки: превью и файл печати на каждую сторону, только PNG. */
const FILE_KEY = /^(preview|print)_(front|back|sleeve_left|sleeve_right)$/;
const MAX_FILE_BYTES = 40 * 1024 * 1024;
/** Предел длины сообщения Telegram — 4096 символов. */
const MAX_TEXT = 4000;

const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export async function POST(req: Request) {
  if (!req.headers.get('content-type')?.includes('multipart/form-data')) return bad('bad_content_type', 415);
  let form: FormData;
  let order: Record<string, unknown>;
  try {
    form = await req.formData();
    order = obj(JSON.parse(String(form.get('order') ?? '')));
  } catch {
    return bad('bad_request');
  }

  // Файлы: только ожидаемые имена полей, только непустой PNG, по одному на поле.
  const files = new Map<string, File>();
  for (const [key, v] of form.entries()) {
    if (typeof v === 'string') continue;
    if (!FILE_KEY.test(key) || files.has(key)) return bad('bad_file_field');
    if (v.type !== 'image/png' || v.size === 0) return bad('bad_file');
    if (v.size > MAX_FILE_BYTES) return bad('file_too_large', 413);
    files.set(key, v);
  }
  if (![...files.keys()].some((k) => k.startsWith('print_'))) return bad('no_print_file');

  const c = obj(order.contacts);
  const name = str(c.name, 100);
  const phone = str(c.phone, 30);
  if (!name || phone.replace(/\D/g, '').length < 5) return bad('bad_contacts');
  const telegram = str(c.telegram, 64);
  const city = str(c.city, 100);
  const comment = str(c.comment, 1500);

  const garment = obj(order.garment);
  const method = str(order.method, 8);
  if (!METHODS.includes(method)) return bad('bad_method');

  // Количество считаем сами из размеров; итог — цена за штуку из расчёта конструктора × количество.
  const sizeList = Object.entries(obj(order.sizes))
    .slice(0, 40)
    .map(([k, n]) => [str(k, 12), Math.round(Number(n))] as const)
    .filter(([k, n]) => k && n > 0 && n <= 999);
  const qty = sizeList.reduce((s, [, n]) => s + n, 0);
  if (!qty) return bad('no_sizes');

  const price = obj(order.price);
  const perItem = Number(price.perItem);
  if (!Number.isFinite(perItem) || perItem < 0) return bad('bad_price');
  const sides = (Array.isArray(price.sides) ? price.sides : [])
    .map(obj)
    .filter((x) => typeof x.side === 'string' && x.side in SIDE_NAME)
    .slice(0, 4)
    .map((x) => `${SIDE_NAME[x.side as string]} ${str(x.format, 4)}${x.oversize ? ' (крупнее формата)' : ''}`);

  const text = [
    '🧩 Заявка из конструктора',
    `${str(garment.name, 120)}, ${str(garment.color, 60)}`,
    `Нанесение: ${method.toUpperCase()} · ${sides.join(', ')}`,
    `Размеры: ${sizeList.map(([k, n]) => `${k}×${n}`).join(', ')} (всего ${qty})`,
    `Сумма по расчёту конструктора: ${Math.round(perItem * qty)} ₽ (${Math.round(perItem)} ₽ за шт)`,
    `Клиент: ${name}, ${phone}${telegram ? `, ${telegram}` : ''}`,
    `Доставка: ${c.delivery === 'cdek' ? `СДЭК, ${city}` : 'самовывоз'}`,
    comment ? `Комментарий: ${comment}` : '',
  ].filter(Boolean).join('\n').slice(0, MAX_TEXT);

  const token = process.env.ORDER_TELEGRAM_BOT_TOKEN;
  const chat = process.env.ORDER_TELEGRAM_CHAT_ID;
  if (!token || !chat) {
    console.log('[order]', text, [...files].map(([k, f]) => `${k}: ${f.size}b`));
    return NextResponse.json({ ok: true, delivered: 'log' });
  }

  /** Вызов Bot API; false — не доставлено (сеть или отказ Telegram). */
  const tg = async (apiMethod: string, body: FormData | string) => {
    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/${apiMethod}`, {
        method: 'POST',
        body,
        headers: typeof body === 'string' ? { 'content-type': 'application/json' } : undefined,
      });
      return r.ok;
    } catch {
      return false;
    }
  };

  if (!(await tg('sendMessage', JSON.stringify({ chat_id: chat, text })))) return bad('delivery_failed', 502);

  // Сообщение уже у менеджера: если файл не дошёл, заявку не отклоняем (повтор дал бы дубль),
  // а пишем об этом в тот же чат.
  const failed: string[] = [];
  for (const [key, file] of files) {
    const fd = new FormData();
    fd.append('chat_id', chat);
    fd.append('document', file, file.name || `${key}.png`);
    if (!(await tg('sendDocument', fd))) failed.push(key);
  }
  if (failed.length) {
    console.error('[order] files not delivered:', failed);
    await tg('sendMessage', JSON.stringify({
      chat_id: chat,
      text: `⚠️ К заявке «${name}, ${phone}» не доставлены файлы: ${failed.join(', ')}. Запросите макет у клиента.`,
    }));
  }
  return NextResponse.json({ ok: true, delivered: 'telegram', filesFailed: failed.length });
}
