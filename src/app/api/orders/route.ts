import { NextResponse } from 'next/server';

/**
 * Приём заявки из конструктора.
 * Прототип: если заданы ORDER_TELEGRAM_* — шлём сообщение и файлы в Telegram, иначе пишем в лог.
 * Финальный канал (Битрикс24 / Telegram / бэкенд сайта) настраивается через env.
 */
export async function POST(req: Request) {
  const form = await req.formData();
  const order = JSON.parse(String(form.get('order') ?? '{}'));
  const files = [...form.entries()].filter(([, v]) => v instanceof Blob) as Array<[string, File]>;

  const c = order.contacts ?? {};
  const sizes = Object.entries(order.sizes ?? {}).filter(([, n]) => Number(n) > 0).map(([k, n]) => `${k}×${n}`).join(', ');
  const text = [
    '🧩 Заявка из конструктора',
    `${order.garment?.name}, ${order.garment?.color}`,
    `Нанесение: ${String(order.method).toUpperCase()} · ${order.price?.sides?.map((x: { side: string; format: string }) => `${x.side} ${x.format}`).join(', ')}`,
    `Размеры: ${sizes} (всего ${order.price?.qty})`,
    `Сумма: ${order.price?.total} ₽`,
    `Клиент: ${c.name}, ${c.phone}${c.telegram ? `, ${c.telegram}` : ''}`,
    `Доставка: ${c.delivery === 'cdek' ? `СДЭК, ${c.city}` : 'самовывоз'}`,
    c.comment ? `Комментарий: ${c.comment}` : '',
  ].filter(Boolean).join('\n');

  const token = process.env.ORDER_TELEGRAM_BOT_TOKEN;
  const chat = process.env.ORDER_TELEGRAM_CHAT_ID;
  if (!token || !chat) {
    console.log('[order]', text, files.map(([k, f]) => `${k}: ${f.size}b`));
    return NextResponse.json({ ok: true, delivered: 'log' });
  }

  const tg = (method: string, body: FormData | string) =>
    fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      body,
      headers: typeof body === 'string' ? { 'content-type': 'application/json' } : undefined,
    });

  const r = await tg('sendMessage', JSON.stringify({ chat_id: chat, text }));
  if (!r.ok) return NextResponse.json({ ok: false }, { status: 502 });
  for (const [name, file] of files) {
    const fd = new FormData();
    fd.append('chat_id', chat);
    fd.append('document', file, file.name || `${name}.png`);
    await tg('sendDocument', fd);
  }
  return NextResponse.json({ ok: true, delivered: 'telegram' });
}
