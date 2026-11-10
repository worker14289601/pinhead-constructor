'use client';
import { useState, type RefObject } from 'react';
import { track, trackPurchase } from '../analytics/events';
import { getUtm } from '../analytics/utm';
import type { PriceBreakdown } from '../model/pricing';
import { useConstructor } from '../model/store';
import { sidesFor } from '../config/print-areas';
import { type Garment, type GarmentVariant, type OrderContacts, type Side } from '../model/types';
import type { DesignStageHandle } from '../canvas/DesignStage';
import { buildOrderPdf } from '../pdf/orderPdf';
import s from './constructor.module.css';

interface Props {
  garment: Garment;
  variant: GarmentVariant;
  price: PriceBreakdown;
  stage: RefObject<DesignStageHandle>;
  /** POST {endpoint}/number — выдать номер заказа, POST {endpoint} — принять заявку. */
  endpoint: string;
  onClose: () => void;
}

const EMPTY: OrderContacts = { name: '', phone: '', email: '', city: '', address: '', comment: '', consent: false };

/** dataURL снимка → PNG. Пустой снимок (браузер не смог создать canvas) — ошибка, а не пустой файл в заявке. */
async function toPng(dataUrl: string): Promise<Blob> {
  const blob = await (await fetch(dataUrl)).blob();
  if (blob.type !== 'image/png' || blob.size === 0) throw new Error('export_empty');
  return blob;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Оформление заявки: контакты, номер заказа, PDF. Без онлайн-оплаты. */
export function OrderForm({ garment, variant, price, stage, endpoint, onClose }: Props) {
  const { method, sizes, side, setSide, layers } = useConstructor();
  const [c, setC] = useState<OrderContacts>(EMPTY);
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [done, setDone] = useState<{ number: string; pdf: Blob } | null>(null);
  const field = (k: keyof OrderContacts) => (e: { target: { value: string } }) => setC({ ...c, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState('sending');
    track('order_send', { total: price.total, qty: price.qty });
    try {
      // Номер выдаёт сервер до отправки: он нужен в PDF, который уходит вместе с заявкой.
      const numRes = await fetch(`${endpoint}/number`, { method: 'POST' });
      const number = numRes.ok ? String((await numRes.json()).number ?? '') : '';
      if (!number) throw new Error(`number_${numRes.status}`);

      // Снимаем превью и файлы печати по каждой стороне с принтом.
      const form = new FormData();
      const sides = sidesFor(garment);
      const previews: Array<{ side: Side; dataUrl: string }> = [];
      const original = side;
      try {
        for (const sd of sides) {
          if (!layers.some((l) => l.side === sd)) continue;
          setSide(sd);
          // Снимок — только когда холст показал эту сторону и загрузил её картинки.
          if (!stage.current) throw new Error('canvas_missing');
          await stage.current.whenReady();
          // Холст перерисовался — берём его методы заново: прежние помнят зону прошлой стороны.
          const preview = stage.current.exportPreview();
          const print = stage.current.exportPrint();
          if (!preview || !print) throw new Error('export_failed');
          previews.push({ side: sd, dataUrl: preview });
          form.append(`preview_${sd}`, await toPng(preview), `preview_${sd}.png`);
          form.append(`print_${sd}`, await toPng(print.dataUrl), `print_${sd}_${print.dpi}dpi.png`);
        }
      } finally {
        setSide(original);
      }

      // Исходные файлы клиента — как загружены, без пересжатия (один файл — один раз, даже если слоёв несколько).
      const images = new Map<string, string>();
      for (const l of layers) if (l.kind === 'image' && sides.includes(l.side)) images.set(l.src, l.fileName);
      let i = 0;
      for (const [src, name] of images) form.append(`original_${i++}`, await (await fetch(src)).blob(), name);

      const contacts: OrderContacts = { ...c, name: c.name.trim(), phone: c.phone.trim(), email: c.email.trim(), city: c.city.trim() };
      const sizeList = Object.entries(sizes).filter(([, q]) => q > 0);
      const pdf = await buildOrderPdf({
        number, createdAt: new Date(), garment: garment.name, color: variant.colorName, method,
        sizes: sizeList, price, contacts, previews, fileNames: [...images.values()],
      });
      form.append('order_pdf', pdf, `order_${number}.pdf`);

      form.append('order', JSON.stringify({
        number,
        garment: { id: garment.id, name: garment.name, productId: variant.productId, color: variant.colorName },
        method, sizes, price, contacts,
        utm: getUtm(),
        page: window.location.href.split('?')[0],
      }));
      const res = await fetch(endpoint, { method: 'POST', body: form });
      if (!res.ok) throw new Error(String(res.status));
      // Сервер мог выдать другой номер, если присланный ему не подошёл.
      const saved = String((await res.json().catch(() => ({}))).number ?? number);
      setDone({ number: saved, pdf });
      setState('done');
      track('order_success', { order_price: price.total, currency: 'RUB', product: garment.name });
      trackPurchase({
        number: saved, total: price.total, perItem: price.perItem, qty: price.qty,
        productId: variant.productId, name: garment.name, color: variant.colorName,
      });
    } catch (err) {
      setState('error');
      track('order_error', { message: String(err) });
    }
  };

  return (
    <div className={s.modalBg} onClick={() => state !== 'sending' && onClose()}>
      <form className={s.modal} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        {state === 'done' && done ? (
          <>
            <h3>Заявка отправлена</h3>
            <p className={s.muted}>Номер заказа</p>
            <p className={s.orderNumber}>{done.number}</p>
            <p>Менеджер свяжется с вами, проверит макет и подтвердит стоимость. Назовите ему этот номер.</p>
            <button
              type="button" className={s.btn}
              onClick={() => { download(done.pdf, `order_${done.number}.pdf`); track('pdf_download'); }}
            >
              Скачать PDF заказа
            </button>
            <button type="button" className={s.cta} onClick={onClose}>Готово</button>
          </>
        ) : (
          <>
            <h3>Оформление заявки</h3>
            <p className={s.muted}>{garment.name}, {variant.colorName} · {price.qty} шт · {price.total.toLocaleString('ru-RU')} ₽</p>
            <input className={s.input} required maxLength={100} autoComplete="name" placeholder="Имя"
              value={c.name} onChange={field('name')} />
            <input className={s.input} required type="tel" maxLength={30} autoComplete="tel" placeholder="Телефон"
              pattern=".*\d.*\d.*\d.*\d.*\d.*" title="Номер телефона с кодом города или оператора"
              value={c.phone} onChange={field('phone')} />
            <input className={s.input} required type="email" maxLength={100} autoComplete="email" placeholder="E-mail"
              value={c.email} onChange={field('email')} />
            <input className={s.input} required maxLength={100} autoComplete="address-level2" placeholder="Город"
              value={c.city} onChange={field('city')} />
            <input className={s.input} maxLength={200} autoComplete="street-address" placeholder="Адрес доставки (необязательно)"
              value={c.address ?? ''} onChange={field('address')} />
            <textarea className={s.input} maxLength={1500} placeholder="Комментарий (необязательно)"
              value={c.comment ?? ''} onChange={field('comment')} />
            <label className={s.check}>
              <input type="checkbox" required checked={c.consent} onChange={(e) => setC({ ...c, consent: e.target.checked })} />
              <span>Согласен на обработку персональных данных</span>
            </label>
            {state === 'error' && <p className={s.err}>Не удалось отправить. Попробуйте ещё раз.</p>}
            <button className={s.cta} disabled={state === 'sending'}>
              {state === 'sending' ? 'Отправляем…' : 'Отправить заявку'}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
