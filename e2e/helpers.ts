import { deflateSync } from 'node:zlib';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import { ORDERS_DIR } from '../playwright.config';

/** PNG одного цвета без сторонних библиотек: RGBA, без фильтров строк. */
export function solidPng(width: number, height: number, [r, g, b]: [number, number, number]): Buffer {
  const row = Buffer.alloc(1 + width * 4);
  for (let x = 0; x < width; x++) row.set([r, g, b, 255], 1 + x * 4);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const x of buf) c = table[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(height, 4);
  head.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Открывает конструктор и ждёт каталог (живой API) и холст. */
export async function openConstructor(page: Page) {
  // Запоминаем последнюю отправленную заявку — для проверки повторной отправки.
  await page.addInitScript(() => {
    const original = window.fetch;
    window.fetch = (input, init) => {
      if (init?.body instanceof FormData) (window as unknown as { __lastOrder: unknown }).__lastOrder = { url: String(input), body: init.body };
      return original(input, init);
    };
  });
  await page.goto('/constructor');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('input[type=file]').first()).toBeAttached();
  // Каталог загружен и модель выбрана: до этого конструктор файл не принимает.
  await expect(page.getByRole('radiogroup', { name: 'Модель' }).getByRole('radio', { checked: true })).toBeVisible({ timeout: 60_000 });
}

export async function uploadImage(page: Page, name: string, png: Buffer) {
  const before = await layerCount(page);
  // Файл кладём в поле так же, как это делает браузер при выборе: поле сразу очищается обработчиком,
  // и файл, выставленный извне через setInputFiles, к этому моменту уже не читается.
  await page.evaluate(([b64, fileName]) => {
    const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], fileName, { type: 'image/png' }));
    const input = document.querySelector<HTMLInputElement>('input[type=file]')!;
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, [png.toString('base64'), name] as const);
  await expect.poll(() => layerCount(page)).toBe(before + 1);
}

/** Сколько слоёв дизайна на холсте (узлы Konva с именем design). */
export const layerCount = (page: Page) =>
  page.evaluate(() => (window as unknown as { Konva?: { stages: Array<{ find(s: string): unknown[] }> } }).Konva?.stages[0]?.find('.design').length ?? 0);

/** Главная кнопка внизу: её подпись ведёт по шагам. */
export const mainButton = (page: Page, name: RegExp) => page.getByRole('button', { name }).last();

/** Размеры → форма → отправка. Возвращает номер заказа с экрана успеха. */
export async function orderAndSubmit(page: Page, sizes: Record<string, number>): Promise<string> {
  // Пока размеры не выбраны, кнопка помечена aria-disabled, но нажимается: ведёт к размерам.
  await mainButton(page, /Выбрать размеры/i).click({ force: true });
  for (const [size, qty] of Object.entries(sizes)) {
    const plus = page.getByRole('button', { name: `Больше ${size}`, exact: true });
    await plus.scrollIntoViewIfNeeded();
    for (let i = 0; i < qty; i++) await plus.click();
  }
  await mainButton(page, /Оформить заявку/i).click();
  await page.getByPlaceholder('Как к вам обращаться').fill('Тест Автотестов');
  await page.getByPlaceholder('+7 900 000-00-00').fill('+7 900 000-00-00');
  await page.getByPlaceholder(/name@mail/).fill('autotest@example.com');
  await page.getByRole('checkbox').check();
  const send = page.getByRole('button', { name: /Отправить заявку/i });
  await expect(send).toBeEnabled({ timeout: 60_000 }); // форма снимает превью сторон
  await send.click();
  const number = page.getByText(/^PH-\d{4}-[2-9A-Z]{4}$/);
  await expect(number).toBeVisible({ timeout: 90_000 });
  return (await number.textContent())!.trim();
}

export interface StoredMeta {
  status: string;
  total: number;
  order: { qty: number; sides: string[]; contacts: { email: string } };
  files: Array<{ name: string; type: string }>;
}

/** Заявка, как её сохранил сервер. */
export async function readStored(number: string) {
  const dir = path.resolve(ORDERS_DIR, number);
  const meta = JSON.parse(await readFile(path.join(dir, 'meta.json'), 'utf8')) as StoredMeta;
  const file = (part: string) => {
    const f = meta.files.find((x) => x.name.includes(part));
    if (!f) throw new Error(`в заявке нет файла ${part}: ${meta.files.map((x) => x.name).join(', ')}`);
    return readFile(path.join(dir, 'files', f.name)).then((buf) => ({ name: f.name, buf }));
  };
  return { meta, file };
}

export const storedCount = async () => (await readdir(path.resolve(ORDERS_DIR)).catch(() => [])).length;

/** Перетаскивает слой дизайна мышью: index — номер слоя на холсте (-1 — верхний), сдвиг — в долях его размера. */
export async function dragLayer(page: Page, index: number, dxParts: number, dyParts: number) {
  const locate = () => page.evaluate((i) => {
    type Node = { getClientRect(): { x: number; y: number; width: number; height: number } };
    const stage = (window as unknown as { Konva: { stages: Array<{ find(s: string): Node[]; container(): HTMLElement }> } }).Konva.stages[0];
    const nodes = stage.find('.design');
    const rect = nodes[i < 0 ? nodes.length + i : i].getClientRect();
    const box = stage.container().getBoundingClientRect();
    return { x: box.left + rect.x + rect.width / 2, y: box.top + rect.y + rect.height / 2, w: rect.width, h: rect.height };
  }, index);
  // Слой появляется с анимацией, а раскладка ещё двигается (сворачивается баннер шагов): ждём, пока встанет.
  let r = await locate();
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(250);
    const next = await locate();
    const still = Math.abs(next.x - r.x) + Math.abs(next.y - r.y) + Math.abs(next.w - r.w) < 0.5;
    r = next;
    if (still) break;
  }
  await page.mouse.move(r.x, r.y);
  await page.mouse.down();
  await page.mouse.move(r.x + (r.w * dxParts) / 2, r.y + (r.h * dyParts) / 2, { steps: 6 });
  await page.mouse.move(r.x + r.w * dxParts, r.y + r.h * dyParts, { steps: 6 });
  await page.mouse.up();
}
