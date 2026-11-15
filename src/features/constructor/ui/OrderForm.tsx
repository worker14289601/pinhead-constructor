'use client';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { track, trackPurchase } from '../analytics/events';
import { getUtm } from '../analytics/utm';
import type { PriceBreakdown } from '../model/pricing';
import { useConstructor } from '../model/store';
import { sidesFor } from '../config/print-areas';
import { METHOD_INFO } from '../config/pricing';
import { PICKUP } from '../config/pickup';
import { SIDE_LABEL, SIDE_TAB, type Garment, type GarmentVariant, type OrderContacts, type Side } from '../model/types';
import type { DesignStageHandle } from '../canvas/DesignStage';
import { buildOrderPdf } from '../pdf/orderPdf';
import { Icon } from './icons';
import s from './constructor.module.css';
import f from './orderForm.module.css';
import { useDismiss } from './useDismiss';

interface Props {
  garment: Garment;
  variant: GarmentVariant;
  price: PriceBreakdown;
  stage: RefObject<DesignStageHandle>;
  /** POST {endpoint}/number — выдать номер заказа, POST {endpoint} — принять заявку. null — демо без сервера. */
  endpoint: string | null;
  onClose: () => void;
}

const EMPTY: OrderContacts = { name: '', phone: '', email: '', delivery: 'pickup', city: '', address: '', comment: '', consent: false };

/** dataURL снимка → PNG. Пустой снимок (браузер не смог создать canvas) — ошибка, а не пустой файл в заявке. */
async function toPng(dataUrl: string): Promise<Blob> {
  const blob = await (await fetch(dataUrl)).blob();
  if (blob.type !== 'image/png' || blob.size === 0) throw new Error('export_empty');
  return blob;
}

const rub = (n: number) => `${n.toLocaleString('ru-RU')} ₽`;

/** Что происходит после отправки — показываем и до, и после. */
const NEXT_STEPS = [
  'Менеджер проверит макет и свяжется с вами',
  'Подтвердит итоговую цену и сроки',
  'Оплата — после подтверждения, сейчас платить не нужно',
];

