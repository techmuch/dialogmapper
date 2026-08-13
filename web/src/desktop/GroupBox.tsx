import { memo, useState } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { useGraph } from "../store/useGraph";
import type { DMGroup } from "../types";

/**
 * A bounding box drawn around a cluster of nodes.
 *
 * Groups are purely spatial: they carry no IBIS meaning and create no edges.
 * That is intentional — teams cluster by theme, by owner, by "we'll come back
 * to this", and encoding those as relationships would pollute the argument
 * structure that the export relies on.
 */
function GroupBoxImpl({ data, selected }: NodeProps) {
  const { group } = data as unknown as { group: DMGroup };
  const saveGroup = useGraph((s) => s.saveGroup);
  const deleteGroup = useGraph((s) => s.deleteGroup);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(group.title);

  return (
    <div className={`group ${selected ? "is-selected" : ""}`}>
      <NodeResizer
        minWidth={120}
        minHeight={80}
        isVisible
        lineClassName="group__resize-line"
        handleClassName="group__resize-handle"
        onResizeEnd={(_, params) =>
          void saveGroup({
            ...group,
            x: params.x,
            y: params.y,
            w: params.width,
            h: params.height,
          })
        }
      />
      <div className="group__label nodrag">
        {editing ? (
          <input
            autoFocus
            className="group__input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              setEditing(false);
              if (draft !== group.title) void saveGroup({ ...group, title: draft });
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
            <span onDoubleClick={() => setEditing(true)}>{group.title || "Cluster"}</span>
            <button
              className="group__delete"
              title="Remove this grouping (nodes are kept)"
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
