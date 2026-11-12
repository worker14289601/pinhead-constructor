'use client';
import { track } from '../analytics/events';
import { METHOD_INFO } from '../config/pricing';
import { SIZE_CHART } from '../config/size-chart';
import type { calcPrice } from '../model/pricing';
import { useConstructor } from '../model/store';
import { SIDE_LABEL, type GarmentVariant, type PrintMethod } from '../model/types';
import { Icon } from './icons';
import s from './constructor.module.css';
import o from './order.module.css';

type Price = ReturnType<typeof calcPrice>;
const rub = (n: number) => `${n.toLocaleString('ru-RU')} ₽`;

/** «DTG — прямая печать» → «DTG» и «прямая печать». */
const splitTitle = (t: string) => {
  const [a, ...b] = t.split(/\s+[—–-]\s+/);
  return [a, b.join(' — ')] as const;
};
/** «10-12 лет 128-134 см» → «10-12 лет» крупно и «128-134 см» мелко; обычные размеры остаются как есть. */
const splitSize = (size: string) => {
  const m = size.match(/^(\S+ (?:лет|года?))\s+(.+)$/);
  return m ? ([m[1], m[2]] as const) : ([size, ''] as const);
};

/** Нанесение, размеры с количеством и разбивка цены. */
export function OrderPanel({ variant, price, onSizeChart }: {
  variant: GarmentVariant | null;
  price: Price | null;
  onSizeChart: () => void;
}) {
  const method = useConstructor((st) => st.method);
  const sizes = useConstructor((st) => st.sizes);
  const { setMethod, incSize, setSizeQty } = useConstructor.getState();

  return (
    <>
      <h3 className={s.h}>Нанесение</h3>
      <div className={o.seg} role="radiogroup" aria-label="Метод печати">
        {(Object.keys(METHOD_INFO) as PrintMethod[]).map((m) => {
          const [name, sub] = splitTitle(METHOD_INFO[m].title);
          return (
            <button
              key={m} type="button" role="radio" aria-checked={method === m}
              className={method === m ? o.segBtnActive : o.segBtn} onClick={() => setMethod(m)}
            >
              {name}
              {sub && <small>{sub}</small>}
            </button>
          );
        })}
      </div>
      <div className={o.card}><p>{METHOD_INFO[method].hint}</p></div>

      <div className={o.subRow}>
        <h3 className={s.h} style={{ margin: 0 }}>Размеры</h3>
        {SIZE_CHART.some((r) => variant?.sizes.includes(r.size)) && (
          <button type="button" className={o.chartLink} onClick={onSizeChart}>
            <Icon name="ruler" size={16} />Таблица размеров
          </button>
        )}
      </div>
      <div className={o.sizes}>
        {variant?.sizes.map((size) => {
          const q = sizes[size] ?? 0;
          const [main, sub] = splitSize(size);
          return (
            <div key={size} className={q ? o.sizeActive : o.size}>
              <span className={o.sizeName}>{main}{sub && <small>{sub}</small>}</span>
              <div className={o.step}>
                <button type="button" aria-label={`Меньше ${size}`} onClick={() => incSize(size, -1)} disabled={!q}><Icon name="minus" size={16} /></button>
                <input
                  type="number" min={0} inputMode="numeric" value={q} aria-label={`Количество ${size}`}
                  onChange={(e) => { setSizeQty(size, Number(e.target.value) || 0); track('size_set'); }}
                />
                <button type="button" aria-label={`Больше ${size}`} onClick={() => { incSize(size, 1); track('size_set'); }}><Icon name="plus" size={16} /></button>
              </div>
            </div>
          );
        })}
      </div>
      {!!price?.qty && <p className={o.total}>Итого: <b>{price.qty} шт</b></p>}

      {price && price.sides.length > 0 && (
        <div className={o.card}>
          <div className={o.row}><span>Изделие</span><span>{rub(price.garment)}</span></div>
          {price.sides.map((x) => (
            <div key={x.side} className={o.row}>
              <span>
                Печать: {SIDE_LABEL[x.side].toLowerCase()} · {x.format}
                {x.oversize && <span className={o.note}> (крупнее формата — уточнит менеджер)</span>}
              </span>
              <span>{rub(x.price)}</span>
            </div>
          ))}
          {price.tierFrom > 1 && <div className={`${o.row} ${o.plain}`}><span className={o.note}>Цена печати за тираж от {price.tierFrom} шт</span></div>}
          {price.next && (
            <div className={o.badge}>
              <Icon name="discount" size={16} />От {price.next.qty} шт дешевле — {rub(price.next.perItem)} за шт
            </div>
          )}
        </div>
      )}
    </>
  );
}

/** Закреплённый итог: сумма и кнопка заявки (дизайн → размеры → заявка). */
export function OrderFooter({ price, hasDesign, onOrder }: { price: Price | null; hasDesign: boolean; onOrder: () => void }) {
  const canOrder = !!price?.qty && hasDesign;
  return (
    <footer className={`${s.footer} ${o.footer}`}>
      <div className={o.footerPrice}>
        <div className={o.sum}>{price ? (price.qty ? rub(price.total) : <>{rub(price.perItem)} <small>/ шт</small></>) : '—'}</div>
        <p className={o.sub2}>{price?.qty ? `${price.qty} шт · ${rub(price.perItem)} за шт` : 'Цена примерная, уточнит менеджер'}</p>
      </div>
      <button className={o.button} onClick={onOrder} aria-disabled={!canOrder}>
        {!hasDesign ? 'Добавить дизайн' : !price?.qty ? 'Выбрать размеры' : 'Оформить заявку'}
      </button>
    </footer>
  );
}
