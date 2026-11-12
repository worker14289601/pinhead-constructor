'use client';
import { create } from 'zustand';
import { DEFAULT_FONT } from '../config/fonts';
import { sidesFor } from '../config/print-areas';
import type {
  DesignLayer, Garment, ImageLayer, PrintMethod, Side, SizeQuantities, TextLayer,
} from './types';

const uid = () => Math.random().toString(36).slice(2, 10);

type NewImage = Pick<ImageLayer, 'src' | 'fileName' | 'isVector' | 'naturalWidth' | 'naturalHeight' | 'crop' | 'width'>;

/** Шаг истории: дизайн до действия и сторона, на которой оно было сделано. */
interface Snapshot {
  layers: DesignLayer[];
  selectedLayerId: string | null;
  side: Side;
}

const HISTORY_LIMIT = 50;
/** Правки подряд с одним ключом (набор текста, протяжка палитры) склеиваются в один шаг. */
const MERGE_MS = 400;

/**
 * Как правка попадает в историю:
 * - 'commit' — отдельный шаг (конец перетаскивания, трансформации, выбор шрифта);
 * - 'merge'  — склеивается с предыдущей правкой того же поля, если пауза меньше MERGE_MS (ввод текста).
 */
export type HistoryMode = 'commit' | 'merge';

interface ConstructorState {
  garments: Garment[];
  garmentId: string | null;
  variantId: string | null;
  side: Side;
  layers: DesignLayer[];
  selectedLayerId: string | null;
  method: PrintMethod;
  sizes: SizeQuantities;
  past: Snapshot[];
  future: Snapshot[];
  /** Растёт, когда загрузился шрифт: слои и цена перерисовываются с настоящими метриками. */
  fontTick: number;
  bumpFonts: () => void;

  setCatalog: (g: Garment[]) => void;
  /** Вернуть дизайн из черновика: изделие, цвет, слои, размеры. История начинается заново. */
  hydrate: (d: import('./draft').DraftState) => void;
  selectGarment: (id: string) => void;
  selectVariant: (productId: string) => void;
  setSide: (s: Side) => void;
  addImage: (img: NewImage) => void;
  addText: (fill: string, text?: string) => void;
  updateLayer: (id: string, patch: Partial<DesignLayer>, mode?: HistoryMode) => void;
  removeLayer: (id: string) => void;
  duplicateLayer: (id: string) => void;
  /** Поднять (+1) или опустить (−1) слой среди слоёв его стороны. */
  moveLayer: (id: string, dir: 1 | -1) => void;
  selectLayer: (id: string | null) => void;
  undo: () => void;
  redo: () => void;
  setMethod: (m: PrintMethod) => void;
  setSizeQty: (size: string, qty: number) => void;
  /** Прибавить/убавить от текущего значения — безопасно при быстрых нажатиях. */
  incSize: (size: string, delta: number) => void;
}

let lastMerge: { key: string; at: number } | null = null;

const snapshot = (s: ConstructorState): Snapshot => ({ layers: s.layers, selectedLayerId: s.selectedLayerId, side: s.side });

/** Запомнить текущий дизайн перед действием; новое действие сбрасывает «повтор». */
const record = (s: ConstructorState) => {
  lastMerge = null;
  return { past: [...s.past, snapshot(s)].slice(-HISTORY_LIMIT), future: [] as Snapshot[] };
};

