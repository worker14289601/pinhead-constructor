'use client';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchCatalog } from '../api/catalog';
import { track } from '../analytics/events';
import { getUtm } from '../analytics/utm';
import { printAreaFor, sidesFor } from '../config/print-areas';
import { FRAME } from '../config/garment-shapes';
import { METHOD_INFO, WHITE_MIN_CHANNEL } from '../config/pricing';
import { hexToRgb, isLight } from '../canvas/tint';
import { designBounds } from '../model/bounds';
import { calcPrice } from '../model/pricing';
import { imageDpi, MIN_DPI, validateFile, ACCEPTED_TYPES } from '../model/quality';
import { canRedo, canUndo, selectGarment, selectVariant, useConstructor } from '../model/store';
import { SIDE_LABEL, SIDE_TAB, type PrintMethod } from '../model/types';
import type { DesignStageHandle } from '../canvas/DesignStage';
import { LayersPanel } from './LayersPanel';
import { OrderForm } from './OrderForm';
import s from './constructor.module.css';

// Konva работает только в браузере.
const DesignStage = dynamic(() => import('../canvas/DesignStage').then((m) => m.DesignStage), {
  ssr: false,
  loading: () => <div className={s.stub}>Загружаем редактор…</div>,
});

const TYPE_LABEL: Record<string, string> = {
  tshirt: 'Футболки', longsleeve: 'Лонгсливы', sweatshirt: 'Свитшоты', hoodie: 'Худи', totebag: 'Шопперы', cap: 'Кепки',
};
const FONTS = ['Arial', 'Georgia', 'Impact', 'Courier New', 'Trebuchet MS'];

