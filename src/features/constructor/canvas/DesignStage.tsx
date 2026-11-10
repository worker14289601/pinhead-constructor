'use client';
import { useEffect, useImperativeHandle, useRef, useState, type RefObject } from 'react';
import { Group, Image as KImage, Layer, Line, Path, Rect, Stage, Transformer } from 'react-konva';
import type Konva from 'konva';
import { FRAME, SHAPES } from '../config/garment-shapes';
import { printAreaFor } from '../config/print-areas';
import { selectGarment, selectVariant, useConstructor } from '../model/store';
import { isSleeve } from '../model/types';
import { alignLayer, snapToCenter, type AlignMode } from './align';
import { LayerNode } from './LayerNode';
import { SILHOUETTES, SILHOUETTE_VIEWBOX } from './silhouettes';
import { isLight, useTintedMockup } from './tint';

export interface DesignStageHandle {
  /** PNG текущей стороны с изделием — превью для клиента и менеджера. */
  exportPreview: () => string | null;
  /**
   * PNG принта (без изделия, прозрачный фон) по реальной ширине зоны: 300 dpi,
   * для самых больших зон — меньше, чтобы файл уложился в предел размера canvas.
   */
  exportPrint: () => { dataUrl: string; dpi: number } | null;
  /** Ждёт, пока холст покажет текущую сторону целиком: мокап и все картинки слоёв загружены. */
  whenReady: (timeoutMs?: number) => Promise<void>;
  /** Выровнять слой в зоне печати (одним шагом истории). */
  align: (id: string, mode: AlignMode) => void;
}

const DPI = 300;
/** Предел площади canvas в мобильных браузерах — около 16,7 Мп; больше — снимок выйдет пустым. */
const MAX_EXPORT_AREA = 16_000_000;
/** Меньше этого размера (px экрана) рамка трансформации слой не сжимает. */
const MIN_NODE_PX = 12;
/** Максимальное приближение маленькой зоны (рукав): мокапы 800×920, дальше картинка мылится. */
const MAX_ZOOM = 2.4;
/** Порог прилипания к центру зоны, в пикселях экрана. */
const SNAP_PX = 6;
/** Фирменный лайм; на светлой ткани он не виден, поэтому рамка и направляющие там чёрные. */
const LIME = '#99ff00';
const INK = '#000000';

/** apiRef — обычный проп, а не ref: next/dynamic не пробрасывает ref в ленивый компонент. */
export function DesignStage({ apiRef }: { apiRef: RefObject<DesignStageHandle> }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const printRef = useRef<Konva.Group>(null);
  const shadeRef = useRef<Konva.Image>(null);
  const guideRef = useRef<Konva.Rect>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const [size, setSize] = useState({ w: 400, h: 460 });
  const [guides, setGuides] = useState({ v: false, h: false });

  const garment = useConstructor(selectGarment);
  const variant = useConstructor(selectVariant);
  const { side, layers, selectedLayerId, selectLayer, updateLayer } = useConstructor();

  const shape = garment?.shapeId ? SHAPES[garment.shapeId] : null;
  const hex = variant?.hex ?? '#e4e4e4';
  const mockup = useTintedMockup(shape?.images[side] ?? null, hex);
  const light = isLight(hex);
  const accent = light ? INK : LIME;

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
  const area = pa ? { x: pa.x * size.w, y: pa.y * size.h, w: pa.width * size.w, h: pa.height * size.h } : null;
  const sideLayers = layers.filter((l) => l.side === side);

  // Рукав — маленькая зона: приближаем холст к ней, не выходя за края кадра.
  const view = { k: 1, x: 0, y: 0 };
  if (isSleeve(side) && area) {
    const k = Math.min(MAX_ZOOM, (0.5 * size.h) / area.h, (0.5 * size.w) / area.w);
    const clamp = (v: number, min: number) => Math.min(0, Math.max(min, v));
    view.k = k;
    view.x = clamp(size.w / 2 - (area.x + area.w / 2) * k, size.w - size.w * k);
    view.y = clamp(size.h / 2 - (area.y + area.h / 2) * k, size.h - size.h * k);
  }

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
      return !!n && (l.kind !== 'image' || !!(n as Konva.Image).image());
    });
  };

  /** Временно прячет служебные узлы на время снимка. */
  const withHidden = <T,>(nodes: Array<Konva.Node | null>, fn: () => T): T => {
    const shown = nodes.filter((n): n is Konva.Node => !!n && n.visible());
    shown.forEach((n) => n.visible(false));
    try { return fn(); } finally { shown.forEach((n) => n.visible(true)); }
  };

  useImperativeHandle(apiRef, () => ({
    exportPreview: () =>
      stageRef.current
        ? withHidden([guideRef.current, trRef.current], () => stageRef.current!.toDataURL({ pixelRatio: 2 }))
        : null,
    exportPrint: () => {
      const g = printRef.current;
      if (!g || !pa || !area) return null;
      const targetPx = (pa.widthCm / 2.54) * DPI;
      // toDataURL берёт область в координатах экрана — с учётом приближения холста.
      const at = g.getAbsolutePosition();
      const w = area.w * view.k;
      const h = area.h * view.k;
      // Файл для печати — без складок ткани.
      const full = targetPx / w;
      const ratio = Math.min(full, Math.sqrt(MAX_EXPORT_AREA / (w * h)));
      const dataUrl = withHidden([shadeRef.current, trRef.current], () =>
        g.toDataURL({ x: at.x, y: at.y, width: w, height: h, pixelRatio: ratio }),
      );
      return { dataUrl, dpi: Math.round((DPI * ratio) / full) };
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
            <Rect
              ref={guideRef}
              listening={false}
              x={area.x} y={area.y} width={area.w} height={area.h}
              stroke={light ? 'rgba(0,0,0,.35)' : 'rgba(255,255,255,.6)'}
              strokeWidth={1}
              strokeScaleEnabled={false}
              dash={[6 / view.k, 4 / view.k]}
            />
          )}
        </Layer>
        <Layer>
          {area && (
            <Group ref={printRef} x={area.x} y={area.y} clipX={0} clipY={0} clipWidth={area.w} clipHeight={area.h}>
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
          <Transformer
            ref={trRef}
            keepRatio
            flipEnabled={false}
            boundBoxFunc={(prev, next) => (Math.abs(next.width) < MIN_NODE_PX || Math.abs(next.height) < MIN_NODE_PX ? prev : next)}
            enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
            rotationSnaps={[0, 90, 180, 270]}
            anchorSize={12}
            padding={6}
            borderStroke={accent}
            borderStrokeWidth={1.5}
            anchorFill={LIME}
            anchorStroke={INK}
            anchorCornerRadius={2}
          />
        </Layer>
      </Stage>
    </div>
  );
}
