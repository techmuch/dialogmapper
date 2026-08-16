import { memo, useRef, useState } from "react";
import { useStore, type NodeProps } from "@xyflow/react";
import { useGraph } from "../store/useGraph";
import type { DMGroup } from "../types";

export interface GroupBoxData extends Record<string, unknown> {
  group: DMGroup;
  width: number;
  height: number;
}

/**
 * The outline drawn around a group's members.
 *
 * It has no geometry of its own: position and size are computed from where the
 * members are (see groupBounds in Canvas.tsx) and handed in as data. Dragging
 * it moves the members, and the outline follows because it is derived from
 * them — which is the whole difference between a group and a backdrop.
 *
 * There is no resize handle for the same reason. Making the box bigger would
 * not mean anything; membership is what defines the bounds, so the way to
 * change them is to change who is in the group.
 */
function GroupBoxImpl({ data }: NodeProps) {
  const { group } = data as unknown as GroupBoxData;
  const deleteGroup = useGraph((s) => s.deleteGroup);
  const renameGroup = useGraph((s) => s.renameGroup);
  const setSelection = useGraph((s) => s.setSelection);
  const shiftGroupLocal = useGraph((s) => s.shiftGroupLocal);
  const commitGroupMove = useGraph((s) => s.commitGroupMove);

  // Screen pixels become flow units by dividing by the zoom, so a drag tracks
  // the cursor at any zoom level.
  const zoom = useStore((s) => s.transform[2]);

  const [editing, setEditing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [draft, setDraft] = useState(group.title);

  const drag = useRef<{ lastX: number; lastY: number; total: { x: number; y: number } } | null>(
    null,
  );

  /**
   * The drag is handled here rather than by React Flow.
   *
   * React Flow drives a node's position from the `position` prop, but this
   * outline's position is derived from its members — which this very drag is
   * moving. Letting React Flow drag it meant its internal drag state and the
   * recomputed prop fought each other every frame, and the group ended up
   * short of the cursor by a growing margin.
   *
   * Handling the pointer directly keeps one source of truth: the members move,
   * and the outline is recomputed from them.
   */
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // The label row is controls, not canvas: renaming, selecting members and
    // ungrouping all live there. Starting a drag from it would swallow the
    // double-click that opens the rename field.
    if ((e.target as HTMLElement).closest(".group__label")) return;
    e.stopPropagation(); // do not pan the canvas
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { lastX: e.clientX, lastY: e.clientY, total: { x: 0, y: 0 } };
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const state = drag.current;
    if (!state) return;
    const dx = (e.clientX - state.lastX) / zoom;
    const dy = (e.clientY - state.lastY) / zoom;
    if (dx === 0 && dy === 0) return;
    state.lastX = e.clientX;
    state.lastY = e.clientY;
    state.total.x += dx;
    state.total.y += dy;
    shiftGroupLocal(group.id, dx, dy);
  };

  const endDrag = (e: React.PointerEvent) => {
    const state = drag.current;
    drag.current = null;
    setDragging(false);
    if (!state) return;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    // One write for the whole gesture, which is also one undo entry.
    void commitGroupMove(group.id, state.total.x, state.total.y);
  };

  return (
    <div
      // `nopan` is React Flow's own opt-out. Its pane drag is driven by
      // d3-zoom listening for mousedown, which a React pointerdown handler
      // cannot stop — so without this the canvas panned at the same time as
      // the members moved, and the group appeared to travel twice as far as
      // the cursor.
      className={`group nopan ${dragging ? "is-dragging" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div className="group__label nodrag">
        {editing ? (
          <input
            autoFocus
            className="group__input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              setEditing(false);
              if (draft !== group.title) void renameGroup(group.id, draft);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setDraft(group.title);
                setEditing(false);
              }
            }}
          />
        ) : (
          <>
            <button
              className="group__title"
              title="Rename this group"
              onClick={() => setEditing(true)}
              onDoubleClick={() => setEditing(true)}
            >
              {group.title || "Cluster"}
            </button>
            <span className="group__count">{group.nodeIds.length}</span>
            <button
              className="group__select"
              title="Select every node in this group"
              onClick={() => setSelection(group.nodeIds)}
            >
              ◎
            </button>
            <button
              className="group__delete"
              title="Ungroup — the nodes stay exactly where they are"
              onClick={() => void deleteGroup(group.id)}
            >
              ×
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export const GroupBox = memo(GroupBoxImpl);
export default GroupBox;