/** Стрелка отмены; для повтора — зеркально. Символы ↶ ↷ в системных шрифтах выглядят по-разному. */
const HistoryIcon = ({ redo }: { redo?: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden style={redo ? { transform: 'scaleX(-1)' } : undefined}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </svg>
);

type Tab = 'garment' | 'design' | 'order';
const TABS: Array<[Tab, string]> = [['garment', 'Изделие'], ['design', 'Дизайн'], ['order', 'Размеры']];

/** ordersEndpoint — куда уходит заявка: POST {endpoint}/number выдаёт номер, POST {endpoint} принимает заявку. */
export function ConstructorApp({ ordersEndpoint = '/api/orders' }: { ordersEndpoint?: string }) {
  const st = useConstructor();
  const garment = useConstructor(selectGarment);
  const variant = useConstructor(selectVariant);
  const stageRef = useRef<DesignStageHandle>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [orderOpen, setOrderOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('garment');
  const undoable = useConstructor(canUndo);
  const redoable = useConstructor(canRedo);
  const sides = sidesFor(garment);

  useEffect(() => {
    const ac = new AbortController();
    track('constructor_open');
    getUtm(); // запоминаем метки первого захода
    fetchCatalog(ac.signal).then(st.setCatalog).catch((e) => !ac.signal.aborted && setError(String(e.message ?? e)));
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cmd/Ctrl+Z — отмена, Cmd/Ctrl+Shift+Z и Ctrl+Y — повтор, Delete — удалить выбранный слой.
  // Когда фокус в поле ввода, клавиши остаются полю (там своя отмена набора).
  // Пока открыта форма заявки, клавиши холст не трогают.
  useEffect(() => {
    if (orderOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      const st = useConstructor.getState();
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && (key === 'z' || e.code === 'KeyZ')) {
        e.preventDefault();
        if (e.shiftKey) st.redo(); else st.undo();
      } else if (mod && (key === 'y' || e.code === 'KeyY')) {
        e.preventDefault();
        st.redo();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && st.selectedLayerId) {
        e.preventDefault();
        st.removeLayer(st.selectedLayerId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [orderOpen]);

  const hex = variant?.hex ?? '#ffffff';
  const price = useMemo(() => {
    if (!variant || !garment) return null;
    // Габарит — только по сторонам модели: печать на рукаве у шоппера в цену не идёт.
    const bounds = designBounds(garment, st.layers);
    const isWhite = hexToRgb(hex).every((c) => c >= WHITE_MIN_CHANNEL);
    return calcPrice({ garmentPrice: variant.price, isWhite, method: st.method, bounds, sizes: st.sizes });
  }, [variant, garment, hex, st.method, st.layers, st.sizes]);

  const onFile = (f?: File) => {
    if (!f || !garment) return;
    const err = validateFile(f);
    setFileError(err);
    if (err) return;
    const url = URL.createObjectURL(f);
    const img = new window.Image();
    img.onload = () => {
      const isVector = f.type === 'image/svg+xml';
      const nw = img.naturalWidth || 1000;
      const nh = img.naturalHeight || 1000;
      // Вписываем в зону печати: 80% ширины, но не выше 80% высоты зоны.
      const pa = printAreaFor(garment, st.side);
      const areaRatio = pa.height / pa.width; // в единицах кадра: высота/ширина зоны
      const frameRatio = FRAME.h / FRAME.w;
      const width = Math.min(0.8, (0.8 * areaRatio * frameRatio * nw) / nh);
      st.addImage({ src: url, fileName: f.name, isVector, naturalWidth: nw, naturalHeight: nh, width });
      track('image_upload', { w: nw, h: nh, type: f.type, kb: Math.round(f.size / 1024) });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setFileError('Не получилось открыть файл. Попробуйте PNG или JPG.');
    };
    img.src = url;
  };

  const selected = st.layers.find((l) => l.id === st.selectedLayerId);
  const sideHasLayers = st.layers.some((l) => l.side === st.side);
  const dpi = selected?.kind === 'image' && garment
    ? imageDpi(selected, printAreaFor(garment, selected.side).widthCm, selected.isVector)
    : null;

  const hasDesign = st.layers.some((l) => sides.includes(l.side));
  const canOrder = !!price?.qty && hasDesign;
  const openOrder = () => {
    if (!hasDesign) return setTab('design');
    if (!price?.qty) return setTab('order');
    setOrderOpen(true);
    track('order_form_open');
  };

  return (
    <div className={s.app} data-tab={tab}>
      {/* Изделие */}
      <section className={`${s.panel} ${s.left}`} data-section="garment">
        <h3 className={s.h}>Изделие</h3>
        {error && <p className={s.err}>{error}</p>}
        {!st.garments.length && !error && <p className={s.muted}>Загружаем каталог…</p>}
        <div className={s.garments}>
          {st.garments.map((g) => (
            <button
              key={g.id}
              className={g.id === st.garmentId ? s.chipActive : s.chip}
              onClick={() => { st.selectGarment(g.id); track('garment_select', { id: g.id }); }}
              title={TYPE_LABEL[g.type]}
            >
              <span>{g.name}</span>
              <small>от {g.basePrice} ₽</small>
            </button>
          ))}
        </div>
        {garment && (
          <>
            <h3 className={s.h}>Цвет · {variant?.colorName}</h3>
            <div className={s.colors}>
              {garment.variants.map((v) => (
                <button
                  key={v.productId}
                  className={v.productId === st.variantId ? s.swatchActive : s.swatch}
                  style={{ background: v.hex }}
                  title={v.colorName}
                  aria-label={v.colorName}
                  onClick={() => { st.selectVariant(v.productId); track('color_select', { color: v.colorName }); }}
                />
              ))}
            </div>
          </>
        )}
      </section>

      {/* Холст */}
      <main className={s.center}>
        {/* Отмена/повтор — в углу холста: строка вкладок занята четырьмя сторонами. */}
        <div className={s.history}>
          <button className={s.iconBtn} onClick={st.undo} disabled={!undoable} aria-label="Отменить" title="Отменить (Ctrl+Z)"><HistoryIcon /></button>
          <button className={s.iconBtn} onClick={st.redo} disabled={!redoable} aria-label="Повторить" title="Повторить (Ctrl+Shift+Z)"><HistoryIcon redo /></button>
        </div>
        <div className={s.sides}>
          {sides.map((side) => (
            <button
              key={side}
              className={side === st.side ? s.tabActive : s.tab}
              title={SIDE_LABEL[side]}
              onClick={() => { st.setSide(side); track('side_switch', { side }); }}
            >
              {SIDE_TAB[side]}
              {st.layers.some((l) => l.side === side) && <i className={s.dot} />}
            </button>
          ))}
        </div>
        <div className={s.stage}>
          <DesignStage apiRef={stageRef} />
        </div>
        {!sideHasLayers && garment && (
          <button className={s.emptyHint} onClick={() => { setTab('design'); fileRef.current?.click(); }}>
            + Загрузите картинку или добавьте текст
          </button>
        )}
      </main>

      {/* Вкладки — только на мобильном */}
      <nav className={s.tabbar}>
        {TABS.map(([id, label]) => (
          <button key={id} className={tab === id ? s.tabbarActive : s.tabbarBtn} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>

      <aside className={`${s.panel} ${s.right}`}>
        {/* Дизайн */}
        <section className={s.section} data-section="design">
          <h3 className={s.h}>Дизайн · {SIDE_LABEL[st.side]}</h3>
          <div className={s.tools}>
            <button className={s.btnPrimary} onClick={() => fileRef.current?.click()}>Загрузить картинку</button>
            <button className={s.btn} onClick={() => { st.addText(isLight(hex) ? '#111111' : '#ffffff'); track('text_add'); }}>
              Добавить текст
            </button>
          </div>
          <input
            ref={fileRef} type="file" hidden accept={ACCEPTED_TYPES.join(',')}
            onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }}
          />
          <p className={s.muted}>PNG, JPG, WEBP или SVG до 15 МБ. Лучше — PNG с прозрачным фоном.</p>
          {fileError && <p className={s.err}>{fileError}</p>}

          {/* Список — над свойствами: при выборе слоя строки не съезжают из-под пальца. */}
          <LayersPanel hex={hex} />

          {selected?.kind === 'text' && (
            <div className={s.props}>
              <input
                className={s.input} value={selected.text} aria-label="Текст"
                onChange={(e) => st.updateLayer(selected.id, { text: e.target.value }, 'merge')}
              />
              <div className={s.row}>
                <select
                  className={s.input} value={selected.fontFamily} aria-label="Шрифт"
                  onChange={(e) => st.updateLayer(selected.id, { fontFamily: e.target.value })}
                >
                  {FONTS.map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
                </select>
                <input
                  type="color" className={s.color} value={selected.fill} aria-label="Цвет текста"
                  onChange={(e) => st.updateLayer(selected.id, { fill: e.target.value }, 'merge')}
                />
              </div>
            </div>
          )}
          {selected?.kind === 'image' && dpi !== null && (
            <p className={dpi >= MIN_DPI ? s.ok : s.warn}>
              {dpi === Infinity
                ? 'Векторный файл — качество отличное.'
                : dpi >= MIN_DPI
                  ? `Качество печати хорошее (${dpi} dpi).`
                  : `Низкое разрешение (${dpi} dpi) — при таком размере печать может выйти нечёткой. Уменьшите картинку или загрузите файл побольше.`}
            </p>
          )}
          {selected && (
            <div className={s.align} role="group" aria-label="Выравнивание">
              <button className={s.btnSmall} onClick={() => stageRef.current?.align(selected.id, 'centerX')} title="По центру по горизонтали">⇔ Центр</button>
              <button className={s.btnSmall} onClick={() => stageRef.current?.align(selected.id, 'centerY')} title="По центру по вертикали">⇕ Центр</button>
              <button className={s.btnSmall} onClick={() => stageRef.current?.align(selected.id, 'fit')} title="Максимальный размер в зоне печати">⤢ Вписать</button>
            </div>
          )}

          <h3 className={s.h}>Нанесение</h3>
          {(Object.keys(METHOD_INFO) as PrintMethod[]).map((m) => (
            <label key={m} className={s.radio}>
              <input type="radio" checked={st.method === m} onChange={() => st.setMethod(m)} />
              <span><b>{METHOD_INFO[m].title}</b><br /><small>{METHOD_INFO[m].hint}</small></span>
            </label>
          ))}
        </section>

        {/* Размеры */}
        <section className={s.section} data-section="order">
          <h3 className={s.h}>Размеры и количество</h3>
          <div className={s.sizes}>
            {variant?.sizes.map((size) => {
              const q = st.sizes[size] ?? 0;
              return (
                <div key={size} className={q ? s.sizeActive : s.size}>
                  <span>{size}</span>
                  <div className={s.stepper}>
                    <button aria-label={`Меньше ${size}`} onClick={() => st.incSize(size, -1)} disabled={!q}>−</button>
                    <input
                      type="number" min={0} inputMode="numeric" value={q} aria-label={`Количество ${size}`}
                      onChange={(e) => { st.setSizeQty(size, Number(e.target.value) || 0); track('size_set'); }}
                    />
                    <button aria-label={`Больше ${size}`} onClick={() => { st.incSize(size, 1); track('size_set'); }}>+</button>
                  </div>
                </div>
              );
            })}
          </div>
          {price && price.sides.length > 0 && (
            <div className={s.breakdown}>
              <div className={s.line}><span>Изделие</span><span>{price.garment} ₽</span></div>
              {price.sides.map((x) => (
                <div key={x.side} className={s.line}><span>Печать: {SIDE_LABEL[x.side].toLowerCase()} · {x.format}{x.oversize ? ' (крупнее формата — уточнит менеджер)' : ''}</span><span>{x.price} ₽</span></div>
              ))}
              {price.tierFrom > 1 && <div className={s.line}><span>Цена печати за тираж от {price.tierFrom} шт</span></div>}
              {price.next && (
                <div className={s.hint}>От {price.next.qty} шт дешевле — {price.next.perItem.toLocaleString('ru-RU')} ₽ за шт</div>
              )}
            </div>
          )}
        </section>

        {/* Итог — на мобильном закреплён внизу */}
        <footer className={s.footer}>
          <div>
            <div className={s.total}>
              {price ? (price.qty ? `${price.total.toLocaleString('ru-RU')} ₽` : `${price.perItem.toLocaleString('ru-RU')} ₽ / шт`) : '—'}
            </div>
            <div className={s.muted}>{price?.qty ? `${price.qty} шт · ${price.perItem} ₽ за шт` : 'Цена примерная, уточнит менеджер'}</div>
          </div>
          <button className={s.cta} onClick={openOrder} aria-disabled={!canOrder}>
            {!hasDesign ? 'Добавить дизайн' : !price?.qty ? 'Выбрать размеры' : 'Оформить заявку'}
          </button>
        </footer>
      </aside>

      {orderOpen && garment && variant && price && (
        <OrderForm garment={garment} variant={variant} price={price} stage={stageRef} endpoint={ordersEndpoint} onClose={() => setOrderOpen(false)} />
      )}
    </div>
  );
}
