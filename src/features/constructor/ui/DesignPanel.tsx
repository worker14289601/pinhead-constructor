'use client';
import type { RefObject } from 'react';
import type { DesignStageHandle } from '../canvas/DesignStage';
import { printAreaFor } from '../config/print-areas';
import { imageDpi, MIN_DPI } from '../model/quality';
import { selectGarment, useConstructor } from '../model/store';
import { SIDE_LABEL, SIDE_TAB } from '../model/types';
import { Icon, type IconName } from './icons';
import { TextPanel } from './TextPanel';
import s from './constructor.module.css';
import d from './design.module.css';

interface Props {
  stage: RefObject<DesignStageHandle>;
  fileError: string | null;
  onUpload: () => void;
  onAddText: () => void;
  /** Открыть каталог готовых принтов; без пропа карточка «Готовые принты» не показывается. */
  onTemplates?: () => void;
  /** Вставить своё фото в место под фото из готового принта (id слоя). */
  onReplacePhoto?: (id: string) => void;
  /** Поменять слово, по буквам которого обрезано фото. */
  onMaskText?: (id: string, text: string) => void;
  /** Открыть кадрирование картинки (id слоя). */
  onCrop?: (id: string) => void;
}

/**
 * Правая панель «Дизайн» зависит от выбора на холсте:
 * ничего не выбрано — три крупных входа (готовые принты, картинка, текст); текст — настройки текста; картинка — её параметры.
 */
export function DesignPanel({ stage, fileError, onUpload, onAddText, onTemplates, onReplacePhoto, onMaskText, onCrop }: Props) {
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

  const kindLabel = selected?.kind === 'text' ? 'Текст' : 'Картинка';

  return (
    <>
      {!selected ? (
        <>
          <h3 className={s.h}>Принт · {SIDE_LABEL[side]}</h3>
          <div className={d.actions}>
            {/* Главная карточка во всю ширину сверху, две остальные — в ряд под ней */}
            <button type="button" className={d.cardPrimary} onClick={onUpload}>
              <Icon name="upload" size={24} />
              <span className={d.cardText}>
                <span className={d.cardTitlePrimary}>Загрузить картинку</span>
                <span className={d.cardNote}>PNG, JPG, SVG · до 15 МБ</span>
              </span>
            </button>
            {onTemplates && (
              <button type="button" className={d.card} onClick={onTemplates}>
                <Icon name="brush" size={22} />
                <span className={d.cardText}>
                  <span className={d.cardTitle}>Готовые принты</span>
                  <span className={d.cardNote}>Выберите и поменяйте текст</span>
                </span>
              </button>
            )}
            <button type="button" className={d.card} onClick={onAddText}>
              <Icon name="textFont" size={22} />
              <span className={d.cardText}>
                <span className={d.cardTitle}>Добавить текст</span>
              </span>
            </button>
          </div>
        </>
      ) : null}
      {fileError && <p className={s.err}>{fileError}</p>}

      {selected && (
        <div className={d.body} key={selected.id}>
          {/* Режим редактирования: шапка закреплена, «Готово» всегда под рукой и возвращает обычный вид панели. */}
          <div className={d.editHead}>
            <span className={d.chip}>
              <span className={d.chipIcon}><Icon name={selected.kind === 'text' ? 'text' : 'image'} size={18} /></span>
              {kindLabel}
              <span className={d.chipSide}>· {SIDE_TAB[side]}</span>
            </span>
            <button type="button" className={d.doneBtn} onClick={() => selectLayer(null)} title="Готово (Esc)">
              <Icon name="checkMark" size={18} />Готово
            </button>
          </div>

          {selected.kind === 'text' && <TextPanel layer={selected} />}

          {selected.kind === 'image' && selected.mask?.kind === 'text' && onMaskText && (
            <label className={d.maskField}>
              <span>Слово</span>
              <input
                className={d.maskInput} value={selected.mask.text} maxLength={14} autoCapitalize="characters" enterKeyHint="done"
                onChange={(e) => onMaskText(selected.id, e.target.value.toUpperCase())}
              />
            </label>
          )}
          {selected.kind === 'image' && selected.slot !== undefined && onReplacePhoto && (
            <button type="button" className={selected.placeholder ? d.slotBtnMain : d.slotBtn} onClick={() => onReplacePhoto(selected.id)}>
              <Icon name="upload" size={20} />{selected.placeholder ? 'Вставить своё фото' : 'Заменить фото'}
            </button>
          )}
          {selected.kind === 'image' && !selected.placeholder && dpi !== null && (
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
          {selected.kind === 'image' && !selected.placeholder && onCrop && (
            <button type="button" className={d.slotBtn} onClick={() => onCrop(selected.id)}>
              <Icon name="crop" size={20} />{selected.slot !== undefined ? 'Подвинуть фото в рамке' : 'Кадрировать'}
            </button>
          )}
          {selected.kind === 'image' && selected.crop && selected.slot === undefined && !selected.cropped && (
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
