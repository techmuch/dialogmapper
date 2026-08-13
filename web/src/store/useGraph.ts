import { create } from "zustand";
import { ApiError, CLIENT_ID, api } from "../api";
import { autoLayout } from "../layout/autoLayout";
import type {
  DMEdge,
  DMGroup,
  DMMap,
  DMNode,
  Grammar,
  NodeType,
  Relationship,
  ServerEvent,
} from "../types";

/**
 * One store holds the whole graph. Nodes and edges are kept in records rather
 * than arrays because the capture loop mutates single nodes many times per
 * second, and scanning an array per keystroke is the difference between
 * "instant" and "laggy" once a map passes a few hundred nodes.
 */

type Toast = { id: number; kind: "error" | "info"; message: string };

interface GraphState {
  maps: DMMap[];
  mapId: string | null;
  map: DMMap | null;
  nodes: Record<string, DMNode>;
  edges: Record<string, DMEdge>;
  groups: Record<string, DMGroup>;
  grammar: Grammar | null;

  /** The node the keyboard acts on. Exactly one, always. */
  selectedId: string | null;
  /** Non-null while a node's title is being typed inline. */
  editingId: string | null;
  loading: boolean;
  connected: boolean;
  toasts: Toast[];

  bootstrap: () => Promise<void>;
  openMap: (mapId: string) => Promise<void>;
  reload: () => Promise<void>;

  select: (id: string | null) => void;
  beginEdit: (id: string) => void;
  commitTitle: (id: string, title: string) => Promise<void>;
  cancelEdit: () => void;

  createChild: (
    parentId: string | null,
    type: NodeType,
    relationship?: Relationship,
  ) => Promise<string | null>;
  createRoot: (type: NodeType, x: number, y: number) => Promise<string | null>;
  link: (sourceId: string, targetId: string, rel?: Relationship) => Promise<void>;
  unlink: (edgeId: string) => Promise<void>;
  moveNode: (nodeId: string, x: number, y: number) => void;
  patchNode: (id: string, patch: Parameters<typeof api.updateNode>[1]) => Promise<void>;
  removeFromMap: (nodeId: string) => Promise<void>;
  deleteEverywhere: (nodeId: string) => Promise<void>;
  insertExisting: (nodeId: string) => Promise<void>;
  saveGroup: (g: Partial<DMGroup>) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;
  runAutoLayout: (persist?: boolean) => Promise<void>;

  applyEvent: (e: ServerEvent) => void;
  setConnected: (v: boolean) => void;
  toast: (message: string, kind?: Toast["kind"]) => void;
  dismissToast: (id: number) => void;
}

const byId = <T extends { id: string }>(xs: T[]): Record<string, T> =>
  Object.fromEntries(xs.map((x) => [x.id, x]));

let toastSeq = 0;

