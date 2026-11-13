'use client';
import type { RefObject } from 'react';
import type { DesignStageHandle } from '../canvas/DesignStage';
import { printAreaFor } from '../config/print-areas';
import { imageDpi, MIN_DPI } from '../model/quality';
import { selectGarment, useConstructor } from '../model/store';
import { SIDE_LABEL } from '../model/types';
import { Icon, type IconName } from './icons';
import { TextPanel } from './TextPanel';
import s from './constructor.module.css';
import d from './design.module.css';

interface Props {
  stage: RefObject<DesignStageHandle>;
  fileError: string | null;
  onUpload: () => void;
  onAddText: () => void;
}

/**
 * Правая панель «Дизайн» зависит от выбора на холсте:
 * ничего не выбрано — крупные карточки добавления; текст — настройки текста; картинка — её параметры.
 */
export function DesignPanel({ stage, fileError, onUpload, onAddText }: Props) {
  const side = useConstructor((st) => st.side);
  const garment = useConstructor(selectGarment);
  const selected = useConstructor((st) => st.layers.find((l) => l.id === st.selectedLayerId));
  const { updateLayer, selectLayer } = useConstructor.getState();

  const dpi = selected?.kind === 'image' && garment
    ? imageDpi(selected, printAreaFor(garment, selected.side).widthCm, selected.isVector)
    : null;

  // Действия со слоем: одна сегментная панель иконок
  const actions: Array<{ icon: IconName; label: string; run: () => void; pressed?: boolean }> = selected ? [
    { icon: 'alignCenterX', label: 'По центру по горизонтали', run: () => stage.current?.align(selected.id, 'centerX') },
    { icon: 'alignCenterY', label: 'По центру по вертикали', run: () => stage.current?.align(selected.id, 'centerY') },
    { icon: 'fit', label: 'Вписать: максимальный размер в зоне печати', run: () => stage.current?.align(selected.id, 'fit') },
    { icon: 'flip', label: 'Отразить по горизонтали', run: () => updateLayer(selected.id, { flipX: !selected.flipX }), pressed: !!selected.flipX },
  ] : [];

  return (
    <>
      <h3 className={s.h}>Дизайн · {SIDE_LABEL[side]}</h3>

      {!selected ? (
        <>
          <div className={d.actions}>
            <button className={d.cardPrimary} onClick={onUpload}>
              <Icon name="upload" size={24} />
              <span className={d.cardTitle}>Загрузить картинку</span>
              <span className={d.cardNote}>PNG, JPG, SVG · до 15 МБ</span>
            </button>
            <button className={d.card} onClick={onAddText}>
              <Icon name="textFont" size={24} />
              <span className={d.cardTitle}>Добавить текст</span>
            </button>
          </div>
          <p className={s.muted}>Лучше PNG с прозрачным фоном. Файл можно перетащить на изделие.</p>
        </>
      ) : (
        <div className={d.addRow}>
          <button className={d.addBtn} onClick={onUpload}><Icon name="plus" size={18} />Картинка</button>
          <button className={d.addBtn} onClick={onAddText}><Icon name="plus" size={18} />Текст</button>
        </div>
      )}
      {fileError && <p className={s.err}>{fileError}</p>}

      {selected && (
        <div className={d.body} key={selected.id}>
          <div className={d.head}>
            <span className={d.chip}>
              <span className={d.chipIcon}><Icon name={selected.kind === 'text' ? 'text' : 'image'} size={18} /></span>
              {selected.kind === 'text' ? 'Текст' : 'Картинка'}
            </span>
            <button className={d.closeBtn} onClick={() => selectLayer(null)} title="Снять выбор" aria-label="Снять выбор">
              <Icon name="close" size={18} />
            </button>
          </div>

          {selected.kind === 'text' && <TextPanel layer={selected} />}

          {selected.kind === 'image' && dpi !== null && (
            <p className={`${d.badge} ${dpi >= MIN_DPI ? '' : d.badgeWarn}`}>
              <Icon name={dpi >= MIN_DPI ? 'check' : 'alert'} size={18} />
              <span>
                {dpi === Infinity
                  ? 'Векторный файл — качество отличное.'
                  : dpi >= MIN_DPI
                    ? `Качество печати хорошее (${dpi} dpi).`
                    : `Низкое разрешение (${dpi} dpi) — при таком размере печать может выйти нечёткой. Уменьшите картинку или загрузите файл побольше.`}
              </span>
            </p>
          )}
          {selected.kind === 'image' && selected.crop && (
            <p className={d.note}>Пустые поля по краям убрали — размер и цена считаются по самому рисунку.</p>
          )}

          <div className={d.seg} role="group" aria-label="Положение и размер">
            {actions.map((a) => (
              <button
                key={a.icon} type="button" className={d.segBtn} title={a.label} aria-label={a.label}
                aria-pressed={a.pressed} onClick={a.run}
              ><Icon name={a.icon} size={20} /></button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
