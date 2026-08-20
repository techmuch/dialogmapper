import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
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
import { autoLayout, NODE_H, NODE_W, type Pos } from "../layout/autoLayout";
import { useGraph } from "../store/useGraph";
import { filterState, isFilterActive, useUI } from "../store/useUI";
import { REL_LABELS, hierarchicalRels, type DMNode, type NodeType } from "../types";
import { ZOOM_PRESETS, panDelta, snapZoom } from "./viewport";

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
  positionOf: (id: string) => Pos | null,
  measured: Map<string, { width?: number; height?: number } | undefined>,
): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const id of memberIds) {
    // Reads the *effective* position, not the saved one: under auto layout
    // the two differ, and an outline drawn from saved positions would sit
    // somewhere its members are not.
    const p = positionOf(id);
    if (!p) continue;
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
  const wrapRef = useRef<HTMLDivElement | null>(null);
  /** False until the opening fitView has finished; see onMoveEnd. */
  const settled = useRef(false);
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
  const groupSelection = useGraph((s) => s.groupSelection);
  const runAutoLayout = useGraph((s) => s.runAutoLayout);
  const grammar = useGraph((s) => s.grammar);

  const ui = useUI();

  const visible = useVisibleSet();

  /**
   * Auto layout is a *view*, not a stored arrangement.
   *
   * It recomputes from the graph on every change, so it is exactly what you
   * would get by holding down `l` — which is what "auto" always claimed to be
   * and never was. Previously it ran once when you switched it on and then
   * never again, so every node added afterwards kept the crude offset from its
   * parent that `createChild` guesses, and nodes under different parents piled
   * up on top of each other. That is the stacking.
   *
   * Deriving rather than writing is also what lets hand-placed positions
   * survive: `placement` is never touched while auto is on, so switching back
   * to freeform puts everything exactly where its owner left it.
   */
  const autoPositions = useMemo(
    () =>
      ui.layoutMode === "auto"
        ? autoLayout(Object.values(nodes), Object.values(edges), hierarchicalRels(grammar))
        : null,
    [ui.layoutMode, nodes, edges, grammar],
  );

  const positionOf = useCallback(
    (id: string): Pos | null => {
      const auto = autoPositions?.get(id);
      if (auto) return auto;
      const p = nodes[id]?.placement;
      return p && p.x != null && p.y != null ? { x: p.x, y: p.y } : null;
    },
    [autoPositions, nodes],
  );

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
        const bounds = groupBounds(g.nodeIds, positionOf, measured);
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
        position: positionOf(n.id) ?? { x: 0, y: 0 },
        selected: n.id === selectedId || multiSelected.has(n.id),
        data: { node: n, dimmed: !visible.has(n.id) } satisfies NodeCardData,
        zIndex: 1,
        measured: measured.get(n.id),
      }));

      return [...boxes, ...cards];
    });
  }, [nodes, groups, selectedId, multiSelected, visible, positionOf]);

  /**
   * Keep the node being edited fully on screen.
   *
   * A new node is created relative to whatever was selected, so during a fast
   * capture run it regularly lands past the edge of the viewport — you get a
   * cursor in a title field you cannot see, and the first thing you know about
   * it is that your typing went somewhere invisible.
   *
   * The pan is the smallest one that works and only happens when the node is
   * actually clipped, because moving the map when nothing was wrong is its own
   * kind of disorienting. Zoom is never touched: that belongs to the user and,
   * if they have pinned it, to the zoom control.
   */
  const editingId = useGraph((s) => s.editingId);
  useEffect(() => {
    const flow = flowRef.current;
    if (!editingId || !flow) return;

    let cancelled = false;
    // React Flow hides a node until it has measured it, so its size is not
    // known for the first few frames after creation — the same window that
    // makes focusing a new title field need a retry.
    const deadline = performance.now() + 1000;
    const attempt = () => {
      if (cancelled) return;
      const el = wrapRef.current;
      const n = flow.getNode(editingId);
      if (!el || !n?.measured?.width) {
        if (performance.now() < deadline) requestAnimationFrame(attempt);
        return;
      }
      const { x: vx, y: vy, zoom } = flow.getViewport();
      const box = el.getBoundingClientRect();
      const delta = panDelta(
        {
          x: n.position.x * zoom + vx,
          y: n.position.y * zoom + vy,
          width: (n.measured.width ?? NODE_W) * zoom,
          height: (n.measured.height ?? NODE_H) * zoom,
        },
        { x: 0, y: 0, width: box.width, height: box.height },
      );
      if (delta) {
        void flow.setViewport(
          { x: vx + delta.dx, y: vy + delta.dy, zoom },
          { duration: 200 },
        );
      }
    };
    requestAnimationFrame(attempt);
    return () => {
      cancelled = true;
    };
  }, [editingId]);

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
    return groupBounds(ids, positionOf, measured);
  }, [selectionCount, selectedId, multiSelected, positionOf, rfNodes]);

  return (
    <div className="canvas" ref={wrapRef}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onInit={(inst) => {
          flowRef.current = inst;
          // fitView runs on first paint and picks its own zoom, so a pinned
          // level has to be reapplied afterwards or it would only take effect
          // the next time something asked for it.
          setTimeout(() => (settled.current = true), 500);
        }}
        onNodesChange={onNodesChange}
        onConnect={onConnect}
        onNodeDragStart={(_, node) => {
          if (node.type === "groupBox" || ui.layoutMode !== "auto") return;
          // Moving a node by hand is a statement that you want to arrange this
          // map yourself, so auto layout steps aside.
          //
          // The current auto positions are saved first — the same write `l`
          // performs — so the rest of the map stays exactly where it appears
          // to be. Without that, every other node would snap back to whatever
          // was saved before auto was switched on, and the map would rearrange
          // itself under the cursor mid-drag.
          void runAutoLayout(true);
          ui.setLayoutMode("freeform");
        }}
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
          // Opens the details panel on this node. It used to start an inline
          // rename, which `F2` still does — but double-click is the gesture
          // people try when they want to see more, not type over what is
          // already there.
          ui.toggleSidebar();
        }}
        onEdgeDoubleClick={(_, edge) => void unlink(edge.id)}
        onPaneClick={() => select(null)}
        // There was an onDoubleClick here that created a root Question at the
        // pointer. It never once did that: React Flow binds d3-zoom's
        // `dblclick.zoom` to the pane, which stops propagation, so the handler
        // was unreachable from empty canvas. It only ever fired when the
        // double-click landed on a card or an edge — where d3-zoom is not
        // listening — and there it dropped a stray Question behind whatever had
        // been clicked. The single observable behaviour of the feature was its
        // own bug. Double-clicking the canvas zooms, which is React Flow's
        // default and what was really happening all along.
        // Plain drag pans, because the canvas should feel like a map. Shift
        // drags a selection box and shift-click extends the selection, which
        // is the convention every other canvas tool uses.
        panOnDrag
        selectionOnDrag
        selectionKeyCode="Shift"
        multiSelectionKeyCode="Shift"
        // Draggable in both modes. Auto layout used to lock nodes down, which
        // meant the only way out of it was finding the toolbar toggle;
        // dragging is the obvious gesture and now does the right thing.
        nodesDraggable
        minZoom={0.08}
        maxZoom={2.5}
        proOptions={{ hideAttribution: false }}
        fitView
        // Clamping fitView's own min and max to the pinned level is what makes
        // the opening frame honour it. Applying the zoom afterwards instead
        // loses a race: fitView runs after onInit and would overwrite it.
        fitViewOptions={
          ui.zoomSetting === "auto"
            ? { padding: 0.25 }
            : { padding: 0.25, minZoom: ui.zoomSetting, maxZoom: ui.zoomSetting }
        }
        // The pinned level follows zooming rather than fighting it, so the
        // control always names the zoom you are actually looking at.
        //
        // Ignored until the first paint has settled: fitView runs on mount and
        // picks its own zoom, which would otherwise overwrite the pinned level
        // before the user had done anything — their setting would silently
        // reset on every page load. After that, moves that keep the pinned
        // zoom write nothing, so the only thing that reaches here is somebody
        // actually changing the zoom.
        onMoveEnd={() => {
          const flow = flowRef.current;
          const pinned = useUI.getState().zoomSetting;
          if (!settled.current || !flow || pinned === "auto") return;
          const snapped = snapZoom(flow.getZoom());
          if (snapped !== pinned) useUI.getState().setZoomSetting(snapped);
        }}
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
        <Panel position="bottom-left" className="zoompick">
          <label>
            <span className="zoompick__label">Zoom</span>
            <select
              value={ui.zoomSetting === "auto" ? "auto" : String(ui.zoomSetting)}
              onChange={(e) => {
                const next =
                  e.target.value === "auto" ? "auto" : Number(e.target.value);
                ui.setZoomSetting(next);
                // Apply it now rather than waiting for the next tidy. Picking
                // a zoom and watching nothing happen reads as a broken control.
                if (next !== "auto") void flowRef.current?.zoomTo(next, { duration: 200 });
              }}
              title="Auto lets tidying pick the zoom. A fixed level survives L, F and auto layout."
            >
              <option value="auto">Auto</option>
              {ZOOM_PRESETS.map((z) => (
                <option key={z} value={z}>
                  {Math.round(z * 100)}%
                </option>
              ))}
            </select>
          </label>
        </Panel>
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