export const useGraph = create<GraphState>((set, get) => ({
  maps: [],
  mapId: null,
  map: null,
  nodes: {},
  edges: {},
  groups: {},
  grammar: null,
  selectedId: null,
  editingId: null,
  loading: true,
  connected: false,
  toasts: [],

  bootstrap: async () => {
    set({ loading: true });
    try {
      const [maps, grammar] = await Promise.all([api.listMaps(), api.grammar()]);
      set({ maps, grammar });
      const preferred =
        new URLSearchParams(location.search).get("map") ??
        localStorage.getItem("dm:lastMap");
      const target = maps.find((m) => m.id === preferred) ?? maps[0];
      if (target) await get().openMap(target.id);
      else set({ loading: false });
    } catch (err) {
      get().toast(describe(err));
      set({ loading: false });
    }
  },

  openMap: async (mapId) => {
    set({ loading: true, mapId });
    localStorage.setItem("dm:lastMap", mapId);
    try {
      const g = await api.graph(mapId);
      set({
        map: g.map,
        nodes: byId(g.nodes),
        edges: byId(g.edges),
        groups: byId(g.groups),
        loading: false,
        selectedId: null,
      });
      // Nodes created blind — by an agent, a phone, or the CLI — arrive with
      // no coordinates. Place them before first paint so the canvas never
      // shows a pile at the origin.
      if (g.nodes.some((n) => n.placement?.x == null)) {
        await get().runAutoLayout(true);
      }
    } catch (err) {
      get().toast(describe(err));
      set({ loading: false });
    }
  },

  reload: async () => {
    const id = get().mapId;
    if (id) await get().openMap(id);
  },

  select: (id) => set({ selectedId: id, editingId: null }),
  beginEdit: (id) => set({ selectedId: id, editingId: id }),
  cancelEdit: () => set({ editingId: null }),

  /**
   * Enter commits the title and drops focus but keeps the node selected, so
   * the next keystroke (`+`, `-`, `q`) acts on what was just typed. That
   * handoff is the whole point of the capture loop.
   */
  commitTitle: async (id, title) => {
    const node = get().nodes[id];
    set({ editingId: null, selectedId: id });
    if (!node || node.title === title) return;
    set((s) => ({ nodes: { ...s.nodes, [id]: { ...node, title } } }));
    try {
      await api.updateNode(id, { title });
    } catch (err) {
      set((s) => ({ nodes: { ...s.nodes, [id]: node } })); // roll back
      get().toast(describe(err));
    }
  },

  createChild: async (parentId, type, relationship) => {
    const { mapId, nodes } = get();
    if (!mapId) return null;

    const parent = parentId ? nodes[parentId] : null;
    // Place the child below and slightly right of its parent. The real
    // position is settled by auto-layout if the user asks for it; this just
    // avoids a node appearing somewhere unrelated to what was selected.
    const px = parent?.placement?.x ?? 0;
    const py = parent?.placement?.y ?? 0;
    const siblings = parent ? childrenOf(get(), parent.id).length : 0;
    const x = px + 40 + siblings * 24;
    const y = py + 150 + siblings * 12;

    try {
      const { node, edge } = await api.createNode({
        type,
        title: "",
        mapId,
        x,
        y,
        parentId: parent?.id,
        relationshipType: relationship,
        source: "ui",
      });
      set((s) => ({
        nodes: { ...s.nodes, [node.id]: node },
        edges: edge ? { ...s.edges, [edge.id]: edge } : s.edges,
        selectedId: node.id,
        editingId: node.id,
      }));
      return node.id;
    } catch (err) {
      get().toast(describe(err));
      return null;
    }
  },

  createRoot: async (type, x, y) => {
    const { mapId } = get();
    if (!mapId) return null;
    try {
      const { node } = await api.createNode({ type, title: "", mapId, x, y, source: "ui" });
      set((s) => ({
        nodes: { ...s.nodes, [node.id]: node },
        selectedId: node.id,
        editingId: node.id,
      }));
      return node.id;
    } catch (err) {
      get().toast(describe(err));
      return null;
    }
  },

  link: async (sourceId, targetId, rel) => {
    const { mapId } = get();
    if (!mapId || sourceId === targetId) return;
    try {
      const edge = await api.createEdge(mapId, sourceId, targetId, rel);
      set((s) => ({ edges: { ...s.edges, [edge.id]: edge } }));
    } catch (err) {
      // A grammar rejection is information, not a failure: show what the
      // backend says would have been legal instead.
      get().toast(describe(err));
    }
  },

  unlink: async (edgeId) => {
    const { mapId, edges } = get();
    if (!mapId) return;
    const prev = edges[edgeId];
    set((s) => {
      const next = { ...s.edges };
      delete next[edgeId];
      return { edges: next };
    });
    try {
      await api.deleteEdge(edgeId, mapId);
    } catch (err) {
      if (prev) set((s) => ({ edges: { ...s.edges, [edgeId]: prev } }));
      get().toast(describe(err));
    }
  },

  /**
   * Dragging updates local state on every frame but only persists on drag end
   * (the canvas calls this from onNodeDragStop), so a drag is one write rather
   * than sixty.
   */
  moveNode: (nodeId, x, y) => {
    const { mapId, nodes } = get();
    const node = nodes[nodeId];
    if (!mapId || !node) return;
    set((s) => ({
      nodes: {
        ...s.nodes,
        [nodeId]: {
          ...node,
          placement: { ...(node.placement ?? emptyPlacement()), x, y },
        },
      },
    }));
    void api.moveNode(mapId, nodeId, { x, y }).catch((err) => get().toast(describe(err)));
  },

  patchNode: async (id, patch) => {
    const before = get().nodes[id];
    try {
      const updated = await api.updateNode(id, patch);
      set((s) => ({
        nodes: {
          ...s.nodes,
          [id]: { ...updated, placement: before?.placement ?? updated.placement },
        },
      }));
    } catch (err) {
      get().toast(describe(err));
    }
  },

  removeFromMap: async (nodeId) => {
    const { mapId } = get();
    if (!mapId) return;
    try {
      await api.removeFromMap(mapId, nodeId);
      set((s) => dropNode(s, nodeId));
    } catch (err) {
      get().toast(describe(err));
    }
  },

  deleteEverywhere: async (nodeId) => {
    try {
      await api.deleteEverywhere(nodeId);
      set((s) => dropNode(s, nodeId));
    } catch (err) {
      get().toast(describe(err));
    }
  },

  insertExisting: async (nodeId) => {
    const { mapId, nodes } = get();
    if (!mapId) return;
    const spot = freeSpot(Object.values(nodes));
    try {
      const node = await api.transclude(mapId, nodeId, spot.x, spot.y);
      set((s) => ({ nodes: { ...s.nodes, [node.id]: node }, selectedId: node.id }));
      get().toast(`Inserted "${node.title}" — shared with ${node.mapCount} maps`, "info");
    } catch (err) {
      get().toast(describe(err));
    }
  },

  saveGroup: async (g) => {
    const { mapId } = get();
    if (!mapId) return;
    try {
      const saved = await api.saveGroup({ ...g, mapId });
      set((s) => ({ groups: { ...s.groups, [saved.id]: saved } }));
    } catch (err) {
      get().toast(describe(err));
    }
  },

  deleteGroup: async (id) => {
    const { mapId } = get();
    if (!mapId) return;
    set((s) => {
      const next = { ...s.groups };
      delete next[id];
      return { groups: next };
    });
    await api.deleteGroup(id, mapId).catch((err) => get().toast(describe(err)));
  },

  runAutoLayout: async (persist = true) => {
    const { nodes, edges, mapId } = get();
    if (!mapId) return;
    const placed = autoLayout(Object.values(nodes), Object.values(edges));

    set((s) => {
      const next = { ...s.nodes };
      for (const [id, p] of placed) {
        const n = next[id];
        if (n) next[id] = { ...n, placement: { ...(n.placement ?? emptyPlacement()), ...p } };
      }
      return { nodes: next };
    });

    if (!persist) return;
    // Fire the writes in parallel; a failed layout save is cosmetic, so one
    // rejection should not abort the rest.
    await Promise.allSettled(
      [...placed].map(([id, p]) => api.moveNode(mapId, id, { x: p.x, y: p.y })),
    );
  },

  /**
   * WebSocket events. Echoes of this tab's own writes are ignored, since the
   * optimistic state is already correct and re-applying would clobber an
   * in-flight edit.
   */
  applyEvent: (e) => {
    if (e.origin && e.origin === CLIENT_ID) return;
    const { mapId } = get();

    switch (e.type) {
      case "graph.invalidated":
        void get().reload();
        return;

      case "node.created": {
        if (e.mapId !== mapId) return;
        const { node, edge } = e.payload as { node: DMNode; edge: DMEdge | null };
        set((s) => ({
          nodes: { ...s.nodes, [node.id]: node },
          edges: edge ? { ...s.edges, [edge.id]: edge } : s.edges,
        }));
        // A node dropped in from a phone or an agent has no coordinates.
        if (node.placement?.x == null) void get().runAutoLayout(false);
        return;
      }

      case "node.transcluded": {
        if (e.mapId !== mapId) return;
        const node = e.payload as DMNode;
        set((s) => ({ nodes: { ...s.nodes, [node.id]: node } }));
        return;
      }

      case "node.updated": {
        const node = e.payload as DMNode;
        set((s) => {
          const existing = s.nodes[node.id];
          if (!existing) return s;
          // Keep our placement: the update is map-agnostic and carries none.
          return {
            nodes: { ...s.nodes, [node.id]: { ...node, placement: existing.placement } },
          };
        });
        return;
      }

      case "node.moved": {
        if (e.mapId !== mapId) return;
        const { nodeId, x, y } = e.payload as { nodeId: string; x: number; y: number };
        set((s) => {
          const n = s.nodes[nodeId];
          if (!n) return s;
          return {
            nodes: {
              ...s.nodes,
              [nodeId]: { ...n, placement: { ...(n.placement ?? emptyPlacement()), x, y } },
            },
          };
        });
        return;
      }

      case "node.deleted":
      case "node.removedFromMap": {
        const { nodeId } = e.payload as { nodeId: string };
        set((s) => dropNode(s, nodeId));
        return;
      }

      case "edge.created": {
        if (e.mapId !== mapId) return;
        const edge = e.payload as DMEdge;
        set((s) => ({ edges: { ...s.edges, [edge.id]: edge } }));
        return;
      }

      case "edge.deleted": {
        const { edgeId } = e.payload as { edgeId: string };
        set((s) => {
          const next = { ...s.edges };
          delete next[edgeId];
          return { edges: next };
        });
        return;
      }

      case "group.saved": {
        if (e.mapId !== mapId) return;
        const g = e.payload as DMGroup;
        set((s) => ({ groups: { ...s.groups, [g.id]: g } }));
        return;
      }

      case "group.deleted": {
        const { groupId } = e.payload as { groupId: string };
        set((s) => {
          const next = { ...s.groups };
          delete next[groupId];
          return { groups: next };
        });
        return;
      }

      case "map.created":
      case "map.updated":
      case "map.deleted":
        void api.listMaps().then((maps) => set({ maps }));
        return;
    }
  },

  setConnected: (v) => set({ connected: v }),

  toast: (message, kind = "error") => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
    setTimeout(() => get().dismissToast(id), kind === "error" ? 7000 : 3500);
  },

  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

// --- helpers ---------------------------------------------------------------

function emptyPlacement() {
  return { x: null, y: null, collapsed: false, addedAt: new Date().toISOString() };
}

function dropNode(s: GraphState, nodeId: string) {
  const nodes = { ...s.nodes };
  delete nodes[nodeId];
  const edges = Object.fromEntries(
    Object.entries(s.edges).filter(
      ([, e]) => e.sourceNodeId !== nodeId && e.targetNodeId !== nodeId,
    ),
  );
  return {
    nodes,
    edges,
    selectedId: s.selectedId === nodeId ? null : s.selectedId,
  };
}

function childrenOf(s: GraphState, nodeId: string) {
  return Object.values(s.edges).filter((e) => e.targetNodeId === nodeId);
}

/** Finds empty canvas space to the right of everything already placed. */
function freeSpot(nodes: DMNode[]) {
  let maxX = 0;
  let sumY = 0;
  let n = 0;
  for (const node of nodes) {
    if (node.placement?.x == null) continue;
    maxX = Math.max(maxX, node.placement.x);
    sumY += node.placement.y ?? 0;
    n++;
  }
  return { x: maxX + 320, y: n ? sumY / n : 0 };
}

export function describe(err: unknown): string {
  if (err instanceof ApiError) return err.humanMessage;
  if (err instanceof Error) return err.message;
  return String(err);
}
