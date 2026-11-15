'use client';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchCatalog } from '../api/catalog';
import { track } from '../analytics/events';
import { getUtm } from '../analytics/utm';
import { printAreaFor, sidesFor } from '../config/print-areas';
import { FRAME } from '../config/garment-shapes';
import { isLight } from '../canvas/tint';
import { designBounds } from '../model/bounds';
import { clearDraft, hasContent, loadDraft, saveDraft, type Draft } from '../model/draft';
import { ensureFont, onFontLoaded } from '../model/fonts';
import { calcPrice, priceVariants } from '../model/pricing';
import { METHOD_INFO } from '../config/pricing';
import { validateFile, ACCEPTED_TYPES } from '../model/quality';
import { canRedo, canUndo, selectGarment, selectVariant, useConstructor, variantQty } from '../model/store';
import { PHOTO_SHAPE } from '../config/photo-shapes';
import { applyCrop, applyShape, areaAspect } from '../model/crop';
import { coverCrop, maskAspect, refitSlot } from '../model/slot';
import { contentBox } from '../model/trim';
import { SIDE_LABEL, SIDE_TAB, type PhotoShape } from '../model/types';
import type { DesignStageHandle } from '../canvas/DesignStage';
import { MAX_USER_ZOOM, ZOOM_STEP } from '../canvas/zoom';
import { GarmentPicker } from './GarmentPicker';
import { Icon } from './icons';
import { CropEditor } from './CropEditor';
import { DesignPanel } from './DesignPanel';
import { DraftPrompt } from './DraftPrompt';
import { LayersPanel } from './LayersPanel';
import { OrderForm } from './OrderForm';
import { OrderFooter, OrderPanel } from './OrderPanel';
import { SizeChart } from './SizeChart';
import { TemplatePicker } from './TemplatePicker';
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

/** Свёрнутый раздел правой колонки в режиме редактирования слоя. */
const SumRow = ({ title, meta, onClick }: { title: string; meta: string; onClick: () => void }) => (
  <button type="button" className={s.sumRow} onClick={onClick}>
    <span className={s.sumTitle}>{title}</span>
    <span className={s.sumMeta}>{meta}</span>
    <Icon name="chevronRight" size={18} />
  </button>
);

/** Шаги на телефоне: изделие → принт → размеры; четвёртый шаг — заявка — открывает кнопка в итоге. */
type Tab = 'garment' | 'design' | 'order';
const STEPS: Array<[Tab, string]> = [['garment', 'Изделие'], ['design', 'Принт'], ['order', 'Размеры']];
/** Сдвиг пальца (px), с которого жест по ручке листа — это свайп, а не нажатие. */
const GRIP_SWIPE = 24;

/**
 * ordersEndpoint — куда уходит заявка: POST {endpoint}/number выдаёт номер, POST {endpoint} принимает заявку.
 * null — демо без сервера: номер выдаётся в браузере, заявка никуда не отправляется (экран успеха и PDF работают).
 */
