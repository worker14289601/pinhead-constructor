'use client';
import { Image as KImage, Shape } from 'react-konva';
import useImage from 'use-image';
import type Konva from 'konva';
import { measureText, textFont } from '../model/trim';
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

  if (layer.kind === 'image') {
    return (
      <KImage
        {...common}
        image={img}
        crop={layer.crop}
        width={layer.width * area.w}
        height={(layer.width * area.w * layer.naturalHeight) / layer.naturalWidth}
      />
    );
  }

  // Текст рисуем сами: у Konva.Text рамка — строка шрифта с запасом сверху и снизу,
  // а нужна рамка по буквам. Точка (x, y) — середина надписи.
  const fontPx = layer.fontSize * area.w;
  const box = measureText(layer.text, layer.fontFamily, fontPx, layer.align);
  return (
    <Shape
      {...common}
      width={box.width}
      height={box.height}
      offsetX={box.width / 2}
      offsetY={box.height / 2}
      fill={layer.fill}
      sceneFunc={(ctx, shape) => {
        const c = ctx._context;
        c.font = textFont(layer.fontFamily, fontPx);
        c.textAlign = 'left';
        c.textBaseline = 'alphabetic';
        c.fillStyle = shape.fill() as string;
        for (const l of box.lines) c.fillText(l.text, l.x, l.y);
      }}
      hitFunc={(ctx, shape) => {
        ctx.beginPath();
        ctx.rect(0, 0, box.width, box.height);
        ctx.closePath();
        ctx.fillStrokeShape(shape);
      }}
    />
  );
}
