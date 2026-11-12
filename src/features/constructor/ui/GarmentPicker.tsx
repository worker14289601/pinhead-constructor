'use client';
import { track } from '../analytics/events';
import type { Garment, GarmentType } from '../model/types';
import s from './constructor.module.css';

const TYPE_LABEL: Record<GarmentType, string> = {
  tshirt: 'Футболки', longsleeve: 'Лонгсливы', sweatshirt: 'Свитшоты', hoodie: 'Худи', totebag: 'Шопперы', cap: 'Кепки',
};

/** Простые контурные иконки типов изделий, 48×48. */
const ICON: Record<GarmentType, string> = {
  tshirt: 'M16 6 6 11l4 9 5-2v24h18V18l5 2 4-9-10-5c-1 3-4 5-8 5s-7-2-8-5Z',
  longsleeve: 'M17 6 7 10 4 40l6 1 3-18 2-1v22h18V22l2 1 3 18 6-1-3-30-10-4c-1 3-4 5-7 5s-6-2-7-5Z',
  sweatshirt: 'M17 6 7 10 4 38l7 2 2-14 2-1v18h18V25l2 1 2 14 7-2-3-28-10-4c-1 3-4 4-7 4s-6-1-7-4ZM15 40h18',
  hoodie: 'M17 7 7 11 4 38l7 2 2-14 2-1v18h18V25l2 1 2 14 7-2-3-27-10-4-3 6h-8l-3-6ZM24 17v8M21 21v5M27 21v5',
  totebag: 'M12 16h24l2 28H10l2-28ZM18 16v-3a6 6 0 0 1 12 0v3',
  cap: 'M8 30c0-10 7-16 16-16s16 6 16 16H8ZM6 30h36c0 3-6 5-18 5S6 33 6 30Z',
};

export const GarmentIcon = ({ type }: { type: GarmentType }) => (
  <svg width="40" height="40" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"
    strokeLinecap="round" aria-hidden>
    <path d={ICON[type]} />
  </svg>
);

/** Каталог: сетка типов изделий, под ней модели выбранного типа и цена «от». */
export function GarmentPicker({ garments, garmentId, onSelect }: {
  garments: Garment[]; garmentId: string | null; onSelect: (id: string) => void;
}) {
  const current = garments.find((g) => g.id === garmentId);
  const types = [...new Set(garments.map((g) => g.type))];
  const models = garments.filter((g) => g.type === current?.type);
  const pick = (id: string) => { onSelect(id); track('garment_select', { id }); };

  return (
    <>
      <div className={s.types} role="radiogroup" aria-label="Тип изделия">
        {types.map((t) => {
          const first = garments.filter((g) => g.type === t)[0];
          const from = Math.min(...garments.filter((g) => g.type === t).map((g) => g.basePrice));
          const active = t === current?.type;
          return (
            <button
              key={t} role="radio" aria-checked={active} className={active ? s.typeActive : s.type}
              onClick={() => !active && pick(first.id)}
            >
              <GarmentIcon type={t} />
              <span>{TYPE_LABEL[t]}</span>
              <small>от {from} ₽</small>
            </button>
          );
        })}
      </div>
      {models.length > 0 && (
        <>
          <h3 className={s.h}>Модель</h3>
          <div className={s.garments}>
            {models.map((g) => (
              <button key={g.id} className={g.id === garmentId ? s.chipActive : s.chip} onClick={() => pick(g.id)}>
                <span>{g.name}</span>
                <small>от {g.basePrice} ₽</small>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
