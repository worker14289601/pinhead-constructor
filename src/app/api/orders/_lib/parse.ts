import { createHash } from 'node:crypto';
import { fetchCatalog } from '@/features/constructor/api/catalog';
import type { SideBounds } from '@/features/constructor/model/pricing';
import type { Garment, PrintMethod, Side } from '@/features/constructor/model/types';
import { newOrderNumber, ORDER_NUMBER } from './number';
import { priceOrder, type RequestedLine } from './price';
import { findOrder } from './store';

/** Проверенная заявка: всё, что пришло от клиента, обрезано и приведено к типам. */
export interface Order {
  number: string;
  /** Отпечаток содержимого заявки (sha256 поля order) — по нему узнаётся повторная отправка. */
  fingerprint: string;
  garment: { name: string };
  method: string;
  /** Цвета заявки: у каждого свои размеры и цена за штуку. */
  lines: OrderLine[];
  /** Всего штук по всем цветам. */
  qty: number;
  /** Сумма, посчитанная сервером по каталогу и прайсу (см. price.ts); цена от клиента не принимается. */
  total: number;
  /** Печать по сторонам — готовые строки для сообщения. */
  sides: string[];
  contacts: { name: string; phone: string; email: string; delivery: 'pickup' | 'delivery'; city: string; address: string; comment: string };
  utm: Record<string, string>;
  page: string;
  files: OrderFile[];
}

export interface OrderLine {
  color: string;
  sizes: Array<[size: string, qty: number]>;
  qty: number;
  perItem: number;
  total: number;
}

export interface OrderFile {
  /** Что это за файл — для подписи в канале заявок. */
  title: string;
  /** Имя с номером заказа в начале. */
  name: string;
  file: File;
}

export class BadOrder extends Error {
  constructor(public code: string, public status = 400) {
    super(code);
  }
}

/** Та же заявка уже принята: второй раз в канал не отправляем, клиенту отвечаем тем же номером. */
export class DuplicateOrder extends Error {
  constructor(public number: string) {
    super('duplicate');
  }
}

const SIDE_NAME: Record<string, string> = {
  front: 'перед', back: 'спина', sleeve_left: 'левый рукав', sleeve_right: 'правый рукав',
};
/** Превью по цветам: индекс — номер строки заявки. Подпись берётся из цвета строки в parseOrder. */
const PREVIEW_KEY = /^preview_(\d|1\d)_(front|back|sleeve_left|sleeve_right)$/;
const METHODS = ['dtf', 'dtg'];
const UTM_KEYS = ['source', 'medium', 'campaign', 'content', 'term'];
const MB = 1024 * 1024;
/** Не больше цветов в заявке: по ним же нумеруются превью. */
const MAX_LINES = 20;
/** Общий предел размера всех файлов заявки. */
const TOTAL_MAX_MB = 300;
/** Предел всего запроса: файлы плюс запас на JSON заявки и разметку multipart. Проверяется до чтения тела. */
const BODY_MAX = (TOTAL_MAX_MB + 5) * MB;
const PNG = ['image/png'];
const IMAGES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

/** Какие поля с файлами принимаем: шаблон имени поля, типы, предел размера, подпись. */
const FILE_RULES: Array<{ key: RegExp; types: string[]; maxMb: number; title: (m: RegExpMatchArray) => string }> = [
  { key: PREVIEW_KEY, types: PNG, maxMb: 20, title: (m) => `Макет на изделии: ${SIDE_NAME[m[2]]}` },
  { key: /^print_(front|back|sleeve_left|sleeve_right)$/, types: PNG, maxMb: 40, title: (m) => `Файл печати: ${SIDE_NAME[m[1]]}` },
  { key: /^original_(\d|1\d)$/, types: IMAGES, maxMb: 15, title: () => 'Файл клиента' },
  { key: /^order_pdf$/, types: ['application/pdf'], maxMb: 20, title: () => 'PDF заказа' },
  { key: /^design_json$/, types: ['application/json'], maxMb: 5, title: () => 'Данные макета (JSON): слои, положение, шрифты' },
];

const rub = (n: number) => `${n.toLocaleString('ru-RU')} ₽`;
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
/** Имя файла без путей и управляющих символов. */
const safeName = (name: string, fallback: string) =>
  name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').slice(-80) || fallback;

/**
 * Расширение по типу и проверка начала файла: тип присылает клиент, поэтому верим только содержимому.
 * Расширение ставим сами — иначе под видом картинки менеджеру придёт, например, .exe или .html.
 */
