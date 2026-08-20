import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  ViewportPortal,
  type Connection,
  type Edge as RFEdge,
  type Node as RFNode,
  type NodeChange,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import GroupBox from "./GroupBox";
import NodeCard, { type NodeCardData } from "./NodeCard";
import { useKeyboard } from "./useKeyboard";
import { computeVisible } from "../filter";
import { NODE_H, NODE_W } from "../layout/autoLayout";
import { useGraph } from "../store/useGraph";
import { filterState, isFilterActive, useUI } from "../store/useUI";
import { REL_LABELS, hierarchicalRels, type DMNode, type NodeType } from "../types";

const nodeTypes = { ibis: NodeCard, groupBox: GroupBox };

const TYPE_COLORS: Record<NodeType, string> = {
  question: "#7aa2f7",
  idea: "#e0af68",
  pro: "#9ece6a",
  con: "#f7768e",
  note: "#9aa5b1",
  map: "#bb9af7",
};

/** Padding between a group's members and the outline drawn around them. */
const GROUP_PADDING = 26;
/** Room above the box for its label. */
const GROUP_LABEL_SPACE = 22;

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The rectangle enclosing a group's members, plus padding.
 *
 * Derived rather than stored: the box is a view of where the nodes are, so a
 * member that moves takes the outline with it and the two can never disagree.
 * Returns null when nothing measurable is in the group, in which case there is
 * nothing to draw.
 */
function groupBounds(
  memberIds: string[],
  nodes: Record<string, DMNode>,
  measured: Map<string, { width?: number; height?: number } | undefined>,
): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const id of memberIds) {
    const p = nodes[id]?.placement;
    if (!p || p.x == null || p.y == null) continue;
    const size = measured.get(id);
    const w = size?.width ?? NODE_W;
    const h = size?.height ?? NODE_H;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + w);
    maxY = Math.max(maxY, p.y + h);
  }
  if (!Number.isFinite(minX)) return null;

  return {
    x: minX - GROUP_PADDING,
    y: minY - GROUP_PADDING - GROUP_LABEL_SPACE,
    width: maxX - minX + GROUP_PADDING * 2,
    height: maxY - minY + GROUP_PADDING * 2 + GROUP_LABEL_SPACE,
  };
}

