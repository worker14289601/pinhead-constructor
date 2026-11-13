'use client';
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { Group, Image as KImage, Layer, Line, Path, Rect, Stage, Transformer } from 'react-konva';
import type Konva from 'konva';
import { appearNode } from './appear';
import { FRAME, SHAPES } from '../config/garment-shapes';
import { MAX_USER_ZOOM } from './zoom';
import { printAreaFor } from '../config/print-areas';
import { priceListFor } from '../config/pricing';
import { layerSizeCm } from '../model/bounds';
import { formatFor } from '../model/pricing';
import { fontReady } from '../model/fonts';
import { selectGarment, selectVariant, useConstructor } from '../model/store';
import { isSleeve, type Side } from '../model/types';
import { alignLayer, snapToCenter, type AlignMode } from './align';
import { DESIGN_NODE, LayerNode } from './LayerNode';
import { SelectionControls } from './SelectionControls';
import c from './controls.module.css';
import { SILHOUETTES, SILHOUETTE_VIEWBOX } from './silhouettes';
import { isLight, zoneTone, useTintedMockup } from './tint';
import { EmptyZone, ZoneBadge } from './EmptyZone';
import { isHalfTurn, playTurn, prefersReducedMotion, turnSign } from './turn';

export interface DesignStageHandle {
  /** PNG текущей стороны с изделием — превью для клиента и менеджера. */
  exportPreview: () => string | null;
  /**
   * PNG принта (без изделия, прозрачный фон), обрезанный по габариту рисунка: 300 dpi,
   * для принтов почти во всю большую зону — меньше, чтобы файл уложился в предел размера canvas.
   */
  exportPrint: () => { dataUrl: string; dpi: number } | null;
  /** Ждёт, пока холст покажет текущую сторону целиком: мокап и все картинки слоёв загружены. */
  whenReady: (timeoutMs?: number) => Promise<void>;
  /** Выровнять слой в зоне печати (одним шагом истории). */
  align: (id: string, mode: AlignMode) => void;
  /** Без анимации поворота — на время программного перебора сторон (снимки для заявки). */
  setTurnEnabled: (on: boolean) => void;
}

const DPI = 300;
/** Предел площади canvas в мобильных браузерах — около 16,7 Мп; больше — снимок выйдет пустым. */
const MAX_EXPORT_AREA = 16_000_000;
/** Меньше этого размера (px экрана) кнопка размера слой не сжимает. */
const MIN_NODE_PX = 12;
/**
 * Автоприближение к зоне рукава (вид сбоку) выводится из размера зоны: зона занимает ~SLEEVE_FILL холста,
 * но не больше MAX_ZOOM. Зоны крупные, поэтому приближение ≈ 1–1,1 (изделие почти целиком), а у футболок
 * (крупный план рукава) — 1. Мокапы 1200×1380: на таком приближении картинка остаётся чёткой на ретине.
 */
const MAX_ZOOM = 1.3;
const SLEEVE_FILL = 0.5;
/** Предел приближения кнопками (вместе с приближением рукава) и шаг одного нажатия. */
const MAX_TOTAL_ZOOM = 4;

/** Порог прилипания к центру зоны, в пикселях экрана. */
const SNAP_PX = 6;
/** Фирменный лайм; на светлой ткани он не виден, поэтому рамка и направляющие там чёрные. */
const LIME = '#99ff00';
const INK = '#000000';

