'use client';
import type { RefObject } from 'react';
import type { DesignStageHandle } from '../canvas/DesignStage';
import { printAreaFor } from '../config/print-areas';
import { imageDpi, MIN_DPI } from '../model/quality';
import { selectGarment, useConstructor } from '../model/store';
import { SIDE_LABEL } from '../model/types';
import { TextPanel } from './TextPanel';
import s from './constructor.module.css';

interface Props {
  stage: RefObject<DesignStageHandle>;
  fileError: string | null;
  onUpload: () => void;
  onAddText: () => void;
}

/**
 * Правая панель «Дизайн» зависит от выбора на холсте:
 * ничего не выбрано — крупные кнопки добавления; текст — настройки текста; картинка — её параметры.
 */
export function DesignPanel({ stage, fileError, onUpload, onAddText }: Props) {
  const side = useConstructor((st) => st.side);
  const garment = useConstructor(selectGarment);
  const selected = useConstructor((st) => st.layers.find((l) => l.id === st.selectedLayerId));
  const { updateLayer, selectLayer } = useConstructor.getState();

  const dpi = selected?.kind === 'image' && garment
    ? imageDpi(selected, printAreaFor(garment, selected.side).widthCm, selected.isVector)
    : null;

  return (
    <>
      <h3 className={s.h}>Дизайн · {SIDE_LABEL[side]}</h3>
      <div className={s.tools}>
        <button className={selected ? s.btnSmallPrimary : s.btnPrimary} onClick={onUpload}>
          {selected ? '+ Картинка' : 'Загрузить картинку'}
        </button>
        <button className={selected ? s.btnSmall : s.btn} onClick={onAddText}>
          {selected ? '+ Текст' : 'Добавить текст'}
        </button>
      </div>
      {!selected && <p className={s.muted}>PNG, JPG, WEBP или SVG до 15 МБ. Лучше — PNG с прозрачным фоном. Файл можно перетащить прямо на изделие.</p>}
      {fileError && <p className={s.err}>{fileError}</p>}

      {selected && (
        <div className={s.props}>
          <div className={s.propsHead}>
            <span>{selected.kind === 'text' ? 'Текст' : 'Картинка'}</span>
            <button className={s.linkBtn} onClick={() => selectLayer(null)}>Снять выбор</button>
          </div>

          {selected.kind === 'text' && (
            <>
              <TextPanel layer={selected} />
            </>
          )}

          {selected.kind === 'image' && dpi !== null && (
            <p className={dpi >= MIN_DPI ? s.ok : s.warn}>
              {dpi === Infinity
                ? 'Векторный файл — качество отличное.'
                : dpi >= MIN_DPI
                  ? `Качество печати хорошее (${dpi} dpi).`
                  : `Низкое разрешение (${dpi} dpi) — при таком размере печать может выйти нечёткой. Уменьшите картинку или загрузите файл побольше.`}
            </p>
          )}
          {selected.kind === 'image' && selected.crop && (
            <p className={s.muted}>Пустые поля по краям убрали — размер и цена считаются по самому рисунку.</p>
          )}

          <div className={s.align} role="group" aria-label="Выравнивание">
            <button className={s.btnSmall} onClick={() => stage.current?.align(selected.id, 'centerX')} title="По центру по горизонтали">⇔ Центр</button>
            <button className={s.btnSmall} onClick={() => stage.current?.align(selected.id, 'centerY')} title="По центру по вертикали">⇕ Центр</button>
            <button className={s.btnSmall} onClick={() => stage.current?.align(selected.id, 'fit')} title="Максимальный размер в зоне печати">⤢ Вписать</button>
          </div>
          <button
            className={selected.flipX ? s.btnSmallPrimary : s.btnSmall} aria-pressed={!!selected.flipX}
            onClick={() => updateLayer(selected.id, { flipX: !selected.flipX })} title="Отразить по горизонтали"
          >⇋ Отразить</button>
        </div>
      )}
    </>
  );
}