export function ConstructorApp({ ordersEndpoint = '/api/orders' }: { ordersEndpoint?: string | null }) {
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
  const [templatesOpen, setTemplatesOpen] = useState(false);
  /** Слой-картинка, который сейчас кадрируют. */
  const [cropId, setCropId] = useState<string | null>(null);
  // Лист с настройками на телефоне: обычная высота или развёрнутый (холст при этом ниже).
  const [sheetFull, setSheetFull] = useState(false);
  const gripY = useRef<number | null>(null);
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

  // На телефоне выбор принта на холсте открывает его настройки (шаг «Принт») — с любого шага.
  useEffect(() => {
    if (st.selectedLayerId) setTab('design');
  }, [st.selectedLayerId]);
  // Развёрнутый лист — только пока нужен: при смене шага возвращаем обычную высоту.
  useEffect(() => setSheetFull(false), [tab]);

  // Телефон: каждая вкладка прокручивается сама — при смене вкладки или слоя показываем её с начала.
  const appRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    appRef.current?.querySelectorAll<HTMLElement>('[data-section]').forEach((el) => { el.scrollTop = 0; });
  }, [tab, st.selectedLayerId]);

  // Телефонная раскладка: при редактировании слоя холст приближается к зоне печати.
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  // Экранная клавиатура: высота видимой области — в --vvh, пока клавиатура открыта — data-kb.
  // Раскладка ужимается над клавиатурой, чтобы изделие с текстом оставалось на виду во время набора.
  const [kb, setKb] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      const open = window.innerHeight - vv.height > 120 && window.matchMedia('(max-width: 900px)').matches;
      appRef.current?.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
      setKb(open);
      if (!open) return;
      // iOS сдвигает страницу к полю ввода; у нас прокручивается панель, а страница должна стоять на месте.
      window.scrollTo(0, 0);
      // После перестройки раскладки поле ввода — в видимой части своей панели.
      requestAnimationFrame(() => {
        (document.activeElement as HTMLElement | null)?.scrollIntoView?.({ block: 'nearest' });
        window.scrollTo(0, 0);
      });
    };
    onResize();
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, []);

  // Cmd/Ctrl+Z — отмена, Cmd/Ctrl+Shift+Z и Ctrl+Y — повтор, Delete — удалить выбранный слой.
  // Когда фокус в поле ввода, клавиши остаются полю (там своя отмена набора).
  // Пока открыта форма заявки, клавиши холст не трогают.
  useEffect(() => {
    if (orderOpen || templatesOpen || cropId) return;
    const onKey = (e: KeyboardEvent) => {
      // Esc — «Готово»: закрыть настройки слоя, даже из поля ввода (пока не открыта таблица размеров).
      if (e.key === 'Escape' && !chartOpen && useConstructor.getState().selectedLayerId) {
        (document.activeElement as HTMLElement | null)?.blur?.();
        useConstructor.getState().selectLayer(null);
        return;
      }
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
  }, [orderOpen, chartOpen, templatesOpen, cropId]);

  // Черновик: при открытии спрашиваем, продолжать ли; пока не ответили — ничего не сохраняем.
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftGate, setDraftGate] = useState<'wait' | 'ask' | 'open'>('wait');
  const [notice, setNotice] = useState<string | null>(null);
  // Короткая подсказка по действию; сама гаснет.
  const [hint, setHint] = useState<string | null>(null);
  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => setHint(null), 4000);
    return () => clearTimeout(t);
  }, [hint]);
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
  const fontKey = st.layers.flatMap((l) => (l.kind === 'text'
    ? [`${l.fontFamily}|${l.bold}|${l.italic}|${l.text}`]
    : l.mask?.kind === 'text' ? [`${l.mask.fontFamily}|${l.mask.bold}|false|${l.mask.text}`] : [])).join('\n');
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
    const variants = priceVariants(garment, st.quantities);
    return calcPrice({ method: st.method, bounds, variants, currentId: variant.productId });
    // fontTick: габарит текста зависит от загруженного шрифта.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, garment, st.method, st.layers, st.quantities, st.fontTick]);

  // Место под фото из готового принта, в которое встанет следующий выбранный файл.
  const replaceId = useRef<string | null>(null);
  const pickPhotoFor = (id: string) => { replaceId.current = id; fileRef.current?.click(); };
  /** Новое слово для фото в буквах: окно под фото меняет пропорции вместе со словом. */
  const setMaskText = (id: string, text: string) => {
    const l = st.layers.find((x) => x.id === id);
    if (l?.kind !== 'image' || l.mask?.kind !== 'text') return;
    const mask = { ...l.mask, text };
    st.updateLayer(id, { mask, ...refitSlot(l, maskAspect(mask)) }, 'merge');
  };
  /** Форма обрезки своего фото; размер снимка берём из самой картинки — у старых слоёв его нет в данных. */
  const setShape = (id: string, shape: PhotoShape | null) => {
    const l = st.layers.find((x) => x.id === id);
    if (l?.kind !== 'image' || !garment) return;
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const cur = useConstructor.getState().layers.find((x) => x.id === id);
      if (cur?.kind !== 'image' || !img.naturalWidth || !img.naturalHeight) return;
      const src = { w: img.naturalWidth, h: img.naturalHeight };
      st.updateLayer(id, applyShape(cur, shape ? PHOTO_SHAPE[shape] : null, src, areaAspect(garment, cur)));
      track('image_shape', { shape: shape ?? 'none' });
    };
    img.src = l.src;
  };
  const pickFile = () => { replaceId.current = null; fileRef.current?.click(); };

  const onFile = (f?: File) => {
    const slotId = replaceId.current;
    replaceId.current = null;
    if (!f || !garment) return;
    const err = validateFile(f);
    setFileError(err);
    if (err) return;
    const url = URL.createObjectURL(f);
    const img = new window.Image();
    img.onload = () => {
      const isVector = f.type === 'image/svg+xml';
      const slot = st.layers.find((l) => l.id === slotId);
      if (slot?.kind === 'image' && slot.slot !== undefined) {
        // Фото встаёт в окно шаблона: обрезаем по центру под пропорции окна, положение и размер слоя не меняются.
        const [iw, ih] = [img.naturalWidth || 1000, img.naturalHeight || 1000];
        const crop = coverCrop(iw, ih, slot.slot);
        st.updateLayer(slot.id, {
          src: url, fileName: f.name, isVector, naturalWidth: crop.width, naturalHeight: crop.height, crop, placeholder: false,
          srcSize: { w: iw, h: ih },
        });
        track('image_upload', { w: iw, h: ih, type: f.type, kb: Math.round(f.size / 1024), slot: true });
        return;
      }
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
  const cropTarget = st.layers.find((l) => l.id === cropId);
  const cropLayer = cropTarget?.kind === 'image' ? cropTarget : undefined;
  const cropShape = cropLayer?.mask?.kind === 'shape' ? PHOTO_SHAPE[cropLayer.mask.shape] : undefined;

  // «Готово» из строки-сводки: снимаем выбор и показываем раздел целиком.
  const layersRef = useRef<HTMLElement>(null);
  const orderRef = useRef<HTMLElement>(null);
  const finishTo = (to: 'layers' | 'order') => {
    st.selectLayer(null);
    if (to === 'layers') setLayersOpen(true);
    requestAnimationFrame(() => (to === 'layers' ? layersRef : orderRef).current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  const sideLayerCount = st.layers.filter((l) => l.side === st.side).length;
  const methodName = METHOD_INFO[st.method].title.split(/\s+[—–-]\s+/)[0];

  const hasDesign = st.layers.some((l) => sides.includes(l.side));
  const openOrder = () => {
    if (!hasDesign) return setTab('design');
    // В готовом принте осталось пустое место под фото — в печать оно уйти не должно.
    const empty = st.layers.find((l) => l.kind === 'image' && l.placeholder && sides.includes(l.side));
    if (empty) {
      st.setSide(empty.side);
      st.selectLayer(empty.id);
      setHint('Вставьте своё фото в рамку или удалите её.');
      return;
    }
    if (!price?.qty) { setTab('order'); return finishTo('order'); }
    setOrderOpen(true);
    track('order_form_open');
  };

  return (
    <div
      ref={appRef} className={s.app} data-tab={tab} data-editing={selected ? '' : undefined} data-kb={kb ? '' : undefined}
      data-sheet={sheetFull ? 'full' : undefined}
    >
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
            empty={{ onUpload: pickFile, dragging: dragOver }}
            zoom={zoom}
            onZoom={setZoom}
            focus={narrow && !!st.selectedLayerId}
            onCrop={setCropId}
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
          {variant && <span className={s.colorName} aria-hidden>{variant.colorName}</span>}
          <div className={s.zoom} role="group" aria-label="Масштаб">
            <button type="button" onClick={() => setZoom((z) => Math.max(1, z / ZOOM_STEP))} disabled={zoom <= 1} aria-label="Уменьшить" title="Уменьшить">−</button>
            <button type="button" className={s.zoomValue} onClick={() => setZoom(1)} disabled={zoom === 1} aria-label="Сбросить масштаб" title="Сбросить масштаб">{Math.round(zoom * 100)}%</button>
            <button type="button" onClick={() => setZoom((z) => Math.min(MAX_USER_ZOOM, z * ZOOM_STEP))} disabled={zoom >= MAX_USER_ZOOM} aria-label="Увеличить" title="Увеличить">+</button>
          </div>
        </div>
      </main>

      {/* Шаги — только на телефоне: где мы и что дальше */}
      <nav className={s.steps} aria-label="Шаги">
        {STEPS.map(([id, label], i) => {
          const done = id === 'garment' ? tab !== 'garment' || hasDesign : id === 'design' ? hasDesign : !!price?.qty;
          return (
            <button
              key={id} type="button" className={tab === id ? s.stepActive : s.step}
              aria-current={tab === id ? 'step' : undefined} data-done={done ? '' : undefined} onClick={() => setTab(id)}
            >
              <span className={s.stepNum}>{done && tab !== id ? <Icon name="checkMark" size={14} /> : i + 1}</span>
              {label}
            </button>
          );
        })}
      </nav>

      {/* Ручка листа — только на телефоне: нажатие или свайп меняет высоту панели */}
      <button
        type="button" className={s.grip} data-still="" aria-label={sheetFull ? 'Свернуть панель' : 'Развернуть панель'}
        aria-expanded={sheetFull}
        onPointerDown={(e) => { gripY.current = e.clientY; e.currentTarget.setPointerCapture?.(e.pointerId); }}
        onPointerUp={(e) => {
          const dy = gripY.current === null ? 0 : e.clientY - gripY.current;
          gripY.current = null;
          setSheetFull((v) => (dy <= -GRIP_SWIPE ? true : dy >= GRIP_SWIPE ? false : !v));
        }}
        onPointerCancel={() => { gripY.current = null; }}
        // Клавиатура и программный click: без жеста — просто переключить.
        onClick={(e) => { if (e.detail === 0) setSheetFull((v) => !v); }}
      />

      <aside className={`${s.panel} ${s.right}`} data-editing={selected ? '' : undefined}>
        {/* Дизайн: содержимое зависит от выбранного слоя */}
        <section className={s.section} data-section="design">
          <DesignPanel
            stage={stageRef} fileError={fileError} onUpload={pickFile} onAddText={addText}
            onTemplates={() => setTemplatesOpen(true)} onReplacePhoto={pickPhotoFor} onMaskText={setMaskText}
            onCrop={setCropId} onShape={setShape}
          />
          {/* Телефон: слои — не отдельная вкладка, а короткий список под кнопками добавления */}
          {narrow && !selected && <LayersPanel embedded hex={hex} open onToggle={() => {}} />}
          <input
            ref={fileRef} type="file" hidden accept={ACCEPTED_TYPES.join(',')}
            onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }}
          />
        </section>

        {/* Слои */}
        <section ref={layersRef} className={s.section} data-section="layers" data-collapsed={layersOpen ? undefined : ''}>
          <div className={s.summary}>
            <SumRow title="Слои" meta={sideLayerCount ? `${sideLayerCount} на стороне` : 'пусто'} onClick={() => finishTo('layers')} />
          </div>
          <div className={s.full}>
            <LayersPanel hex={hex} open={layersOpen} onToggle={() => setLayersOpen((v) => !v)} />
          </div>
        </section>

        {/* Размеры */}
        <section ref={orderRef} className={s.section} data-section="order">
          <div className={s.summary}>
            <SumRow title="Нанесение" meta={methodName} onClick={() => finishTo('order')} />
            <SumRow title="Размеры" meta={price?.qty ? `${price.qty} шт` : 'не выбраны'} onClick={() => finishTo('order')} />
          </div>
          <div className={s.full}>
            <OrderPanel variant={variant} price={price} onSizeChart={() => setChartOpen(true)} />
          </div>
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
      {(hint ?? notice) && <div className={s.notice} role="status">{hint ?? notice}</div>}
      {templatesOpen && <TemplatePicker hex={hex} onClose={() => setTemplatesOpen(false)} />}
      {cropLayer && garment && (
        <CropEditor
          src={cropLayer.src} flipX={cropLayer.flipX} flipY={cropLayer.flipY} crop={cropLayer.crop} lockedAspect={cropLayer.slot ?? cropShape?.aspect} shape={cropShape}
          onClose={() => setCropId(null)}
          onApply={(crop, src) => {
            st.updateLayer(cropLayer.id, applyCrop(cropLayer, crop, src, areaAspect(garment, cropLayer)));
            track('image_crop', { slot: cropLayer.slot !== undefined });
            setCropId(null);
          }}
        />
      )}
      {chartOpen && <SizeChart sizes={variant?.sizes ?? []} onClose={() => setChartOpen(false)} />}
      {orderOpen && garment && variant && price && (
        <OrderForm garment={garment} variant={variant} price={price} stage={stageRef} endpoint={ordersEndpoint} onClose={() => setOrderOpen(false)} />
      )}
    </div>
  );
}
