import { create } from "zustand";
import type { NodeType, Status } from "../types";

/**
 * View state, kept apart from graph state so that panning or opening a panel
 * never re-renders node components. On a large map that separation is the
 * difference between smooth panning and dropped frames.
 */

export type FilterPreset = "all" | "openQuestions" | "unresolved" | "shared";

interface UIState {
  sidebarOpen: boolean;
  paletteOpen: boolean;
  mapMenuOpen: boolean;
  helpOpen: boolean;

  /** Freeform lets the user cluster by hand; auto re-runs the tidy tree. */
  layoutMode: "freeform" | "auto";
  showMinimap: boolean;

  filterPreset: FilterPreset;
  typeFilter: Set<NodeType>;
  statusFilter: Set<Status>;
  tagFilter: string | null;
  /** Text typed into the on-canvas filter box. */
  filterQuery: string;

  /** Set while drawing a bounding box, in flow coordinates. */
  drawingGroup: { x: number; y: number; w: number; h: number } | null;

  toggleSidebar: (v?: boolean) => void;
  setPalette: (v: boolean) => void;
  setMapMenu: (v: boolean) => void;
  setHelp: (v: boolean) => void;
  setLayoutMode: (m: "freeform" | "auto") => void;
  toggleMinimap: () => void;
  setFilterPreset: (p: FilterPreset) => void;
  toggleType: (t: NodeType) => void;
  toggleStatus: (s: Status) => void;
  setTagFilter: (t: string | null) => void;
  setFilterQuery: (q: string) => void;
  setDrawingGroup: (g: UIState["drawingGroup"]) => void;
  resetFilters: () => void;
}

const ALL_TYPES: NodeType[] = ["question", "idea", "pro", "con", "note", "map"];
const ALL_STATUSES: Status[] = ["open", "resolved", "rejected", "parked"];

export const useUI = create<UIState>((set, get) => ({
  sidebarOpen: false,
  paletteOpen: false,
  mapMenuOpen: false,
  helpOpen: false,
  layoutMode: (localStorage.getItem("dm:layout") as "freeform" | "auto") ?? "freeform",
  showMinimap: localStorage.getItem("dm:minimap") !== "off",

  filterPreset: "all",
  typeFilter: new Set(ALL_TYPES),
  statusFilter: new Set(ALL_STATUSES),
  tagFilter: null,
  filterQuery: "",
  drawingGroup: null,

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
   * Presets are the common questions people actually ask of a map, expressed
   * as filters rather than as separate views: "what is still open?", "what is
   * shared with other maps?".
   */
  setFilterPreset: (p) => {
    switch (p) {
      case "openQuestions":
        set({
          filterPreset: p,
          typeFilter: new Set<NodeType>(["question", "idea"]),
          statusFilter: new Set<Status>(["open", "parked"]),
        });
        break;
      case "unresolved":
        set({
          filterPreset: p,
          typeFilter: new Set(ALL_TYPES),
          statusFilter: new Set<Status>(["open", "parked"]),
        });
        break;
      case "shared":
        set({ filterPreset: p, typeFilter: new Set(ALL_TYPES), statusFilter: new Set(ALL_STATUSES) });
        break;
      default:
        set({
          filterPreset: "all",
          typeFilter: new Set(ALL_TYPES),
          statusFilter: new Set(ALL_STATUSES),
          tagFilter: null,
          filterQuery: "",
        });
    }
  },

  toggleType: (t) =>
    set((s) => {
      const next = new Set(s.typeFilter);
      next.has(t) ? next.delete(t) : next.add(t);
      return { typeFilter: next, filterPreset: "all" };
    }),

  toggleStatus: (st) =>
    set((s) => {
      const next = new Set(s.statusFilter);
      next.has(st) ? next.delete(st) : next.add(st);
      return { statusFilter: next, filterPreset: "all" };
    }),

  setTagFilter: (t) => set({ tagFilter: t }),
  setFilterQuery: (q) => set({ filterQuery: q }),
  setDrawingGroup: (g) => set({ drawingGroup: g }),

  resetFilters: () =>
    set({
      filterPreset: "all",
      typeFilter: new Set(ALL_TYPES),
      statusFilter: new Set(ALL_STATUSES),
      tagFilter: null,
      filterQuery: "",
    }),
}));

/** True when nothing is being filtered out. */
export function isFilterActive(s: UIState): boolean {
  return (
    s.filterPreset !== "all" ||
    s.typeFilter.size !== ALL_TYPES.length ||
    s.statusFilter.size !== ALL_STATUSES.length ||
    s.tagFilter !== null ||
    s.filterQuery.trim() !== ""
  );
}