const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((x, i) => b[at + i] === x);
const FILE_KINDS: Record<string, { ext: string; looksRight: (head: Uint8Array) => boolean }> = {
  'image/png': { ext: 'png', looksRight: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  'image/jpeg': { ext: 'jpg', looksRight: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  'image/webp': { ext: 'webp', looksRight: (b) => startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8) },
  'image/svg+xml': { ext: 'svg', looksRight: (b) => new TextDecoder().decode(b).toLowerCase().includes('<svg') },
  'application/json': { ext: 'json', looksRight: (b) => b[0] === 0x7b },
  'application/pdf': { ext: 'pdf', looksRight: (b) => startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d]) },
};
/** Сколько байт начала файла читаем для проверки (у SVG перед <svg бывают заголовок и комментарии). */
const HEAD_BYTES = 4096;

/** Хост, на котором открыт сайт; за прокси — из x-forwarded-host. */
const siteHost = (req: Request) => (req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '').split(',')[0].trim();
const originHost = (origin: string) => {
  try {
    return new URL(origin).host;
  } catch {
    return '';
  }
};

/** Разбирает и проверяет multipart-заявку. Бросает BadOrder с кодом ошибки. */
export async function parseOrder(req: Request): Promise<Order> {
  // Браузер шлёт Origin с каждым POST: заявку с чужого сайта не принимаем.
  const origin = req.headers.get('origin');
  if (origin && originHost(origin) !== siteHost(req)) throw new BadOrder('bad_origin', 403);
  // Размер проверяем до formData(): она читает всё тело в память.
  const length = Number(req.headers.get('content-length'));
  if (!length) throw new BadOrder('length_required', 411);
  if (length > BODY_MAX) throw new BadOrder('file_too_large', 413);
  if (!req.headers.get('content-type')?.includes('multipart/form-data')) throw new BadOrder('bad_content_type', 415);
  let form: FormData;
  let raw: Record<string, unknown>;
  let fingerprint: string;
  try {
    form = await req.formData();
    const json = String(form.get('order') ?? '');
    raw = obj(JSON.parse(json));
    fingerprint = createHash('sha256').update(json).digest('hex');
  } catch {
    throw new BadOrder('bad_request');
  }

  const rawNumber = str(raw.number, 20);
  let number = ORDER_NUMBER.test(rawNumber) ? rawNumber : newOrderNumber();
  // Номер уже занят: та же заявка пришла повторно (сбой сети, двойное нажатие) — второй раз не принимаем;
  // другая заявка с чужим или старым номером получает новый.
  const known = await findOrder(number);
  if (known) {
    if (known.fingerprint === fingerprint) throw new DuplicateOrder(number);
    number = newOrderNumber();
  }

  // Файлы: только ожидаемые поля, по одному на поле, нужного типа и размера.
  const rawOrderLines: unknown[] = Array.isArray(raw.lines) ? raw.lines : [];
  const files: OrderFile[] = [];
  const seen = new Set<string>();
  const printPx: Partial<Record<Side, { w: number; h: number }>> = {};
  let totalSize = 0;
  for (const [key, v] of form.entries()) {
    if (typeof v === 'string') continue;
    const rule = FILE_RULES.find((r) => r.key.test(key));
    if (!rule || seen.has(key)) throw new BadOrder('bad_file_field');
    seen.add(key);
    if (!rule.types.includes(v.type) || v.size === 0) throw new BadOrder('bad_file');
    if (v.size > rule.maxMb * MB) throw new BadOrder('file_too_large', 413);
    totalSize += v.size;
    if (totalSize > TOTAL_MAX_MB * MB) throw new BadOrder('file_too_large', 413);
    const kind = FILE_KINDS[v.type];
    const head = new Uint8Array(await v.slice(0, HEAD_BYTES).arrayBuffer());
    if (!kind.looksRight(head)) throw new BadOrder('bad_file');
    const m = key.match(rule.key)!;
    // Размер файла печати в пикселях — из заголовка PNG (IHDR): по нему сервер считает габарит принта.
    if (key.startsWith('print_')) {
      if (head.length < 24) throw new BadOrder('bad_file');
      const dv = new DataView(head.buffer, head.byteOffset);
      printPx[m[1] as Side] = { w: dv.getUint32(16), h: dv.getUint32(20) };
    }
    // Превью по цветам: индекс — номер строки заявки, в подписи нужен её цвет.
    const pv = key.match(PREVIEW_KEY);
    const color = pv ? str(obj(rawOrderLines[Number(pv[1])]).color, 60) : '';
    const title = pv ? `Макет на изделии: ${color ? `${color}, ` : ''}${SIDE_NAME[pv[2]]}` : rule.title(m);
    files.push({ title, name: `${number}_${safeName(v.name.replace(/\.[^.]*$/, ''), key)}.${kind.ext}`, file: v });
  }
  if (![...seen].some((k) => k.startsWith('print_'))) throw new BadOrder('no_print_file');

  const c = obj(raw.contacts);
  const contacts = {
    name: str(c.name, 100), phone: str(c.phone, 30), email: str(c.email, 100),
    // Без поля delivery (старые клиенты) — доставка, если указан город.
    delivery: (c.delivery === 'delivery' || (c.delivery === undefined && str(c.city, 100)) ? 'delivery' : 'pickup') as 'pickup' | 'delivery',
    city: str(c.city, 100), address: str(c.address, 200), comment: str(c.comment, 1500),
  };
  if (contacts.delivery === 'pickup') { contacts.city = ''; contacts.address = ''; }
  const okEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contacts.email);
  if (!contacts.name || contacts.phone.replace(/\D/g, '').length < 5 || !okEmail || (contacts.delivery === 'delivery' && !contacts.city)) {
    throw new BadOrder('bad_contacts');
  }
  if (c.consent !== true) throw new BadOrder('no_consent');

  const method = str(raw.method, 8);
  if (!METHODS.includes(method)) throw new BadOrder('bad_method');

  // От клиента берём только что и сколько: изделие (productId) и количество по размерам. Цену считает сервер.
  const requested: RequestedLine[] = rawOrderLines.slice(0, MAX_LINES).map(obj).map((l) => ({
    productId: str(l.productId, 40),
    sizes: Object.fromEntries(Object.entries(obj(l.sizes))
      .slice(0, 40)
      .map(([k, n]): [string, number] => [str(k, 12), Math.round(Number(n))])
      .filter(([k, n]) => k && n > 0 && n <= 999)),
  })).filter((l) => l.productId && Object.keys(l.sizes).length);
  if (!requested.length) throw new BadOrder('no_sizes');

  // Габарит принта, который посчитал конструктор: сервер возьмёт не меньше, чем выходит по файлу печати.
  const claimed: SideBounds = {};
  for (const x of (Array.isArray(raw.printSizes) ? raw.printSizes : []).map(obj)) {
    const [w, h] = [Number(x.wCm), Number(x.hCm)];
    if (typeof x.side === 'string' && x.side in SIDE_NAME && w > 0 && h > 0 && w < 1000 && h < 1000) {
      claimed[x.side as Side] = { wCm: w, hCm: h };
    }
  }

  let catalog: Garment[];
  try {
    catalog = await fetchCatalog();
  } catch {
    throw new BadOrder('catalog_unavailable', 503);
  }
  const priced = priceOrder(catalog, method as PrintMethod, requested, printPx, claimed);
  if (!priced) throw new BadOrder('bad_product');
  const { lines, qty, total } = priced;
  const sides = priced.sides.map((x) =>
    `${SIDE_NAME[x.side]} ${x.format}${x.oversize ? ' (крупнее формата)' : ''} ≈${Math.round(x.wCm)}×${Math.round(x.hCm)} см`);

  const rawUtm = obj(raw.utm);
  const utm: Record<string, string> = {};
  for (const k of UTM_KEYS) if (str(rawUtm[k], 200)) utm[k] = str(rawUtm[k], 200);

  return {
    number,
    fingerprint,
    garment: { name: priced.garmentName },
    method, lines, qty, total, sides, contacts, utm,
    page: /^https?:\/\//.test(str(raw.page, 300)) ? str(raw.page, 300) : '',
    files,
  };
}

/** Текст заявки для менеджера — один для всех каналов. */
export function orderText(o: Order): string {
  const c = o.contacts;
  const utm = Object.entries(o.utm).map(([k, v]) => `${k}=${v}`).join(', ');
  return [
    `🧩 Заявка из конструктора № ${o.number}`,
    o.garment.name,
    `Нанесение: ${o.method.toUpperCase()} · ${o.sides.join(', ')}`,
    ...o.lines.map((l) => `${l.color}: ${l.sizes.map(([k, n]) => `${k}×${n}`).join(', ')} — ${l.qty} шт × ${rub(l.perItem)} = ${rub(l.total)}`),
    `Всего: ${o.qty} шт, сумма по расчёту конструктора: ${rub(o.total)}`,
    `Клиент: ${c.name}, ${c.phone}, ${c.email}`,
    c.delivery === 'delivery' ? `Доставка: ${c.city}${c.address ? `, ${c.address}` : ''}` : 'Получение: самовывоз из студии',
    c.comment ? `Комментарий: ${c.comment}` : '',
    utm ? `UTM: ${utm}` : '',
    o.page ? `Страница: ${o.page}` : '',
  ].filter(Boolean).join('\n');
}
