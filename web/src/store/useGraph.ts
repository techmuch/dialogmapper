import { create } from "zustand";
import { ApiError, CLIENT_ID, api, onMutation } from "../api";
import { autoLayout, freeSpot } from "../layout/autoLayout";
import { NODE_LABELS, REL_LABELS, hierarchicalRels } from "../types";
import type {
  DMEdge,
  DMGroup,
  DMMap,
  DMNode,
  Grammar,
  NodeType,
  Relationship,
  ServerEvent,
  Status,
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
  /**
   * Additional nodes selected alongside it, for grouping and bulk moves.
   * selectedId is always the anchor and is never in this set.
   */
  multiSelected: Set<string>;
  /** Non-null while a node's title is being typed inline. */
  editingId: string | null;
  loading: boolean;
  connected: boolean;
  toasts: Toast[];

  /** How many of this client's own actions can be reversed. */
  undoDepth: number;
  redoDepth: number;
  /** Labels for the next undo/redo, shown as button tooltips. */
  nextUndoLabel: string | null;
  nextRedoLabel: string | null;

  bootstrap: () => Promise<void>;
  openMap: (mapId: string) => Promise<void>;
  reload: () => Promise<void>;

  select: (id: string | null) => void;
  /** Replaces the whole selection, e.g. after a marquee drag. */
  setSelection: (ids: string[]) => void;
  /** Adds or removes one node from the selection (shift-click). */
  toggleSelected: (id: string) => void;
  /** Every currently selected node, anchor first. */
  selectedIds: () => string[];
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
  /** Applies one change to every selected node, as a single undoable action. */
  bulkUpdate: (ops: {
    addTags?: string[];
    removeTags?: string[];
    status?: Status;
  }) => Promise<void>;
  /** Gathers the current selection into a group. */
  groupSelection: () => Promise<void>;
  /** Dissolves a group, leaving its nodes where they are. */
  deleteGroup: (id: string) => Promise<void>;
  renameGroup: (id: string, title: string) => Promise<void>;
  /** Shifts a group's members locally, during a drag. */
  shiftGroupLocal: (groupId: string, dx: number, dy: number) => void;
  /** Persists a finished group drag as one offset. */
  commitGroupMove: (groupId: string, dx: number, dy: number) => Promise<void>;
  runAutoLayout: (persist?: boolean) => Promise<void>;

  undo: () => Promise<void>;
  redo: () => Promise<void>;
  refreshUndoState: () => Promise<void>;

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
  multiSelected: new Set<string>(),
  editingId: null,
  loading: true,
  connected: false,
  toasts: [],
  undoDepth: 0,
  redoDepth: 0,
  nextUndoLabel: null,
  nextRedoLabel: null,

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
      // Undo history is server-side, so it survives a reload — the buttons
      // must reflect that on first paint rather than appearing empty.
      await get().refreshUndoState();
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

  /**
   * Refetches the current map in place.
   *
   * Deliberately not `openMap(mapId)`, which clears the selection and flips
   * `loading`. That is right when you switch maps and wrong for a refetch: a
   * retype or an undo would drop the node out of the details panel, so the
   * panel emptied itself exactly when you wanted to see the result of what you
   * just did.
   *
   * The selection is pruned to nodes that still exist, since a reload may
   * follow a delete.
   */
  reload: async () => {
    const id = get().mapId;
    if (!id) return;
    try {
      const g = await api.graph(id);
      const nodes = byId(g.nodes);
      set((s) => ({
        map: g.map,
        nodes,
        edges: byId(g.edges),
        groups: byId(g.groups),
        selectedId: s.selectedId && nodes[s.selectedId] ? s.selectedId : null,
        multiSelected: new Set([...s.multiSelected].filter((n) => nodes[n])),
      }));
      // A reload can be the first sight of nodes made blind by an agent, a
      // phone or the CLI, which arrive with no coordinates.
      if (g.nodes.some((n) => n.placement?.x == null)) {
        await get().runAutoLayout(true);
      }
    } catch (err) {
      get().toast(describe(err));
    }
  },

  select: (id) => set({ selectedId: id, multiSelected: new Set(), editingId: null }),

  setSelection: (ids) =>
    set({
      selectedId: ids[0] ?? null,
      multiSelected: new Set(ids.slice(1)),
      editingId: null,
    }),

  toggleSelected: (id) =>
    set((s) => {
      if (s.selectedId === id) {
        // Deselecting the anchor promotes one of the others so the keyboard
        // always has something to act on.
        const rest = [...s.multiSelected];
        return {
          selectedId: rest[0] ?? null,
          multiSelected: new Set(rest.slice(1)),
          editingId: null,
        };
      }
      const next = new Set(s.multiSelected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return s.selectedId
        ? { multiSelected: next, editingId: null }
        : { selectedId: id, multiSelected: new Set(), editingId: null };
    }),

  selectedIds: () => {
    const { selectedId, multiSelected } = get();
    return selectedId ? [selectedId, ...multiSelected] : [...multiSelected];
  },

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
      // Roll back only if the node is still here. Ctrl+Z while typing commits
      // the field and undoes in the same breath; the commit then fails against
      // a node the undo has already removed, and an unconditional rollback
      // resurrected it on the canvas after the graph had been refetched.
      set((s) => (s.nodes[id] ? { nodes: { ...s.nodes, [id]: node } } : s));
      if (get().nodes[id]) get().toast(describe(err));
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
    // Then nudged clear of anything already there. The offset alone knows
    // nothing about other branches, so two of them growing at once used to put
    // cards exactly on top of each other.
    const { x, y } = freeSpot(
      px + 40 + siblings * 24,
      py + 150 + siblings * 12,
      Object.values(nodes)
        .map((n) => n.placement)
        .filter((p): p is NonNullable<typeof p> => p?.x != null && p?.y != null)
        .map((p) => ({ x: p.x!, y: p.y! })),
    );

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
    const retyping = patch.type !== undefined && patch.type !== before?.type;
    // A retype relabels the node's edges, so the relationships on screen are
    // about to be stale. Remember them to report what actually changed.
    const relsBefore = retyping
      ? new Map(Object.values(get().edges).map((e) => [e.id, e.relationshipType]))
      : null;

    try {
      const updated = await api.updateNode(id, patch);
      set((s) => ({
        nodes: {
          ...s.nodes,
          [id]: { ...updated, placement: before?.placement ?? updated.placement },
        },
      }));

      if (retyping) {
        await get().reload();
        const changed = Object.values(get().edges).filter(
          (e) => relsBefore!.get(e.id) && relsBefore!.get(e.id) !== e.relationshipType,
        );
        // Relabelling is a structural change the user did not explicitly ask
        // for, so it is stated rather than left to be noticed.
        get().toast(
          changed.length === 0
            ? `Now a ${NODE_LABELS[updated.type]}.`
            : `Now a ${NODE_LABELS[updated.type]} — ${changed.length} link${
                changed.length > 1 ? "s" : ""
              } relabelled to ${[...new Set(changed.map((e) => REL_LABELS[e.relationshipType]))].join(", ")}.`,
          "info",
        );
      }
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
    const spot = spaceToTheRight(Object.values(nodes));
    try {
      const node = await api.transclude(mapId, nodeId, spot.x, spot.y);
      set((s) => ({ nodes: { ...s.nodes, [node.id]: node }, selectedId: node.id }));
      get().toast(`Inserted "${node.title}" — shared with ${node.mapCount} maps`, "info");
    } catch (err) {
      get().toast(describe(err));
    }
  },

  bulkUpdate: async (ops) => {
    const ids = get().selectedIds();
    if (ids.length === 0) return;
    try {
      const { nodes } = await api.bulkUpdate(ids, ops);
      // Merge rather than reload: the response carries the authoritative node
      // state, and a full refetch would drop the selection the user is still
      // working with.
      set((s) => {
        const next = { ...s.nodes };
        for (const n of nodes) {
          const existing = next[n.id];
          next[n.id] = { ...n, placement: existing?.placement ?? n.placement };
        }
        return { nodes: next };
      });
    } catch (err) {
      get().toast(describe(err));
    }
  },

  groupSelection: async () => {
    const { mapId } = get();
    const ids = get().selectedIds();
    if (!mapId) return;
    if (ids.length < 2) {
      get().toast("Select two or more nodes to group them — shift-click, or shift-drag a box.", "info");
      return;
    }
    try {
      const saved = await api.createGroup(mapId, ids);
      set((s) => ({ groups: { ...s.groups, [saved.id]: saved } }));
      // Refetch: grouping can pull nodes out of another group, which changes
      // that group's membership too.
      await get().reload();
      get().toast(`Grouped ${ids.length} nodes`, "info");
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

  renameGroup: async (id, title) => {
    try {
      const saved = await api.renameGroup(id, title);
      set((s) => ({ groups: { ...s.groups, [saved.id]: saved } }));
    } catch (err) {
      get().toast(describe(err));
    }
  },

  /**
   * Shifts a group's members locally, without touching the server.
   *
   * Called on every frame of a drag. The outline is derived from the members,
   * so moving them is what makes the box follow the cursor — the box is never
   * moved directly.
   */
  shiftGroupLocal: (groupId, dx, dy) => {
    const group = get().groups[groupId];
    if (!group) return;
    set((s) => {
      const nodes = { ...s.nodes };
      for (const id of group.nodeIds) {
        const n = nodes[id];
        if (!n?.placement || n.placement.x == null || n.placement.y == null) continue;
        nodes[id] = {
          ...n,
          placement: { ...n.placement, x: n.placement.x + dx, y: n.placement.y + dy },
        };
      }
      return { nodes };
    });
  },

  /**
   * Persists a completed group drag as a single offset.
   *
   * One write per gesture rather than one per frame, which also means one
   * undo entry for the whole drag.
   */
  commitGroupMove: async (groupId, dx, dy) => {
    const { mapId } = get();
    if (!mapId || (dx === 0 && dy === 0)) return;
    try {
      await api.moveGroup(mapId, groupId, dx, dy);
    } catch (err) {
      get().toast(describe(err));
      // The local positions are now a guess; take the server's word for it.
      await get().reload();
    }
  },

  runAutoLayout: async (persist = true) => {
    const { nodes, edges, mapId } = get();
    if (!mapId) return;
    const placed = autoLayout(
      Object.values(nodes),
      Object.values(edges),
      hierarchicalRels(get().grammar),
    );

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
   * Undo, performed server-side and scoped to this client.
   *
   * The whole graph is refetched afterwards rather than patched locally. A
   * single undo can restore a node, its placements on several maps and every
   * edge that pointed at it; reconstructing that from a diff is exactly the
   * kind of thing that silently drifts out of sync, and correctness matters
   * more here than one round trip.
   */
  undo: async () => {
    const { mapId } = get();
    try {
      const res = await api.undo(mapId ?? undefined);
      if (!res.applied) {
        get().toast("Nothing left to undo.", "info");
        return;
      }
      await get().reload();
      await get().refreshUndoState();
      // Naming what was reversed is most of undo's value: it tells the user
      // whether the thing that vanished is the thing they meant to remove.
      get().toast(`Undone: ${res.entry?.label ?? "last change"}`, "info");
    } catch (err) {
      get().toast(describe(err));
    }
  },

  redo: async () => {
    const { mapId } = get();
    try {
      const res = await api.redo(mapId ?? undefined);
      if (!res.applied) {
        get().toast("Nothing left to redo.", "info");
        return;
      }
      await get().reload();
      await get().refreshUndoState();
      get().toast(`Redone: ${res.entry?.label ?? "last change"}`, "info");
    } catch {
      // A failed redo is not worth interrupting the user over; the button
      // state refreshes on the next action anyway.
    }
  },

  refreshUndoState: async () => {
    const { mapId } = get();
    try {
      const s = await api.undoState(mapId ?? undefined);
      set({
        undoDepth: s.undoDepth,
        redoDepth: s.redoDepth,
        nextUndoLabel: s.nextUndo?.label ?? null,
        nextRedoLabel: s.nextRedo?.label ?? null,
      });
    } catch {
      // Button affordances only; not worth surfacing.
    }
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
function spaceToTheRight(nodes: DMNode[]) {
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

// Refresh undo depth after any write, coalesced so that a fast capture run
// issues one request rather than one per keystroke.
let undoRefreshTimer: ReturnType<typeof setTimeout> | undefined;
onMutation(() => {
  clearTimeout(undoRefreshTimer);
  undoRefreshTimer = setTimeout(() => {
    void useGraph.getState().refreshUndoState();
  }, 250);
});

export function describe(err: unknown): string {
  if (err instanceof ApiError) return err.humanMessage;
  if (err instanceof Error) return err.message;
  return String(err);
}
