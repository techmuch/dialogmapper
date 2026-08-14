// Mirrors the Go structs in internal/store and internal/ibis. Kept hand-written
// rather than generated: the surface is small, and a generator would be one
// more thing to run before the build.

export type NodeType = "note" | "question" | "idea" | "pro" | "con" | "map";

export type Relationship =
  | "responds_to"
  | "questions"
  | "supports"
  | "objects_to"
  | "relates_to"
  | "specializes";

export type Status = "open" | "resolved" | "rejected" | "parked";

export interface Asset {
  path: string;
  kind: "image" | "file";
  caption?: string;
  mime?: string;
  bytes?: number;
}

export interface Link {
  url: string;
  title?: string;
}

export interface NodeContent {
  markdown: string;
  tags: string[];
  status: Status;
  assets: Asset[];
  links: Link[];
  source?: string;
}

export interface Placement {
  x: number | null;
  y: number | null;
  collapsed: boolean;
  groupId?: string | null;
  addedAt: string;
}

export interface DMNode {
  id: string;
  type: NodeType;
  title: string;
  content: NodeContent;
  mapRefId?: string;
  createdAt: string;
  updatedAt: string;
  placement?: Placement | null;
  /** >1 means the node is transcluded — shared with other maps, not copied. */
  mapCount: number;
  mapIds?: string[];
}

export interface DMEdge {
  id: string;
  mapId: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationshipType: Relationship;
  createdAt: string;
}

export interface DMGroup {
  id: string;
  mapId: string;
  title: string;
  color: string;
  x: number;
  y: number;
  w: number;
  h: number;
  createdAt: string;
}

export interface DMMap {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  nodeCount?: number;
}

export interface Graph {
  map: DMMap;
  nodes: DMNode[];
  edges: DMEdge[];
  groups: DMGroup[];
}

export interface GrammarRule {
  relationship: Relationship;
  sources: NodeType[];
  targets: NodeType[];
  hierarchical: boolean;
  description: string;
}

export interface Grammar {
  nodeTypes: NodeType[];
  rules: GrammarRule[];
}

/** Server-sent state changes. Payload shape varies by type. */
export interface ServerEvent {
  type:
    | "hello"
    | "map.created"
    | "map.updated"
    | "map.deleted"
    | "node.created"
    | "node.updated"
    | "node.deleted"
    | "node.moved"
    | "node.transcluded"
    | "node.removedFromMap"
    | "edge.created"
    | "edge.deleted"
    | "group.saved"
    | "group.deleted"
    | "graph.invalidated";
  mapId?: string;
  origin?: string;
  payload?: any;
}

/** One reversible action from the server's undo journal. */
export interface UndoEntry {
  id: number;
  mapId: string;
  actor: string;
  action: string;
  /** Human phrasing, e.g. `added Pro "Fewer weekend pages"`. */
  label: string;
}

export interface UndoResult {
  applied: boolean;
  /** Present when nothing was left to undo — not an error, just the end. */
  reason?: string;
  entry?: UndoEntry;
  undoDepth?: number;
  redoDepth?: number;
}

export interface UndoState {
  undoDepth: number;
  redoDepth: number;
  nextUndo: UndoEntry | null;
  nextRedo: UndoEntry | null;
}

/** The structured 422 the server returns when an edge breaks IBIS rules. */
export interface IbisViolation {
  error: string;
  kind?: "ibis_violation" | "conflict";
  source?: NodeType;
  target?: NodeType;
  relationship?: Relationship;
  reason?: string;
  suggestions?: string[];
}

export const NODE_LABELS: Record<NodeType, string> = {
  question: "Question",
  idea: "Idea",
  pro: "Pro",
  con: "Con",
  note: "Note",
  map: "Map",
};

/** Single-character glyphs, matching the markdown export markers. */
export const NODE_GLYPHS: Record<NodeType, string> = {
  question: "?",
  idea: "!",
  pro: "+",
  con: "−",
  note: "·",
  map: "#",
};

export const REL_LABELS: Record<Relationship, string> = {
  responds_to: "responds to",
  questions: "questions",
  supports: "supports",
  objects_to: "objects to",
  relates_to: "relates to",
  specializes: "specializes",
};
