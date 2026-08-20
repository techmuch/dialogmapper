import { create } from "zustand";
import { isFilterActive as filterActive, type FilterPreset, type FilterState } from "../filter";
import type { Status } from "../types";

/**
 * View state, kept apart from graph state so that panning or opening a panel
 * never re-renders node components. On a large map that separation is the
 * difference between smooth panning and dropped frames.
 */

export type { FilterPreset };

interface UIState {
  sidebarOpen: boolean;
  paletteOpen: boolean;
  mapMenuOpen: boolean;
  helpOpen: boolean;

  /** Freeform lets the user cluster by hand; auto re-runs the tidy tree. */
  layoutMode: "freeform" | "auto";
  showMinimap: boolean;

  filterPreset: FilterPreset;
  statusFilter: Set<Status>;
  tagFilter: string | null;
  /** Text typed into the on-canvas filter box. */
  filterQuery: string;

  toggleSidebar: (v?: boolean) => void;
  setPalette: (v: boolean) => void;
  setMapMenu: (v: boolean) => void;
  setHelp: (v: boolean) => void;
  setLayoutMode: (m: "freeform" | "auto") => void;
  toggleMinimap: () => void;
  setFilterPreset: (p: FilterPreset) => void;
  toggleStatus: (s: Status) => void;
  setTagFilter: (t: string | null) => void;
  setFilterQuery: (q: string) => void;
  resetFilters: () => void;
}

export const ALL_STATUSES: Status[] = ["open", "resolved", "rejected", "parked"];

export const useUI = create<UIState>((set, get) => ({
  sidebarOpen: false,
  paletteOpen: false,
  mapMenuOpen: false,
  helpOpen: false,
  // Auto by default: a map that tidies itself is the right first experience,
  // and dragging any node opts out immediately, so nobody is stuck in it.
  layoutMode: (localStorage.getItem("dm:layout") as "freeform" | "auto") ?? "auto",
  showMinimap: localStorage.getItem("dm:minimap") !== "off",

  filterPreset: "all",
  statusFilter: new Set(ALL_STATUSES),
  tagFilter: null,
  filterQuery: "",

  toggleSidebar: (v) => set((s) => ({ sidebarOpen: v ?? !s.sidebarOpen })),
  setPalette: (v) => set({ paletteOpen: v }),
  setMapMenu: (v) => set({ mapMenuOpen: v }),
  setHelp: (v) => set({ helpOpen: v }),

  setLayoutMode: (m) => {
    localStorage.setItem("dm:layout", m);
    set({ layoutMode: m });
  },

  toggleMinimap: () => {
    const next = !get().showMinimap;
    localStorage.setItem("dm:minimap", next ? "on" : "off");
    set({ showMinimap: next });
  },

  /**
   * "Open questions" is purely structural — it selects which questions are
   * still live and shows what hangs off them. It deliberately does not also
   * set a status filter: an earlier version did, which hid the resolved
   * arguments underneath a question that was still open.
   */
  setFilterPreset: (p) =>
    p === "all"
      ? set({
          filterPreset: "all",
          statusFilter: new Set(ALL_STATUSES),
          tagFilter: null,
          filterQuery: "",
        })
      : set({ filterPreset: p }),

  toggleStatus: (st) =>
    set((s) => {
      const next = new Set(s.statusFilter);
      next.has(st) ? next.delete(st) : next.add(st);
      return { statusFilter: next };
    }),

  setTagFilter: (t) => set({ tagFilter: t }),
  setFilterQuery: (q) => set({ filterQuery: q }),

  resetFilters: () =>
    set({
      filterPreset: "all",
      statusFilter: new Set(ALL_STATUSES),
      tagFilter: null,
      filterQuery: "",
    }),
}));

/** The filter, in the shape the pure filtering code expects. */
export function filterState(s: {
  filterPreset: FilterPreset;
  statusFilter: Set<Status>;
  tagFilter: string | null;
  filterQuery: string;
}): FilterState {
  return {
    preset: s.filterPreset,
    statuses: s.statusFilter,
    tag: s.tagFilter,
    query: s.filterQuery,
  };
}

/** True when anything is being filtered out. */
export function isFilterActive(s: Parameters<typeof filterState>[0]): boolean {
  return filterActive(filterState(s), ALL_STATUSES.length);
}
