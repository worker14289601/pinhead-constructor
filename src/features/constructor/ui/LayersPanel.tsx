'use client';
import { useConstructor } from '../model/store';
import type { DesignLayer } from '../model/types';
import { Icon } from './icons';
import s from './constructor.module.css';
import o from './order.module.css';

const label = (l: DesignLayer) => (l.kind === 'image' ? l.fileName : l.text.trim() || 'Пустой текст');

/**
 * Слои текущей стороны: сверху — то, что нарисовано поверх. Тап по строке выбирает слой
 * (так можно достать картинку, перекрытую другой), кнопки меняют порядок, дублируют и удаляют.
 */
export function LayersPanel({ hex, open, onToggle }: { hex: string; open: boolean; onToggle: () => void }) {
  const side = useConstructor((st) => st.side);
  const layers = useConstructor((st) => st.layers);
  const selectedId = useConstructor((st) => st.selectedLayerId);
  const { selectLayer, moveLayer, duplicateLayer, removeLayer } = useConstructor.getState();

  const sideLayers = layers.filter((l) => l.side === side);
  const top = [...sideLayers].reverse();

  return (
    <>
      <div className={o.head}>
        <div className={o.titleWrap}>
          <h3 className={s.h}>Слои</h3>
          <span className={o.count}>{top.length}</span>
        </div>
        {/* На мобильном слои — отдельная вкладка, сворачивать нечего. */}
        <button
          className={`${o.collapse} ${s.desktopOnly}`} onClick={onToggle} aria-expanded={open}
          aria-label={open ? 'Свернуть слои' : 'Развернуть слои'} title={open ? 'Свернуть' : 'Развернуть'}
        >
          <Icon name={open ? 'chevronUp' : 'chevronDown'} size={18} />
        </button>
      </div>
      {!top.length && (
        <p className={o.empty}><Icon name="layers" size={18} />Пока пусто — добавьте картинку или текст.</p>
      )}
      {/* s.layers нужен мобильной вёрстке: там список не сворачивается. */}
      <ul className={`${s.layers} ${o.list}`} hidden={!open}>
        {top.map((l, i) => {
          const active = l.id === selectedId;
          return (
            <li key={l.id} className={active ? o.layerActive : o.layer}>
              <button className={o.main} onClick={() => selectLayer(l.id)} aria-pressed={active} title={label(l)}>
                <span className={s.thumb} style={{ background: hex }} aria-hidden>
                  {l.kind === 'image' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={l.src} alt="" />
                  ) : (
                    <span style={{ color: l.fill, fontFamily: l.fontFamily }}>Aa</span>
                  )}
                </span>
                <span className={o.names}>
                  <span className={o.name}>{label(l)}</span>
                  <span className={o.kind}>{l.kind === 'image' ? 'Картинка' : 'Текст'}</span>
                </span>
              </button>
              <div className={o.actions}>
                <button className={o.act} onClick={() => moveLayer(l.id, 1)} disabled={i === 0} aria-label="Выше" title="Выше"><Icon name="arrowUp" size={18} /></button>
                <button className={o.act} onClick={() => moveLayer(l.id, -1)} disabled={i === top.length - 1} aria-label="Ниже" title="Ниже"><Icon name="arrowDown" size={18} /></button>
                <button className={o.act} onClick={() => duplicateLayer(l.id)} aria-label="Дублировать" title="Дублировать"><Icon name="copy" size={18} /></button>
                <button className={`${o.act} ${o.actDanger}`} onClick={() => removeLayer(l.id)} aria-label="Удалить" title="Удалить"><Icon name="trash" size={18} /></button>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