export const useConstructor = create<ConstructorState>((set, get) => {
  /** Вернуть снимок из одной стопки истории, текущее состояние положить в другую. */
  const travel = (from: 'past' | 'future') => {
    const s = get();
    const stack = s[from];
    const target = stack[stack.length - 1];
    if (!target) return;
    lastMerge = null;
    const to = from === 'past' ? 'future' : 'past';
    // Показываем сторону, на которой было действие; если у текущей модели её нет — перед.
    const side = sidesFor(selectGarment(s)).includes(target.side) ? target.side : 'front';
    // В обратную стопку кладём текущий дизайн с той же стороной — повтор вернёт туда же.
    const current = { ...snapshot(s), side: target.side };
    set({
      layers: target.layers,
      selectedLayerId: target.layers.some((l) => l.id === target.selectedLayerId) ? target.selectedLayerId : null,
      side,
      [from]: stack.slice(0, -1),
      [to]: [...s[to], current],
    });
  };

  return {
    garments: [],
    garmentId: null,
    variantId: null,
    side: 'front',
    layers: [],
    selectedLayerId: null,
    method: 'dtf',
    sizes: {},
    past: [],
    future: [],
    fontTick: 0,
    bumpFonts: () => set((s) => ({ fontTick: s.fontTick + 1 })),

    setCatalog: (garments) => {
      const first = garments[0];
      set({ garments, garmentId: first?.id ?? null, variantId: first?.variants[0]?.productId ?? null });
    },
    hydrate: (d) => {
      const g = get().garments.find((x) => x.id === d.garmentId) ?? selectGarment(get());
      const v = g?.variants.find((x) => x.productId === d.variantId) ?? g?.variants[0];
      const sideOk = sidesFor(g).includes(d.side);
      set({
        garmentId: g?.id ?? null,
        variantId: v?.productId ?? null,
        side: sideOk ? d.side : 'front',
        method: d.method,
        // Количество — только по размерам, которые есть у выбранного цвета.
        sizes: Object.fromEntries(Object.entries(d.sizes).filter(([k]) => v?.sizes.includes(k))),
        layers: d.layers,
        selectedLayerId: null,
        past: [],
        future: [],
      });
      lastMerge = null;
    },
    // Дизайн при смене модели и цвета сохраняется — меняется только изделие под ним. В историю не входит.
    selectGarment: (id) => {
      const g = get().garments.find((x) => x.id === id) ?? null;
      const side = sidesFor(g).includes(get().side) ? get().side : 'front';
      set({ garmentId: id, variantId: g?.variants[0]?.productId ?? null, sizes: {}, side });
    },
    // У цветов одной модели набор размеров может отличаться: количество по размерам,
    // которых у нового цвета нет, убираем — иначе оно незаметно осталось бы в сумме и заявке.
    selectVariant: (variantId) =>
      set((s) => {
        const v = selectGarment(s)?.variants.find((x) => x.productId === variantId);
        const sizes = v ? Object.fromEntries(Object.entries(s.sizes).filter(([k]) => v.sizes.includes(k))) : s.sizes;
        return { variantId, sizes };
      }),
    setSide: (side) => set({ side, selectedLayerId: null }),

    addImage: (img) => {
      const id = uid();
      set((s) => ({
        ...record(s),
        layers: [...s.layers, { ...img, id, kind: 'image', side: s.side, x: (1 - img.width) / 2, y: 0.03, rotation: 0 }],
        selectedLayerId: id,
      }));
    },
    addText: (fill, text = 'Твой текст') => {
      const id = uid();
      const layer: TextLayer = {
        id, kind: 'text', side: get().side, text, fontFamily: DEFAULT_FONT, fontSize: 0.12,
        // у текста x/y — центр надписи
        fill, align: 'center', x: 0.5, y: 0.12, rotation: 0,
        bold: true, italic: false, lineHeight: 1.1, strokeWidth: 0, strokeColor: fill === '#ffffff' ? '#111111' : '#ffffff', arc: 0,
      };
      set((s) => ({ ...record(s), layers: [...s.layers, layer], selectedLayerId: id }));
    },
    updateLayer: (id, patch, mode = 'commit') =>
      set((s) => {
        let history = {};
        if (mode === 'merge') {
          const key = `${id}:${Object.keys(patch).sort().join(',')}`;
          const now = Date.now();
          const continues = lastMerge?.key === key && now - lastMerge.at < MERGE_MS;
          if (!continues) history = record(s);
          lastMerge = { key, at: now };
        } else {
          history = record(s);
        }
        return { ...history, layers: s.layers.map((l) => (l.id === id ? ({ ...l, ...patch } as DesignLayer) : l)) };
      }),
    removeLayer: (id) =>
      set((s) => {
        const layers = s.layers.filter((l) => l.id !== id);
        return { ...record(s), layers, selectedLayerId: null };
      }),
    duplicateLayer: (id) =>
      set((s) => {
        const i = s.layers.findIndex((l) => l.id === id);
        if (i < 0) return {};
        const src = s.layers[i];
        const copy = { ...src, id: uid(), x: src.x + 0.04, y: src.y + 0.04 } as DesignLayer;
        const layers = [...s.layers.slice(0, i + 1), copy, ...s.layers.slice(i + 1)];
        return { ...record(s), layers, selectedLayerId: copy.id };
      }),
    moveLayer: (id, dir) =>
      set((s) => {
        const i = s.layers.findIndex((l) => l.id === id);
        if (i < 0) return {};
        // Соседний слой той же стороны в нужном направлении: слои других сторон порядок не задают.
        let j = i + dir;
        while (j >= 0 && j < s.layers.length && s.layers[j].side !== s.layers[i].side) j += dir;
        if (j < 0 || j >= s.layers.length) return {};
        const layers = [...s.layers];
        [layers[i], layers[j]] = [layers[j], layers[i]];
        return { ...record(s), layers };
      }),
    selectLayer: (selectedLayerId) => set({ selectedLayerId }),
    undo: () => travel('past'),
    redo: () => travel('future'),

    setMethod: (method) => set({ method }),
    setSizeQty: (size, qty) =>
      set((s) => ({ sizes: { ...s.sizes, [size]: Math.max(0, Math.min(999, Math.round(qty) || 0)) } })),
    incSize: (size, delta) =>
      set((s) => ({ sizes: { ...s.sizes, [size]: Math.max(0, Math.min(999, (s.sizes[size] ?? 0) + delta)) } })),
  };
});

/** Удобные селекторы. */
export function selectGarment(s: Pick<ConstructorState, 'garments' | 'garmentId'>) {
  return s.garments.find((g) => g.id === s.garmentId) ?? null;
}
export const selectVariant = (s: ConstructorState) =>
  selectGarment(s)?.variants.find((v) => v.productId === s.variantId) ?? null;
export const canUndo = (s: ConstructorState) => s.past.length > 0;
export const canRedo = (s: ConstructorState) => s.future.length > 0;
