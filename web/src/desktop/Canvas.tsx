import { useCallback, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
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
import { NODE_H, NODE_W } from "../layout/autoLayout";
import { useGraph } from "../store/useGraph";
import { isFilterActive, useUI } from "../store/useUI";
import { REL_LABELS, type DMNode, type NodeType } from "../types";

const nodeTypes = { ibis: NodeCard, groupBox: GroupBox };

const TYPE_COLORS: Record<NodeType, string> = {
  question: "#7aa2f7",
  idea: "#e0af68",
  pro: "#9ece6a",
  con: "#f7768e",
  note: "#9aa5b1",
  map: "#bb9af7",
};

function CanvasInner() {
  const flowRef = useRef<ReactFlowInstance | null>(null);
  const [armedGroup, setArmedGroup] = useState(false);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const rf = useReactFlow();

  const nodes = useGraph((s) => s.nodes);
  const edges = useGraph((s) => s.edges);
  const groups = useGraph((s) => s.groups);
  const selectedId = useGraph((s) => s.selectedId);
  const select = useGraph((s) => s.select);
  const moveNode = useGraph((s) => s.moveNode);
  const link = useGraph((s) => s.link);
  const unlink = useGraph((s) => s.unlink);
  const createRoot = useGraph((s) => s.createRoot);
  const saveGroup = useGraph((s) => s.saveGroup);

  const ui = useUI();

  const visible = useVisibleSet();

  /** Store nodes → React Flow nodes. Group boxes are laid in behind. */
  const rfNodes = useMemo<RFNode[]>(() => {
    const boxes: RFNode[] = Object.values(groups).map((g) => ({
      id: g.id,
      type: "groupBox",
      position: { x: g.x, y: g.y },
      data: { group: g },
      draggable: true,
      selectable: false,
      zIndex: -1,
      style: { width: g.w, height: g.h },
    }));

    const cards: RFNode[] = Object.values(nodes).map((n) => ({
      id: n.id,
      type: "ibis",
      position: { x: n.placement?.x ?? 0, y: n.placement?.y ?? 0 },
      selected: n.id === selectedId,
      data: { node: n, dimmed: !visible.has(n.id) } satisfies NodeCardData,
      zIndex: 1,
    }));

    return [...boxes, ...cards];
  }, [nodes, groups, selectedId, visible]);

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
      // Position is owned by the store, so only drag-end is persisted; React
      // Flow's own position updates are handled by re-deriving rfNodes.
      for (const c of changes) {
        if (c.type === "select" && c.selected) select(c.id);
      }
    },
    [select],
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

  return (
    <div
      className={`canvas ${armedGroup ? "canvas--arming" : ""}`}
      onPointerDown={(ev) => {
        if (!armedGroup) return;
        const p = rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
        dragStart.current = p;
        ui.setDrawingGroup({ x: p.x, y: p.y, w: 0, h: 0 });
      }}
      onPointerMove={(ev) => {
        if (!armedGroup || !dragStart.current) return;
        const p = rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
        const s = dragStart.current;
        ui.setDrawingGroup({
          x: Math.min(s.x, p.x),
          y: Math.min(s.y, p.y),
          w: Math.abs(p.x - s.x),
          h: Math.abs(p.y - s.y),
        });
      }}
      onPointerUp={() => {
        const box = ui.drawingGroup;
        dragStart.current = null;
        setArmedGroup(false);
        ui.setDrawingGroup(null);
        if (box && box.w > 40 && box.h > 40) {
          void saveGroup({ ...box, title: "Cluster", color: "slate" });
        }
      }}
    >
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onInit={(inst) => (flowRef.current = inst)}
        onNodesChange={onNodesChange}
        onConnect={onConnect}
        onNodeDragStop={(_, node) => {
          if (node.type === "groupBox") {
            const g = groups[node.id];
            if (g) void saveGroup({ ...g, x: node.position.x, y: node.position.y });
            return;
          }
          moveNode(node.id, node.position.x, node.position.y);
        }}
        onNodeClick={(_, node) => node.type !== "groupBox" && select(node.id)}
        onNodeDoubleClick={(_, node) => {
          if (node.type === "groupBox") return;
          useGraph.getState().beginEdit(node.id);
        }}
        onEdgeDoubleClick={(_, edge) => void unlink(edge.id)}
        onPaneClick={() => select(null)}
        onDoubleClick={(ev) => {
          if (armedGroup) return;
          const p = rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
          void createRoot("question", p.x - NODE_W / 2, p.y - NODE_H / 2);
        }}
        // Panning with the left button keeps the canvas feeling like a map;
        // selection boxes are a rarer action and get the shift modifier.
        panOnDrag={!armedGroup}
        selectionOnDrag={false}
        nodesDraggable={ui.layoutMode === "freeform"}
        minZoom={0.08}
        maxZoom={2.5}
        proOptions={{ hideAttribution: false }}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        deleteKeyCode={null}
        multiSelectionKeyCode={null}
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

        {ui.drawingGroup && (
          <div
            className="group-preview"
            style={{
              transform: `translate(${ui.drawingGroup.x}px, ${ui.drawingGroup.y}px)`,
              width: ui.drawingGroup.w,
              height: ui.drawingGroup.h,
            }}
          />
        )}
      </ReactFlow>

      <button
        className={`canvas__group-btn ${armedGroup ? "is-armed" : ""}`}
        onClick={() => setArmedGroup((v) => !v)}
        title="Draw a bounding box around a cluster"
      >
        {armedGroup ? "Drag to draw a group — Esc to cancel" : "⬚ Group"}
      </button>

      {isFilterActive(ui) && (
        <button className="canvas__filter-note" onClick={ui.resetFilters}>
          Filtered — showing {visible.size} of {Object.keys(nodes).length} · clear
        </button>
      )}
    </div>
  );
}

/**
 * Which nodes are "relevant" under the current filter.
 *
 * Filtering fades rather than hides, and pulls in one hop of context: an open
 * Question with its Ideas removed is not a useful thing to look at. This is
 * what makes "show only open questions and connected ideas" behave the way the
 * phrase suggests.
 */
function useVisibleSet(): Set<string> {
  const nodes = useGraph((s) => s.nodes);
  const edges = useGraph((s) => s.edges);
  const ui = useUI();

  return useMemo(() => {
    const all = Object.values(nodes);
    if (!isFilterActive(ui)) return new Set(all.map((n) => n.id));

    const q = ui.filterQuery.trim().toLowerCase();
    const direct = new Set<string>();

    for (const n of all) {
      if (!ui.typeFilter.has(n.type)) continue;
      if (!ui.statusFilter.has(n.content.status)) continue;
      if (ui.tagFilter && !n.content.tags.includes(ui.tagFilter)) continue;
      if (ui.filterPreset === "shared" && n.mapCount < 2) continue;
      if (
        q &&
        !n.title.toLowerCase().includes(q) &&
        !n.content.markdown.toLowerCase().includes(q)
      )
        continue;
      direct.add(n.id);
    }

    // One hop of neighbours, so matched nodes keep the arguments attached to
    // them. Two hops would defeat the point of filtering at all.
    const withContext = new Set(direct);
    for (const e of Object.values(edges)) {
      if (direct.has(e.targetNodeId)) withContext.add(e.sourceNodeId);
      if (direct.has(e.sourceNodeId)) withContext.add(e.targetNodeId);
    }
    return withContext;
  }, [nodes, edges, ui]);
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
