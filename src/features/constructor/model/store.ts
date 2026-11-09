'use client';
import { create } from 'zustand';
import type {
  DesignLayer, Garment, ImageLayer, PrintMethod, Side, SizeQuantities, TextLayer,
} from './types';
import type { SideBounds } from './pricing';

const uid = () => Math.random().toString(36).slice(2, 10);

type NewImage = Pick<ImageLayer, 'src' | 'fileName' | 'isVector' | 'naturalWidth' | 'naturalHeight' | 'width'>;

interface ConstructorState {
  garments: Garment[];
  garmentId: string | null;
  variantId: string | null;
  side: Side;
  layers: DesignLayer[];
  selectedLayerId: string | null;
  method: PrintMethod;
  sizes: SizeQuantities;
  bounds: SideBounds;

  setCatalog: (g: Garment[]) => void;
  selectGarment: (id: string) => void;
  selectVariant: (productId: string) => void;
  setSide: (s: Side) => void;
  addImage: (img: NewImage) => void;
  addText: (fill: string, text?: string) => void;
  updateLayer: (id: string, patch: Partial<DesignLayer>) => void;
  removeLayer: (id: string) => void;
  selectLayer: (id: string | null) => void;
  setMethod: (m: PrintMethod) => void;
  setSizeQty: (size: string, qty: number) => void;
  /** Прибавить/убавить от текущего значения — безопасно при быстрых нажатиях. */
  incSize: (size: string, delta: number) => void;
  setBounds: (side: Side, b: { wCm: number; hCm: number } | null) => void;
}

export const useConstructor = create<ConstructorState>((set, get) => ({
  garments: [],
  garmentId: null,
  variantId: null,
  side: 'front',
  layers: [],
  selectedLayerId: null,
  method: 'dtf',
  sizes: {},
  bounds: {},

  setCatalog: (garments) => {
    const first = garments[0];
    set({ garments, garmentId: first?.id ?? null, variantId: first?.variants[0]?.productId ?? null });
  },
  // Дизайн при смене модели и цвета сохраняется — меняется только изделие под ним.
  selectGarment: (id) => {
    const g = get().garments.find((x) => x.id === id);
    set({ garmentId: id, variantId: g?.variants[0]?.productId ?? null, sizes: {} });
  },
  selectVariant: (variantId) => set({ variantId }),
  setSide: (side) => set({ side, selectedLayerId: null }),

  addImage: (img) => {
    const id = uid();
    set((s) => ({
      layers: [...s.layers, { ...img, id, kind: 'image', side: s.side, x: (1 - img.width) / 2, y: 0.03, rotation: 0 }],
      selectedLayerId: id,
    }));
  },
  addText: (fill, text = 'Твой текст') => {
    const id = uid();
    const layer: TextLayer = {
      id, kind: 'text', side: get().side, text, fontFamily: 'Arial', fontSize: 0.12,
      // у текста x/y — центр надписи
      fill, align: 'center', x: 0.5, y: 0.12, rotation: 0,
    };
    set((s) => ({ layers: [...s.layers, layer], selectedLayerId: id }));
  },
  updateLayer: (id, patch) =>
    set((s) => ({ layers: s.layers.map((l) => (l.id === id ? ({ ...l, ...patch } as DesignLayer) : l)) })),
  removeLayer: (id) =>
    set((s) => ({ layers: s.layers.filter((l) => l.id !== id), selectedLayerId: null })),
  selectLayer: (selectedLayerId) => set({ selectedLayerId }),
  setMethod: (method) => set({ method }),
  setSizeQty: (size, qty) =>
    set((s) => ({ sizes: { ...s.sizes, [size]: Math.max(0, Math.min(999, qty)) } })),
  incSize: (size, delta) =>
    set((s) => ({ sizes: { ...s.sizes, [size]: Math.max(0, Math.min(999, (s.sizes[size] ?? 0) + delta)) } })),
  setBounds: (side, b) => {
    // Холст зовёт это после каждого рендера — обновляем только при реальном изменении (шаг 1 мм).
    const r = (n: number) => Math.round(n * 10);
    const prev = get().bounds[side];
    const same = prev === b || (prev && b && r(prev.wCm) === r(b.wCm) && r(prev.hCm) === r(b.hCm));
    if (prev !== undefined && same) return;
    set((s) => ({ bounds: { ...s.bounds, [side]: b } }));
  },
}));

/** Удобные селекторы. */
export const selectGarment = (s: ConstructorState) => s.garments.find((g) => g.id === s.garmentId) ?? null;
export const selectVariant = (s: ConstructorState) =>
  selectGarment(s)?.variants.find((v) => v.productId === s.variantId) ?? null;
