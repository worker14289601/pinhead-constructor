'use client';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchCatalog } from '../api/catalog';
import { track } from '../analytics/events';
import { getUtm } from '../analytics/utm';
import { printAreaFor, sidesFor } from '../config/print-areas';
import { FRAME } from '../config/garment-shapes';
import { WHITE_MIN_CHANNEL } from '../config/pricing';
import { hexToRgb, isLight } from '../canvas/tint';
import { designBounds } from '../model/bounds';
import { clearDraft, hasContent, loadDraft, saveDraft, type Draft } from '../model/draft';
import { ensureFont, onFontLoaded } from '../model/fonts';
import { calcPrice } from '../model/pricing';
import { validateFile, ACCEPTED_TYPES } from '../model/quality';
import { canRedo, canUndo, selectGarment, selectVariant, useConstructor, variantQty } from '../model/store';
import { contentBox } from '../model/trim';
import { SIDE_LABEL, SIDE_TAB } from '../model/types';
import type { DesignStageHandle } from '../canvas/DesignStage';
import { MAX_USER_ZOOM, ZOOM_STEP } from '../canvas/zoom';
import { GarmentPicker } from './GarmentPicker';
import { DesignPanel } from './DesignPanel';
import { DraftPrompt } from './DraftPrompt';
import { LayersPanel } from './LayersPanel';
import { OrderForm } from './OrderForm';
import { OrderFooter, OrderPanel } from './OrderPanel';
import { SizeChart } from './SizeChart';
import s from './constructor.module.css';

// Konva работает только в браузере.
const DesignStage = dynamic(() => import('../canvas/DesignStage').then((m) => m.DesignStage), {
  ssr: false,
  loading: () => <div className={s.stub}>Загружаем редактор…</div>,
});


