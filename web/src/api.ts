import type {
  Asset,
  DMEdge,
  DMGroup,
  DMMap,
  DMNode,
  Graph,
  Grammar,
  IbisViolation,
  MobileAccess,
  NodeType,
  Relationship,
  Status,
  UndoResult,
  UndoState,
} from "./types";

/**
 * A stable per-tab id.
 *
 * The server stamps it on broadcast events so this tab can ignore echoes of
 * its own writes, and — more importantly — undo history is scoped to it.
 *
 * Kept in sessionStorage, which is per-tab and survives a reload. Generating a
 * fresh id on every load silently emptied the undo history whenever the page
 * refreshed, which defeated the point of keeping that history on the server.
 * localStorage would be wrong in the other direction: two tabs would share one
 * history, so undo in one would reverse work done in the other.
 */
function stableClientID(): string {
  const fresh = () =>
    globalThis.crypto?.randomUUID?.() ?? `c${Math.random().toString(36).slice(2)}`;
  try {
    const existing = sessionStorage.getItem("dm:clientId");
    if (existing) return existing;
    const id = fresh();
    sessionStorage.setItem("dm:clientId", id);
    return id;
  } catch {
    // Private browsing or a blocked storage partition: fall back to a
    // per-load id. Undo still works, it just does not survive a reload.
    return fresh();
  }
}

export const CLIENT_ID = stableClientID();

/** Thrown for any non-2xx response, carrying the server's structured detail. */
export class ApiError extends Error {
  status: number;
  detail: IbisViolation;

  constructor(status: number, detail: IbisViolation) {
    super(detail.error || `request failed (${status})`);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }

  /** True when the write was rejected by the IBIS grammar rather than failing. */
  get isGrammarViolation() {
    return this.detail.kind === "ibis_violation";
  }

  /**
   * A sentence a person can act on. The Go layer already computes the legal
   * alternatives, so the UI never has to reimplement the ruleset.
   */
  get humanMessage() {
    const d = this.detail;
    if (!this.isGrammarViolation) return this.message;
    const head = d.reason ?? this.message;
    if (!d.suggestions?.length) return head;
    return `${head}. Legal here: ${d.suggestions.join(", ")}`;
  }
}

/**
 * Called after any successful non-GET request.
 *
 * Undo depth changes on every write, and the toolbar needs to know so it can
 * enable its buttons and name what Ctrl+Z would reverse. Hooking it here means
 * one interception point instead of a refresh call bolted onto every mutation
 * in the store — the kind of thing that gets forgotten on the next one added.
 */
let mutationListener: (() => void) | null = null;

export function onMutation(fn: () => void) {
  mutationListener = fn;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "X-Client-Id": CLIENT_ID,
      ...(init?.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  });

  const method = (init?.method ?? "GET").toUpperCase();

  if (res.status === 204) {
    if (method !== "GET") mutationListener?.();
    return undefined as T;
  }

  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, body ?? { error: res.statusText });
  if (method !== "GET") mutationListener?.();
  return body as T;
}

const json = (body: unknown) => JSON.stringify(body);