function CanvasInner() {
  const flowRef = useRef<ReactFlowInstance | null>(null);
  const rf = useReactFlow();
  // Reactive zoom, so outlines stay a constant on-screen weight while zooming
  // rather than only being right at first render.
  const zoom = useStore((s) => s.transform[2]);

  const nodes = useGraph((s) => s.nodes);
  const edges = useGraph((s) => s.edges);
  const groups = useGraph((s) => s.groups);
  const selectedId = useGraph((s) => s.selectedId);
  const multiSelected = useGraph((s) => s.multiSelected);
  const select = useGraph((s) => s.select);
  const setSelection = useGraph((s) => s.setSelection);
  const toggleSelected = useGraph((s) => s.toggleSelected);
  const moveNode = useGraph((s) => s.moveNode);
  const link = useGraph((s) => s.link);
  const unlink = useGraph((s) => s.unlink);
  const createRoot = useGraph((s) => s.createRoot);
  const groupSelection = useGraph((s) => s.groupSelection);

  const ui = useUI();

  const visible = useVisibleSet();

  /**
   * React Flow nodes, derived from the store but held in local state.
   *
   * The local copy exists so that onNodesChange can apply React Flow's own
   * updates — in particular the "dimensions" change it emits after measuring
   * each card. Those measurements are what the minimap and fitView read; an
   * earlier version discarded every change and re-derived purely from the
   * store, so nothing was ever measured and the minimap rendered empty.
   *
   * Re-deriving preserves `measured`, otherwise every store update would
   * throw the measurements away again.
   */
  const [rfNodes, setRfNodes] = useState<RFNode[]>([]);

  useEffect(() => {
    setRfNodes((prev) => {
      const measured = new Map(prev.map((n) => [n.id, n.measured]));

      // Group outlines are computed from their members, so they update for
      // free whenever a member moves — including mid-drag.
      const boxes: RFNode[] = [];
      for (const g of Object.values(groups)) {
        const bounds = groupBounds(g.nodeIds, nodes, measured);
        if (!bounds) continue;
        boxes.push({
          id: g.id,
          type: "groupBox",
          position: { x: bounds.x, y: bounds.y },
          data: { group: g, width: bounds.width, height: bounds.height },
          // Not draggable by React Flow: its position is derived from the
          // members, so GroupBox handles the pointer itself. See the comment
          // there for why the two cannot both drive it.
          draggable: false,
          selectable: false,
          // Behind the cards, so clicking a node inside a group selects the
          // node and dragging the surrounding space moves the whole group.
          zIndex: -1,
          style: { width: bounds.width, height: bounds.height },
          measured: { width: bounds.width, height: bounds.height },
        });
      }

      const cards: RFNode[] = Object.values(nodes).map((n) => ({
        id: n.id,
        type: "ibis",
        position: { x: n.placement?.x ?? 0, y: n.placement?.y ?? 0 },
        selected: n.id === selectedId || multiSelected.has(n.id),
        data: { node: n, dimmed: !visible.has(n.id) } satisfies NodeCardData,
        zIndex: 1,
        measured: measured.get(n.id),
      }));

      return [...boxes, ...cards];
    });
  }, [nodes, groups, selectedId, multiSelected, visible]);

  const rfEdges = useMemo<RFEdge[]>(
    () =>
      Object.values(edges).map((e) => {
        const lit = visible.has(e.sourceNodeId) && visible.has(e.targetNodeId);
        return {
          id: e.id,
          source: e.sourceNodeId,
          target: e.targetNodeId,
          label: REL_LABELS[e.relationshipType],
          animated: false,
          className: `edge edge--${e.relationshipType} ${lit ? "" : "is-dimmed"}`,
          // The label states the IBIS relationship explicitly. An unlabelled
          // arrow is exactly the ambiguity this tool exists to remove.
          labelBgPadding: [4, 2] as [number, number],
          labelBgBorderRadius: 3,
          style: { stroke: edgeColor(e.relationshipType), strokeWidth: 1.5 },
        };
      }),
    [edges, visible],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // Apply everything React Flow reports — measurements, drag positions,
      // selection. The store stays the source of truth for *persisted*
      // position: only drag-end writes back, so a drag is one round trip
      // rather than one per frame.
      setRfNodes((ns) => applyNodeChanges(changes, ns));

      // Selection changes arrive as a batch, including the deselections that
      // a marquee produces. Reading the whole batch keeps multi-select and
      // single click on one code path.
      const selects = changes.filter(
        (c): c is NodeChange & { type: "select"; id: string; selected: boolean } =>
          c.type === "select",
      );
      if (selects.length === 0) return;

      setRfNodes((ns) => {
        const chosen = ns
          .filter((n) => n.type === "ibis" && n.selected)
          .map((n) => n.id);
        // Defer, because this runs inside a state updater.
        queueMicrotask(() => {
          const current = useGraph.getState();
          const same =
            chosen.length === current.selectedIds().length &&
            chosen.every((id) => id === current.selectedId || current.multiSelected.has(id));
          if (!same) setSelection(chosen);
        });
        return ns;
      });
    },
    [setSelection],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target) return;
      // No relationship is passed: the backend infers the only sensible one
      // for this pair of types, or explains why there isn't one.
      void link(c.source, c.target);
    },
    [link],
  );

  useKeyboard({
    flow: flowRef.current,
    visibleNodes: useMemo(
      () => Object.values(nodes).filter((n) => visible.has(n.id)),
      [nodes, visible],
    ),
  });

  const selectionCount = selectedId ? 1 + multiSelected.size : 0;

  // Show the user what grouping the current selection would enclose, before
  // they commit to it.
  const pendingBounds = useMemo(() => {
    if (selectionCount < 2) return null;
    const ids = selectedId ? [selectedId, ...multiSelected] : [];
    const measured = new Map(rfNodes.map((n) => [n.id, n.measured]));
    return groupBounds(ids, nodes, measured);
  }, [selectionCount, selectedId, multiSelected, nodes, rfNodes]);

  return (
    <div className="canvas">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onInit={(inst) => (flowRef.current = inst)}
        onNodesChange={onNodesChange}
        onConnect={onConnect}
        onNodeDragStop={(_, node) => {
          // Group outlines are dragged by GroupBox itself, so anything React
          // Flow reports here is a node.
          if (node.type === "groupBox") return;
          moveNode(node.id, node.position.x, node.position.y);
        }}
        onNodeClick={(ev, node) => {
          if (node.type === "groupBox") return;
          // Shift-click adds to the selection, which is how a group gets
          // assembled out of nodes that a marquee would not cleanly enclose.
          if (ev.shiftKey) toggleSelected(node.id);
          else select(node.id);
        }}
        onNodeDoubleClick={(_, node) => {
          if (node.type === "groupBox") return;
          useGraph.getState().beginEdit(node.id);
        }}
        onEdgeDoubleClick={(_, edge) => void unlink(edge.id)}
        onPaneClick={() => select(null)}
        onDoubleClick={(ev) => {
          const p = rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
          void createRoot("question", p.x - NODE_W / 2, p.y - NODE_H / 2);
        }}
        // Plain drag pans, because the canvas should feel like a map. Shift
        // drags a selection box and shift-click extends the selection, which
        // is the convention every other canvas tool uses.
        panOnDrag
        selectionOnDrag
        selectionKeyCode="Shift"
        multiSelectionKeyCode="Shift"
        nodesDraggable={ui.layoutMode === "freeform"}
        minZoom={0.08}
        maxZoom={2.5}
        proOptions={{ hideAttribution: false }}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        deleteKeyCode={null}
        // React Flow makes node wrappers focusable and focuses the newly
        // selected one for its own keyboard accessibility. That fires after
        // the title editor has focused itself, so pressing `q` opened an
        // editor and then quietly moved focus to the wrapper div — the user
        // typed and nothing landed, which breaks the entire capture loop.
        // Selection and arrow-key navigation are ours (see useKeyboard), so
        // React Flow has no reason to manage focus here.
        nodesFocusable={false}
        edgesFocusable={false}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} />
        <Controls position="bottom-left" showInteractive={false} />
        {ui.showMinimap && (
          <MiniMap
            position="bottom-right"
            pannable
            zoomable
            className="minimap"
            nodeColor={(n) =>
              n.type === "groupBox"
                ? "transparent"
                : TYPE_COLORS[(n.data as unknown as NodeCardData).node.type]
            }
            nodeStrokeWidth={0}
            maskColor="rgba(10,12,16,0.72)"
          />
        )}

        {/*
          A preview of what grouping the current selection would enclose.
          Rendered inside the viewport transform so its flow coordinates line
          up with the cursor — as a plain child of <ReactFlow> it would be
          positioned in screen pixels and drift by the current pan.
        */}
        <ViewportPortal>
          {pendingBounds && (
            <div
              className="group-preview"
              style={{
                transform: `translate(${pendingBounds.x}px, ${pendingBounds.y}px)`,
                width: pendingBounds.width,
                height: pendingBounds.height,
                // Everything inside the viewport scales with zoom, which would
                // make the outline a hairline when zoomed out. Dividing by
                // zoom keeps it a constant weight on screen.
                borderWidth: 1.5 / zoom,
              }}
            />
          )}
        </ViewportPortal>
      </ReactFlow>

      {selectionCount >= 2 && (
        <button
          className="canvas__group-btn is-armed"
          onClick={() => void groupSelection()}
          title="Group the selected nodes so they move together (g)"
        >
          ⬚ Group {selectionCount} nodes
        </button>
      )}

      {isFilterActive(ui) && (
        <button className="canvas__filter-note" onClick={ui.resetFilters}>
          Filtered — showing {visible.size} of {Object.keys(nodes).length} · clear
        </button>
      )}
    </div>
  );
}