/** apiRef — обычный проп, а не ref: next/dynamic не пробрасывает ref в ленивый компонент. */
export function DesignStage({ apiRef, empty, zoom: zoomProp, onZoom }: {
  apiRef: RefObject<DesignStageHandle>;
  /** Масштаб, которым управляет родитель (кнопки вне холста). Без него — внутреннее состояние. */
  zoom?: number;
  onZoom?: Dispatch<SetStateAction<number>>;
  /** Действия приглашения на пустой стороне: загрузить картинку / добавить текст. */
  empty?: { onUpload: () => void; dragging?: boolean };
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const printRef = useRef<Konva.Group>(null);
  const shadeRef = useRef<Konva.Image>(null);
  const guideRef = useRef<Konva.Line>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const [size, setSize] = useState({ w: 400, h: 460 });
  const [zoomInner, setZoomInner] = useState(1);
  const zoom = zoomProp ?? zoomInner;
  const setZoom = onZoom ?? setZoomInner;
  const [guides, setGuides] = useState({ v: false, h: false });
  // Поворот при смене стороны: снимок прежней стороны (canvas) и куда поворачиваемся.
  const [turn, setTurn] = useState<{ id: number; snap: HTMLCanvasElement; from: Side; to: Side } | null>(null);
  const turnRef = useRef<HTMLDivElement>(null);
  const turnEnabled = useRef(true);
  // Кроссфейд при смене изделия и цвета: снимок прежнего кадра растворяется поверх нового.
  const [fade, setFade] = useState<{ id: number; snap: HTMLCanvasElement; base: unknown } | null>(null);
  const fadeRef = useRef<HTMLDivElement>(null);
  // Появление новых слоёв: id, которые уже встречались (отмена/повтор/черновик не в счёт), ожидающие и идущие.
  const seenIds = useRef(new Set<string>());
  const pendingNew = useRef(new Set<string>());
  const appearing = useRef(new Map<string, { finish: () => void }>());
  // Сдвиг вида пользователем (px экрана) относительно центрирования на зоне; сбрасывается при смене стороны, модели и масштаба.
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef(pan);
  panRef.current = pan;
  const panLimits = useRef({ bx: 0, by: 0, minX: 0, minY: 0, k: 1 });
  const baseView = useRef({ x: 0, y: 0 });

  const garment = useConstructor(selectGarment);
  const garmentId = garment?.id;
  const variant = useConstructor(selectVariant);
  const { method, side, layers, selectedLayerId, selectLayer, updateLayer, removeLayer, duplicateLayer } = useConstructor();

  const shape = garment?.shapeId ? SHAPES[garment.shapeId] : null;
  const hex = variant?.hex ?? '#e4e4e4';
  const mockup = useTintedMockup(shape?.images[side] ?? null, hex);
  const light = isLight(hex);
  const accent = light ? INK : LIME;

  // Сторона меняется в сторе синхронно, до перерисовки: в этот момент холст ещё показывает прежнюю сторону —
  // снимаем её для анимации поворота.
  useEffect(() => useConstructor.subscribe((st, prev) => {
    if (st.side === prev.side || st.garmentId !== prev.garmentId || !turnEnabled.current || prefersReducedMotion()) return;
    const stage = stageRef.current;
    if (!stage || !stage.width()) return;
    settleAppear();
    const hidden = ([guideRef.current, trRef.current] as Array<Konva.Node | null>).filter((n): n is Konva.Node => !!n && n.visible());
    hidden.forEach((n) => n.visible(false));
    let snap: HTMLCanvasElement;
    try { snap = stage.toCanvas({ pixelRatio: Math.min(2, window.devicePixelRatio || 1) }); } finally { hidden.forEach((n) => n.visible(true)); }
    setTurn({ id: Date.now(), snap, from: prev.side, to: st.side });
  }), []);

  useLayoutEffect(() => {
    const holder = turnRef.current;
    const content = stageRef.current?.content;
    if (!turn || !holder || !content) return;
    turn.snap.style.width = '100%';
    turn.snap.style.height = '100%';
    holder.replaceChildren(turn.snap);
    const anim = playTurn(holder, content, turnSign(turn.from, turn.to), isHalfTurn(turn.from, turn.to), {
      ready: () => isReady.current(),
      draw: () => stageRef.current?.draw(),
    });
    let alive = true;
    anim.finished.then(() => alive && setTurn((t) => (t?.id === turn.id ? null : t))).catch(() => {});
    return () => { alive = false; anim.cancel(); };
  }, [turn]);

  /** Доводит идущие появления слоёв до конца: снимки и экспорт не должны застать полупрозрачный слой. */
  const settleAppear = () => { [...appearing.current.values()].forEach((a) => a.finish()); };

  // Новый слой (добавлен, а не восстановлен отменой/повтором или черновиком) появляется плавно.
  useEffect(() => {
    useConstructor.getState().layers.forEach((l) => seenIds.current.add(l.id));
    return useConstructor.subscribe((st, prev) => {
      const added = st.layers.length === prev.layers.length + 1 && st.past.length === prev.past.length + 1
        ? st.layers.find((l) => !seenIds.current.has(l.id))
        : undefined;
      st.layers.forEach((l) => seenIds.current.add(l.id));
      if (added && added.side === st.side && !prefersReducedMotion()) pendingNew.current.add(added.id);
    });
  }, []);

  useLayoutEffect(() => {
    const g = printRef.current;
    if (!g || !pendingNew.current.size) return;
    for (const id of [...pendingNew.current]) {
      const node = g.findOne(`#${id}`);
      if (!node) continue;
      pendingNew.current.delete(id);
      const layer = useConstructor.getState().layers.find((l) => l.id === id);
      const ready = () => {
        if (!layer) return true;
        if (layer.kind === 'text') return fontReady(layer.fontFamily, layer.bold, layer.italic, layer.text);
        return !!(node as Konva.Image).image();
      };
      appearing.current.set(id, appearNode(node, ready, () => appearing.current.delete(id)));
    }
  });

  // Смена изделия или цвета: снимок прежнего кадра, как только стор поменялся (холст ещё старый).
  const mockupRef = useRef<unknown>(null);
  useEffect(() => useConstructor.subscribe((st, prev) => {
    if ((st.garmentId === prev.garmentId && st.variantId === prev.variantId) || !turnEnabled.current || prefersReducedMotion()) return;
    const stage = stageRef.current;
    if (!stage || !stage.width() || !prev.garmentId) return;
    settleAppear();
    const hidden = ([guideRef.current, trRef.current] as Array<Konva.Node | null>).filter((n): n is Konva.Node => !!n && n.visible());
    hidden.forEach((n) => n.visible(false));
    let snap: HTMLCanvasElement;
    try { snap = stage.toCanvas({ pixelRatio: Math.min(2, window.devicePixelRatio || 1) }); } finally { hidden.forEach((n) => n.visible(true)); }
    setFade({ id: Date.now(), snap, base: mockupRef.current });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  const fadeReady = useRef<(base: unknown) => boolean>(() => true);
  useLayoutEffect(() => {
    const holder = fadeRef.current;
    if (!fade || !holder) return;
    fade.snap.style.width = '100%';
    fade.snap.style.height = '100%';
    holder.replaceChildren(fade.snap);
    let alive = true;
    let anim: Animation | null = null;
    let timer = 0;
    const started = Date.now();
    const go = () => {
      if (!alive) return;
      stageRef.current?.draw();
      // Дать браузеру показать новый кадр под снимком, затем растворить снимок.
      timer = window.setTimeout(() => {
        if (!alive) return;
        anim = holder.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, easing: 'cubic-bezier(.3,.1,.3,1)', fill: 'forwards' });
        anim.finished.then(() => alive && setFade((f) => (f?.id === fade.id ? null : f)), () => {});
      }, 50);
    };
    const wait = () => {
      if (!alive) return;
      if (fadeReady.current(fade.base) || Date.now() - started > 800) go();
      else timer = window.setTimeout(wait, 30);
    };
    wait();
    // Страховка: фоновая вкладка не гонит анимации — снимок не должен зависнуть.
    const guard = window.setTimeout(() => alive && setFade((f) => (f?.id === fade.id ? null : f)), 2500);
    return () => { alive = false; clearTimeout(timer); clearTimeout(guard); anim?.cancel(); };
  }, [fade]);

  // Холст тянется по контейнеру с пропорциями кадра 400×460.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      const ratio = FRAME.h / FRAME.w;
      const w = Math.max(200, Math.min(width, height / ratio));
      setSize({ w, h: w * ratio });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pa = garment ? printAreaFor(garment, side) : null;
  // Контур зоны в пикселях холста относительно её левого верхнего угла (прямоугольник, если контура нет).
  const outlinePts = pa
    ? (pa.outline && pa.outline.length >= 3 ? pa.outline : [[0, 0], [1, 0], [1, 1], [0, 1]]).map(([px, py]) => [px * pa.width * size.w, py * pa.height * size.h])
    : [];
  const hasOutline = !!pa?.outline && pa.outline.length >= 3;
  /** Обрезка слоёв по контуру зоны (координаты группы печати). */
  const clipOutline = (ctx: Konva.Context) => {
    ctx.beginPath();
    outlinePts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.closePath();
  };
  const area = pa ? { x: pa.x * size.w, y: pa.y * size.h, w: pa.width * size.w, h: pa.height * size.h } : null;
  // Приближение — на время просмотра одной стороны: при смене стороны и модели возвращаем 100%.
  useEffect(() => setZoom(1), [side, garmentId, setZoom]);
  useEffect(() => setPan({ x: 0, y: 0 }), [side, garmentId, zoom]);

  const sideLayers = layers.filter((l) => l.side === side);

  // Подпись под выделенным принтом: «26 × 5 см · A4».
  const selectedLayer = sideLayers.find((l) => l.id === selectedLayerId);
  const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString('ru-RU');
  let caption: string | undefined;
  if (garment && selectedLayer) {
    const sz = layerSizeCm(garment, selectedLayer);
    if (sz) {
      const { format, oversize } = formatFor(sz.wCm, sz.hCm, priceListFor(method));
      caption = `${fmt(sz.wCm)} × ${fmt(sz.hCm)} см · ${oversize ? `больше ${format.name}` : format.name}`;
    }
  }

  // Размер зоны печати в см для плашки: до 10 см — с десятыми, дальше — целые.
  const zoneFmt = (n: number) => (n < 10 ? fmt(n) : String(Math.round(n)));
  const zoneText = pa && area ? `${zoneFmt(pa.widthCm)} × ${zoneFmt(pa.widthCm * (area.h / area.w))} см` : undefined;
  const isEmptyZone = sideLayers.length === 0;
  // Рамка зоны еле заметна, пока слой не выбран; у пустой зоны её нет — только заливка.
  const frameStrong = !!selectedLayer;

  // Рукав — маленькая зона: приближаем холст к ней, не выходя за края кадра.
  // Кнопки масштаба умножают это приближение; центр — середина зоны печати, края кадра не покидаем.
  const view = { k: 1, x: 0, y: 0 };
  if (area && (isSleeve(side) || zoom > 1)) {
    const fit = Math.min(MAX_ZOOM, (SLEEVE_FILL * size.h) / area.h, (SLEEVE_FILL * size.w) / area.w);
    const base = isSleeve(side) ? Math.max(1, fit) : 1;
    const k = Math.min(MAX_TOTAL_ZOOM, base * zoom);
    const clamp = (v: number, min: number) => Math.min(0, Math.max(min, v));
    view.k = k;
    const bx = clamp(size.w / 2 - (area.x + area.w / 2) * k, size.w - size.w * k);
    const by = clamp(size.h / 2 - (area.y + area.h / 2) * k, size.h - size.h * k);
    view.k = k;
    view.x = clamp(bx + pan.x, size.w - size.w * k);
    view.y = clamp(by + pan.y, size.h - size.h * k);
    panLimits.current = { bx, by, minX: size.w - size.w * k, minY: size.h - size.h * k, k };
    baseView.current = { x: bx, y: by };
  } else {
    panLimits.current = { bx: 0, by: 0, minX: 0, minY: 0, k: 1 };
    baseView.current = { x: 0, y: 0 };
  }
  const pannable = view.k > 1;

  /** Сдвигает вид на (dx, dy) px экрана, не выпуская изделие за края кадра. true — вид действительно сдвинулся. */
  const panBy = (dx: number, dy: number) => {
    const L = panLimits.current;
    if (L.k <= 1) return false;
    const p = panRef.current;
    const nx = Math.min(0, Math.max(L.minX, L.bx + p.x + dx)) - L.bx;
    const ny = Math.min(0, Math.max(L.minY, L.by + p.y + dy)) - L.by;
    if (nx === p.x && ny === p.y) return false;
    panRef.current = { x: nx, y: ny };
    setPan(panRef.current);
    return true;
  };
  const panByRef = useRef(panBy);
  panByRef.current = panBy;

  // Перетаскивание фона и изделия двигает вид; слои (и рамка выделения) сохраняют своё перетаскивание.
  const onWrapPointerDown = (e: React.PointerEvent) => {
    const stage = stageRef.current;
    if (!stage || panLimits.current.k <= 1 || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (!stage.content.contains(e.target as Node)) return;
    const box = stage.container().getBoundingClientRect();
    const hit = stage.getIntersection({ x: e.clientX - box.left, y: e.clientY - box.top });
    if (hit && hit.name() !== 'bg') return;
    let lx = e.clientX;
    let ly = e.clientY;
    const id = e.pointerId;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      panByRef.current(ev.clientX - lx, ev.clientY - ly);
      lx = ev.clientX;
      ly = ev.clientY;
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  // Колесо и трекпад двигают вид только на приближенном холсте и пока есть куда двигать — иначе прокручивается страница.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || panLimits.current.k <= 1) return;
      const unit = e.deltaMode === 1 ? 16 : 1;
      if (panByRef.current(-e.deltaX * unit, -e.deltaY * unit)) e.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  /** Прилипание к центру зоны при перетаскивании + направляющие. */
  const onDrag = (node: Konva.Node | null) => {
    const g = printRef.current;
    if (!node || !g || !area) return setGuides((p) => (p.v || p.h ? { v: false, h: false } : p));
    const rect = node.getClientRect({ relativeTo: g, skipShadow: true, skipStroke: true });
    const snap = snapToCenter(rect, { w: area.w, h: area.h }, SNAP_PX / view.k);
    if (snap.dx || snap.dy) node.position({ x: node.x() + snap.dx, y: node.y() + snap.dy });
    setGuides((p) => (p.v === snap.v && p.h === snap.h ? p : { v: snap.v, h: snap.h }));
  };

  // Рамка выделения живёт в отдельном слое — её не обрезает зона печати и не затеняют складки.
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const node = selectedLayerId ? stageRef.current?.findOne(`#${selectedLayerId}`) : null;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  });

  // Готов ли холст к снимку: показана сторона из стора, её мокап и картинки всех слоёв загружены.
  const isReady = useRef<() => boolean>(() => false);
  isReady.current = () => {
    const st = useConstructor.getState();
    const g = printRef.current;
    if (st.side !== side || !g) return false;
    if (shape && mockup?.url !== shape.images[side]) return false;
    return st.layers.filter((l) => l.side === side).every((l) => {
      const n = g.findOne(`#${l.id}`);
      if (l.kind === 'text') return !!n && fontReady(l.fontFamily, l.bold, l.italic, l.text);
      return !!n && !!(n as Konva.Image).image();
    });
  };

  mockupRef.current = mockup;
  // Новый кадр готов: мокап другой, чем при снимке, и это мокап текущей стороны (у силуэта без мокапа — сразу).
  fadeReady.current = (base) => !shape || (!!mockup && mockup !== base && mockup.url === shape.images[side]);

  /** Временно прячет служебные узлы на время снимка. */
  const withHidden = <T,>(nodes: Array<Konva.Node | null>, fn: () => T): T => {
    const shown = nodes.filter((n): n is Konva.Node => !!n && n.visible());
    shown.forEach((n) => n.visible(false));
    try { return fn(); } finally { shown.forEach((n) => n.visible(true)); }
  };

  /** Снимки делаются с кадром без пользовательского сдвига: на время вызова вид возвращается к центрированию на зоне. */
  const unpanned = <T,>(fn: () => T): T => {
    const stage = stageRef.current;
    if (!stage) return fn();
    const cur = { x: stage.x(), y: stage.y() };
    stage.position(baseView.current);
    try { return fn(); } finally { stage.position(cur); }
  };

  useImperativeHandle(apiRef, () => ({
    exportPreview: () => {
      settleAppear();
      return stageRef.current
        ? withHidden([guideRef.current, trRef.current], () => unpanned(() => stageRef.current!.toDataURL({ pixelRatio: 2 })))
        : null;
    },
    exportPrint: () => {
      settleAppear();
      const g = printRef.current;
      if (!g || !pa || !area) return null;
      const targetPx = (pa.widthCm / 2.54) * DPI;
      // toDataURL берёт область в координатах экрана — с учётом приближения холста.
      const w = area.w * view.k;
      const h = area.h * view.k;
      const full = targetPx / w;
      // Файл для печати — без складок ткани и только по самому рисунку: пустая часть зоны в файл не идёт,
      // поэтому предел площади canvas почти всегда оставляет полные 300 dpi.
      const out = withHidden([shadeRef.current, trRef.current], () => unpanned(() => {
        const at = g.getAbsolutePosition();
        let [x1, y1, x2, y2] = [Infinity, Infinity, -Infinity, -Infinity];
        for (const n of g.find(`.${DESIGN_NODE}`)) {
          const r = n.getClientRect();
          x1 = Math.min(x1, r.x); y1 = Math.min(y1, r.y);
          x2 = Math.max(x2, r.x + r.width); y2 = Math.max(y2, r.y + r.height);
        }
        // За границей зоны рисунок обрезается — габарит тоже.
        x1 = Math.max(x1, at.x); y1 = Math.max(y1, at.y);
        x2 = Math.min(x2, at.x + w); y2 = Math.min(y2, at.y + h);
        // Рисунок целиком за зоной — отдаём всю зону (пустую), чтобы заявка не споткнулась.
        if (!(x2 > x1 && y2 > y1)) [x1, y1, x2, y2] = [at.x, at.y, at.x + w, at.y + h];
        const ratio = Math.min(full, Math.sqrt(MAX_EXPORT_AREA / ((x2 - x1) * (y2 - y1))));
        const dataUrl = g.toDataURL({ x: x1, y: y1, width: x2 - x1, height: y2 - y1, pixelRatio: ratio });
        return { dataUrl, dpi: Math.round((DPI * ratio) / full) };
      }));
      return out;
    },
    whenReady: (timeoutMs = 8000) =>
      new Promise<void>((resolve, reject) => {
        const started = Date.now();
        // Не rAF: в фоновой вкладке он не срабатывает.
        const check = () => {
          if (isReady.current()) return resolve();
          if (Date.now() - started > timeoutMs) return reject(new Error('canvas_not_ready'));
          setTimeout(check, 40);
        };
        setTimeout(check, 0);
      }),
    setTurnEnabled: (on) => { turnEnabled.current = on; if (!on) { setTurn(null); setFade(null); settleAppear(); } },
    align: (id, mode) => {
      const g = printRef.current;
      const node = g?.findOne(`#${id}`);
      const layer = layers.find((l) => l.id === id);
      if (!g || !node || !layer || !area) return;
      const rect = node.getClientRect({ relativeTo: g, skipShadow: true, skipStroke: true });
      if (!rect.width || !rect.height) return;
      const r = alignLayer(mode, { x: node.x(), y: node.y() }, rect, { w: area.w, h: area.h });
      const moved = Math.abs(r.x - node.x()) > 0.5 || Math.abs(r.y - node.y()) > 0.5;
      const scaled = Math.abs(r.scale - 1) > 1e-3;
      // Слой уже стоит как надо — не добавляем пустой шаг в историю.
      if (!moved && !scaled) return;
      const pos = { x: r.x / area.w, y: r.y / area.h };
      if (!scaled) return updateLayer(id, pos);
      updateLayer(id, layer.kind === 'image' ? { ...pos, width: layer.width * r.scale } : { ...pos, fontSize: layer.fontSize * r.scale });
    },
  }));

  const silScale = Math.min(size.w / SILHOUETTE_VIEWBOX.w, size.h / SILHOUETTE_VIEWBOX.h);
  const deselect = (e: Konva.KonvaEventObject<Event>) => {
    if (e.target === e.target.getStage() || e.target.name() === 'bg') selectLayer(null);
  };

  return (
    <div ref={wrapRef} style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center' }}>
      <div
        className={c.viewport}
        style={{ width: size.w, height: size.h, touchAction: pannable ? 'none' : undefined }}
        onPointerDown={onWrapPointerDown}
      >
      <Stage
        ref={stageRef} width={size.w} height={size.h}
        scaleX={view.k} scaleY={view.k} x={view.x} y={view.y}
        onMouseDown={deselect} onTouchStart={deselect}
      >
        <Layer>
          {shape ? (
            mockup && <KImage name="bg" image={mockup.garment} width={size.w} height={size.h} />
          ) : garment ? (
            <Path
              name="bg"
              data={SILHOUETTES[garment.type]}
              x={(size.w - SILHOUETTE_VIEWBOX.w * silScale) / 2}
              scaleX={silScale}
              scaleY={silScale}
              fill={hex}
              stroke="#c9c9c9"
              strokeWidth={1}
            />
          ) : null}
          {area && (
            <Line
              ref={guideRef}
              listening={false}
              visible={!isEmptyZone}
              x={area.x} y={area.y}
              points={outlinePts.flat()}
              closed
              stroke={light
                ? (frameStrong ? 'rgba(0,0,0,.35)' : 'rgba(0,0,0,.18)')
                : (frameStrong ? 'rgba(255,255,255,.6)' : 'rgba(255,255,255,.25)')}
              strokeWidth={1}
              strokeScaleEnabled={false}
              dash={[6 / view.k, 4 / view.k]}
            />
          )}
        </Layer>
        <Layer>
          {area && (
            <Group
              ref={printRef} x={area.x} y={area.y}
              {...(hasOutline ? { clipFunc: clipOutline } : { clipX: 0, clipY: 0, clipWidth: area.w, clipHeight: area.h })}
            >
              {sideLayers.map((l) => (
                <LayerNode
                  key={l.id}
                  layer={l}
                  area={{ w: area.w, h: area.h }}
                  onSelect={() => selectLayer(l.id)}
                  onChange={(p) => updateLayer(l.id, p)}
                  onDrag={onDrag}
                />
              ))}
              {mockup && sideLayers.length > 0 && (
                <KImage
                  ref={shadeRef}
                  image={mockup.shade}
                  x={-area.x}
                  y={-area.y}
                  width={size.w}
                  height={size.h}
                  listening={false}
                  globalCompositeOperation="source-atop"
                />
              )}
            </Group>
          )}
        </Layer>
        <Layer>
          {area && (guides.v || guides.h) && (
            <Group x={area.x} y={area.y} listening={false}>
              {guides.v && <Line points={[area.w / 2, 0, area.w / 2, area.h]} stroke={accent} strokeWidth={1} strokeScaleEnabled={false} />}
              {guides.h && <Line points={[0, area.h / 2, area.w, area.h / 2]} stroke={accent} strokeWidth={1} strokeScaleEnabled={false} />}
            </Group>
          )}
          {/* Только рамка вплотную к принту; поворот, размер и удаление — кнопки SelectionControls. */}
          <Transformer
            ref={trRef}
            resizeEnabled={false}
            rotateEnabled={false}
            padding={0}
            borderStroke={accent}
            borderStrokeWidth={1.5}
          />
        </Layer>
      </Stage>
      {turn && <div ref={turnRef} className={c.turn} aria-hidden />}
      {fade && <div ref={fadeRef} className={c.turn} aria-hidden />}
      {area && !turn && empty && sideLayers.length === 0 && (
        <EmptyZone
          rect={{ left: area.x * view.k + view.x, top: area.y * view.k + view.y, width: area.w * view.k, height: area.h * view.k }}
          dragging={empty.dragging}
          panEnabled={pannable}
          onPanBy={panBy}
          outline={pa?.outline}
          tone={zoneTone(hex)}
          sizeText={zoneText}
          onUpload={empty.onUpload}
        />
      )}
      {area && !turn && !isEmptyZone && selectedLayer && zoneText && (
        <ZoneBadge
          rect={{ left: area.x * view.k + view.x, top: area.y * view.k + view.y, width: area.w * view.k, height: area.h * view.k }}
          text={zoneText}
          corner="bottom"
        />
      )}
      {area && !turn && (
        <SelectionControls
          stage={stageRef.current}
          layer={selectedLayer}
          area={{ w: area.w, h: area.h }}
          size={size}
          minPx={MIN_NODE_PX}
          accent={accent}
          caption={caption}
          onCommit={(p) => selectedLayerId && updateLayer(selectedLayerId, p)}
          onRemove={() => selectedLayerId && removeLayer(selectedLayerId)}
          onDuplicate={() => selectedLayerId && duplicateLayer(selectedLayerId)}
        />
      )}
      </div>
    </div>
  );
}
