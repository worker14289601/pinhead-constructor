'use client';
import { useState, type RefObject } from 'react';
import { track } from '../analytics/events';
import type { PriceBreakdown } from '../model/pricing';
import { useConstructor } from '../model/store';
import { sidesFor } from '../config/print-areas';
import { type Garment, type GarmentVariant, type OrderContacts } from '../model/types';
import type { DesignStageHandle } from '../canvas/DesignStage';
import s from './constructor.module.css';

interface Props {
  garment: Garment;
  variant: GarmentVariant;
  price: PriceBreakdown;
  stage: RefObject<DesignStageHandle>;
  onClose: () => void;
}

/** dataURL снимка → PNG. Пустой снимок (браузер не смог создать canvas) — ошибка, а не пустой файл в заявке. */
async function toPng(dataUrl: string): Promise<Blob> {
  const blob = await (await fetch(dataUrl)).blob();
  if (blob.type !== 'image/png' || blob.size === 0) throw new Error('export_empty');
  return blob;
}

/** Оформление заявки: контакты + доставка, без онлайн-оплаты. */
export function OrderForm({ garment, variant, price, stage, onClose }: Props) {
  const { method, sizes, side, setSide, layers } = useConstructor();
  const [c, setC] = useState<OrderContacts>({ name: '', phone: '', delivery: 'pickup' });
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState('sending');
    track('order_submit', { total: price.total, qty: price.qty });
    try {
      // Снимаем превью и файлы печати по каждой стороне с принтом.
      const form = new FormData();
      const original = side;
      try {
        for (const sd of sidesFor(garment)) {
          if (!layers.some((l) => l.side === sd)) continue;
          setSide(sd);
          // Снимок — только когда холст показал эту сторону и загрузил её картинки.
          if (!stage.current) throw new Error('canvas_missing');
          await stage.current.whenReady();
          // Холст перерисовался — берём его методы заново: прежние помнят зону прошлой стороны.
          const preview = stage.current.exportPreview();
          const print = stage.current.exportPrint();
          if (!preview || !print) throw new Error('export_failed');
          form.append(`preview_${sd}`, await toPng(preview), `preview_${sd}.png`);
          form.append(`print_${sd}`, await toPng(print.dataUrl), `print_${sd}_${print.dpi}dpi.png`);
        }
      } finally {
        setSide(original);
      }
      form.append('order', JSON.stringify({
        garment: { id: garment.id, name: garment.name, productId: variant.productId, color: variant.colorName },
        method, sizes, price, contacts: c,
      }));
      const res = await fetch('/api/orders', { method: 'POST', body: form });
      if (!res.ok) throw new Error(String(res.status));
      setState('done');
      track('order_success', { total: price.total });
    } catch (err) {
      setState('error');
      track('order_error', { message: String(err) });
    }
  };

  return (
    <div className={s.modalBg} onClick={() => state !== 'sending' && onClose()}>
      <form className={s.modal} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        {state === 'done' ? (
          <>
            <h3>Заявка отправлена</h3>
            <p>Менеджер свяжется с вами, проверит макет и подтвердит стоимость.</p>
            <button type="button" className={s.cta} onClick={onClose}>Готово</button>
          </>
        ) : (
          <>
            <h3>Оформление заявки</h3>
            <p className={s.muted}>{garment.name}, {variant.colorName} · {price.qty} шт · {price.total} ₽</p>
            <input className={s.input} required placeholder="Имя" value={c.name}
              onChange={(e) => setC({ ...c, name: e.target.value })} />
            <input className={s.input} required type="tel" placeholder="Телефон" value={c.phone}
              onChange={(e) => setC({ ...c, phone: e.target.value })} />
            <input className={s.input} placeholder="Telegram (необязательно)" value={c.telegram ?? ''}
              onChange={(e) => setC({ ...c, telegram: e.target.value })} />
            <select className={s.input} value={c.delivery}
              onChange={(e) => setC({ ...c, delivery: e.target.value as OrderContacts['delivery'] })}>
              <option value="pickup">Самовывоз — СПб, ул. Чапыгина, 1</option>
              <option value="cdek">Доставка СДЭК</option>
            </select>
            {c.delivery === 'cdek' && (
              <input className={s.input} required placeholder="Город" value={c.city ?? ''}
                onChange={(e) => setC({ ...c, city: e.target.value })} />
            )}
            <textarea className={s.input} placeholder="Комментарий" value={c.comment ?? ''}
              onChange={(e) => setC({ ...c, comment: e.target.value })} />
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
