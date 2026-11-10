'use client';
import { useConstructor } from '../model/store';
import type { DesignLayer } from '../model/types';
import s from './constructor.module.css';

const label = (l: DesignLayer) => (l.kind === 'image' ? l.fileName : l.text.trim() || 'Пустой текст');

/**
 * Слои текущей стороны: сверху — то, что нарисовано поверх. Тап по строке выбирает слой
 * (так можно достать картинку, перекрытую другой), кнопки меняют порядок, дублируют и удаляют.
 */
export function LayersPanel({ hex }: { hex: string }) {
  const side = useConstructor((st) => st.side);
  const layers = useConstructor((st) => st.layers);
  const selectedId = useConstructor((st) => st.selectedLayerId);
  const { selectLayer, moveLayer, duplicateLayer, removeLayer } = useConstructor.getState();

  const sideLayers = layers.filter((l) => l.side === side);
  if (!sideLayers.length) return null;
  const top = [...sideLayers].reverse();

  return (
    <>
      <h3 className={s.h}>Слои</h3>
      <ul className={s.layers}>
        {top.map((l, i) => {
          const active = l.id === selectedId;
          return (
            <li key={l.id} className={active ? s.layerActive : s.layer}>
              <button
                className={s.layerMain}
                onClick={() => selectLayer(l.id)}
                aria-pressed={active}
                title={label(l)}
              >
                <span className={s.thumb} style={{ background: hex }} aria-hidden>
                  {l.kind === 'image' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={l.src} alt="" />
                  ) : (
                    <span style={{ color: l.fill, fontFamily: l.fontFamily }}>Aa</span>
                  )}
                </span>
                <span className={s.layerName}>{label(l)}</span>
              </button>
              <div className={s.layerActions}>
                <button className={s.iconBtn} onClick={() => moveLayer(l.id, 1)} disabled={i === 0} aria-label="Выше" title="Выше">↑</button>
                <button className={s.iconBtn} onClick={() => moveLayer(l.id, -1)} disabled={i === top.length - 1} aria-label="Ниже" title="Ниже">↓</button>
                <button className={s.iconBtn} onClick={() => duplicateLayer(l.id)} aria-label="Дублировать" title="Дублировать">⧉</button>
                <button className={s.iconBtnDanger} onClick={() => removeLayer(l.id)} aria-label="Удалить" title="Удалить">✕</button>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
