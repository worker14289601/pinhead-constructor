'use client';
import { useState } from 'react';
import { track } from '../analytics/events';
import type { Garment, GarmentType, GarmentVariant } from '../model/types';
import { Icon } from './icons';
import s from './constructor.module.css';

const TYPE_LABEL: Record<GarmentType, string> = {
  tshirt: 'Футболки', longsleeve: 'Лонгсливы', sweatshirt: 'Свитшоты', hoodie: 'Худи', totebag: 'Шопперы', cap: 'Кепки',
};

export const GarmentIcon = ({ type, size = 28 }: { type: GarmentType; size?: number }) => <Icon name={type} size={size} />;

/** «Футболка OVERSIZE» → «OVERSIZE»: тип уже выбран выше, повторять его в каждой строке незачем. */
const modelLabel = (g: Garment) => g.name.split(/\s+/).slice(1).join(' ') || g.name;
/** «10-12 лет 128-134 см» → «10-12 лет»: детские размеры в чипе — только возраст, рост — в подсказке. */
const sizeLabel = (size: string) => size.match(/^\S+ (?:лет|года?)/)?.[0] ?? size;
const rub = (n: number) => `${n.toLocaleString('ru-RU')} ₽`;

/**
 * Левая колонка: список типов изделий, модели выбранного типа и карточка модели —
 * описание из каталога и размеры выбранного цвета. Таблица обмеров — в секции размеров справа.
 */
export function GarmentPicker({ garments, garmentId, variant, onSelect }: {
  garments: Garment[];
  garmentId: string | null;
  variant: GarmentVariant | null;
  onSelect: (id: string) => void;
}) {
  const [more, setMore] = useState(false);
  const current = garments.find((g) => g.id === garmentId);
  const types = [...new Set(garments.map((g) => g.type))];
  const models = garments.filter((g) => g.type === current?.type);
  const pick = (id: string) => { onSelect(id); setMore(false); track('garment_select', { id }); };

  const about = variant?.description ?? '';
  const sizes = variant?.sizes ?? [];
  const oneSize = sizes.length === 1 && /one size/i.test(sizes[0]);

  if (!garments.length) return null;

  return (
    <>
      <div className={s.types} role="radiogroup" aria-label="Тип изделия">
        {types.map((t) => {
          const ofType = garments.filter((g) => g.type === t);
          const active = t === current?.type;
          return (
            <button
              key={t} role="radio" aria-checked={active} className={active ? s.typeActive : s.type}
              onClick={() => !active && pick(ofType[0].id)}
            >
              <span className={s.typeIcon}><GarmentIcon type={t} /></span>
              <span className={s.typeText}>
                <span className={s.typeName}>{TYPE_LABEL[t]}</span>
                <small>от {rub(Math.min(...ofType.map((g) => g.basePrice)))}</small>
              </span>
            </button>
          );
        })}
      </div>

      {models.length > 0 && (
        <>
          <h3 className={s.h}>Модель</h3>
          <div className={s.models} role="radiogroup" aria-label="Модель">
            {models.map((g) => {
              const active = g.id === garmentId;
              const prices = g.variants.map((v) => v.price);
              const range = Math.max(...prices) > g.basePrice;
              return (
                <button
                  key={g.id} role="radio" aria-checked={active} className={active ? s.modelActive : s.model}
                  title={g.name} onClick={() => !active && pick(g.id)}
                >
                  <span className={s.typeText}>
                    <span className={s.modelName}>{modelLabel(g)}</span>
                    <small>{range && 'от '}{rub(g.basePrice)}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {current && variant && (
        <div className={s.about}>
          {about && (
            <>
              <p className={more ? s.aboutTextOpen : s.aboutText}>{about}</p>
              {about.length > 110 && (
                <button className={s.linkBtn} onClick={() => setMore((m) => !m)}>{more ? 'Свернуть' : 'Подробнее'}</button>
              )}
            </>
          )}
          {sizes.length > 0 && (
            <div className={s.aboutSizes}>
              <span className={s.aboutLabel}>{oneSize ? 'Размер' : 'Размеры в наличии'}</span>
              <div className={s.sizeChips}>
                {sizes.map((z) => <span key={z} className={s.sizeChip} title={z}>{sizeLabel(z)}</span>)}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
