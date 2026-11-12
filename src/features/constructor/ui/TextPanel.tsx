'use client';
import { useEffect, useState } from 'react';
import { FONT_GROUPS, FONTS, fontDef, TEXT_COLORS } from '../config/fonts';
import { ensureFont, onFontLoaded } from '../model/fonts';
import { useConstructor } from '../model/store';
import type { TextLayer } from '../model/types';
import s from './constructor.module.css';

const AlignIcon = ({ mode }: { mode: TextLayer['align'] }) => {
  // Строки разной длины: у «по левому» и «по правому» они прижаты к своему краю, у «по центру» — по центру.
  const w = mode === 'center' ? [10, 6, 10] : [16, 10, 13];
  const x = (i: number) => (mode === 'left' ? 3 : mode === 'right' ? 21 - w[i] : 12 - w[i] / 2);
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      {[6, 12, 18].map((y, i) => <line key={y} x1={x(i)} x2={x(i) + w[i]} y1={y} y2={y} />)}
    </svg>
  );
};

const ALIGNS: Array<[TextLayer['align'], string]> = [['left', 'По левому краю'], ['center', 'По центру'], ['right', 'По правому краю']];

/** Все настройки выбранного текста: шрифт карточками, начертание, цвет, интервал, обводка, дуга. */
export function TextPanel({ layer }: { layer: TextLayer }) {
  const { updateLayer } = useConstructor.getState();
  const [, tick] = useState(0);
  const def = fontDef(layer.fontFamily);
  const set = (patch: Partial<TextLayer>, mode: 'commit' | 'merge' = 'commit') => updateLayer(layer.id, patch, mode);

  // Превью карточек — текст слоя нужным шрифтом, поэтому грузим все шрифты списка (только нужные буквы).
  const sample = layer.text.split('\n')[0].trim().slice(0, 18) || 'Аа Bb';
  useEffect(() => {
    const t = setTimeout(() => FONTS.forEach((f) => ensureFont(f.family, false, false, sample).catch(() => {})), 250);
    return () => clearTimeout(t);
  }, [sample]);
  useEffect(() => onFontLoaded(() => tick((n) => n + 1)), []);

  const pickFont = (family: string) => {
    const d = fontDef(family);
    // У нового шрифта может не быть жирного/курсива — сбрасываем, чтобы файл печати совпал с выбором.
    set({ fontFamily: family, bold: layer.bold && !!d?.bold, italic: layer.italic && !!d?.italic });
  };

  return (
    <>
      <textarea
        className={s.input} rows={2} value={layer.text} aria-label="Текст" placeholder="Введите текст"
        onChange={(e) => set({ text: e.target.value }, 'merge')}
      />

      <div className={s.sub}>Шрифт</div>
      {FONT_GROUPS.map(([group, title]) => (
        <div key={group}>
          <div className={s.fontGroup}>{title}</div>
          <div className={s.fonts}>
            {FONTS.filter((f) => f.group === group).map((f) => (
              <button
                key={f.family} type="button" aria-pressed={f.family === layer.fontFamily}
                className={f.family === layer.fontFamily ? s.fontCardActive : s.fontCard}
                onClick={() => pickFont(f.family)} title={f.family}
              >
                <span style={{ fontFamily: `"${f.family}", Arial, sans-serif` }}>{sample}</span>
                <small>{f.family}</small>
              </button>
            ))}
          </div>
        </div>
      ))}

      <div className={s.styleRow}>
        <button
          className={layer.bold ? s.toggleOn : s.toggle} aria-pressed={layer.bold} disabled={!def?.bold && !layer.bold}
          title={def && !def.bold ? 'У этого шрифта нет жирного начертания' : 'Жирный'} aria-label="Жирный"
          onClick={() => set({ bold: !layer.bold })}
        ><b>B</b></button>
        <button
          className={layer.italic ? s.toggleOn : s.toggle} aria-pressed={layer.italic} disabled={!def?.italic && !layer.italic}
          title={def && !def.italic ? 'У этого шрифта нет курсива' : 'Курсив'} aria-label="Курсив"
          onClick={() => set({ italic: !layer.italic })}
        ><i>I</i></button>
        <span className={s.sep} />
        {ALIGNS.map(([a, label]) => (
          <button
            key={a} className={layer.align === a ? s.toggleOn : s.toggle} aria-pressed={layer.align === a}
            title={label} aria-label={label} onClick={() => set({ align: a })}
          ><AlignIcon mode={a} /></button>
        ))}
      </div>

      <div className={s.sub}>Цвет</div>
      <div className={s.palette} role="group" aria-label="Цвет текста">
        {TEXT_COLORS.map((c) => (
          <button
            key={c} type="button" className={c === layer.fill.toLowerCase() ? s.dotActive : s.dotBtn}
            style={{ background: c }} aria-label={c} onClick={() => set({ fill: c }, 'merge')}
          />
        ))}
        <input type="color" className={s.colorMini} value={layer.fill} aria-label="Свой цвет" title="Свой цвет"
          onChange={(e) => set({ fill: e.target.value }, 'merge')} />
      </div>

      <label className={s.slider}>
        <span>Межстрочный интервал <b>{layer.lineHeight.toFixed(2)}</b></span>
        <input type="range" min={0.8} max={2} step={0.05} value={layer.lineHeight}
          onChange={(e) => set({ lineHeight: Number(e.target.value) }, 'merge')} />
      </label>
      <label className={s.slider}>
        <span>Дуга <b>{layer.arc}</b></span>
        <input type="range" min={-100} max={100} step={1} value={layer.arc} aria-label="Изгиб текста дугой"
          onChange={(e) => set({ arc: Number(e.target.value) }, 'merge')} />
      </label>

      <label className={s.check}>
        <input
          type="checkbox" checked={layer.strokeWidth > 0}
          onChange={(e) => set({ strokeWidth: e.target.checked ? 0.06 : 0 })}
        />
        <span>Обводка</span>
      </label>
      {layer.strokeWidth > 0 && (
        <div className={s.row}>
          <input type="color" className={s.colorMini} value={layer.strokeColor} aria-label="Цвет обводки"
            onChange={(e) => set({ strokeColor: e.target.value }, 'merge')} />
          <label className={`${s.slider} ${s.grow}`}>
            <span>Толщина</span>
            <input type="range" min={0.01} max={0.2} step={0.01} value={layer.strokeWidth}
              onChange={(e) => set({ strokeWidth: Number(e.target.value) }, 'merge')} />
          </label>
        </div>
      )}
    </>
  );
}
