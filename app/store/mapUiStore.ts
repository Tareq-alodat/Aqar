import { create } from "zustand";
import type { BBox } from "~/shared/geo";

/**
 * Client-only UI state of the map page (SPEC §1: Zustand). Search state
 * itself lives in the URL (useMapUrlState), not here.
 */

export type SheetSnap = "peek" | "half" | "full";
export type NoticeKind = "rate_limited" | "load_error" | "draw_invalid" | "geo_denied" | "geo_unavailable";

interface MapUiState {
  hoveredId: number | null;
  selectedId: number | null;
  sheet: SheetSnap;
  drawing: boolean;
  searchAsMove: boolean;
  filtersOpen: boolean;
  notice: NoticeKind | null;
  /** Bounds to fit the map to; `key` changes on every request. */
  fit: { bbox: BBox; key: number } | undefined;
  setHovered(id: number | null): void;
  select(id: number | null): void;
  setSheet(s: SheetSnap): void;
  setDrawing(on: boolean): void;
  setSearchAsMove(on: boolean): void;
  setFiltersOpen(open: boolean): void;
  setNotice(n: NoticeKind | null): void;
  fitTo(bbox: BBox): void;
}

export const useMapUi = create<MapUiState>((set) => ({
  hoveredId: null,
  selectedId: null,
  sheet: "peek",
  drawing: false,
  searchAsMove: true,
  filtersOpen: false,
  notice: null,
  fit: undefined,
  setHovered: (hoveredId) => set({ hoveredId }),
  select: (selectedId) => set({ selectedId }),
  setSheet: (sheet) => set({ sheet }),
  setDrawing: (drawing) => set({ drawing }),
  setSearchAsMove: (searchAsMove) => set({ searchAsMove }),
  setFiltersOpen: (filtersOpen) => set({ filtersOpen }),
  setNotice: (notice) => set({ notice }),
  fitTo: (bbox) => set((s) => ({ fit: { bbox, key: (s.fit?.key ?? 0) + 1 } })),
}));