/** Поле с подписью над ним; звёздочка — обязательное. */
function Field({ label, required, wide, children }: { label: string; required?: boolean; wide?: boolean; children: React.ReactNode }) {
  return (
    <label className={wide ? `${f.field} ${f.wide}` : f.field}>
      <span className={f.label}>{label}{required ? <i aria-hidden> *</i> : <small> — необязательно</small>}</span>
      {children}
    </label>
  );
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
/** Номер для демо без сервера — того же вида, что выдаёт сервер: PH-ММДД-XXXX. */
function demoNumber(): string {
  const abc = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const d = new Date();
  const mmdd = String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  let tail = '';
  for (let i = 0; i < 4; i++) tail += abc[Math.floor(Math.random() * abc.length)];
  return `PH-${mmdd}-${tail}`;
}

export function OrderForm({ garment, variant, price, stage, endpoint, onClose }: Props) {
  const { method, side, setSide, selectVariant, clearSizes, layers } = useConstructor();
  const [c, setC] = useState<OrderContacts>(EMPTY);
  const { leaving, dismiss } = useDismiss();
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [done, setDone] = useState<{ number: string; pdf: Blob } | null>(null);
  // Превью для сводки: снимок каждой стороны с принтом (перед — первым). Холст на это время
  // перебирает стороны за размытым фоном и возвращается туда, где был.
  const [shots, setShots] = useState<Array<{ side: Side; src: string }>>([]);
  const [capturing, setCapturing] = useState(true);
  const [shot, setShot] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const started = useRef(false);
  const touchX = useRef(0); // свайп в увеличенном просмотре
  // Снимки по цветам: клик по строке цвета в сводке показывает превью этого цвета.
  const [active, setActive] = useState(variant.productId);
  const cache = useRef(new Map<string, Array<{ side: Side; src: string }>>());
  const shoot = async (productId: string) => {
    const cached = cache.current.get(productId);
    if (cached) { setShots(cached); return; }
    setCapturing(true);
    const sides = sidesFor(garment).filter((sd) => layers.some((l) => l.side === sd));
    const out: Array<{ side: Side; src: string }> = [];
    stage.current?.setTurnEnabled(false);
    try {
      if (productId !== variant.productId) selectVariant(productId);
      for (const sd of sides) {
        setSide(sd);
        if (!stage.current) break;
        await stage.current.whenReady();
        const src = stage.current.exportPreview();
        if (src) { out.push({ side: sd, src }); setShots([...out]); }
      }
      if (out.length) cache.current.set(productId, out);
    } catch {
      // Без превью заявку всё равно можно отправить.
    } finally {
      setSide(side);
      stage.current?.setTurnEnabled(true);
      setCapturing(false);
    }
  };
  useEffect(() => {
    if (started.current) return; // StrictMode вызывает эффект дважды
    started.current = true;
    void shoot(variant.productId);
    // Снимки — один раз при открытии.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const pick = (productId: string) => {
    if (capturing || productId === active) return;
    setActive(productId);
    void shoot(productId);
  };
  // Убрать цвет из заказа; если он был на превью — показать соседний.
  const remove = (productId: string) => {
    if (capturing || price.lines.length < 2) return;
    const i = price.lines.findIndex((l) => l.productId === productId);
    clearSizes(productId);
    if (productId === active) {
      const next = price.lines[i + 1] ?? price.lines[i - 1];
      if (next) { setActive(next.productId); void shoot(next.productId); }
    }
  };
  // Пока открыта заявка, страница под ней не прокручивается и не «болтается» от свайпов.
  useEffect(() => {
    const html = document.documentElement;
    const prev = [html.style.overflow, document.body.style.overflow];
    html.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    return () => { [html.style.overflow, document.body.style.overflow] = prev; };
  }, []);
  const cur = shots[Math.min(shot, shots.length - 1)];
  const flip = (d: number) => setShot((i) => (i + d + shots.length) % shots.length);

  const ship = c.delivery === 'delivery';
  const close = () => state !== 'sending' && dismiss(onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (zoomed) setZoomed(false); else close(); }
      else if (zoomed && shots.length > 1 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) flip(e.key === 'ArrowLeft' ? -1 : 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const printed = price.lines[0]?.sides ?? price.current?.sides ?? [];
  const methodName = METHOD_INFO[method].title.split(/\s+[—–-]\s+/)[0];
  const field = (k: keyof OrderContacts) => (e: { target: { value: string } }) => setC({ ...c, [k]: e.target.value });

  // «Далее» на мобильной клавиатуре: Enter переводит на следующее поле, а не отправляет форму.
  const nextOnEnter = (e: React.KeyboardEvent<HTMLFormElement>) => {
    const t = e.target as HTMLElement;
    if (e.key !== 'Enter' || t.tagName !== 'INPUT' || (t as HTMLInputElement).type === 'checkbox') return;
    e.preventDefault();
    const all = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('input:not([type=checkbox]), textarea'))
      .filter((el) => !el.closest('[aria-hidden="true"]'));
    all[all.indexOf(t) + 1]?.focus();
  };
  // Ошибка валидации: первое невалидное поле — в центр экрана и в фокус (браузер сам прокрутил бы под прилипшие панели).
  const invalidSeen = useRef(false);
  const focusInvalid = (e: React.FormEvent<HTMLFormElement>) => {
    if (invalidSeen.current) return;
    invalidSeen.current = true;
    setTimeout(() => { invalidSeen.current = false; }, 0);
    const t = e.target as HTMLElement;
    t.focus({ preventScroll: true });
    t.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (capturing) return; // холст ещё перебирает стороны для превью
    setState('sending');
    track('order_send', { total: price.total, qty: price.qty });
    try {
      // Номер выдаёт сервер до отправки: он нужен в PDF, который уходит вместе с заявкой.
      let number = demoNumber();
      if (endpoint) {
        const numRes = await fetch(`${endpoint}/number`, { method: 'POST' });
        number = numRes.ok ? String((await numRes.json()).number ?? '') : '';
        if (!number) throw new Error(`number_${numRes.status}`);
      }

      // Снимаем превью по каждому цвету и стороне с принтом; файл печати от цвета ткани не зависит — один на сторону.
      const form = new FormData();
      const sides = sidesFor(garment).filter((sd) => layers.some((l) => l.side === sd));
      const previews: Array<{ color: string; side: Side; dataUrl: string }> = [];
      const original = { side, variantId: variant.productId };
      stage.current?.setTurnEnabled(false);
      try {
        for (const [i, line] of price.lines.entries()) {
          selectVariant(line.productId);
          for (const sd of sides) {
            setSide(sd);
            // Снимок — только когда холст показал этот цвет и сторону и загрузил их картинки.
            if (!stage.current) throw new Error('canvas_missing');
            await stage.current.whenReady();
            // Холст перерисовался — берём его методы заново: прежние помнят зону прошлой стороны.
            const preview = stage.current.exportPreview();
            if (!preview) throw new Error('export_failed');
            previews.push({ color: line.color, side: sd, dataUrl: preview });
            form.append(`preview_${i}_${sd}`, await toPng(preview), `preview_${i}_${sd}.png`);
            if (i === 0) {
              const print = stage.current.exportPrint();
              if (!print) throw new Error('export_failed');
              form.append(`print_${sd}`, await toPng(print.dataUrl), `print_${sd}_${print.dpi}dpi.png`);
            }
          }
        }
      } finally {
        selectVariant(original.variantId);
        setSide(original.side);
        stage.current?.setTurnEnabled(true);
      }

      // Исходные файлы клиента — как загружены, без пересжатия (один файл — один раз, даже если слоёв несколько).
      const images = new Map<string, string>();
      for (const l of layers) if (l.kind === 'image' && sides.includes(l.side)) images.set(l.src, l.fileName);
      let i = 0;
      for (const [src, name] of images) form.append(`original_${i++}`, await (await fetch(src)).blob(), name);

      const contacts: OrderContacts = {
        ...c, name: c.name.trim(), phone: c.phone.trim(), email: c.email.trim(),
        city: ship ? c.city.trim() : '', address: ship ? c.address?.trim() : '',
      };
      const pdf = await buildOrderPdf({
        number, createdAt: new Date(), garment: garment.name, method, price, contacts, previews, fileNames: [...images.values()],
      });
      form.append('order_pdf', pdf, `order_${number}.pdf`);

      form.append('order', JSON.stringify({
        number,
        garment: { id: garment.id, name: garment.name },
        method,
        // Цену сервер считает сам по каталогу и прайсу; от конструктора — только что и сколько печатать.
        lines: price.lines.map((l) => ({ productId: l.productId, color: l.color, sizes: Object.fromEntries(l.sizes) })),
        printSizes: (price.lines[0]?.sides ?? []).map(({ side, wCm, hCm }) => ({ side, wCm, hCm })),
        contacts,
        utm: getUtm(),
        page: window.location.href.split('?')[0],
      }));
      let saved = number;
      if (endpoint) {
        const res = await fetch(endpoint, { method: 'POST', body: form });
        if (!res.ok) throw new Error(String(res.status));
        // Сервер мог выдать другой номер, если присланный ему не подошёл.
        saved = String((await res.json().catch(() => ({}))).number ?? number);
      }
      setDone({ number: saved, pdf });
      setState('done');
      track('order_success', { order_price: price.total, currency: 'RUB', product: garment.name });
      trackPurchase({
        number: saved, total: price.total, name: garment.name,
        items: price.lines.map((l) => ({ productId: l.productId, color: l.color, perItem: l.perItem, qty: l.qty })),
      });
    } catch (err) {
      setState('error');
      track('order_error', { message: String(err) });
    }
  };

  return (
    <div className={`${s.modalBg} ${f.bg}`} data-leaving={leaving || undefined} onClick={close}>
      <form
        className={`${s.modal} ${f.modal} ${state === 'done' ? f.modalDone : ''}`} onClick={(e) => e.stopPropagation()} onSubmit={submit}
        role="dialog" aria-modal="true" aria-labelledby="order-title" onKeyDown={nextOnEnter} onInvalidCapture={focusInvalid}
      >
        <button type="button" className={f.close} onClick={close} disabled={state === 'sending'} aria-label="Закрыть" title="Закрыть (Esc)">
          <Icon name="close" size={20} />
        </button>

        {state !== 'done' && <div className={f.sheetHead} aria-hidden>Оформление заявки</div>}

        {state === 'done' && done ? (
          <div className={f.done}>
            <span className={f.doneIcon}><Icon name="checkMark" size={34} /></span>
            <h3 id="order-title" className={s.reveal}>Заявка отправлена</h3>
            <p className={f.doneLead}>Номер заказа — назовите его менеджеру:</p>
            <p className={s.orderNumber}>{done.number}</p>
            <ol className={f.steps}>{NEXT_STEPS.map((x) => <li key={x}>{x}</li>)}</ol>
            {!endpoint && <p className={f.doneLead}>Демо-версия: заявка никуда не отправлена.</p>}
            <div className={f.doneActions}>
              <button
                type="button" className={s.btn}
                onClick={() => { download(done.pdf, `order_${done.number}.pdf`); track('pdf_download'); }}
              >
                Скачать PDF заказа
              </button>
              <button type="button" className={s.cta} onClick={() => dismiss(onClose)}>Готово</button>
            </div>
          </div>
        ) : (
          <div className={f.grid}>
            {/* Сводка: что именно заказываем */}
            <aside className={f.summary}>
              <p className={f.kicker}>Ваш заказ</p>
              <div className={f.product}>
                <div className={f.gallery}>
                  {cur ? (
                    <button type="button" className={f.shotBtn} onClick={() => setZoomed(true)} aria-label="Увеличить превью">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img key={cur.src} className={f.preview} src={cur.src} alt={`Превью: ${SIDE_LABEL[cur.side].toLowerCase()}`} />
                    </button>
                  ) : (
                    <div className={`${f.preview} ${f.previewStub}`} aria-hidden />
                  )}
                  {cur && <span className={f.shotSide}>{SIDE_TAB[cur.side]}{shots.length > 1 && ` · ${shot + 1}/${shots.length}`}</span>}
                  {shots.length > 1 && (
                    <>
                      <button type="button" className={`${f.arrow} ${f.arrowL}`} onClick={() => flip(-1)} aria-label="Предыдущая сторона">
                        <Icon name="chevronRight" size={18} />
                      </button>
                      <button type="button" className={`${f.arrow} ${f.arrowR}`} onClick={() => flip(1)} aria-label="Следующая сторона">
                        <Icon name="chevronRight" size={18} />
                      </button>
                    </>
                  )}
                  {cur && (
                    <button type="button" className={f.zoomBtn} onClick={() => setZoomed(true)} aria-label="Увеличить" title="Увеличить">
                      <Icon name="zoomIn" />
                    </button>
                  )}
                </div>
                <div className={f.productText}>
                  <p className={f.productName}>{garment.name}</p>
                  <p className={f.productMeta}>
                    {methodName}
                    {printed.length > 0 && ` · ${printed.map((x) => `${SIDE_LABEL[x.side].toLowerCase()} ${x.format}`).join(', ')}`}
                  </p>
                </div>
              </div>
              <ul className={f.lines}>
                {price.lines.map((l) => {
                  const body = (
                    <>
                      <i style={{ background: l.hex }} />
                      <span className={f.lineName}>{l.color}<small>{l.sizes.map(([k, n]) => `${k}×${n}`).join(', ')}</small></span>
                      <span className={f.lineSum}>{l.qty} шт<small>{rub(l.total)}</small></span>
                    </>
                  );
                  return (
                    <li key={l.productId} className={f.lineRow}>
                      {price.lines.length > 1 ? (
                        <>
                          <button
                            type="button" className={f.line} aria-pressed={l.productId === active} disabled={capturing}
                            onClick={() => pick(l.productId)} title={`Показать превью: ${l.color}`}
                          >{body}</button>
                          <button
                            type="button" className={f.lineDel} disabled={capturing} onClick={() => remove(l.productId)}
                            aria-label={`Убрать из заказа: ${l.color}`} title="Убрать из заказа"
                          ><Icon name="close" size={16} /></button>
                        </>
                      ) : (
                        <div className={f.line}>{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
              <div className={f.total}>
                <span>Итого · {price.qty} шт</span>
                <b>{rub(price.total)}</b>
              </div>
              <ol className={f.steps}>{NEXT_STEPS.map((x) => <li key={x}>{x}</li>)}</ol>
            </aside>

            {/* Контакты */}
            <div className={f.fields}>
              <h3 id="order-title">Оформление заявки</h3>
              <fieldset className={f.group}>
                <legend className={f.legend}>Контакты</legend>
                <Field label="Имя" required wide>
                  <input className={s.input} required maxLength={100} autoComplete="name" enterKeyHint="next" placeholder="Как к вам обращаться"
                    value={c.name} onChange={field('name')} />
                </Field>
                <Field label="Телефон" required>
                  <input className={s.input} required type="tel" inputMode="tel" enterKeyHint="next" maxLength={30} autoComplete="tel" placeholder="+7 900 000-00-00"
                    pattern=".*\d.*\d.*\d.*\d.*\d.*" title="Номер телефона с кодом города или оператора"
                    value={c.phone} onChange={field('phone')} />
                </Field>
                <Field label="E-mail" required>
                  <input className={s.input} required type="email" inputMode="email" enterKeyHint="next" maxLength={100} autoComplete="email" placeholder="name@mail.ru"
                    value={c.email} onChange={field('email')} />
                </Field>
              </fieldset>
              <fieldset className={f.group}>
                <legend className={f.legend}>Получение</legend>
                <div className={`${f.wide} ${f.seg}`} role="radiogroup" aria-label="Способ получения">
                  {([['pickup', 'Самовывоз'], ['delivery', 'Доставка']] as const).map(([v, label]) => (
                    <button
                      key={v} type="button" role="radio" aria-checked={c.delivery === v}
                      className={c.delivery === v ? f.segActive : f.segBtn} onClick={() => setC({ ...c, delivery: v })}
                    >{label}</button>
                  ))}
                </div>
                {/* Оба варианта лежат в одной ячейке: высота — по большему, поэтому окно не прыгает при переключении. */}
                <div className={`${f.wide} ${f.swap}`}>
                  <div className={f.pickup} data-on={!ship || undefined} aria-hidden={ship}>
                    <Icon name="mapPin" size={20} />
                    <span><b>{PICKUP.place}</b>{PICKUP.address} · {PICKUP.metro}</span>
                  </div>
                  <div className={f.ship} data-on={ship || undefined} aria-hidden={!ship}>
                    <Field label="Город" required>
                      <input className={s.input} required={ship} maxLength={100} autoComplete="address-level2" enterKeyHint="next" placeholder="Москва"
                        value={c.city} onChange={field('city')} />
                    </Field>
                    <Field label="Адрес">
                      <input className={s.input} maxLength={200} autoComplete="street-address" enterKeyHint="next" placeholder="Улица, дом, офис"
                        value={c.address ?? ''} onChange={field('address')} />
                    </Field>
                    <p className={`${f.wide} ${f.hint}`}>Стоимость доставки менеджер посчитает отдельно.</p>
                  </div>
                </div>
              </fieldset>
              <div className={f.group}>
                <Field label="Комментарий" wide>
                  <textarea className={`${s.input} ${f.textarea}`} maxLength={1500} rows={3} placeholder="Сроки, пожелания к печати, вопросы"
                    value={c.comment ?? ''} onChange={field('comment')} />
                </Field>
              </div>
              <div className={f.submit}>
                <label className={s.check}>
                  <input type="checkbox" required checked={c.consent} onChange={(e) => setC({ ...c, consent: e.target.checked })} />
                  <span>Согласен на обработку персональных данных</span>
                </label>
                {state === 'error' && <p className={s.err}>Не удалось отправить. Проверьте интернет и попробуйте ещё раз.</p>}
                <button className={`${s.cta} ${f.send}`} disabled={state === 'sending' || capturing}>
                  <span>{state === 'sending' ? 'Отправляем…' : 'Отправить заявку'}</span>
                  {state !== 'sending' && <span className={f.sendSum}>{rub(price.total)}</span>}
                </button>
              </div>
            </div>
          </div>
        )}
      </form>

      {zoomed && cur && (
        <div className={f.zoom} onClick={(e) => { e.stopPropagation(); setZoomed(false); }} role="dialog" aria-label="Превью дизайна">
          <figure
            className={f.zoomFig} onClick={(e) => e.stopPropagation()}
            onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
            onTouchEnd={(e) => {
              const dx = e.changedTouches[0].clientX - touchX.current;
              if (shots.length > 1 && Math.abs(dx) > 40) flip(dx > 0 ? -1 : 1);
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={cur.src} alt={`Превью: ${SIDE_LABEL[cur.side].toLowerCase()}`} />
            <figcaption>{SIDE_LABEL[cur.side]}{shots.length > 1 && ` · ${shot + 1} из ${shots.length}`}</figcaption>
            {shots.length > 1 && (
              <>
                <button type="button" className={`${f.arrow} ${f.arrowL} ${f.arrowBig}`} onClick={() => flip(-1)} aria-label="Предыдущая сторона">
                  <Icon name="chevronRight" size={22} />
                </button>
                <button type="button" className={`${f.arrow} ${f.arrowR} ${f.arrowBig}`} onClick={() => flip(1)} aria-label="Следующая сторона">
                  <Icon name="chevronRight" size={22} />
                </button>
              </>
            )}
            <button type="button" className={`${f.close} ${f.zoomClose}`} onClick={() => setZoomed(false)} aria-label="Закрыть просмотр">
              <Icon name="close" size={20} />
            </button>
          </figure>
        </div>
      )}
    </div>
  );
}