/**
 * Which nodes survive the current filter.
 *
 * Filtering fades rather than hides, so the map keeps its shape and you keep
 * your spatial memory of where things are.
 *
 * The rules themselves live in ../filter.ts, which is pure and unit tested.
 * They used to live here and expanded every match by one hop in each
 * direction, which quietly pulled back in whatever had just been excluded —
 * filtering by anything showed almost everything.
 */
function useVisibleSet(): Set<string> {
  const nodes = useGraph((s) => s.nodes);
  const edges = useGraph((s) => s.edges);
  const grammar = useGraph((s) => s.grammar);
  const ui = useUI();

  return useMemo(() => {
    const all = Object.values(nodes);
    if (!isFilterActive(ui)) return new Set(all.map((n) => n.id));
    return computeVisible(all, Object.values(edges), filterState(ui), hierarchicalRels(grammar));
  }, [nodes, edges, grammar, ui]);
}

function edgeColor(rel: string): string {
  switch (rel) {
    case "supports":
      return "#9ece6a";
    case "objects_to":
      return "#f7768e";
    case "responds_to":
      return "#7aa2f7";
    case "questions":
      return "#bb9af7";
    case "specializes":
      return "#e0af68";
    default:
      return "#4b5563";
  }
}

export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}

export default Canvas;
export type { DMNode };
