'use client';
import { useEffect, useImperativeHandle, useRef, useState, type RefObject } from 'react';
import { Group, Image as KImage, Layer, Path, Rect, Stage, Transformer } from 'react-konva';
import type Konva from 'konva';
import { FRAME, SHAPES } from '../config/garment-shapes';
import { printAreaFor } from '../config/print-areas';
import { selectGarment, selectVariant, useConstructor } from '../model/store';
import { DESIGN_NODE, LayerNode } from './LayerNode';
import { SILHOUETTES, SILHOUETTE_VIEWBOX } from './silhouettes';
import { isLight, useTintedMockup } from './tint';

export interface DesignStageHandle {
  /** PNG текущей стороны с изделием — превью для клиента и менеджера. */
  exportPreview: () => string | null;
  /** PNG принта (без изделия, прозрачный фон) в 300 dpi по реальной ширине зоны. */
  exportPrint: () => string | null;
}

const DPI = 300;

/** apiRef — обычный проп, а не ref: next/dynamic не пробрасывает ref в ленивый компонент. */
export function DesignStage({ apiRef }: { apiRef: RefObject<DesignStageHandle> }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const printRef = useRef<Konva.Group>(null);
  const shadeRef = useRef<Konva.Image>(null);
  const guideRef = useRef<Konva.Rect>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const [size, setSize] = useState({ w: 400, h: 460 });

  const garment = useConstructor(selectGarment);
  const variant = useConstructor(selectVariant);
  const { side, layers, selectedLayerId, selectLayer, updateLayer, setBounds } = useConstructor();

  const shape = garment?.shapeId ? SHAPES[garment.shapeId] : null;
  const hex = variant?.hex ?? '#e4e4e4';
  const mockup = useTintedMockup(shape?.images[side] ?? null, hex);
  const light = isLight(hex);

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

  // Рамка выделения живёт в отдельном слое — её не обрезает зона печати и не затеняют складки.
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const node = selectedLayerId ? stageRef.current?.findOne(`#${selectedLayerId}`) : null;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  });

  // Габарит принта в см — для расчёта формата и цены.
  useEffect(() => {
    const g = printRef.current;
    if (!g || !pa || !area) return;
    const nodes = g.find(`.${DESIGN_NODE}`);
    if (!nodes.length) return setBounds(side, null);
    let [x1, y1, x2, y2] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const n of nodes) {
      const r = n.getClientRect({ relativeTo: g, skipShadow: true, skipStroke: true });
      x1 = Math.min(x1, Math.max(0, r.x));
      y1 = Math.min(y1, Math.max(0, r.y));
      x2 = Math.max(x2, Math.min(area.w, r.x + r.width));
      y2 = Math.max(y2, Math.min(area.h, r.y + r.height));
    }
    const cmPerPx = pa.widthCm / area.w;
    setBounds(side, x2 > x1 && y2 > y1 ? { wCm: (x2 - x1) * cmPerPx, hCm: (y2 - y1) * cmPerPx } : null);
  });

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
      // Файл для печати — без складок ткани.
      return withHidden([shadeRef.current, trRef.current], () =>
        g.toDataURL({ x: area.x, y: area.y, width: area.w, height: area.h, pixelRatio: targetPx / area.w }),
      );
    },
  }));

  const silScale = Math.min(size.w / SILHOUETTE_VIEWBOX.w, size.h / SILHOUETTE_VIEWBOX.h);
  const deselect = (e: Konva.KonvaEventObject<Event>) => {
    if (e.target === e.target.getStage() || e.target.name() === 'bg') selectLayer(null);
  };

  return (
    <div ref={wrapRef} style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center' }}>
      <Stage ref={stageRef} width={size.w} height={size.h} onMouseDown={deselect} onTouchStart={deselect}>
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
              dash={[6, 4]}
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
          <Transformer
            ref={trRef}
            keepRatio
            enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
            rotationSnaps={[0, 90, 180, 270]}
            anchorSize={12}
            padding={6}
            borderStroke="#ff4f00"
            anchorStroke="#ff4f00"
          />
        </Layer>
      </Stage>
    </div>
  );
}