/** Стрелка отмены; для повтора — зеркально. Символы ↶ ↷ в системных шрифтах выглядят по-разному. */
const HistoryIcon = ({ redo }: { redo?: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden style={redo ? { transform: 'scaleX(-1)' } : undefined}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </svg>
);

type Tab = 'garment' | 'design' | 'layers' | 'order';
const TABS: Array<[Tab, string]> = [['garment', 'Изделие'], ['design', 'Дизайн'], ['layers', 'Слои'], ['order', 'Размеры']];

/** ordersEndpoint — куда уходит заявка: POST {endpoint}/number выдаёт номер, POST {endpoint} принимает заявку. */
export function ConstructorApp({ ordersEndpoint = '/api/orders' }: { ordersEndpoint?: string }) {
  const st = useConstructor();
  const garment = useConstructor(selectGarment);
  const variant = useConstructor(selectVariant);
  const stageRef = useRef<DesignStageHandle>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Масштаб холста — кнопки в панели под холстом; DesignStage сбрасывает его при смене стороны и модели.
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [orderOpen, setOrderOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [chartOpen, setChartOpen] = useState(false);
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

  // На мобильном выбор принта на холсте открывает его настройки (вкладка «Дизайн»).
  useEffect(() => {
    if (st.selectedLayerId) setTab((t) => (t === 'garment' ? 'design' : t));
  }, [st.selectedLayerId]);

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

  // Черновик: при открытии спрашиваем, продолжать ли; пока не ответили — ничего не сохраняем.
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftGate, setDraftGate] = useState<'wait' | 'ask' | 'open'>('wait');
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (draftGate !== 'wait' || !st.garments.length) return;
    const d = loadDraft();
    if (d && hasContent(d)) { setDraft(d); setDraftGate('ask'); } else setDraftGate('open');
  }, [draftGate, st.garments.length]);
  useEffect(() => {
    if (draftGate !== 'open') return;
    const t = setTimeout(async () => {
      const r = await saveDraft({
        garmentId: st.garmentId, variantId: st.variantId, side: st.side, method: st.method, quantities: st.quantities, layers: st.layers,
      });
      if (r === 'no-images') setNotice('Черновик сохранён без картинок: не хватило места в браузере.');
      else if (r === 'failed') setNotice('Не получилось сохранить черновик в браузере.');
      else setNotice(null);
    }, 800);
    return () => clearTimeout(t);
  }, [draftGate, st.garmentId, st.variantId, st.side, st.method, st.quantities, st.layers]);

  // Шрифты текстовых слоёв: грузим по мере появления, после загрузки пересчитываем габарит.
  const fontKey = st.layers.flatMap((l) => (l.kind === 'text' ? [`${l.fontFamily}|${l.bold}|${l.italic}|${l.text}`] : [])).join('\n');
  useEffect(() => {
    for (const line of fontKey ? fontKey.split('\n') : []) {
      const [family, bold, italic, ...text] = line.split('|');
      ensureFont(family, bold === 'true', italic === 'true', text.join('|')).catch(() => {});
    }
  }, [fontKey]);
  useEffect(() => onFontLoaded(() => useConstructor.getState().bumpFonts()), []);

  const hex = variant?.hex ?? '#ffffff';
  const price = useMemo(() => {
    if (!variant || !garment) return null;
    // Габарит — только по сторонам модели: печать на рукаве у шоппера в цену не идёт.
    const bounds = designBounds(garment, st.layers);
    const variants = garment.variants.map((v) => ({
      productId: v.productId, color: v.colorName, hex: v.hex, garmentPrice: v.price,
      isWhite: hexToRgb(v.hex).every((c) => c >= WHITE_MIN_CHANNEL),
      sizeNames: v.sizes, sizes: st.quantities[v.productId] ?? {},
    }));
    return calcPrice({ method: st.method, bounds, variants, currentId: variant.productId });
    // fontTick: габарит текста зависит от загруженного шрифта.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, garment, st.method, st.layers, st.quantities, st.fontTick]);

  const onFile = (f?: File) => {
    if (!f || !garment) return;
    const err = validateFile(f);
    setFileError(err);
    if (err) return;
    const url = URL.createObjectURL(f);
    const img = new window.Image();
    img.onload = () => {
      const isVector = f.type === 'image/svg+xml';
      // Пустые поля по краям в размер принта не идут — обрезаем их сразу.
      const crop = contentBox(img) ?? undefined;
      const nw = crop?.width ?? (img.naturalWidth || 1000);
      const nh = crop?.height ?? (img.naturalHeight || 1000);
      // Вписываем в зону печати: 80% ширины, но не выше 80% высоты зоны.
      const pa = printAreaFor(garment, st.side);
      const areaRatio = pa.height / pa.width; // в единицах кадра: высота/ширина зоны
      const frameRatio = FRAME.h / FRAME.w;
      const width = Math.min(0.8, (0.8 * areaRatio * frameRatio * nw) / nh);
      st.addImage({ src: url, fileName: f.name, isVector, naturalWidth: nw, naturalHeight: nh, crop, width });
      track('image_upload', { w: nw, h: nh, type: f.type, kb: Math.round(f.size / 1024), trimmed: !!crop });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setFileError('Не получилось открыть файл. Попробуйте PNG или JPG.');
    };
    img.src = url;
  };

  const addText = () => { st.addText(isLight(hex) ? '#111111' : '#ffffff'); track('text_add'); };
  const selected = st.layers.find((l) => l.id === st.selectedLayerId);

  const hasDesign = st.layers.some((l) => sides.includes(l.side));
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
        <GarmentPicker
          garments={st.garments} garmentId={st.garmentId} variant={variant}
          onSelect={st.selectGarment}
        />
      </section>

      {/* Холст */}
      <main className={s.center}>
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
        <div
          className={dragOver ? s.stageDrop : s.stage}
          onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragOver(true); } }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false); }}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); onFile(e.dataTransfer.files?.[0]); }}
        >
          <DesignStage
            apiRef={stageRef}
            empty={{ onUpload: () => fileRef.current?.click(), dragging: dragOver }}
            zoom={zoom}
            onZoom={setZoom}
          />
          {dragOver && <div className={s.dropHint}>Отпустите файл, чтобы добавить</div>}
        </div>
        {/* Панель под холстом: история слева, цвет по центру, масштаб справа — ничего не лежит поверх графики. */}
        <div className={s.toolbar}>
          <div className={s.history} role="group" aria-label="История">
            <button type="button" onClick={st.undo} disabled={!undoable} aria-label="Отменить" title="Отменить (Ctrl+Z)"><HistoryIcon /></button>
            <button type="button" onClick={st.redo} disabled={!redoable} aria-label="Повторить" title="Повторить (Ctrl+Shift+Z)"><HistoryIcon redo /></button>
          </div>
          {garment && garment.variants.length > 0 && (
            <div className={s.colorBar} role="radiogroup" aria-label="Цвет изделия">
              <div className={s.colors}>
                {garment.variants.map((v) => {
                  const n = variantQty(st.quantities, v);
                  return (
                  <button
                    key={v.productId}
                    role="radio"
                    aria-checked={v.productId === st.variantId}
                    className={v.productId === st.variantId ? s.swatchActive : s.swatch}
                    style={{ background: v.hex }}
                    title={n ? `${v.colorName} — ${n} шт в заявке` : v.colorName}
                    aria-label={n ? `${v.colorName}, ${n} шт` : v.colorName}
                    onClick={() => { st.selectVariant(v.productId); track('color_select', { color: v.colorName }); }}
                  >
                    {n > 0 && <span className={s.swatchCount} aria-hidden>{n > 99 ? '99+' : n}</span>}
                  </button>
                  );
                })}
              </div>
            </div>
          )}
          <div className={s.zoom} role="group" aria-label="Масштаб">
            <button type="button" onClick={() => setZoom((z) => Math.max(1, z / ZOOM_STEP))} disabled={zoom <= 1} aria-label="Уменьшить" title="Уменьшить">−</button>
            <button type="button" className={s.zoomValue} onClick={() => setZoom(1)} disabled={zoom === 1} aria-label="Сбросить масштаб" title="Сбросить масштаб">{Math.round(zoom * 100)}%</button>
            <button type="button" onClick={() => setZoom((z) => Math.min(MAX_USER_ZOOM, z * ZOOM_STEP))} disabled={zoom >= MAX_USER_ZOOM} aria-label="Увеличить" title="Увеличить">+</button>
          </div>
        </div>
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
        {/* Дизайн: содержимое зависит от выбранного слоя */}
        <section className={s.section} data-section="design">
          <DesignPanel stage={stageRef} fileError={fileError} onUpload={() => fileRef.current?.click()} onAddText={addText} />
          <input
            ref={fileRef} type="file" hidden accept={ACCEPTED_TYPES.join(',')}
            onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }}
          />
        </section>

        {/* Слои */}
        <section className={s.section} data-section="layers" data-collapsed={layersOpen ? undefined : ''}>
          <LayersPanel hex={hex} open={layersOpen} onToggle={() => setLayersOpen((v) => !v)} />
        </section>

        {/* Размеры */}
        <section className={s.section} data-section="order">
          <OrderPanel variant={variant} price={price} onSizeChart={() => setChartOpen(true)} />
        </section>

        {/* Итог — на мобильном закреплён внизу */}
        <OrderFooter price={price} hasDesign={hasDesign} onOrder={openOrder} />
      </aside>

      {draftGate === 'ask' && draft && (
        <DraftPrompt
          draft={draft}
          onNew={() => { clearDraft(); setDraft(null); setDraftGate('open'); }}
          onContinue={() => { st.hydrate(draft); setDraft(null); setDraftGate('open'); }}
        />
      )}
      {notice && <div className={s.notice} role="status">{notice}</div>}
      {chartOpen && <SizeChart sizes={variant?.sizes ?? []} onClose={() => setChartOpen(false)} />}
      {orderOpen && garment && variant && price && (
        <OrderForm garment={garment} variant={variant} price={price} stage={stageRef} endpoint={ordersEndpoint} onClose={() => setOrderOpen(false)} />
      )}
    </div>
  );
}
