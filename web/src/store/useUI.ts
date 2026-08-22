import { create } from "zustand";
import { isFilterActive as filterActive, type FilterPreset, type FilterState } from "../filter";
import type { ZoomSetting } from "../desktop/viewport";
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
  /**
   * "auto" lets fitView choose the zoom, which is what tidying has always
   * done. A number pins it: `l`, `f` and Space then reposition without
   * changing how big anything looks.
   */
  zoomSetting: ZoomSetting;

  filterPreset: FilterPreset;
  statusFilter: Set<Status>;
  tagFilter: string | null;
  /** Text typed into the on-canvas filter box. */
  filterQuery: string;

  /**
   * The participant this tab is following, or null.
   *
   * Following is a view mode, not graph state: it belongs to this browser and
   * nobody else needs to know about it, so it never leaves the client.
   */
  following: string | null;
  /**
   * Registered by the canvas, which owns the viewport.
   *
   * The toolbar lives outside the ReactFlow provider, so it cannot move the
   * view itself; this is the same arrangement as the presence sender.
   */
  jumpTo: ((nodeID: string) => void) | null;

  toggleSidebar: (v?: boolean) => void;
  setPalette: (v: boolean) => void;
  setMapMenu: (v: boolean) => void;
  setHelp: (v: boolean) => void;
  setLayoutMode: (m: "freeform" | "auto") => void;
  toggleMinimap: () => void;
  setZoomSetting: (z: ZoomSetting) => void;
  setFilterPreset: (p: FilterPreset) => void;
  toggleStatus: (s: Status) => void;
  setTagFilter: (t: string | null) => void;
  setFilterQuery: (q: string) => void;
  setFollowing: (id: string | null) => void;
  setJumpTo: (fn: ((nodeID: string) => void) | null) => void;
  resetFilters: () => void;
}

export const ALL_STATUSES: Status[] = ["open", "resolved", "rejected", "parked"];

/** Auto unless a level was pinned; an unparseable value falls back to auto. */
function readZoom(): ZoomSetting {
  const raw = localStorage.getItem("dm:zoom");
  if (!raw || raw === "auto") return "auto";
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : "auto";
}

export const useUI = create<UIState>((set, get) => ({
  sidebarOpen: false,
  paletteOpen: false,
  mapMenuOpen: false,
  helpOpen: false,
  // Auto by default: a map that tidies itself is the right first experience,
  // and dragging any node opts out immediately, so nobody is stuck in it.
  layoutMode: (localStorage.getItem("dm:layout") as "freeform" | "auto") ?? "auto",
  showMinimap: localStorage.getItem("dm:minimap") !== "off",
  zoomSetting: readZoom(),

  filterPreset: "all",
  statusFilter: new Set(ALL_STATUSES),
  tagFilter: null,
  filterQuery: "",
  following: null,
  jumpTo: null,

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

  setZoomSetting: (z) => {
    localStorage.setItem("dm:zoom", z === "auto" ? "auto" : String(z));
    set({ zoomSetting: z });
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
  setFollowing: (id) => set({ following: id }),
  setJumpTo: (fn) => set({ jumpTo: fn }),

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
