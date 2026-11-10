'use client';
import { useLayoutEffect, useRef } from 'react';
import { Image as KImage, Text as KText } from 'react-konva';
import useImage from 'use-image';
import type Konva from 'konva';
import type { DesignLayer } from '../model/types';

interface Props {
  layer: DesignLayer;
  /** Размер зоны печати в пикселях экрана. */
  area: { w: number; h: number };
  onSelect: () => void;
  onChange: (patch: Partial<DesignLayer>) => void;
  /** Узел во время перетаскивания (для прилипания к центру); null — перетаскивание закончилось. */
  onDrag?: (node: Konva.Node | null) => void;
}

/** Имя узлов дизайна — по нему холст отличает их от служебных (тени, рамки). */
export const DESIGN_NODE = 'design';

/** Слой дизайна. Координаты хранятся в долях зоны печати, на экране — пиксели. */
export function LayerNode({ layer, area, onSelect, onChange, onDrag }: Props) {
  const [img] = useImage(layer.kind === 'image' ? layer.src : '', 'anonymous');
  const textRef = useRef<Konva.Text>(null);

  // Текст позиционируется по центру: точка (x, y) — середина надписи.
  useLayoutEffect(() => {
    const n = textRef.current;
    if (!n) return;
    n.offsetX(n.width() / 2);
    n.offsetY(n.height() / 2);
    n.getLayer()?.batchDraw();
  });

  const common = {
    id: layer.id,
    name: DESIGN_NODE,
    x: layer.x * area.w,
    y: layer.y * area.h,
    rotation: layer.rotation,
    draggable: true,
    onMouseDown: onSelect,
    onTouchStart: onSelect,
    onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => onDrag?.(e.target),
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
      onDrag?.(null);
      onChange({ x: e.target.x() / area.w, y: e.target.y() / area.h });
    },
    onTransformEnd: (e: Konva.KonvaEventObject<Event>) => {
      const n = e.target;
      const sx = n.scaleX();
      n.scaleX(1);
      n.scaleY(1);
      const base = { x: n.x() / area.w, y: n.y() / area.h, rotation: n.rotation() };
      if (layer.kind === 'image') onChange({ ...base, width: (n.width() * sx) / area.w });
      else onChange({ ...base, fontSize: layer.fontSize * sx });
    },
  };

  return layer.kind === 'image' ? (
    <KImage
      {...common}
      image={img}
      width={layer.width * area.w}
      height={(layer.width * area.w * layer.naturalHeight) / layer.naturalWidth}
    />
  ) : (
    <KText
      {...common}
      ref={textRef}
      text={layer.text}
      fontFamily={layer.fontFamily}
      fontSize={layer.fontSize * area.w}
      fill={layer.fill}
      align={layer.align}
    />
  );
}