export const api = {
  health: () => request<{ ok: boolean; root: string }>("/api/health"),
  grammar: () => request<Grammar>("/api/grammar"),

  listMaps: () => request<{ maps: DMMap[] }>("/api/maps").then((r) => r.maps),
  createMap: (name: string, description = "") =>
    request<DMMap>("/api/maps", { method: "POST", body: json({ Name: name, Description: description }) }),
  renameMap: (id: string, name: string, description = "") =>
    request<DMMap>(`/api/maps/${id}`, { method: "PATCH", body: json({ Name: name, Description: description }) }),
  deleteMap: (id: string) => request<void>(`/api/maps/${id}`, { method: "DELETE" }),

  graph: (mapId: string) => request<Graph>(`/api/maps/${mapId}/graph`),

  /**
   * Creates a node and, when a parent is given, the connecting edge in one
   * transaction. The capture loop depends on this being a single round trip:
   * two calls would let a keystroke land between them and attach to the wrong
   * parent.
   */
  createNode: (input: {
    type: NodeType;
    title: string;
    mapId: string;
    x?: number;
    y?: number;
    parentId?: string;
    relationshipType?: Relationship;
    edgeDirection?: "from" | "to";
    source?: string;
    content?: Partial<DMNode["content"]>;
  }) =>
    request<{ node: DMNode; edge: DMEdge | null }>("/api/nodes", {
      method: "POST",
      body: json(input),
    }),

  getNode: (id: string, mapId?: string) =>
    request<DMNode>(`/api/nodes/${id}${mapId ? `?mapId=${mapId}` : ""}`),

  updateNode: (
    id: string,
    patch: {
      title?: string;
      type?: NodeType;
      markdown?: string;
      tags?: string[];
      status?: Status;
      assets?: Asset[];
      links?: { url: string; title?: string }[];
    },
  ) => request<DMNode>(`/api/nodes/${id}`, { method: "PATCH", body: json(patch) }),

  moveNode: (
    mapId: string,
    nodeId: string,
    pos: { x?: number; y?: number; collapsed?: boolean; groupId?: string | null },
  ) =>
    request<{ ok: boolean }>(`/api/nodes/${nodeId}/placement`, {
      method: "PUT",
      body: json({ mapId, ...pos }),
    }),

  /** Adds an existing node to this map. The node is shared, not copied. */
  transclude: (mapId: string, nodeId: string, x?: number, y?: number) =>
    request<DMNode>(`/api/nodes/${nodeId}/transclude`, {
      method: "POST",
      body: json({ mapId, x, y }),
    }),

  /** Removes a node from one map, leaving it intact everywhere else. */
  removeFromMap: (mapId: string, nodeId: string) =>
    request<void>(`/api/nodes/${nodeId}?mapId=${mapId}`, { method: "DELETE" }),

  /** Destroys a node on every map it appears in. */
  deleteEverywhere: (nodeId: string) =>
    request<void>(`/api/nodes/${nodeId}?everywhere=true`, { method: "DELETE" }),

  createEdge: (
    mapId: string,
    sourceNodeId: string,
    targetNodeId: string,
    relationshipType?: Relationship,
  ) =>
    request<DMEdge>("/api/edges", {
      method: "POST",
      body: json({ mapId, sourceNodeId, targetNodeId, relationshipType }),
    }),

  deleteEdge: (id: string, mapId: string) =>
    request<void>(`/api/edges/${id}?mapId=${mapId}`, { method: "DELETE" }),

  /** Gathers the given nodes into a group. The request is the selection. */
  createGroup: (mapId: string, nodeIds: string[], title = "Cluster", color = "slate") =>
    request<DMGroup>("/api/groups", {
      method: "POST",
      body: json({ mapId, nodeIds, title, color }),
    }),

  renameGroup: (id: string, title: string, color?: string) =>
    request<DMGroup>(`/api/groups/${id}`, {
      method: "PATCH",
      body: json({ Title: title, Color: color ?? "" }),
    }),

  /** Shifts every member by the same offset. Sent once, on drag end. */
  moveGroup: (mapId: string, id: string, dx: number, dy: number) =>
    request<{ ok: boolean }>(`/api/groups/${id}/move`, {
      method: "POST",
      body: json({ mapId, dx, dy }),
    }),

  /** Replaces membership. An empty list dissolves the group. */
  setGroupMembers: (mapId: string, id: string, nodeIds: string[]) =>
    request<DMGroup | void>(`/api/groups/${id}/members`, {
      method: "PUT",
      body: json({ mapId, nodeIds }),
    }),

  /** Dissolves a group, leaving its nodes where they are. */
  deleteGroup: (id: string, mapId: string) =>
    request<void>(`/api/groups/${id}?mapId=${mapId}`, { method: "DELETE" }),

  search: (q: string, excludeMapId?: string, limit = 30) => {
    const p = new URLSearchParams({ q, limit: String(limit) });
    if (excludeMapId) p.set("excludeMapId", excludeMapId);
    return request<{ nodes: DMNode[] }>(`/api/search?${p}`).then((r) => r.nodes);
  },

  feed: (mapId?: string, limit = 100) => {
    const p = new URLSearchParams({ limit: String(limit) });
    if (mapId) p.set("mapId", mapId);
    return request<{ nodes: DMNode[] }>(`/api/feed?${p}`).then((r) => r.nodes);
  },

  /**
   * Undo is server-side and scoped to this client, so pressing Ctrl+Z only
   * ever walks back your own actions — never a node someone just added from
   * their phone.
   */
  undo: (mapId?: string) =>
    request<UndoResult>(`/api/undo${mapId ? `?mapId=${mapId}` : ""}`, { method: "POST" }),
  redo: (mapId?: string) =>
    request<UndoResult>(`/api/redo${mapId ? `?mapId=${mapId}` : ""}`, { method: "POST" }),

  /** Depth and labels, for enabling and titling the toolbar buttons. */
  undoState: (mapId?: string) =>
    request<UndoState>(`/api/undo${mapId ? `?mapId=${mapId}` : ""}`),

  /**
   * Where a phone should point. Answered by the server because only it knows
   * which interface it is bound to and what this session's access key is.
   */
  mobileAccess: () => request<MobileAccess>("/api/mobile"),

  uploadAsset: async (file: File, nodeId?: string) => {
    const fd = new FormData();
    fd.append("file", file);
    if (nodeId) fd.append("nodeId", nodeId);
    return request<{ asset: Asset; storagePath: string }>("/api/assets", {
      method: "POST",
      body: fd,
    });
  },
};
