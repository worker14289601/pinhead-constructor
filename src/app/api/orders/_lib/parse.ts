import { newOrderNumber, ORDER_NUMBER } from './number';

/** Проверенная заявка: всё, что пришло от клиента, обрезано и приведено к типам. */
export interface Order {
  number: string;
  garment: { name: string };
  method: string;
  /** Цвета заявки: у каждого свои размеры и цена за штуку. */
  lines: OrderLine[];
  /** Всего штук по всем цветам. */
  qty: number;
  /** Сумма строк, посчитанная здесь: perItem × qty по каждому цвету. */
  total: number;
  /** Печать по сторонам — готовые строки для сообщения. */
  sides: string[];
  contacts: { name: string; phone: string; email: string; city: string; address: string; comment: string };
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
const PNG = ['image/png'];
const IMAGES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

/** Какие поля с файлами принимаем: шаблон имени поля, типы, предел размера, подпись. */
const FILE_RULES: Array<{ key: RegExp; types: string[]; maxMb: number; title: (m: RegExpMatchArray) => string }> = [
  { key: PREVIEW_KEY, types: PNG, maxMb: 20, title: (m) => `Макет на изделии: ${SIDE_NAME[m[2]]}` },
  { key: /^print_(front|back|sleeve_left|sleeve_right)$/, types: PNG, maxMb: 40, title: (m) => `Файл печати: ${SIDE_NAME[m[1]]}` },
  { key: /^original_(\d|1\d)$/, types: IMAGES, maxMb: 15, title: () => 'Файл клиента' },
  { key: /^order_pdf$/, types: ['application/pdf'], maxMb: 20, title: () => 'PDF заказа' },
];

const rub = (n: number) => `${n.toLocaleString('ru-RU')} ₽`;
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
/** Имя файла без путей и управляющих символов. */
const safeName = (name: string, fallback: string) =>
  name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').slice(-80) || fallback;

/** Разбирает и проверяет multipart-заявку. Бросает BadOrder с кодом ошибки. */
export async function parseOrder(req: Request): Promise<Order> {
  if (!req.headers.get('content-type')?.includes('multipart/form-data')) throw new BadOrder('bad_content_type', 415);
  let form: FormData;
  let raw: Record<string, unknown>;
  try {
    form = await req.formData();
    raw = obj(JSON.parse(String(form.get('order') ?? '')));
  } catch {
    throw new BadOrder('bad_request');
  }

  const rawNumber = str(raw.number, 20);
  const number = ORDER_NUMBER.test(rawNumber) ? rawNumber : newOrderNumber();

  // Файлы: только ожидаемые поля, по одному на поле, нужного типа и размера.
  const rawOrderLines: unknown[] = Array.isArray(raw.lines) ? raw.lines : [];
  const files: OrderFile[] = [];
  const seen = new Set<string>();
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
    const m = key.match(rule.key)!;
    // Превью по цветам: индекс — номер строки заявки, в подписи нужен её цвет.
    const pv = key.match(PREVIEW_KEY);
    const color = pv ? str(obj(rawOrderLines[Number(pv[1])]).color, 60) : '';
    const title = pv ? `Макет на изделии: ${color ? `${color}, ` : ''}${SIDE_NAME[pv[2]]}` : rule.title(m);
    files.push({ title, name: `${number}_${safeName(v.name, key)}`, file: v });
  }
  if (![...seen].some((k) => k.startsWith('print_'))) throw new BadOrder('no_print_file');

  const c = obj(raw.contacts);
  const contacts = {
    name: str(c.name, 100), phone: str(c.phone, 30), email: str(c.email, 100),
    city: str(c.city, 100), address: str(c.address, 200), comment: str(c.comment, 1500),
  };
  const okEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contacts.email);
  if (!contacts.name || contacts.phone.replace(/\D/g, '').length < 5 || !okEmail || !contacts.city) {
    throw new BadOrder('bad_contacts');
  }
  if (c.consent !== true) throw new BadOrder('no_consent');

  const method = str(raw.method, 8);
  if (!METHODS.includes(method)) throw new BadOrder('bad_method');

  // Количество считаем сами из размеров; итог — сумма по цветам: цена за штуку из расчёта конструктора × количество.
  const rawLines = rawOrderLines.slice(0, MAX_LINES).map(obj);
  const lines: OrderLine[] = [];
  rawLines.forEach((l) => {
    const sizes = Object.entries(obj(l.sizes))
      .slice(0, 40)
      .map(([k, n]): [string, number] => [str(k, 12), Math.round(Number(n))])
      .filter(([k, n]) => k && n > 0 && n <= 999);
    const qty = sizes.reduce((s, [, n]) => s + n, 0);
    if (!qty) return;
    const perItem = Math.round(Number(l.perItem));
    if (!Number.isFinite(perItem) || perItem < 0) throw new BadOrder('bad_price');
    lines.push({ color: str(l.color, 60), sizes, qty, perItem, total: perItem * qty });
  });
  if (!lines.length) throw new BadOrder('no_sizes');
  const qty = lines.reduce((s, l) => s + l.qty, 0);
  const total = lines.reduce((s, l) => s + l.total, 0);

  const price = obj(raw.price);
  const sides = (Array.isArray(price.sides) ? price.sides : [])
    .map(obj)
    .filter((x) => typeof x.side === 'string' && x.side in SIDE_NAME)
    .slice(0, 4)
    .map((x) => {
      const size = Number(x.wCm) > 0 && Number(x.hCm) > 0 ? ` ≈${Math.round(Number(x.wCm))}×${Math.round(Number(x.hCm))} см` : '';
      return `${SIDE_NAME[x.side as string]} ${str(x.format, 4)}${x.oversize ? ' (крупнее формата)' : ''}${size}`;
    });

  const garment = obj(raw.garment);
  const rawUtm = obj(raw.utm);
  const utm: Record<string, string> = {};
  for (const k of UTM_KEYS) if (str(rawUtm[k], 200)) utm[k] = str(rawUtm[k], 200);

  return {
    number,
    garment: { name: str(garment.name, 120) },
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
    `Город: ${c.city}${c.address ? `, адрес: ${c.address}` : ''}`,
    c.comment ? `Комментарий: ${c.comment}` : '',
    utm ? `UTM: ${utm}` : '',
    o.page ? `Страница: ${o.page}` : '',
  ].filter(Boolean).join('\n');
}
