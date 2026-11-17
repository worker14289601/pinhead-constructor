import { expect, test } from '@playwright/test';
import { dragLayer, openConstructor, orderAndSubmit, readStored, solidPng, storedCount, uploadImage } from './helpers';

/**
 * Основной сценарий: изделие → своя картинка → размеры → заявка → номер.
 * Идёт на десктопе 1440 и на телефоне 375 (см. playwright.config.ts).
 */
test('заявка проходит от картинки до номера заказа', async ({ page }) => {
  await openConstructor(page);
  await uploadImage(page, 'logo.png', solidPng(1200, 1200, [255, 0, 170]));

  const number = await orderAndSubmit(page, { M: 2, L: 1 });
  await expect(page.getByRole('button', { name: /Скачать PDF заказа/i })).toBeVisible();

  // Сервер сохранил заявку со всеми файлами и сам посчитал количество и сумму.
  const { meta } = await readStored(number);
  expect(meta.order.qty).toBe(3);
  expect(meta.total).toBeGreaterThan(0);
  expect(meta.order.contacts.email).toBe('autotest@example.com');
  const names = meta.files.map((f) => f.name).join(' ');
  for (const part of ['preview_0_front', 'print_front', 'logo', 'order_', 'design']) expect(names).toContain(part);

  // Та же заявка, отправленная ещё раз (сбой сети, двойное нажатие), второй заявки не создаёт.
  const before = await storedCount();
  const again = await page.evaluate(async () => {
    const last = (window as unknown as { __lastOrder: { url: string; body: FormData } }).__lastOrder;
    return (await fetch(last.url, { method: 'POST', body: last.body })).json();
  });
  expect(again).toMatchObject({ ok: true, number, duplicate: true });
  expect(await storedCount()).toBe(before);
});

test('с принтом за границей зоны заявку оформить нельзя', async ({ page, isMobile }) => {
  test.skip(isMobile, 'перетаскивание мышью — только десктоп');
  await openConstructor(page);
  await uploadImage(page, 'logo.png', solidPng(600, 600, [255, 0, 170]));
  // Тащим слой далеко влево — за край зоны печати.
  await dragLayer(page, 0, -4, 0);

  // Главная кнопка не открывает форму, а выбирает проблемный слой и объясняет, что мешает.
  await page.getByRole('button', { name: /Принт вне зоны/i }).click({ force: true });
  await expect(page.getByText(/за границей зоны печати/).first()).toBeVisible();
  await expect(page.getByPlaceholder('Как к вам обращаться')).toHaveCount(0);
  await page.getByRole('button', { name: /Вписать в зону/i }).click();
  await expect(page.getByRole('button', { name: /Принт вне зоны/i })).toHaveCount(0);
});
