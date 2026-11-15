'use client';
import { useEffect, useReducer, useState } from 'react';
import { track } from '../analytics/events';
import { isLight } from '../canvas/tint';
import { TEMPLATE_CATEGORIES, TEMPLATES, templateFill, type PrintTemplate } from '../config/templates';
import { ensureFont, onFontLoaded } from '../model/fonts';
import { useConstructor } from '../model/store';
import t from './templates.module.css';
import { useDismiss } from './useDismiss';

/** Превью шаблона: те же шрифты, текст в HTML; дуга в превью не рисуется, на холсте применяется настоящая. */
function Preview({ tpl, hex, light }: { tpl: PrintTemplate; hex: string; light: boolean }) {
  return (
    <div className={t.preview} style={{ background: hex }}>
      <div className={t.zone}>
        {tpl.layers.map((l, i) => (
          <span
            key={i}
            className={t.line}
            style={{
              left: `${l.x * 100}%`, top: `${l.y * 100}%`,
              transform: `translate(-50%, -50%) rotate(${l.rotation}deg)`,
              fontFamily: `"${l.fontFamily}", sans-serif`,
              fontSize: `${l.fontSize * 100}cqw`,
              fontWeight: l.bold ? 700 : 400, fontStyle: l.italic ? 'italic' : 'normal',
              lineHeight: l.lineHeight, textAlign: l.align,
              color: templateFill(l.tone, light),
            }}
          >
            {l.text}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Готовые принты: лист снизу на телефоне, окно по центру на десктопе.
 * hex — цвет ткани: на нём рисуются превью и по нему выбирается цвет надписей.
 */
export function TemplatePicker({ hex, onClose }: { hex: string; onClose: () => void }) {
  const { leaving, dismiss } = useDismiss();
  const close = () => dismiss(onClose);
  const [category, setCategory] = useState<string>('Все');
  const [pending, setPending] = useState<PrintTemplate | null>(null);
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const applyTemplate = useConstructor((s) => s.applyTemplate);
  const hasLayers = useConstructor((s) => s.layers.some((l) => l.side === s.side));
  const light = isLight(hex);

  // Шрифты превью грузим сразу все; после загрузки перерисовываем.
  useEffect(() => {
    const off = onFontLoaded(redraw);
    for (const tpl of TEMPLATES) for (const l of tpl.layers) ensureFont(l.fontFamily, l.bold, l.italic, l.text).catch(() => {});
    return off;
  }, []);

  // Esc: закрывает подтверждение, а если его нет — весь лист.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (pending) setPending(null); else dismiss(onClose);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, dismiss, onClose]);

  const apply = (tpl: PrintTemplate) => {
    applyTemplate(tpl.layers.map(({ tone, ...l }) => ({ ...l, fill: templateFill(tone, light) })));
    track('template_apply', { id: tpl.id });
    onClose();
  };
  const pick = (tpl: PrintTemplate) => (hasLayers ? setPending(tpl) : apply(tpl));

  const list = category === 'Все' ? TEMPLATES : TEMPLATES.filter((x) => x.category === category);

  return (
    <div className={t.backdrop} data-leaving={leaving || undefined} onClick={close}>
      <div className={t.sheet} role="dialog" aria-label="Готовые принты" onClick={(e) => e.stopPropagation()}>
        <div className={t.head}>
          <h3 className={t.title}>Готовые принты</h3>
          <button type="button" className={t.close} aria-label="Закрыть" onClick={close}>
            <svg viewBox="0 0 24 24" aria-hidden><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
        <div className={t.chips} role="tablist" aria-label="Категории">
          {['Все', ...TEMPLATE_CATEGORIES].map((name) => (
            <button
              key={name} type="button" role="tab" aria-selected={category === name}
              className={t.chip} data-on={category === name || undefined} onClick={() => setCategory(name)}
            >
              {name}
            </button>
          ))}
        </div>
        <div className={t.scroll}>
          <div className={t.grid}>
            {list.map((tpl) => (
              <button key={tpl.id} type="button" className={t.card} onClick={() => pick(tpl)}>
                <Preview tpl={tpl} hex={hex} light={light} />
                <span className={t.name}>{tpl.title}</span>
              </button>
            ))}
          </div>
        </div>
        {pending && (
          <div className={t.confirm} role="alertdialog" aria-label="Подтверждение замены">
            <p className={t.confirmText}>Заменить текущий принт на этой стороне?</p>
            <div className={t.confirmBtns}>
              <button type="button" className={t.btnGhost} onClick={() => setPending(null)}>Отмена</button>
              <button type="button" className={t.btnMain} onClick={() => apply(pending)}>Заменить</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
